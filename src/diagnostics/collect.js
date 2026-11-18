/**
 * collect.js — 收集诊断报告要的信息
 *
 * Electron 的接口和程序状态都由调用方（main.js）传进来，这里不直接 require('electron')，
 * 纯 Node 测试也能跑。每一部分单独 try：哪部分出错就记成 { error }，其余照常收集。
 * 全部在本进程里完成，不启动 PowerShell 之类的外部程序（安全软件会拦）。
 */

'use strict';

const fs = require('fs');
const os = require('os');
const { readLogTail, recentProblems } = require('./logs');
const { matchKnownSoftware } = require('./software');

/** 报告里放日志最后多少行、最近多少条错误；挑错误时多往前看一些 */
const LOG_LINES = 1500;
const PROBLEM_COUNT = 30;
const PROBLEM_SCAN_LINES = 5000;

/** 等完整显卡信息多久：每次运行第一次要查 DirectX，开发机上就要 5 秒（之后有缓存），慢的电脑更久 */
const GPU_TIMEOUT_MS = 15000;

/**
 * Windows 11 的注册表 ProductName 还是 "Windows 10 …"（os.version() 读的就是它），按版本号改过来。
 * @param {string} version - os.version()
 * @param {string} release - os.release()，比如 10.0.26200
 */
function windowsName(version, release) {
    const build = Number(String(release).split('.')[2]);
    if (build >= 22000) return String(version).replace(/^Windows 10\b/, 'Windows 11');
    return version;
}

/**
 * @param {{renderingActive?: boolean, screenLocked?: boolean, suspended?: boolean, placing?: boolean, unlockHolding?: boolean}} state
 * @returns {string[]}
 */
function pausedReasons(state) {
    const reasons = [];
    if (state.renderingActive === false) reasons.push('全屏程序挡住');
    if (state.screenLocked) reasons.push('锁屏');
    if (state.suspended) reasons.push('睡眠');
    if (state.placing) reasons.push('正在摆放元素');
    if (state.unlockHolding) reasons.push('正在放解锁动画');
    return reasons;
}

const errorOf = (err) => ({ error: (err && err.message) || String(err) });

async function safely(fn) {
    try {
        return await fn();
    } catch (err) {
        return errorOf(err);
    }
}

function withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`超过 ${ms}ms`)), ms); });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const tryOr = (fn, fallback) => {
    try {
        return fn();
    } catch (_) {
        return fallback;
    }
};

function collectApp({ app, store, getAutoLaunch, launchedAtLogin }) {
    const cpus = os.cpus();
    return {
        version: app.getVersion(),
        packaged: app.isPackaged,
        electron: process.versions.electron || '-',
        chrome: process.versions.chrome || '-',
        node: process.versions.node,
        os: windowsName(os.version(), os.release()),
        osRelease: os.release(),
        arch: os.arch(),
        cpu: cpus.length ? cpus[0].model.trim() : '未知',
        cpuCount: cpus.length,
        memoryGB: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
        locale: tryOr(() => app.getLocale(), '未知'),
        uptimeSec: Math.round(process.uptime()),
        exePath: process.execPath,
        dataDir: store ? tryOr(() => store.getStorePath(), '读取失败') : '（还没初始化）',
        depthDir: store ? tryOr(() => store.getDepthCacheDir(), '读取失败') : '（还没初始化）',
        launchedAtLogin: !!launchedAtLogin,
        autoLaunch: tryOr(() => getAutoLaunch(), false),
    };
}

function collectDisplays({ screen, primaryScreenSize }) {
    const primaryId = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().map((d) => {
        const primary = d.id === primaryId;
        // 物理像素：主显示器问系统（准确）；其他显示器用 Electron 的换算，会向上取整，可能多 1（2560 算成 2561）
        const physical = (primary && primaryScreenSize && tryOr(() => primaryScreenSize(), null))
            || tryOr(() => screen.dipToScreenRect(null, d.bounds), null);
        return {
            primary,
            width: d.bounds.width,
            height: d.bounds.height,
            physicalWidth: physical ? physical.width : undefined,
            physicalHeight: physical ? physical.height : undefined,
            scaleFactor: d.scaleFactor,
            refreshRate: d.displayFrequency,
            x: d.bounds.x,
            y: d.bounds.y,
        };
    });
}

