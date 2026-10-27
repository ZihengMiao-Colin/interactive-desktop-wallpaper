/**
 * ============================================================================
 * main.js — Electron 主进程入口
 * ============================================================================
 *
 * 职责：
 *   1. 创建无边框、透明的 BrowserWindow 并注入到桌面 WorkerW 层
 *   2. 管理系统托盘图标和菜单
 *   3. 监听全屏应用状态，控制渲染暂停/恢复
 *   4. 通过 IPC 与渲染进程通信（图片上传、参数配置、深度图缓存）
 *   5. 管理开机自启
 *
 * 启动流程：
 *   app.whenReady()
 *     → 初始化 electron-store（数据持久化）
 *     → 创建壁纸窗口 → 注入 WorkerW 层
 *     → 创建系统托盘
 *     → 启动全屏检测轮询
 *     → 注册 IPC 处理器
 * ============================================================================
 */

const {
    app,
    BrowserWindow,
    Tray,
    Menu,
    ipcMain,
    dialog,
    nativeImage,
    powerMonitor,
    screen,
    shell,
} = require('electron');

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// ---- 自定义模块 ----
const { injectToWallpaperLayer, restoreFromWallpaperLayer } = require('./src/wallpaper-native');
const { createTray, updateTrayMenu } = require('./src/tray-manager');
const { FullscreenDetector } = require('./src/fullscreen-detector');
const { AppStore } = require('./src/store');
const { registerElementsIpc } = require('./src/elements/ipc');
const { PlacementController } = require('./src/elements/placement-controller');
const { upsertInstance } = require('./shared/elements-model');
const { migrateLegacySticker } = require('./src/elements/migrate');
const { cleanupOrphanFiles } = require('./src/elements/library');
const { loadGallery, findGalleryEntry, migrateLegacyImagePath } = require('./src/gallery');

// ==================== 全局状态 ====================

/** 壁纸窗口引用 */
let wallpaperWindow = null;

/** 设置窗口引用 */
let settingsWindow = null;

/** 系统托盘引用 */
let tray = null;

/** 全屏检测器 */
let fullscreenDetector = null;

/** 数据持久化 */
let store = null;

/** 渲染是否活跃 */
let isRenderingActive = true;

/** 自定义元素摆放模式会话 */
let placement = null;

/** 默认壁纸图库（项目 wallpapers/ 目录），启动时读取 */
let gallery = [];

/**
 * 主动要求壁纸窗口重绘一次。
 *
 * 窗口注入到 WorkerW 之后，Chromium 的合成器需要一次 resize/重绘
 * 才会把画面提交到"刚变成子窗口"的 HWND 上；否则要等桌面下次重绘
 * （比如点一下"显示桌面"）壁纸才出现。
 *
 * @param {BrowserWindow} win
 * @param {number} width
 * @param {number} height
 */
function nudgeWallpaperRepaint(win, width, height) {
    if (!win || win.isDestroyed()) return;

    try {
        // 尺寸没变也会走一遍 Chromium 的 resize → 重绘流程
        win.setBounds({ x: 0, y: 0, width, height });
        win.webContents.invalidate();
        win.showInactive();
    } catch (_) {
        // 窗口正在销毁时忽略
    }
}

/** 是否为开发模式 */
const isDev = process.argv.includes('--dev');

// ==================== 壁纸窗口创建 ====================

/**
 * 创建壁纸 BrowserWindow。
 *
 * 关键配置：
 *   - type: 'toolbar' → 在 Windows 上使窗口行为类似桌面组件
 *   - transparent: true → 透明背景（让桌面图标可见）
 *   - skipTaskbar: true → 不在任务栏显示
 *   - focusable: false → 不接受焦点（点击穿透到桌面图标）
 *   - alwaysOnTop: false → 不置顶（在 WorkerW 层之后处理层级）
 *   - frame: false → 无边框
 */
