'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { collectDiagnostics, windowsName, pausedReasons } = require('../src/diagnostics/collect');

test('windowsName：Windows 11 的注册表里还写着 Windows 10，按版本号改过来', () => {
    assert.equal(windowsName('Windows 10 Pro', '10.0.26200'), 'Windows 11 Pro');
    assert.equal(windowsName('Windows 10 Enterprise', '10.0.22000'), 'Windows 11 Enterprise');
    assert.equal(windowsName('Windows 10 Pro', '10.0.19045'), 'Windows 10 Pro');
    assert.equal(windowsName('Windows 11 Home', '10.0.22631'), 'Windows 11 Home');
});

test('pausedReasons：把几种暂停状态翻成中文', () => {
    assert.deepEqual(pausedReasons({ renderingActive: true }), []);
    assert.deepEqual(
        pausedReasons({ renderingActive: false, screenLocked: true, suspended: true, placing: true, unlockHolding: true }),
        ['全屏程序挡住', '锁屏', '睡眠', '正在摆放元素', '正在放解锁动画'],
    );
});

/** 假的 Electron 和程序状态，各测试按需改 */
function fakeDeps(overrides = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-diag-collect-'));
    const logFile = path.join(dir, 'main.log');
    fs.writeFileSync(logFile, [
        '[2026-11-18 10:00:01.000] [info]  start',
        '[2026-11-18 10:00:02.000] [error] boom',
    ].join('\n'));
    const imagePath = path.join(dir, 'a.jpg');
    fs.writeFileSync(imagePath, 'x');
    const config = { currentImage: imagePath, theme: 'dark' };
    return {
        app: {
            getVersion: () => '1.3.1',
            isPackaged: true,
            getLocale: () => 'zh-CN',
            getGPUFeatureStatus: () => ({ webgl: 'enabled' }),
            getGPUInfo: async (level) => ({
                gpuDevice: [{ active: true, vendorId: 0x10de, deviceId: 0x2520, driverVersion: '31.0' }],
                auxAttributes: level === 'complete' ? { glRenderer: 'ANGLE (NVIDIA)' } : {},
            }),
        },
        screen: {
            getPrimaryDisplay: () => ({ id: 1 }),
            getAllDisplays: () => [
                { id: 1, bounds: { x: 0, y: 0, width: 1707, height: 1067 }, scaleFactor: 1.5, displayFrequency: 165 },
                { id: 2, bounds: { x: 1707, y: 0, width: 1280, height: 720 }, scaleFactor: 1.5, displayFrequency: 60 },
            ],
            // Electron 的换算向上取整：1707 × 1.5 得到 2561
            dipToScreenRect: (_win, rect) => ({ ...rect, width: Math.ceil(rect.width * 1.5), height: Math.ceil(rect.height * 1.5) }),
        },
        primaryScreenSize: () => ({ width: 2560, height: 1600 }),
        store: {
            getStorePath: () => dir,
            getDepthCacheDir: () => path.join(dir, 'depth_cache'),
            getConfig: () => config,
        },
        logFiles: [path.join(dir, 'main.old.log'), logFile],
        getAutoLaunch: () => true,
        launchedAtLogin: false,
        getState: () => ({ desktopLayer: true, renderingActive: true }),
        getWallpaperHandle: () => 0x99,
        describeWindow: () => ['self Chrome_WidgetWin_1', 'parent WorkerW'],
        listProcessNames: () => ['explorer.exe', '360Tray.exe'],
        resolveCurrent: (c) => ({ type: 'image', path: c.currentImage }),
        now: () => new Date(2026, 10, 18, 14, 3, 22),
        ...overrides,
    };
}

test('各部分都收集到', async () => {
    const info = await collectDiagnostics(fakeDeps());
    assert.equal(info.app.version, '1.3.1');
    assert.equal(info.app.packaged, true);
    assert.equal(info.app.autoLaunch, true);
    assert.deepEqual(info.displays, [
        { primary: true, width: 1707, height: 1067, physicalWidth: 2560, physicalHeight: 1600, scaleFactor: 1.5, refreshRate: 165, x: 0, y: 0 },
        { primary: false, width: 1280, height: 720, physicalWidth: 1920, physicalHeight: 1080, scaleFactor: 1.5, refreshRate: 60, x: 1707, y: 0 },
    ]);
    assert.equal(info.gpu.glRenderer, 'ANGLE (NVIDIA)');
    assert.deepEqual(info.gpu.devices, [{ active: true, vendorId: 0x10de, deviceId: 0x2520, driverVersion: '31.0' }]);
    assert.equal(info.wallpaper.desktopLayer, true);
    assert.deepEqual(info.wallpaper.windowLines, ['self Chrome_WidgetWin_1', 'parent WorkerW']);
    assert.equal(info.wallpaper.current.exists, true);
    assert.deepEqual(info.software.map((s) => s.name), ['360安全卫士']);
    assert.deepEqual(info.problems, ['[2026-11-18 10:00:02.000] [error] boom']);
    assert.equal(info.config.theme, 'dark');
    assert.equal(info.log.lines.length, 2);
});

test('某一部分出错时那部分记下原因，其余照常', async () => {
    const info = await collectDiagnostics(fakeDeps({
        listProcessNames: () => { throw new Error('koffi 加载失败'); },
        describeWindow: () => { throw new Error('bad hwnd'); },
    }));
    assert.deepEqual(info.software, { error: 'koffi 加载失败' });
    assert.deepEqual(info.wallpaper.windowLines, { error: 'bad hwnd' });
    assert.equal(info.wallpaper.desktopLayer, true);
    assert.equal(info.app.version, '1.3.1');
});

test('完整显卡信息拿不到（超时）时退回基本信息', async () => {
    const deps = fakeDeps();
    deps.app.getGPUInfo = (level) => (level === 'complete'
        ? new Promise(() => {})
        : Promise.resolve({ gpuDevice: [{ active: true, vendorId: 0x8086, deviceId: 1 }] }));
    const info = await collectDiagnostics({ ...deps, gpuTimeoutMs: 20 });
    assert.equal(info.gpu.devices[0].vendorId, 0x8086);
    assert.equal(info.gpu.glRenderer, '');
    assert.deepEqual(info.gpu.featureStatus, { webgl: 'enabled' });
});

test('启动早期出错（数据还没初始化、壁纸窗口还没建）也能生成', async () => {
    const info = await collectDiagnostics(fakeDeps({ store: null, getWallpaperHandle: () => null }));
    assert.equal(info.app.version, '1.3.1');
    assert.ok(info.config.error);
    assert.equal(info.wallpaper.windowLines, null);
    assert.equal(info.wallpaper.current, null);
});

test('系统接口读不到主显示器大小时，退回 Electron 的换算', async () => {
    const info = await collectDiagnostics(fakeDeps({ primaryScreenSize: () => { throw new Error('koffi'); } }));
    assert.equal(info.displays[0].physicalWidth, 2561);
});

test('当前壁纸文件被删了', async () => {
    const info = await collectDiagnostics(fakeDeps({ resolveCurrent: () => ({ type: 'video', path: 'Z:\\gone.mp4' }) }));
    assert.equal(info.wallpaper.current.exists, false);
});
