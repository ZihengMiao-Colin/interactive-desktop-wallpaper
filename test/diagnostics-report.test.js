'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { formatReport, issueSummary, reportFileName, saveReport } = require('../src/diagnostics/report');

/** 一份齐全的收集结果，各测试在它上面改 */
function sampleInfo(overrides = {}) {
    return {
        generatedAt: new Date(2026, 10, 18, 14, 3, 22),
        app: {
            version: '1.3.1', packaged: true,
            electron: '28.3.3', chrome: '120.0.6099.291', node: '18.18.2',
            os: 'Windows 11 Pro', osRelease: '10.0.26200', arch: 'x64',
            cpu: 'Intel(R) Core(TM) i7-12700H', cpuCount: 20, memoryGB: 15.7,
            locale: 'zh-CN', uptimeSec: 4980,
            exePath: 'C:\\Program Files\\Kirie 壁纸\\Kirie.exe',
            dataDir: 'C:\\Users\\Alice\\AppData\\Roaming\\interactive-desktop-wallpaper',
            depthDir: 'C:\\Users\\Alice\\AppData\\Roaming\\interactive-desktop-wallpaper\\depth_cache',
            launchedAtLogin: false, autoLaunch: true,
        },
        displays: [
            { primary: true, width: 1707, height: 1067, physicalWidth: 2560, physicalHeight: 1600, scaleFactor: 1.5, refreshRate: 165, x: 0, y: 0 },
            { primary: false, width: 1920, height: 1080, physicalWidth: 1920, physicalHeight: 1080, scaleFactor: 1, x: 1707, y: 0 },
        ],
        gpu: {
            featureStatus: { gpu_compositing: 'enabled', webgl: 'enabled' },
            devices: [{ active: true, vendorId: 0x10de, deviceId: 0x2520, driverVersion: '31.0.15.4633' }],
            glRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)',
        },
        wallpaper: {
            desktopLayer: true,
            windowLines: ['self Chrome_WidgetWin_1 hwnd=0x1 visible=true pid=9', 'parent WorkerW hwnd=0x2 visible=true pid=8'],
            paused: [],
            current: { type: 'image', path: 'C:\\Users\\Alice\\Pictures\\a.jpg', exists: true },
        },
        software: [],
        problems: ['[2026-11-18 14:00:00.000] [error] [Main] boom'],
        config: { currentImage: 'C:\\Users\\Alice\\Pictures\\a.jpg', theme: 'dark' },
        log: { file: 'C:\\x\\main.log', lines: ['[2026-11-18 14:00:00.000] [info]  hello'] },
        ...overrides,
    };
}

test('报告开头有生成时间和隐私说明', () => {
    const text = formatReport(sampleInfo());
    assert.match(text, /^Kirie 壁纸 诊断报告\n/);
    assert.match(text, /生成时间：2026-11-18 14:03:22/);
    assert.match(text, /用户名已换成/);
});

test('基本信息：版本、安装版还是开发版、系统、运行了多久', () => {
    const text = formatReport(sampleInfo());
    assert.match(text, /软件版本：1\.3\.1（安装版）/);
    assert.match(text, /系统：Windows 11 Pro 10\.0\.26200 x64/);
    assert.match(text, /已运行：1 小时 23 分钟（手动打开的）/);
    assert.match(formatReport(sampleInfo({ app: { ...sampleInfo().app, packaged: false } })), /（开发版）/);
});

test('显示器：物理分辨率、缩放百分比，主显示器标出来', () => {
    const text = formatReport(sampleInfo());
    assert.match(text, /主显示器：2560×1600（缩放 150%，165Hz）/);
    assert.match(text, /显示器 2：1920×1080（缩放 100%）/);
});