function createWallpaperWindow() {
    // 壁纸要铺满整个屏幕（含任务栏所在的区域），所以取 bounds 而不是 workAreaSize
    const { width, height } = screen.getPrimaryDisplay().bounds;

    wallpaperWindow = new BrowserWindow({
        width: width,
        height: height,
        x: 0,
        y: 0,
        type: 'toolbar',
        transparent: true,
        frame: false,
        skipTaskbar: true,
        focusable: false,
        alwaysOnTop: false,
        hasShadow: false,
        thickFrame: false,
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        show: false,                 // 先隐藏，注入 WorkerW 后再显示
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,   // 安全：隔离渲染进程
            nodeIntegration: false,   // 安全：禁止渲染进程访问 Node.js
            sandbox: false,           // 需要 preload 访问 Node API
            webgl: true,              // Pixi.js 需要 WebGL
            webSecurity: false,       // 允许直接播放本地视频/音频与纹理
            offscreen: false,
        },
    });

    // 加载壁纸页面
    wallpaperWindow.loadFile('index.html');

    // 隐藏右键菜单（壁纸不需要）
    wallpaperWindow.hookWindowMessage(0x0112, () => {
        wallpaperWindow.setEnabled(false);
        wallpaperWindow.setEnabled(true);
    });

    // 窗口准备好后注入 WorkerW 层
    wallpaperWindow.once('ready-to-show', () => {
        // 读取缓存的配置发送给渲染进程
        const cachedConfig = store.getConfig();
        wallpaperWindow.webContents.send('config:load', cachedConfig);

        // 启动全局鼠标位置轮询（WorkerW 层收不到 mousemove 事件）
        startMousePolling(wallpaperWindow);

        // 注入到桌面 WorkerW 层（壁纸核心步骤）——异步执行，不阻塞主进程。
        //
        // 注入完成前不显示窗口：这段时间它还是个普通顶层窗口，
        // 显示出来会盖住用户所有程序（表现："启动后壁纸把整个屏幕都盖住了"）。
        // 等注入有结果再决定怎么显示。
        const hwnd = wallpaperWindow.getNativeWindowHandle();
        injectToWallpaperLayer(hwnd, width, height).then((injected) => {
            if (!wallpaperWindow || wallpaperWindow.isDestroyed()) return;

            if (injected) {
                console.log('[Main] WorkerW injected, window mounted as desktop wallpaper layer');

                wallpaperWindow.show();

                // 挂载后立刻催一次重绘，并在 1.5s / 4s 后各补一次，
                // 防止首次合成没跟上导致壁纸"消失"
                nudgeWallpaperRepaint(wallpaperWindow, width, height);
                setTimeout(() => nudgeWallpaperRepaint(wallpaperWindow, width, height), 1500);
                setTimeout(() => nudgeWallpaperRepaint(wallpaperWindow, width, height), 4000);
                return;
            }

            console.warn('[Main] WorkerW injection failed, using fallback mode');
            // Fallback: 普通窗口模式。
            // 关键：打开鼠标穿透，否则这个铺满屏幕的窗口会把桌面图标的
            // 点击/右键全部吃掉（用户表现为"桌面图标点不动"）。
            wallpaperWindow.setAlwaysOnTop(false);
            wallpaperWindow.setIgnoreMouseEvents(true);
            wallpaperWindow.show();
            wallpaperWindow.moveTop();
        });

        // 开发模式下打开 DevTools
        if (isDev) {
            wallpaperWindow.webContents.openDevTools({ mode: 'detach' });
        }
    });

    // 窗口关闭事件
    wallpaperWindow.on('closed', () => {
        stopMousePolling();
        wallpaperWindow = null;
    });

    return wallpaperWindow;
}

// ==================== 全局鼠标位置轮询 ====================

/** 鼠标轮询定时器 */
let mousePollTimer = null;

/** 上一次推送的鼠标坐标（用于去重，鼠标不动就不发 IPC） */
let lastMouseX = null;
let lastMouseY = null;

