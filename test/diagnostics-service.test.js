'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDiagnostics } = require('../src/diagnostics');

/** 最小的收集结果：路径里带用户名 Alice，用来检查脱敏 */
function info() {
    return {
        generatedAt: new Date(2026, 10, 18, 14, 3, 22),
        app: {
            version: '1.3.1', packaged: true, electron: '28', chrome: '120', node: '18',
            os: 'Windows 11 Pro', osRelease: '10.0.26200', arch: 'x64', cpu: 'cpu', cpuCount: 8, memoryGB: 16,
            locale: 'zh-CN', uptimeSec: 60, exePath: 'C:\\app.exe',
            dataDir: 'C:\\Users\\Alice\\AppData\\Roaming\\x', depthDir: 'C:\\Users\\Alice\\d',
            launchedAtLogin: false, autoLaunch: false,
        },
        displays: [{ primary: true, width: 1920, height: 1080, scaleFactor: 1, x: 0, y: 0 }],
        gpu: { featureStatus: {}, devices: [], glRenderer: 'ANGLE' },
        wallpaper: { desktopLayer: true, windowLines: null, paused: [], current: null },
        software: [],
        problems: ['[2026-11-18 14:00:00.000] [error] 读不到 C:\\Users\\Alice\\Pictures\\a.jpg'],
        config: {},
        log: { file: 'main.log', lines: ['C:\\Users\\Alice\\x'] },
    };
}

function setup({ saveDirs } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-diag-service-'));
    const shown = [];
    const opened = [];
    const diagnostics = createDiagnostics({
        collect: async () => info(),
        username: 'Alice',
        getSaveDirs: () => saveDirs || [dir],
        shell: {
            showItemInFolder: (p) => shown.push(p),
            openExternal: async (url) => { opened.push(url); },
        },
        logger: { info() {}, error() {} },
    });
    return { diagnostics, dir, shown, opened };
}

test('生成报告：存到桌面，在文件夹里选中它', async () => {
    const t = setup();
    const result = await t.diagnostics.generateReport();
    assert.equal(result.success, true);
    assert.equal(result.fileName, 'Kirie-诊断报告-20261118-140322.txt');
    assert.equal(result.path, path.join(t.dir, result.fileName));
    assert.ok(fs.existsSync(result.path));
    assert.deepEqual(t.shown, [result.path]);
});

test('生成报告：报告里没有用户名', async () => {
    const t = setup();
    const result = await t.diagnostics.generateReport();
    const text = fs.readFileSync(result.path, 'utf8');
    assert.doesNotMatch(text, /Alice/);
    assert.match(text, /C:\\Users\\<用户名>\\AppData/);
});

test('生成报告：存不进去时返回失败原因，不抛异常', async () => {
    const t = setup({ saveDirs: [path.join(os.tmpdir(), 'wp-diag-no-such-dir-' + Date.now())] });
    const result = await t.diagnostics.generateReport();
    assert.equal(result.success, false);
    assert.ok(result.error);
    assert.deepEqual(t.shown, []);
});

test('到 GitHub 反馈：先生成报告，再打开填好的反馈页（带报告文件名，没有用户名）', async () => {
    const t = setup();
    const result = await t.diagnostics.openGitHubFeedback();
    assert.equal(result.success, true);
    assert.equal(t.shown.length, 1);
    assert.equal(t.opened.length, 1);
    const body = new URL(t.opened[0]).searchParams.get('body');
    assert.match(body, /Kirie-诊断报告-20261118-140322\.txt/);
    assert.match(body, /软件版本：1\.3\.1/);
    assert.match(body, /读不到 C:\\Users\\<用户名>\\Pictures/);
    assert.doesNotMatch(t.opened[0] + body, /Alice/);
});

test('到 GitHub 反馈：报告存不下来也照样打开反馈页，只是不提拖文件', async () => {
    const t = setup({ saveDirs: [path.join(os.tmpdir(), 'wp-diag-no-such-dir-' + Date.now())] });
    const result = await t.diagnostics.openGitHubFeedback();
    assert.equal(result.success, false);
    assert.equal(t.opened.length, 1);
    assert.doesNotMatch(new URL(t.opened[0]).searchParams.get('body'), /拖/);
});

test('返回给设置页的结果里不带整份收集信息', async () => {
    const t = setup();
    const result = await t.diagnostics.generateReport();
    assert.deepEqual(Object.keys(result).sort(), ['fileName', 'path', 'success']);
});