test('显卡：渲染器、厂商名、驱动版本、硬件加速状态', () => {
    const text = formatReport(sampleInfo());
    assert.match(text, /渲染器：ANGLE \(NVIDIA/);
    assert.match(text, /显卡 1（正在用）：NVIDIA 0x10de:0x2520，驱动 31\.0\.15\.4633/);
    assert.match(text, /gpu_compositing=enabled/);
});

test('正在用的是微软基本显示驱动时，提示可能没装显卡驱动', () => {
    const gpu = { ...sampleInfo().gpu, devices: [{ active: true, vendorId: 0x1414, deviceId: 0x8c, driverVersion: '10.0' }] };
    assert.match(formatReport(sampleInfo({ gpu })), /没有正常的显卡驱动/);
});

test('壁纸状态：挂上、没挂上、还在挂三种写法', () => {
    const state = (desktopLayer) => formatReport(sampleInfo({ wallpaper: { ...sampleInfo().wallpaper, desktopLayer } }));
    assert.match(state(true), /桌面层：已挂上/);
    assert.match(state(false), /桌面层：没挂上/);
    assert.match(state(null), /桌面层：还没有结果/);
});

test('壁纸状态：暂停原因、当前壁纸文件找不到', () => {
    const wallpaper = { ...sampleInfo().wallpaper, paused: ['全屏程序挡住', '锁屏'], current: { type: 'video', path: 'D:\\v.mp4', exists: false } };
    const text = formatReport(sampleInfo({ wallpaper }));
    assert.match(text, /暂停：全屏程序挡住、锁屏/);
    assert.match(text, /当前壁纸：视频 D:\\v\.mp4（文件找不到了）/);
    assert.match(formatReport(sampleInfo()), /暂停：没有/);
});

test('其他软件：分类列出，没有时写没有发现', () => {
    const software = [
        { category: 'security', name: '360安全卫士', exe: '360Tray.exe' },
        { category: 'desktop', name: 'Wallpaper Engine', exe: 'wallpaper64.exe' },
    ];
    const text = formatReport(sampleInfo({ software }));
    assert.match(text, /安全软件：360安全卫士（360Tray\.exe）/);
    assert.match(text, /壁纸 \/ 桌面美化：Wallpaper Engine（wallpaper64\.exe）/);
    assert.match(formatReport(sampleInfo()), /没有发现/);
});

test('最近的错误、配置、日志都在报告里', () => {
    const text = formatReport(sampleInfo());
    assert.match(text, /\[Main\] boom/);
    assert.match(text, /"theme": "dark"/);
    assert.match(text, /\[info\] {2}hello/);
});

test('最近的错误：标题写条数，没有错误时标题不写"0 条"', () => {
    assert.match(formatReport(sampleInfo()), /最近的错误和警告（最近 1 条）/);
    const empty = formatReport(sampleInfo({ problems: [] }));
    assert.match(empty, /=+ 最近的错误和警告 =+\n没有/);
});

test('某一部分读取失败时写一行原因，其余照常', () => {
    const text = formatReport(sampleInfo({ gpu: { error: 'timeout' }, software: { error: 'koffi 加载失败' } }));
    assert.match(text, /读取失败：timeout/);
    assert.match(text, /读取失败：koffi 加载失败/);
    assert.match(text, /软件版本：1\.3\.1/);
    assert.match(text, /\[Main\] boom/);
});

test('GitHub 用的摘要：每行一项，读取失败的写失败', () => {
    const software = [{ category: 'security', name: '360安全卫士', exe: '360Tray.exe' }];
    const lines = issueSummary(sampleInfo({ software }));
    assert.ok(lines.includes('软件版本：1.3.1（安装版）'));
    assert.ok(lines.includes('系统：Windows 11 Pro 10.0.26200 x64'));
    assert.ok(lines.includes('显示器：2560×1600，缩放 150%，共 2 块'), lines.join('\n'));
    assert.ok(lines.some((l) => l.startsWith('显卡：ANGLE (NVIDIA')));
    assert.ok(lines.includes('桌面层：已挂上'));
    assert.ok(lines.includes('可能有关的软件：360安全卫士'));
    assert.ok(issueSummary(sampleInfo({ gpu: { error: 'x' } })).includes('显卡：读取失败'));
});

test('文件名带日期时间，不同秒生成的不会重名', () => {
    assert.equal(reportFileName(new Date(2026, 10, 18, 14, 3, 22)), 'Kirie-诊断报告-20261118-140322.txt');
});

test('saveReport 存到第一个能写的文件夹，带 BOM 和 Windows 换行（老记事本也能正常显示中文）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-diag-save-'));
    const missing = path.join(dir, 'no-such-desktop');
    const saved = saveReport('第一行\n第二行', [missing, dir], 'r.txt');
    assert.equal(saved, path.join(dir, 'r.txt'));
    const bytes = fs.readFileSync(saved);
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.equal(bytes.subarray(3).toString('utf8'), '第一行\r\n第二行');
});

test('saveReport 所有文件夹都不能写时抛出错误', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-diag-save-'));
    assert.throws(() => saveReport('x', [path.join(dir, 'a'), path.join(dir, 'b')], 'r.txt'));
});