/**
 * 启动全局鼠标位置轮询。
 *
 * 由于 WorkerW 壁纸层在桌面图标后面，window 的 mousemove 事件无法触发。
 * 因此通过主进程轮询 screen.getCursorScreenPoint() 获取全局鼠标坐标，
 * 并通过 IPC 发送给渲染进程。
 *
 * 做了两处省电处理：
 *   - 坐标没变化时不发送（鼠标静止时几乎零开销）
 *   - 只监控主显示器范围内的坐标
 *
 * @param {BrowserWindow} win - 壁纸窗口
 */
function startMousePolling(win) {
    const POLL_INTERVAL = 1000 / 30; // 30fps，足够流畅且不过度消耗 CPU

    lastMouseX = null;
    lastMouseY = null;

    mousePollTimer = setInterval(() => {
        if (win && !win.isDestroyed()) {
            try {
                const point = screen.getCursorScreenPoint();
                const primaryDisplay = screen.getPrimaryDisplay();
                const { x: screenX, y: screenY, width: screenW, height: screenH } = primaryDisplay.bounds;

                // 仅当鼠标在主显示器上时才发送（多显示器场景的简单处理）
                if (point.x >= screenX && point.x <= screenX + screenW &&
                    point.y >= screenY && point.y <= screenY + screenH) {
                    // 坐标没变就不发，避免鼠标静止时白白唤醒渲染进程
                    if (point.x === lastMouseX && point.y === lastMouseY) return;
                    lastMouseX = point.x;
                    lastMouseY = point.y;

                    win.webContents.send('mouse:move', {
                        x: point.x - screenX,  // 转为相对于主显示器的坐标
                        y: point.y - screenY,
                    });
                }
            } catch (_) {
                // 窗口销毁时可能抛出异常，忽略
            }
        }
    }, POLL_INTERVAL);
}

/** 停止鼠标位置轮询 */
function stopMousePolling() {
    if (mousePollTimer) {
        clearInterval(mousePollTimer);
        mousePollTimer = null;
    }
    lastMouseX = null;
    lastMouseY = null;
}

// ==================== 设置窗口创建 ====================

/**
 * 创建设置窗口（用户更换壁纸、调整参数时使用）。
 */
function createSettingsWindow() {
    if (settingsWindow) {
        settingsWindow.focus();
        return settingsWindow;
    }

    settingsWindow = new BrowserWindow({
        width: 540,
        height: 800,
        resizable: true,
        frame: true,
        title: '互动3D壁纸 - 设置',
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            webSecurity: false,
        },
    });

    settingsWindow.loadFile('settings.html');

    settingsWindow.on('closed', () => {
        settingsWindow = null;
    });

    return settingsWindow;
}

// ==================== 配置广播 ====================

/** 把最新配置推送给壁纸窗口和设置窗口 */
function broadcastConfig() {
    const config = store.getConfig();
    for (const win of [wallpaperWindow, settingsWindow]) {
        if (win && !win.isDestroyed()) win.webContents.send('config:load', config);
    }
}

// ==================== 自定义元素摆放窗口 ====================

/**
 * 创建全屏置顶的摆放窗口，加载壁纸页面的编辑模式。
 * 打开期间暂停真实壁纸的渲染，避免同时跑两个 WebGL 场景。
 */
function createPlacementWindow() {
    const { x, y, width, height } = screen.getPrimaryDisplay().bounds;
    const win = new BrowserWindow({
        x, y, width, height,
        frame: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        focusable: true,
        show: false,
        backgroundColor: '#000000',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            webgl: true,
            webSecurity: false,
        },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.loadFile('index.html', { query: { mode: 'edit' } });
    win.once('ready-to-show', () => {
        win.show();
        win.focus();
    });
    // 主进程兜底：渲染进程出问题时 Esc 仍然能退出摆放模式
    win.webContents.on('before-input-event', (_event, input) => {
        if (input.type === 'keyDown' && input.key === 'Escape') placement.cancel();
    });
    if (isDev) win.webContents.openDevTools({ mode: 'detach' });

    if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
        wallpaperWindow.webContents.send('renderer:pause', { silent: true });
    }
    return win;
}

