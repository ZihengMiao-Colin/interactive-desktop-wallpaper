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
 * 启动流程（拿到单实例锁之后）：
 *   app.whenReady() → startApp()
 *     → 初始化 AppStore（config.json 和深度图缓存）
 *     → 注册 IPC 处理器
 *     → 创建壁纸窗口 → 注入 WorkerW 层
 *     → 创建系统托盘
 *     → 启动全屏检测轮询
 *     → 打开设置窗口（开机自启带 --autostart，不打开）
 * ============================================================================
 */

const {
    app,
    BrowserWindow,
    Tray,
    Menu,
    ipcMain,
    dialog,
    globalShortcut,
    nativeImage,
    nativeTheme,
    powerMonitor,
    screen,
    shell,
} = require('electron');

const path = require('path');
const fs = require('fs');

// ---- 日志：主进程和各窗口的控制台输出都写进 userData/logs/main.log（打包后没有控制台可看） ----
const log = require('electron-log/main');
log.initialize({ preload: false, spyRendererConsole: true });
log.errorHandler.startCatching();
Object.assign(console, log.functions);

// ---- 自定义模块 ----
const { injectToWallpaperLayer } = require('./src/wallpaper-native');
const { createTray, updateTrayMenu } = require('./src/tray-manager');
const { FullscreenDetector } = require('./src/fullscreen-detector');
const { DesktopClickWatcher } = require('./src/desktop-click-watcher');
const { AppStore } = require('./src/store');
const { registerElementsIpc } = require('./src/elements/ipc');
const { PlacementController } = require('./src/elements/placement-controller');
const { createFullScreenWindow } = require('./src/elements/placement-window');
const { upsertInstance, hasClickTriggers } = require('./shared/elements-model');
const { isClickable: isVinylClickable, normalizeLayout: normalizeVinylLayout } = require('./shared/vinyl-player');
const { migrateLegacySticker } = require('./src/elements/migrate');
const { cleanupOrphanFiles } = require('./src/elements/library');
const { UnlockAnimationController } = require('./src/unlock-animation/controller');
const { createPlayerWindow, refitPlayerWindow } = require('./src/unlock-animation/player-window');
const { cleanupUnlockFiles, resolvePlayback } = require('./src/unlock-animation/files');
const { registerUnlockIpc } = require('./src/unlock-animation/ipc');
const { getWin32 } = require('./src/win32');
const { loadGallery, findGalleryEntry, migrateLegacyImagePath } = require('./src/gallery');
const myWallpapers = require('./shared/my-wallpapers');
const { nextWallpaperSignal } = require('./shared/frame-pacing');
const { findDepthModel, generateDepthPng } = require('./src/depth/generator');
const { DEFAULT_BLUR } = require('./src/depth/processing');
const { findUninstaller, launchUninstaller } = require('./src/uninstaller');

// ==================== 资源位置 ====================

/**
 * 自带素材（overlay/、elements/、wallpapers/）所在目录：
 * 打包后在安装目录的 resources/ 下（asar 外面，视频才能正常拖进度、循环），开发时就是项目目录。
 */
const ASSET_DIR = app.isPackaged ? process.resourcesPath : __dirname;

/** 深度模型所在目录：打包后是 resources/models/，开发时是项目根目录（*.onnx 不进 git） */
const MODEL_DIR = app.isPackaged ? path.join(process.resourcesPath, 'models') : __dirname;

// ==================== 全局状态 ====================

/** 壁纸窗口引用 */
let wallpaperWindow = null;

/** 设置窗口引用 */
let settingsWindow = null;

/** 系统托盘引用 */
let tray = null;

/** 全屏检测器 */
let fullscreenDetector = null;

/** 桌面点击检测（有"点击播放"的元素时才开启） */
let desktopClickWatcher = null;

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