async function collectGpu({ app, gpuTimeoutMs }) {
    const featureStatus = tryOr(() => app.getGPUFeatureStatus(), {});
    let info = null;
    try {
        info = await withTimeout(app.getGPUInfo('complete'), gpuTimeoutMs);
    } catch (_) {
        info = await withTimeout(app.getGPUInfo('basic'), gpuTimeoutMs).catch(() => null);
    }
    const devices = ((info && info.gpuDevice) || []).map((d) => ({
        active: !!d.active,
        vendorId: d.vendorId,
        deviceId: d.deviceId,
        driverVersion: d.driverVersion || '',
    }));
    const glRenderer = (info && info.auxAttributes && info.auxAttributes.glRenderer) || '';
    return { featureStatus, devices, glRenderer };
}

async function collectWallpaper({ store, getState, getWallpaperHandle, describeWindow, resolveCurrent }) {
    const state = getState();
    const handle = getWallpaperHandle();
    const windowLines = handle ? await safely(() => describeWindow(handle)) : null;
    let current = null;
    const config = store ? tryOr(() => store.getConfig(), null) : null;
    const resolved = config ? tryOr(() => resolveCurrent(config), null) : null;
    if (resolved && resolved.path) {
        current = { type: resolved.type, path: resolved.path, exists: fs.existsSync(resolved.path) };
    }
    return { desktopLayer: state.desktopLayer, windowLines, paused: pausedReasons(state), current };
}

/**
 * @param {object} deps
 * @param {object} deps.app - Electron app
 * @param {object} deps.screen - Electron screen
 * @param {() => {width: number, height: number}} [deps.primaryScreenSize] - 主显示器的物理分辨率（win32 的 getScreenSize）
 * @param {object|null} deps.store - AppStore，启动早期可能还没有
 * @param {string[]} deps.logFiles - [main.old.log, main.log]
 * @param {() => boolean} deps.getAutoLaunch
 * @param {boolean} deps.launchedAtLogin
 * @param {() => object} deps.getState - { desktopLayer: true|false|null, renderingActive, screenLocked, suspended, placing, unlockHolding }
 * @param {() => (Buffer|number|null)} deps.getWallpaperHandle - 壁纸窗口的句柄，没有窗口时 null
 * @param {(handle) => string[]} deps.describeWindow - wallpaper-native 的 describeWallpaperWindow
 * @param {() => string[]} deps.listProcessNames - win32 的 listProcessNames
 * @param {(config: object) => ({type: string, path: string}|null)} deps.resolveCurrent - 当前壁纸
 * @param {() => Date} [deps.now]
 * @param {number} [deps.gpuTimeoutMs]
 */
async function collectDiagnostics(deps) {
    const { now = () => new Date(), gpuTimeoutMs = GPU_TIMEOUT_MS } = deps;
    const recentLog = await safely(() => readLogTail(deps.logFiles, PROBLEM_SCAN_LINES));
    const logFile = deps.logFiles[deps.logFiles.length - 1];
    return {
        generatedAt: now(),
        app: await safely(() => collectApp(deps)),
        displays: await safely(() => collectDisplays(deps)),
        gpu: await safely(() => collectGpu({ app: deps.app, gpuTimeoutMs })),
        wallpaper: await safely(() => collectWallpaper(deps)),
        software: await safely(() => matchKnownSoftware(deps.listProcessNames())),
        problems: Array.isArray(recentLog) ? recentProblems(recentLog, PROBLEM_COUNT) : recentLog,
        config: await safely(() => {
            if (!deps.store) throw new Error('数据还没初始化');
            return deps.store.getConfig();
        }),
        log: Array.isArray(recentLog) ? { file: logFile, lines: recentLog.slice(-LOG_LINES) } : recentLog,
    };
}

module.exports = { collectDiagnostics, windowsName, pausedReasons };