function createPlacementController() {
    return new PlacementController({
        createWindow: createPlacementWindow,
        onCommit: (instance) => {
            const { customElements } = store.getConfig();
            store.saveConfig({ customElements: upsertInstance(customElements, instance) });
        },
        onEnd: () => {
            if (wallpaperWindow && !wallpaperWindow.isDestroyed() && isRenderingActive) {
                wallpaperWindow.webContents.send('renderer:resume', { silent: true });
            }
            broadcastConfig();
        },
    });
}

// ==================== 换壁纸 ====================

/**
 * 弹出选择壁纸图片的对话框。
 * @returns {Promise<string|null>} 选中的图片路径，取消时为 null
 */
async function showImageDialog() {
    const result = await dialog.showOpenDialog(settingsWindow || wallpaperWindow, {
        title: '选择壁纸图片',
        filters: [{ name: '图片文件', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }],
        properties: ['openFile'],
    });
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
}

/**
 * 把图片应用为桌面壁纸：记住它（重启后还是这张），并通知壁纸窗口加载。
 * 调用前应确保这张图已有深度图缓存。
 * @returns {boolean}
 */
function applyWallpaper(imagePath) {
    if (!wallpaperWindow || wallpaperWindow.isDestroyed()) return false;
    store.saveConfig({ currentImage: imagePath });
    wallpaperWindow.webContents.send('image:new', imagePath);
    // 设置窗口的默认壁纸面板要知道"当前"换成了哪张
    broadcastConfig();
    console.log('[Main] Apply wallpaper:', imagePath);
    return true;
}

/**
 * 托盘"更换壁纸..."：有深度图缓存就直接应用；
 * 没有就打开设置窗口，在那里生成深度图（带进度），生成成功后自动应用。
 */
async function changeWallpaperFromTray() {
    const imagePath = await showImageDialog();
    if (!imagePath) return;

    if (hasDepthMap(imagePath)) {
        applyWallpaper(imagePath);
        return;
    }

    const win = createSettingsWindow();
    const send = () => win.webContents.send('settings:prepareImage', { imagePath });
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
    else send();
}

// ==================== 深度图来源 ====================

/** 默认壁纸用自带的深度图，其他图片用深度图缓存 */
function getDepthDataUrl(imagePath) {
    const entry = findGalleryEntry(gallery, imagePath);
    if (!entry) return store.getDepthCache(imagePath);
    try {
        return 'data:image/png;base64,' + fs.readFileSync(entry.depth).toString('base64');
    } catch (err) {
        console.error('[Main] 读取默认壁纸深度图失败:', err.message);
        return null;
    }
}

/** 这张图是否已有深度图（默认壁纸总是有） */
function hasDepthMap(imagePath) {
    return !!findGalleryEntry(gallery, imagePath) || store.hasDepthCache(imagePath);
}

// ==================== IPC 处理器注册 ====================