/** 开机自启时带上这个参数：只显示壁纸，不弹设置窗口（用户自己打开程序时才弹） */
const AUTOSTART_ARG = '--autostart';
const launchedAtLogin = process.argv.includes(AUTOSTART_ARG);

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
        injectToWallpaperLayer(hwnd).then((injected) => {
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

/** 设置窗口标题栏的颜色（和 ui/tokens.css 的 --ink / --text-2 / --bg 一致），按当前是深色还是浅色取 */
function settingsChromeColors() {
    return nativeTheme.shouldUseDarkColors
        ? { color: '#0b0d0f', symbolColor: '#9099a1', background: '#0f1214' }
        : { color: '#dde1e4', symbolColor: '#535d66', background: '#e6e9eb' };
}

/**
 * 界面主题：写进 nativeTheme.themeSource，设置页的 prefers-color-scheme 跟着变（ui/tokens.css）。
 * 系统按钮叠在页面标题栏上，颜色要跟着改；跟随系统时系统切换深浅色也会走到 nativeTheme 的 updated。
 * @param {'dark'|'light'|'system'} theme
 */
function applyTheme(theme) {
    nativeTheme.themeSource = theme;
}

function updateSettingsChrome() {
    if (!settingsWindow || settingsWindow.isDestroyed()) return;
    const { color, symbolColor, background } = settingsChromeColors();
    settingsWindow.setTitleBarOverlay({ color, symbolColor, height: 36 });
    settingsWindow.setBackgroundColor(background);
}

/**
 * 创建设置窗口（用户更换壁纸、调整参数时使用）。
 */
function createSettingsWindow() {
    if (settingsWindow) {
        // 最小化在任务栏里时 focus() 不会把它还原出来
        if (settingsWindow.isMinimized()) settingsWindow.restore();
        settingsWindow.show();
        settingsWindow.focus();
        return settingsWindow;
    }

    const chrome = settingsChromeColors();
    settingsWindow = new BrowserWindow({
        width: 960,
        height: 660,
        minWidth: 820,
        minHeight: 560,
        resizable: true,
        title: '互动3D壁纸 - 设置',
        // 任务栏图标（安装版的 exe 自带图标，开发时不设就是 Electron 的图标）
        icon: path.join(__dirname, 'assets', 'icon.png'),
        autoHideMenuBar: true,
        // 页面自己画标题栏，系统的最小化 / 最大化 / 关闭按钮叠在右上角，颜色跟着界面主题
        titleBarStyle: 'hidden',
        titleBarOverlay: { color: chrome.color, symbolColor: chrome.symbolColor, height: 36 },
        backgroundColor: chrome.background,
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
    syncDesktopClickWatcher(config);
}

// ==================== 桌面点击 ====================

/** 按配置开关桌面点击检测：有显示中的"点击播放"元素，或者唱片机里有音乐（点它播放 / 暂停）才开 */
function syncDesktopClickWatcher(config) {
    if (!desktopClickWatcher) {
        desktopClickWatcher = new DesktopClickWatcher({ onClick: forwardDesktopClick });
    }
    desktopClickWatcher.setEnabled(hasClickTriggers(config.customElements) || isVinylClickable(config.vinyl));
}

/** 桌面被单击：把鼠标位置（相对主显示器）发给壁纸窗口；壁纸暂停或正在摆放元素时忽略 */
function forwardDesktopClick() {
    if (!isRenderingActive || (placement && placement.active)) return;
    if (!wallpaperWindow || wallpaperWindow.isDestroyed()) return;
    const point = screen.getCursorScreenPoint();
    const { x, y, width, height } = screen.getPrimaryDisplay().bounds;
    if (point.x < x || point.x > x + width || point.y < y || point.y > y + height) return;
    wallpaperWindow.webContents.send('desktop:click', { x: point.x - x, y: point.y - y });
}

// ==================== 自定义元素摆放窗口 ====================

/**
 * 创建全屏置顶的摆放窗口，加载壁纸页面的编辑模式。
 * 打开期间暂停真实壁纸的渲染，避免同时跑两个 WebGL 场景。
 */
function createPlacementWindow() {
    const win = createFullScreenWindow(BrowserWindow, screen.getPrimaryDisplay().bounds, {
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

    isPlacing = true;
    syncWallpaperSignal();
    return win;
}

function createPlacementController() {
    return new PlacementController({
        createWindow: createPlacementWindow,
        onCommit: (result, draft) => {
            // 摆放唱片机：保存位置和大小，并显示出来（关着的时候摆完也看得到）
            if (draft.kind === 'vinyl') {
                store.saveConfig({ vinyl: { ...normalizeVinylLayout(result), enabled: true } });
                return;
            }
            const { customElements } = store.getConfig();
            store.saveConfig({ customElements: upsertInstance(customElements, result) });
        },
        onEnd: () => {
            isPlacing = false;
            syncWallpaperSignal();
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
 * 弹出选择壁纸图片或视频的对话框（设置页"从电脑选择…"）。
 * @returns {Promise<{path: string, type: 'image'|'video'}|null>}
 */
async function showWallpaperDialog() {
    const { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, wallpaperType } = myWallpapers;
    const result = await dialog.showOpenDialog(settingsWindow || wallpaperWindow, {
        title: '选择壁纸图片或视频',
        filters: [
            { name: '图片和视频', extensions: [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS] },
            { name: '图片', extensions: IMAGE_EXTENSIONS },
            { name: '视频', extensions: VIDEO_EXTENSIONS },
        ],
        properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const type = wallpaperType(filePath);
    return type ? { path: filePath, type } : null;
}

/**
 * 应用壁纸：记住它（重启后还是这个），并通知壁纸窗口加载。
 * 图片调用前应确保已有深度图缓存；视频的 3D 视差同样要先有深度图。
 * 裁剪从「我的壁纸」里取，调用的地方不用管，托盘换壁纸也用得上之前裁好的范围。
 * @param {{type: 'image', path: string} | {type: 'video', path: string, effect: string, sound: boolean} | string} descriptor
 *   传字符串时当成图片
 * @returns {boolean}
 */
function applyWallpaper(descriptor) {
    if (!wallpaperWindow || wallpaperWindow.isDestroyed()) return false;
    const requested = typeof descriptor === 'string' ? { type: 'image', path: descriptor } : descriptor;
    const target = myWallpapers.withCrop(requested, store.getConfig());
    store.saveConfig(myWallpapers.applyPartial(store.getConfig(), target, Date.now()));
    wallpaperWindow.webContents.send('wallpaper:show', target);
    // 设置窗口的图库、我的壁纸要知道"当前"换成了哪个
    broadcastConfig();
    console.log('[Main] Apply wallpaper:', target);
    return true;
}

/**
 * 托盘"更换壁纸..."：选的图片放进「我的壁纸」；有深度图缓存就直接应用，
 * 没有就打开设置窗口，在那里生成深度图（带进度），生成成功后自动应用。
 */
async function changeWallpaperFromTray() {
    const imagePath = await showImageDialog();
    if (!imagePath) return;

    const { myWallpapers: list } = store.getConfig();
    store.saveConfig({ myWallpapers: myWallpapers.addEntry(list, { path: imagePath, type: 'image' }, Date.now()) });
    broadcastConfig();

    if (hasDepthMap(imagePath)) {
        applyWallpaper({ type: 'image', path: imagePath });
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

    // ---- 选择壁纸图片或视频（只返回路径和类型） ----
    ipcMain.handle('dialog:selectWallpaper', () => showWallpaperDialog());

    // ---- 我的壁纸：加入 / 移除 / 改视频设置 / 补缩略图，改完广播配置 ----
    /** 存裁好的缩略图：文件名要变（重新裁剪后地址不变的话，设置窗口会一直显示缓存里的旧图），旧文件删掉 */
    const replaceThumb = (filePath, thumbDataUrl, oldThumb) => {
        const thumb = store.saveWallpaperThumb(filePath, thumbDataUrl, '_' + Date.now().toString(36));
        if (oldThumb !== thumb) store.deleteWallpaperThumb(oldThumb);
        return thumb;
    };

    ipcMain.handle('myWallpapers:add', (_event, { path: filePath, type, thumbDataUrl, duration, crop }) => {
        if (myWallpapers.wallpaperType(filePath) !== type) throw new Error('不支持的文件类型');
        const existing = myWallpapers.findEntry(store.getConfig().myWallpapers, filePath);
        const thumb = thumbDataUrl ? replaceThumb(filePath, thumbDataUrl, existing && existing.thumb) : '';
        const list = myWallpapers.addEntry(store.getConfig().myWallpapers, { path: filePath, type, thumb, duration, crop }, Date.now());
        store.saveConfig({ myWallpapers: list });
        broadcastConfig();
        return myWallpapers.findEntry(list, filePath);
    });
    ipcMain.handle('myWallpapers:remove', (_event, filePath) => {
        const { list, removed } = myWallpapers.removeEntry(store.getConfig().myWallpapers, filePath);
        if (!removed) return false;
        store.deleteWallpaperThumb(removed.thumb);
        store.saveConfig({ myWallpapers: list });
        broadcastConfig();
        return true;
    });
    ipcMain.handle('myWallpapers:update', (_event, filePath, patch) => {
        const { effect, sound } = patch || {};
        const list = myWallpapers.updateEntry(store.getConfig().myWallpapers, filePath, { effect, sound });
        store.saveConfig({ myWallpapers: list });
        broadcastConfig();
        return myWallpapers.findEntry(list, filePath);
    });
    ipcMain.handle('myWallpapers:setThumb', (_event, filePath, thumbDataUrl) => {
        if (!myWallpapers.findEntry(store.getConfig().myWallpapers, filePath) || !thumbDataUrl) return null;
        const thumb = store.saveWallpaperThumb(filePath, thumbDataUrl);
        const list = myWallpapers.updateEntry(store.getConfig().myWallpapers, filePath, { thumb });
        store.saveConfig({ myWallpapers: list });
        broadcastConfig();
        return myWallpapers.findEntry(list, filePath);
    });
    ipcMain.handle('myWallpapers:setCrop', (_event, filePath, crop, thumbDataUrl) => {
        const entry = myWallpapers.findEntry(store.getConfig().myWallpapers, filePath);
        if (!entry) return null;
        const thumb = thumbDataUrl ? replaceThumb(filePath, thumbDataUrl, entry.thumb) : entry.thumb;
        const list = myWallpapers.updateEntry(store.getConfig().myWallpapers, filePath, { crop, thumb });
        store.saveConfig({ myWallpapers: list });
        broadcastConfig();
        return myWallpapers.findEntry(list, filePath);
    });

    // ---- 主显示器的大小：裁剪框的比例和"可能会模糊"的提示要用 ----
    ipcMain.handle('app:getScreenInfo', () => {
        const { bounds, scaleFactor } = screen.getPrimaryDisplay();
        return { width: bounds.width, height: bounds.height, scaleFactor };
    });

    // ---- 往歌单里添加本地音乐（可以一次选多首），只返回路径，歌名由歌单逻辑从文件名取 ----
    ipcMain.handle('dialog:selectAudioFiles', async () => {
        const result = await dialog.showOpenDialog(settingsWindow || wallpaperWindow, {
            title: '添加歌曲（可以多选）',
            filters: [
                { name: '音频文件', extensions: ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac'] },
                { name: '所有文件', extensions: ['*'] }
            ],
            properties: ['openFile', 'multiSelections'],
        });
        return result.canceled ? [] : result.filePaths;
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

    // ---- 在摆放窗口里拖动唱片机（和摆放元素共用一个摆放会话） ----
    ipcMain.handle('vinyl:startPlacement', () =>
        placement.start({ kind: 'vinyl', vinyl: store.getConfig().vinyl }));

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
        const overlayDir = path.join(ASSET_DIR, 'overlay');
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
        if (config && config.theme) applyTheme(store.getConfig().theme);
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
        // 新加载的壁纸页是运行状态：当前该暂停的话重新发一次
        lastWallpaperSignal = null;
        syncWallpaperSignal();
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
        setAutoLaunch(enabled);
        store.saveConfig({ autoLaunch: enabled });
        return getAutoLaunch();
    });

    ipcMain.handle('app:getAutoLaunch', async () => getAutoLaunch());

    // ---- 卸载软件（设置页）：打开安装目录里的卸载程序，然后退出 ----
    // 删数据、删开机自启都由卸载程序做（build/installer.nsh），用户在卸载向导里点了取消就什么都不动
    const uninstallerPath = () => (app.isPackaged ? findUninstaller(path.dirname(process.execPath)) : null);

    ipcMain.handle('app:getUninstallInfo', () => {
        if (!app.isPackaged) return { available: false, reason: '开发版没有卸载程序，只有安装版可以卸载' };
        if (!uninstallerPath()) return { available: false, reason: '没找到卸载程序，请到 Windows 设置 → 应用 里卸载' };
        return { available: true };
    });

    ipcMain.handle('app:uninstall', async (_event, { deleteData } = {}) => {
        const exe = uninstallerPath();
        if (!exe) return { success: false, error: '没找到卸载程序' };
        try {
            await launchUninstaller(exe, !!deleteData);
        } catch (err) {
            console.error('[Main] 打开卸载程序失败:', err);
            return { success: false, error: err.message };
        }
        console.log(`[Main] 已打开卸载程序（${deleteData ? '删除' : '保留'}用户数据），退出`);
        // 等这次 IPC 回复发出去再退出
        setTimeout(cleanupAndQuit, 200);
        return { success: true };
    });

    // ---- 生成深度图（onnxruntime-node，在单独的子进程里跑；像素由设置窗口的 preload 解码好传过来） ----
    ipcMain.handle('depth:generate', async (event, { imagePath, blurRadius, width, height, rgba }) => {
        const blur = Number.isFinite(Number(blurRadius)) ? Number(blurRadius) : DEFAULT_BLUR;
        const progress = (message) => {
            console.log('[Depth]', message);
            if (!event.sender.isDestroyed()) event.sender.send('depth:progress', { message });
        };

        const modelPath = findDepthModel(MODEL_DIR);
        if (!modelPath) {
            const error = `找不到深度模型 depth_anything_v2_small*.onnx（${MODEL_DIR}）`;
            console.error('[Main]', error);
            return { success: false, error };
        }
        console.log(`[Main] 生成深度图: ${imagePath}（${width}×${height}，平滑 ${blur}，模型 ${path.basename(modelPath)}）`);

        try {
            const png = await generateDepthPng({ rgba, width, height, modelPath, blurRadius: blur, onProgress: progress });
            const depthDataUrl = 'data:image/png;base64,' + png.toString('base64');
            store.saveDepthCache(imagePath, depthDataUrl);
            progress(`[OK] 深度图已生成（${Math.round(png.length / 1024)} KB）`);
            return { success: true, depthDataUrl };
        } catch (err) {
            console.error('[Main] 深度图生成失败:', err);
            return { success: false, error: err.message };
        }
    });

    // ---- 应用壁纸（从设置窗口触发）：{ type, path, ... }，旧写法传图片路径字符串也行 ----
    ipcMain.handle('wallpaper:apply', (_event, descriptor) => applyWallpaper(descriptor));

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
        elementsDir: path.join(ASSET_DIR, 'elements'),
        getDialogParent: () => settingsWindow || wallpaperWindow,
        broadcastConfig,
        placement,
    });

    // ---- 解锁动画 ----
    registerUnlockIpc({
        ipcMain,
        dialog,
        store,
        getDialogParent: () => settingsWindow || wallpaperWindow,
        broadcastConfig,
        controller: unlockAnimation,
    });
}

// ==================== 开机自启 ====================

/**
 * 开机自启的启动命令。打包后就是安装目录里的 exe；
 * 开发时 process.execPath 是 electron.exe，要带上项目目录，否则开机打开的是 Electron 的默认页。
 * 末尾带 --autostart，开机时不弹设置窗口。
 * 查询时必须传同样的 path / args 才能找到这一条。
 */
function loginItemOptions(withAutostartArg = true) {
    const args = app.isPackaged ? [] : [app.getAppPath()];
    if (withAutostartArg) args.push(AUTOSTART_ARG);
    return { path: process.execPath, args };
}

function getAutoLaunch() {
    return app.getLoginItemSettings(loginItemOptions()).openAtLogin;
}

function setAutoLaunch(enabled) {
    app.setLoginItemSettings({ openAtLogin: enabled, ...loginItemOptions() });
}

/** 旧版本登记的开机自启没有 --autostart（开机会弹设置窗口）：换成新的启动命令（注册表里是同一项，直接覆盖） */
function migrateAutoLaunch() {
    try {
        if (!getAutoLaunch() && app.getLoginItemSettings(loginItemOptions(false)).openAtLogin) {
            setAutoLaunch(true);
            console.log('[Main] 开机自启命令已加上 ' + AUTOSTART_ARG);
        }
    } catch (err) {
        console.warn('[Main] 更新开机自启命令失败:', err.message);
    }
}

// ==================== 暂停 / 恢复 ====================

/** 锁屏中（lock-screen 到 unlock-screen） */
let isScreenLocked = false;
/** 睡眠中（suspend 到 resume） */
let isSuspended = false;
/** 摆放窗口开着（createPlacementWindow 到摆放结束） */
let isPlacing = false;
/** 上一次发给壁纸窗口的暂停 / 恢复消息 */
let lastWallpaperSignal = null;
/** 解锁动画控制器（startApp 里建） */
let unlockAnimation = null;
/** 上一次告诉壁纸窗口的"唱片机要让路" */
let vinylDucked = false;

/**
 * 按摆放、锁屏 / 睡眠、被窗口挡住几种状态，给壁纸窗口发暂停（带原因）或恢复，状态没变不发。
 * 规则在 shared/frame-pacing.js 的 nextWallpaperSignal：锁屏期间全屏检测怎么变都不会恢复，
 * 解锁时还被挡着就换成 covered（开了声音的视频壁纸接着出声）。
 */
function syncWallpaperSignal() {
    if (!wallpaperWindow || wallpaperWindow.isDestroyed()) return;
    const next = nextWallpaperSignal(lastWallpaperSignal, {
        placement: isPlacing,
        system: isScreenLocked || isSuspended || unlockAnimation.holdsWallpaper,
        covered: !isRenderingActive,
    });
    if (!next) return;
    lastWallpaperSignal = next;
    if (next.type === 'pause') {
        wallpaperWindow.webContents.send('renderer:pause', { reason: next.reason, silent: next.silent });
    } else {
        wallpaperWindow.webContents.send('renderer:resume', { silent: next.silent });
    }
}

// ==================== 解锁动画 ====================

/** 远程桌面会话里不放解锁动画。user32 加载失败时当作不是 */
function isRemoteSession() {
    try {
        return getWin32().isRemoteSession();
    } catch (_) {
        return false;
    }
}

/** 动画占着壁纸的状态变了：同步壁纸的暂停，开着声音时让唱片机的音量降到 0 */
function syncUnlockHold() {
    syncWallpaperSignal();
    const ducked = unlockAnimation.ducksMusic;
    if (ducked === vinylDucked) return;
    vinylDucked = ducked;
    if (wallpaperWindow && !wallpaperWindow.isDestroyed()) wallpaperWindow.webContents.send('vinyl:duck', ducked);
}

function createUnlockAnimation() {
    return new UnlockAnimationController({
        getPlayback: ({ preview = false } = {}) => {
            if (!preview && (isPlacing || isRemoteSession())) return null;
            return resolvePlayback(store.getConfig().unlockAnimation, store.getUnlockAnimationDir(), { preview });
        },
        createWindow: (playback) => createPlayerWindow({ BrowserWindow, screen }, playback),
        refitWindow: (win) => refitPlayerWindow(win, screen),
        registerSkipKey: (onSkip) => globalShortcut.register('Escape', onSkip),
        unregisterSkipKey: () => globalShortcut.unregister('Escape'),
        isSessionLocked: () => powerMonitor.getSystemIdleState(1) === 'locked',
        onHoldChange: syncUnlockHold,
        // 没收到 unlock-screen 也要清锁屏状态，否则壁纸一直停着
        onSessionUnlocked: () => {
            isScreenLocked = false;
            syncWallpaperSignal();
        },
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
            syncWallpaperSignal();
        },
        onFullscreenEnd: () => {
            console.log('[Main] Fullscreen app exited, resuming render');
            isRenderingActive = true;
            syncWallpaperSignal();
        },
    });

    fullscreenDetector.start();
}

// ==================== 电源状态监听 ====================

function setupPowerMonitor() {
    // 睡眠 / 锁屏单独记，唤醒时还锁着屏就不恢复（睡眠前通常会先锁屏）。
    // 监听器第一个参数是 Electron 的事件对象，不要直接传给发 IPC 的函数（序列化不了）
    powerMonitor.on('suspend', () => {
        isSuspended = true;
        syncWallpaperSignal();
    });
    powerMonitor.on('resume', () => {
        isSuspended = false;
        syncWallpaperSignal();
    });
    powerMonitor.on('lock-screen', () => {
        // 排在最前面：睡眠时离 suspend 只有约 90 毫秒
        unlockAnimation.handleLock();
        isScreenLocked = true;
        syncWallpaperSignal();
    });
    powerMonitor.on('unlock-screen', () => {
        // 先让动画占住壁纸再清锁屏状态，否则壁纸会先恢复一下又暂停，声音会响一下
        unlockAnimation.handleUnlock();
        isScreenLocked = false;
        syncWallpaperSignal();
    });
}

// ==================== 清理和退出 ====================

function cleanupAndQuit() {
    console.log('[Main] Cleaning up...');

    // 停止全屏检测和桌面点击检测
    if (fullscreenDetector) {
        fullscreenDetector.stop();
    }
    if (desktopClickWatcher) {
        desktopClickWatcher.stop();
    }

    if (unlockAnimation) unlockAnimation.dispose();

    if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
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

function startApp() {
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

    // 默认壁纸图库。配置里记的是绝对路径：开发目录和安装目录各有一份图库、共用同一份配置，
    // 另一份图库里的图、以及旧版本 default wallpaper/ 里的原图，都换成当前图库里的同一张
    gallery = loadGallery(path.join(ASSET_DIR, 'wallpapers'));
    const currentImage = store.getConfig().currentImage;
    const migratedImage = migrateLegacyImagePath(currentImage, gallery);
    if (migratedImage !== currentImage) {
        store.saveConfig({ currentImage: migratedImage });
        console.log('[Main] 当前壁纸已换成图库里的同一张:', migratedImage);
    }
    // 当前视频记下的 imageAtTime 也要跟着换，否则和换过的 currentImage 对不上，视频会被当成"旧版本换过图片"
    const { currentVideo } = store.getConfig();
    if (currentVideo && currentVideo.imageAtTime) {
        const migratedAtTime = migrateLegacyImagePath(currentVideo.imageAtTime, gallery);
        if (migratedAtTime !== currentVideo.imageAtTime) {
            store.saveConfig({ currentVideo: { ...currentVideo, imageAtTime: migratedAtTime } });
        }
    }
    // 旧版本之后又换过图片（imageAtTime 对不上）：以 currentImage 为准，清掉当前视频
    const resolved = myWallpapers.resolveCurrent(store.getConfig());
    if (store.getConfig().currentVideo && (!resolved || resolved.type !== 'video')) {
        store.saveConfig({ currentVideo: null });
        console.log('[Main] 当前图片在别的版本里换过，不再用上次的视频壁纸');
    }
    // 第一次运行还没选过壁纸：用图库第一张（自带深度图）。
    // 应用视频时 currentImage 可能是空的，这时不能补，否则 imageAtTime 就对不上了
    if (!store.getConfig().currentImage && !store.getConfig().currentVideo && gallery.length) {
        store.saveConfig({ currentImage: gallery[0].file });
        console.log('[Main] 第一次运行，默认壁纸:', gallery[0].name);
    }
    // 升级到有「我的壁纸」的版本：当前是用户自己的图片就放进去（只做一次）
    if (store.getConfig().myWallpapersVersion !== 1) {
        const config = store.getConfig();
        const list = myWallpapers.migrateFromCurrentImage(config.myWallpapers, config.currentImage, {
            isGallery: (p) => !!findGalleryEntry(gallery, p),
            exists: (p) => fs.existsSync(p),
        }, Date.now());
        store.saveConfig({ myWallpapers: list, myWallpapersVersion: 1 });
    }

    // 清理上次没删掉的素材副本（移除素材时视频可能正被占用）
    const orphans = cleanupOrphanFiles(store.getElementsDir(), store.getConfig().customElements.library);
    if (orphans.length) console.log('[Main] 已清理无用的素材文件:', orphans);
    const unlockOrphans = cleanupUnlockFiles(store.getUnlockAnimationDir(), store.getConfig().unlockAnimation);
    if (unlockOrphans.length) console.log('[Main] 已清理无用的解锁动画文件:', unlockOrphans);

    // 设置窗口的界面主题（要在建窗口之前，标题栏颜色按它取）
    applyTheme(store.getConfig().theme);
    nativeTheme.on('updated', updateSettingsChrome);

    // 2. 注册 IPC 处理器
    unlockAnimation = createUnlockAnimation();
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
        getAutoLaunch,
        setAutoLaunch,
    });

    // 5. 启动全屏检测；有"点击播放"的元素时启动桌面点击检测
    startFullscreenDetection();
    syncDesktopClickWatcher(store.getConfig());

    // 6. 监听电源事件
    setupPowerMonitor();

    // 7. 用户自己打开程序时直接显示设置窗口（任务栏上也有图标）；开机自启只显示壁纸，留在托盘里
    migrateAutoLaunch();
    if (!launchedAtLogin) createSettingsWindow();

    console.log('[Main] App startup complete');
}

// 所有窗口关闭时不退出（壁纸在托盘中常驻）
app.on('window-all-closed', () => {
    // 不退出，由托盘控制
});

// 防止应用多开。拿不到锁说明已经有一个在运行：直接退出，不注册启动流程——
// app.quit() 之后 ready 事件照样会来，启动流程写在外面的话第二个实例会先建窗口、注入桌面、建托盘再退出
if (app.requestSingleInstanceLock()) {
    app.on('second-instance', () => {
        // 第二个实例启动时，打开设置窗口
        createSettingsWindow();
    });
    app.whenReady().then(startApp);
} else {
    app.quit();
}
