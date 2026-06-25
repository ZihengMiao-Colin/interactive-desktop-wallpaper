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
} = require('electron');

const path = require('path');
const fs = require('fs');

// ---- 自定义模块 ----
const { injectToWallpaperLayer, restoreFromWallpaperLayer } = require('./src/wallpaper-native');
const { createTray, updateTrayMenu } = require('./src/tray-manager');
const { FullscreenDetector } = require('./src/fullscreen-detector');
const { AppStore } = require('./src/store');

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
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;

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

        // 注入到桌面 WorkerW 层（壁纸核心步骤）
        const hwnd = wallpaperWindow.getNativeWindowHandle();
        const injected = injectToWallpaperLayer(hwnd, width, height);

        if (injected) {
            console.log('[Main] WorkerW 注入成功，窗口已挂载为桌面壁纸层');
        } else {
            console.warn('[Main] WorkerW 注入失败，使用 fallback 模式');
            // Fallback: 设为最底层窗口
            wallpaperWindow.setAlwaysOnTop(false);
            wallpaperWindow.moveTop();
        }

        wallpaperWindow.show();

        // 开发模式下打开 DevTools
        if (isDev) {
            wallpaperWindow.webContents.openDevTools({ mode: 'detach' });
        }

        // 启动全局鼠标位置轮询（WorkerW 层收不到 mousemove 事件）
        startMousePolling(wallpaperWindow);
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

/**
 * 启动全局鼠标位置轮询。
 *
 * 由于 WorkerW 壁纸层在桌面图标后面，window 的 mousemove 事件无法触发。
 * 因此通过主进程轮询 screen.getCursorScreenPoint() 获取全局鼠标坐标，
 * 并通过 IPC 发送给渲染进程。
 *
 * @param {BrowserWindow} win - 壁纸窗口
 */
function startMousePolling(win) {
    const { screen } = require('electron');
    const POLL_INTERVAL = 1000 / 30; // 30fps，足够流畅且不过度消耗 CPU

    mousePollTimer = setInterval(() => {
        if (win && !win.isDestroyed()) {
            try {
                const point = screen.getCursorScreenPoint();
                const primaryDisplay = screen.getPrimaryDisplay();
                const { x: screenX, y: screenY, width: screenW, height: screenH } = primaryDisplay.bounds;

                // 仅当鼠标在主显示器上时才发送（多显示器场景的简单处理）
                if (point.x >= screenX && point.x <= screenX + screenW &&
                    point.y >= screenY && point.y <= screenY + screenH) {
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
        width: 500,
        height: 620,
        resizable: false,
        frame: true,
        title: '互动3D壁纸 - 设置',
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });

    settingsWindow.loadFile('settings.html');

    settingsWindow.on('closed', () => {
        settingsWindow = null;
    });

    return settingsWindow;
}

// ==================== IPC 处理器注册 ====================

function registerIpcHandlers() {

    // ---- 选择新图片 ----
    ipcMain.handle('dialog:selectImage', async () => {
        const result = await dialog.showOpenDialog(settingsWindow || wallpaperWindow, {
            title: '选择壁纸图片',
            filters: [
                { name: '图片文件', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] },
            ],
            properties: ['openFile'],
        });

        if (result.canceled || result.filePaths.length === 0) {
            return null;
        }

        const imagePath = result.filePaths[0];

        // 通知渲染进程加载新图片
        if (wallpaperWindow) {
            wallpaperWindow.webContents.send('image:new', imagePath);
        }

        return imagePath;
    });

    // ---- 保存深度图到缓存 ----
    ipcMain.handle('cache:saveDepthMap', async (_event, { imagePath, depthDataUrl }) => {
        return store.saveDepthCache(imagePath, depthDataUrl);
    });

    // ---- 读取缓存的深度图 ----
    ipcMain.handle('cache:getDepthMap', async (_event, imagePath) => {
        return store.getDepthCache(imagePath);
    });

    // ---- 保存应用配置 ----
    ipcMain.handle('config:save', async (_event, config) => {
        store.saveConfig(config);
        return true;
    });

    // ---- 读取应用配置 ----
    ipcMain.handle('config:get', async () => {
        return store.getConfig();
    });

    // ---- 渲染状态通知 ----
    ipcMain.on('renderer:ready', () => {
        console.log('[Main] 渲染进程就绪');
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

    // ---- 退出应用 ----
    ipcMain.on('app:quit', () => {
        cleanupAndQuit();
    });
}

// ==================== 全屏检测 ====================

function startFullscreenDetection() {
    fullscreenDetector = new FullscreenDetector({
        pollInterval: 1000,          // 每秒检测一次
        onFullscreenStart: () => {
            console.log('[Main] 检测到全屏应用，暂停渲染');
            isRenderingActive = false;
            if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
                wallpaperWindow.webContents.send('renderer:pause');
            }
        },
        onFullscreenEnd: () => {
            console.log('[Main] 全屏应用已退出，恢复渲染');
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
    console.log('[Main] 正在清理...');

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

app.whenReady().then(() => {
    console.log('[Main] 应用启动中...');

    // 1. 初始化数据存储
    store = new AppStore();
    console.log('[Main] 数据存储路径:', store.getStorePath());

    // 2. 注册 IPC 处理器
    registerIpcHandlers();

    // 3. 创建壁纸窗口
    createWallpaperWindow();

    // 4. 创建系统托盘
    tray = createTray({
        onOpenSettings: () => createSettingsWindow(),
        onSelectImage: async () => {
            const result = await dialog.showOpenDialog(settingsWindow || wallpaperWindow, {
                title: '选择壁纸图片',
                filters: [{ name: '图片文件', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }],
                properties: ['openFile'],
            });
            if (!result.canceled && result.filePaths.length > 0 && wallpaperWindow) {
                wallpaperWindow.webContents.send('image:new', result.filePaths[0]);
            }
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

    console.log('[Main] 应用启动完成');
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