function registerIpcHandlers() {

    // ---- 选择新图片（只返回路径，应用要等用户点"应用壁纸"） ----
    ipcMain.handle('dialog:selectImage', () => showImageDialog());

    // ---- 选择本地音乐文件 ----
    ipcMain.handle('dialog:selectAudio', async () => {
        const result = await dialog.showOpenDialog(settingsWindow || wallpaperWindow, {
            title: '选择本地音乐/音频文件',
            filters: [
                { name: '音频文件', extensions: ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac'] },
                { name: '所有文件', extensions: ['*'] }
            ],
            properties: ['openFile'],
        });

        if (result.canceled || result.filePaths.length === 0) {
            return null;
        }

        const filePath = result.filePaths[0];
        const fileName = path.basename(filePath);
        return { path: filePath, name: fileName };
    });

    // ---- 选择唱片中心封面图片 ----
    ipcMain.handle('dialog:selectCover', async () => {
        const result = await dialog.showOpenDialog(settingsWindow || wallpaperWindow, {
            title: '选择唱片中心封面图片',
            filters: [
                { name: '图片文件', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] },
            ],
            properties: ['openFile'],
        });

        if (result.canceled || result.filePaths.length === 0) {
            return null;
        }

        return result.filePaths[0];
    });

    // ---- 选择自定义视频特效文件 ----
    ipcMain.handle('dialog:selectOverlayVideo', async () => {
        const result = await dialog.showOpenDialog(settingsWindow || wallpaperWindow, {
            title: '选择本地视频特效文件',
            filters: [
                { name: '视频文件', extensions: ['mp4', 'webm', 'mov', 'mkv'] },
                { name: '所有文件', extensions: ['*'] }
            ],
            properties: ['openFile'],
        });

        if (result.canceled || result.filePaths.length === 0) {
            return null;
        }

        const filePath = result.filePaths[0];
        const fileName = path.basename(filePath);
        return { path: filePath, name: fileName };
    });

    // ---- 获取内置视频特效列表 ----
    ipcMain.handle('overlay:getPresets', async () => {
        const overlayDir = path.join(__dirname, 'overlay');
        return [
            {
                id: 'rain1',
                title: '细雨蒙蒙',
                desc: '窗前微雨 · 宁静舒适',
                mode: 'screen',
                modeName: '滤色混合',
                path: path.join(overlayDir, 'rain1.mp4'),
                thumb: path.join(overlayDir, 'rain1_thumb.jpg'),
            },
            {
                id: 'rain2',
                title: '暴雨倾盆',
                desc: '2K高清大雨 · 沉浸感强',
                mode: 'screen',
                modeName: '滤色混合',
                path: path.join(overlayDir, 'rain2.mp4'),
                thumb: path.join(overlayDir, 'rain2_thumb.jpg'),
            },
            {
                id: 'snow1',
                title: '唯美落雪',
                desc: '轻柔雪花 · 浪漫冬日',
                mode: 'screen',
                modeName: '滤色混合',
                path: path.join(overlayDir, 'snow1.mp4'),
                thumb: path.join(overlayDir, 'snow1_thumb.jpg'),
            },
            {
                id: 'snow2',
                title: '纯净落雪',
                desc: '绿幕抠图 · 真实雪景',
                mode: 'chroma',
                modeName: '绿幕抠图',
                path: path.join(overlayDir, 'snow2.mp4'),
                thumb: path.join(overlayDir, 'snow2_thumb.jpg'),
            },
            {
                id: 'snow3',
                title: '漫天大雪',
                desc: '密集风雪 · 寒冬飘舞',
                mode: 'screen',
                modeName: '滤色混合',
                path: path.join(overlayDir, 'snow3.mp4'),
                thumb: path.join(overlayDir, 'snow3_thumb.jpg'),
            },
            {
                id: 'old1',
                title: '老电影胶片',
                desc: '复古胶片颗粒 · 怀旧质感',
                mode: 'screen',
                modeName: '滤色混合',
                path: path.join(overlayDir, 'old1.mp4'),
                thumb: path.join(overlayDir, 'old1_thumb.jpg'),
            },
            {
                id: 'old2',
                title: '放映机划痕',
                desc: '经典黑白划痕 · 复古放映',
                mode: 'screen',
                modeName: '滤色混合',
                path: path.join(overlayDir, 'old2.mp4'),
                thumb: path.join(overlayDir, 'old2_thumb.jpg'),
            },
            {
                id: 'old3',
                title: '复古光斑',
                desc: '暖调光斑闪烁 · 电影氛围',
                mode: 'screen',
                modeName: '滤色混合',
                path: path.join(overlayDir, 'old3.mp4'),
                thumb: path.join(overlayDir, 'old3_thumb.jpg'),
            },
        ];
    });

    // ---- 保存深度图到缓存 ----
    ipcMain.handle('cache:saveDepthMap', async (_event, { imagePath, depthDataUrl }) => {
        return store.saveDepthCache(imagePath, depthDataUrl);
    });

    // ---- 读取深度图（默认壁纸用自带的，其他图片读缓存） ----
    ipcMain.handle('cache:getDepthMap', (_event, imagePath) => getDepthDataUrl(imagePath));

    // ---- 默认壁纸图库 ----
    ipcMain.handle('gallery:list', () => gallery);

    // ---- 深度图存放文件夹管理 ----
    ipcMain.handle('depth:getCacheDir', async () => {
        return store.getDepthCacheDir();
    });

    ipcMain.handle('depth:openCacheDir', async () => {
        const dir = store.getDepthCacheDir();
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        await shell.openPath(dir);
        return true;
    });

    ipcMain.handle('depth:selectCacheDir', async () => {
        const result = await dialog.showOpenDialog(settingsWindow || wallpaperWindow, {
            title: '选择深度图存放文件夹',
            defaultPath: store.getDepthCacheDir(),
            properties: ['openDirectory', 'createDirectory'],
        });

        if (result.canceled || result.filePaths.length === 0) {
            return null;
        }

        const newDir = result.filePaths[0];
        return store.setDepthCacheDir(newDir, true);
    });

    // ---- 保存应用配置 ----
    ipcMain.handle('config:save', async (_event, config) => {
        store.saveConfig(config);
        // 实时广播，让视差参数拖动时立刻生效
        broadcastConfig();
        return true;
    });

    // ---- 读取应用配置 ----
    ipcMain.handle('config:get', async () => {
        return store.getConfig();
    });

    // ---- 渲染状态通知 ----
    ipcMain.on('renderer:ready', () => {
        console.log('[Main] Renderer process ready');
        // 通知全屏检测器渲染已准备好
        if (fullscreenDetector) {
            fullscreenDetector.setRendererReady(true);
        }
    });

    ipcMain.on('renderer:depthGenerated', (_event, { imagePath, depthDataUrl }) => {
        store.saveDepthCache(imagePath, depthDataUrl);
    });

    // ---- 打开设置窗口 ----
    ipcMain.handle('app:openSettings', () => {
        createSettingsWindow();
        return true;
    });

    // ---- 开机自启切换 ----
    ipcMain.handle('app:toggleAutoLaunch', async (_event, enabled) => {
        app.setLoginItemSettings({
            openAtLogin: enabled,
            path: process.execPath,
        });
        store.saveConfig({ autoLaunch: enabled });
        return app.getLoginItemSettings().openAtLogin;
    });

    ipcMain.handle('app:getAutoLaunch', async () => {
        return app.getLoginItemSettings().openAtLogin;
    });

    // ---- 生成深度图（调用 Python 脚本） ----
    ipcMain.handle('depth:generate', async (event, { imagePath, modelSize, blurRadius }) => {
        const scriptPath = path.join(__dirname, 'generate_depth_map.py');
        const cacheKey = store._hashPath(imagePath);
        const outputPath = path.join(store._cacheDir, `${cacheKey}.png`);

        const blurVal = (blurRadius !== undefined && blurRadius !== null) ? Number(blurRadius) : 8.0;
        console.log(`[Main] Starting depth generation: ${imagePath} (model: ${modelSize || 'small'}, blur: ${blurVal})`);

        return new Promise((resolve) => {
            const args = ['-X', 'utf8', scriptPath, imagePath, '-o', outputPath];
            if (modelSize) {
                args.push('-m', modelSize);
            }
            args.push('--blur', String(blurVal));

            // 优先使用项目虚拟环境里的 Python（包含所有依赖），找不到则回退到系统 python
            const venvPython = path.join(__dirname, 'venv', 'Scripts', 'python.exe');
            const pythonExe = fs.existsSync(venvPython) ? venvPython : 'python';
            console.log(`[Main] Using Python: ${pythonExe}`);

            const proc = spawn(pythonExe, args, {
                stdio: ['ignore', 'pipe', 'pipe'],
                env: {
                    ...process.env,
                    PYTHONUTF8: '1',
                    PYTHONIOENCODING: 'utf-8',
                },
            });

            let stderr = '';

            proc.stdout.on('data', (data) => {
                const text = data.toString('utf-8');
                const lines = text.split('\n').filter(l => l.trim());
                for (const line of lines) {
                    console.log('[Python]', line);
                    event.sender.send('depth:progress', { message: line.trim() });
                }
            });

            proc.stderr.on('data', (data) => {
                const text = data.toString('utf-8');
                stderr += text;
                console.error('[Python:stderr]', text);
            });

            proc.on('close', async (code) => {
                if (code !== 0) {
                    console.error('[Main] Python exit code:', code);
                    resolve({ success: false, error: stderr || 'Depth map generation failed' });
                    return;
                }

                try {
                    if (!fs.existsSync(outputPath)) {
                        resolve({ success: false, error: `Depth file not generated: ${outputPath}` });
                        return;
                    }

                    const depthData = fs.readFileSync(outputPath);
                    const base64 = depthData.toString('base64');
                    const depthDataUrl = `data:image/png;base64,${base64}`;

                    // 保存到缓存
                    store.saveDepthCache(imagePath, depthDataUrl);

                    console.log('[Main] Depth map generated and cached');

                    resolve({ success: true, depthDataUrl, depthPath: outputPath });
                } catch (err) {
                    console.error('[Main] Failed to read depth map:', err.message);
                    resolve({ success: false, error: err.message });
                }
            });

            proc.on('error', (err) => {
                console.error('[Main] Failed to start Python:', err.message);
                resolve({
                    success: false,
                    error: `Failed to start Python: ${err.message}\nPlease ensure Python is installed and in PATH`,
                });
            });
        });
    });

    // ---- 应用壁纸（从设置窗口触发） ----
    ipcMain.handle('wallpaper:apply', (_event, imagePath) => applyWallpaper(imagePath));

    // ---- 清除深度图缓存 ----
    ipcMain.handle('cache:clearAll', async () => {
        store.clearAllCache();
        return true;
    });

    // ---- 退出应用 ----
    ipcMain.on('app:quit', () => {
        cleanupAndQuit();
    });

    // ---- 自定义元素 ----
    placement = createPlacementController();
    registerElementsIpc({
        ipcMain,
        dialog,
        store,
        elementsDir: path.join(__dirname, 'elements'),
        getDialogParent: () => settingsWindow || wallpaperWindow,
        broadcastConfig,
        placement,
    });
}

// ==================== 全屏检测 ====================

function startFullscreenDetection() {
    fullscreenDetector = new FullscreenDetector({
        pollInterval: 1000,          // 每秒检测一次
        ignorePid: process.pid,      // 本程序的窗口（全屏摆放窗口）不算全屏应用
        onFullscreenStart: () => {
            console.log('[Main] Fullscreen app detected, pausing render');
            isRenderingActive = false;
            if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
                wallpaperWindow.webContents.send('renderer:pause');
            }
        },
        onFullscreenEnd: () => {
            console.log('[Main] Fullscreen app exited, resuming render');
            isRenderingActive = true;
            if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
                wallpaperWindow.webContents.send('renderer:resume');
            }
        },
    });

    fullscreenDetector.start();
}

// ==================== 电源状态监听 ====================

function setupPowerMonitor() {
    // 系统进入睡眠/锁定 → 暂停渲染
    powerMonitor.on('suspend', () => {
        if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
            wallpaperWindow.webContents.send('renderer:pause');
        }
    });

    // 系统唤醒/解锁 → 恢复渲染
    powerMonitor.on('resume', () => {
        if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
            wallpaperWindow.webContents.send('renderer:resume');
        }
    });

    // 锁屏
    powerMonitor.on('lock-screen', () => {
        if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
            wallpaperWindow.webContents.send('renderer:pause');
        }
    });

    // 解锁
    powerMonitor.on('unlock-screen', () => {
        if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
            wallpaperWindow.webContents.send('renderer:resume');
        }
    });
}

// ==================== 清理和退出 ====================

function cleanupAndQuit() {
    console.log('[Main] Cleaning up...');

    // 停止全屏检测
    if (fullscreenDetector) {
        fullscreenDetector.stop();
    }

    // 从 WorkerW 层恢复（可选，防止桌面图标异常）
    if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
        const hwnd = wallpaperWindow.getNativeWindowHandle();
        restoreFromWallpaperLayer(hwnd);
        wallpaperWindow.close();
    }

    // 关闭设置窗口
    if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.close();
    }

    // 销毁托盘
    if (tray) {
        tray.destroy();
    }

    app.quit();
}

// ==================== 应用生命周期 ====================

// 允许壁纸后台播放音频，免除手势交互限制
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

app.whenReady().then(() => {
    console.log('[Main] App starting...');

    // 1. 初始化数据存储
    store = new AppStore();
    console.log('[Main] Data store path:', store.getStorePath());

    // 旧版"自定义贴纸"配置迁移为自定义元素（只会执行一次）
    migrateLegacySticker({
        store,
        screenSize: screen.getPrimaryDisplay().bounds,
        getImageAspect: (imagePath) => {
            const { width, height } = nativeImage.createFromPath(imagePath).getSize();
            return width && height ? width / height : 1;
        },
    });

    // 默认壁纸图库；旧版本直接用 default wallpaper/ 里的原图当壁纸，原图不在了就换成图库里的同一张
    gallery = loadGallery(path.join(__dirname, 'wallpapers'));
    const currentImage = store.getConfig().currentImage;
    const migratedImage = migrateLegacyImagePath(currentImage, gallery);
    if (migratedImage !== currentImage) {
        store.saveConfig({ currentImage: migratedImage });
        console.log('[Main] 当前壁纸已换成图库里的同一张:', migratedImage);
    }

    // 清理上次没删掉的素材副本（移除素材时视频可能正被占用）
    const orphans = cleanupOrphanFiles(store.getElementsDir(), store.getConfig().customElements.library);
    if (orphans.length) console.log('[Main] 已清理无用的素材文件:', orphans);

    // 2. 注册 IPC 处理器
    registerIpcHandlers();

    // 3. 创建壁纸窗口
    createWallpaperWindow();

    // 4. 创建系统托盘
    tray = createTray({
        onOpenSettings: () => createSettingsWindow(),
        onSelectImage: () => changeWallpaperFromTray(),
        onOpenDepthDir: async () => {
            const dir = store.getDepthCacheDir();
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            await shell.openPath(dir);
        },
        onQuit: () => cleanupAndQuit(),
        getAutoLaunch: () => app.getLoginItemSettings().openAtLogin,
        setAutoLaunch: (enabled) => {
            app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath });
        },
    });

    // 5. 启动全屏检测
    startFullscreenDetection();

    // 6. 监听电源事件
    setupPowerMonitor();

    console.log('[Main] App startup complete');
});

// 所有窗口关闭时不退出（壁纸在托盘中常驻）
app.on('window-all-closed', () => {
    // 不退出，由托盘控制
});

// macOS: 从 Dock 激活时重新创建窗口
app.on('activate', () => {
    if (!wallpaperWindow || wallpaperWindow.isDestroyed()) {
        createWallpaperWindow();
    }
});

// 防止应用多开
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        // 第二个实例启动时，打开设置窗口
        createSettingsWindow();
    });
}
