'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// 模拟出过问题的那台电脑：安全软件不让本程序启动 powershell.exe，spawn 直接抛 EPERM
const childProcess = require('child_process');
childProcess.spawn = () => {
    throw Object.assign(new Error('spawn EPERM'), { code: 'EPERM' });
};

const { injectToWallpaperLayer, findWallpaperWorker, toHwndNumber } = require('../src/wallpaper-native');

const DESKTOP_ROOT = 0x1000C;
const SHELL_PID = 100;
const OTHER_PID = 200;
const WS_VISIBLE = 0x10000000;

/** 假的 win32 接口：窗口列表的顺序就是 Z 序，parent 不写表示顶层窗口 */
function fakeDesktop(windows, { refuseSetParent = 0 } = {}) {
    const list = windows.map(w => ({ pid: SHELL_PID, visible: true, parent: DESKTOP_ROOT, style: 0, ...w }));
    const find = hwnd => list.find(w => w.hwnd === hwnd);
    let refusals = refuseSetParent;

    return {
        spawnMessages: [],
        repainted: [],
        findWindow(parent, after, className = null) {
            const siblings = list.filter(w => w.parent === (parent || DESKTOP_ROOT));
            const start = after ? siblings.findIndex(w => w.hwnd === after) + 1 : 0;
            const hit = siblings.slice(start).find(w => !className || w.cls === className);
            return hit ? hit.hwnd : 0;
        },
        getClassName: hwnd => find(hwnd).cls,
        getProcessId: hwnd => find(hwnd).pid,
        isWindowVisible: hwnd => find(hwnd).visible,
        getStyle(hwnd) {
            if (hwnd === DESKTOP_ROOT) return WS_VISIBLE;
            const w = find(hwnd);
            return w.style | (w.visible ? WS_VISIBLE : 0);
        },
        getParentWindow(hwnd) {
            return hwnd === DESKTOP_ROOT ? 0 : find(hwnd).parent;
        },
        async sendMessage(hwnd, msg, wParam, lParam) {
            this.spawnMessages.push({ hwnd, msg, wParam, lParam });
        },
        async setParent(child, parent) {
            if (refusals > 0) {
                refusals -= 1;
                return;
            }
            find(child).parent = parent;
        },
        async setStyle(hwnd, style) {
            find(hwnd).style = style;
        },
        async pushToBottomAndRepaint(hwnd, parent) {
            this.repainted.push({ hwnd, parent });
        },
    };
}

/** Windows 11 24H2 之后：图标层和壁纸层都是 Progman 的子窗口 */
function modernDesktop() {
    return [
        { hwnd: 0x10, cls: 'Progman' },
        { hwnd: 0x11, cls: 'SHELLDLL_DefView', parent: 0x10 },
        { hwnd: 0x12, cls: 'SysListView32', parent: 0x11 },
        { hwnd: 0x13, cls: 'WorkerW', parent: 0x10 },
        { hwnd: 0x30, cls: 'WorkerW', pid: OTHER_PID, visible: false },
    ];
}

const self = { hwnd: 0x99, cls: 'Chrome_WidgetWin_1', pid: OTHER_PID };
const inject = (api) => injectToWallpaperLayer(self.hwnd, { api, delay: async () => {} });

test('启动不了 PowerShell 也能挂上桌面层', async () => {
    const api = fakeDesktop([...modernDesktop(), self]);
    assert.equal(await inject(api), true);
    assert.equal(api.getParentWindow(self.hwnd), 0x13);
    assert.deepEqual(api.repainted, [{ hwnd: self.hwnd, parent: 0x13 }]);
});

test('让系统刷新壁纸层：给 Progman 发 0x052C', async () => {
    const api = fakeDesktop([...modernDesktop(), self]);
    await inject(api);
    assert.deepEqual(api.spawnMessages[0], { hwnd: 0x10, msg: 0x052C, wParam: 0, lParam: 0 });
});

test('第一次没有壁纸层时，换参数再让系统建一次', async () => {
    const api = fakeDesktop([
        { hwnd: 0x10, cls: 'Progman' },
        { hwnd: 0x11, cls: 'SHELLDLL_DefView', parent: 0x10 },
        self,
    ]);
    assert.equal(await inject(api), false);
    assert.deepEqual(api.spawnMessages.map(m => [m.wParam, m.lParam]), [[0, 0], [0xD, 1]]);
});

test('Windows 11 新结构：选 Progman 下不含图标层的 WorkerW', () => {
    const api = fakeDesktop(modernDesktop());
    assert.deepEqual(findWallpaperWorker(api, 0x10), { hwnd: 0x13, how: 'Progman child WorkerW' });
});

test('Windows 10 旧结构：选桌面进程里不含图标层的顶层 WorkerW', () => {
    const api = fakeDesktop([
        { hwnd: 0x20, cls: 'WorkerW' },
        { hwnd: 0x21, cls: 'SHELLDLL_DefView', parent: 0x20 },
        { hwnd: 0x22, cls: 'WorkerW' },
        { hwnd: 0x10, cls: 'Progman' },
    ]);
    assert.deepEqual(findWallpaperWorker(api, 0x10), { hwnd: 0x22, how: 'top-level WorkerW of shell process' });
});

test('别的 Chromium 程序的隐藏 WorkerW 不能当壁纸层', () => {
    const api = fakeDesktop([
        { hwnd: 0x30, cls: 'WorkerW', pid: OTHER_PID, visible: false },
        { hwnd: 0x31, cls: 'WorkerW', visible: false },
        { hwnd: 0x10, cls: 'Progman' },
    ]);
    assert.equal(findWallpaperWorker(api, 0x10), null);
});

test('桌面进程里没有候选时，退回任意可见的顶层 WorkerW', () => {
    const api = fakeDesktop([
        { hwnd: 0x30, cls: 'WorkerW', pid: OTHER_PID },
        { hwnd: 0x10, cls: 'Progman' },
    ]);
    assert.deepEqual(findWallpaperWorker(api, 0x10), { hwnd: 0x30, how: 'fallback visible WorkerW' });
});

test('父窗口隐藏的 WorkerW 也不算', () => {
    const api = fakeDesktop([
        { hwnd: 0x10, cls: 'Progman', visible: false },
        { hwnd: 0x13, cls: 'WorkerW', parent: 0x10 },
    ]);
    assert.equal(findWallpaperWorker(api, 0x10), null);
});

test('SetParent 没生效时补上 WS_CHILD 再试一次', async () => {
    const api = fakeDesktop([...modernDesktop(), { ...self, style: 0x80000000 | 0 }], { refuseSetParent: 1 });
    assert.equal(await inject(api), true);
    assert.equal(api.getParentWindow(self.hwnd), 0x13);
    assert.equal(api.getStyle(self.hwnd) & 0x40000000, 0x40000000);
    assert.equal(api.getStyle(self.hwnd) & 0x80000000, 0);
});

test('SetParent 一直不生效时报告失败，让主进程走兜底', async () => {
    const api = fakeDesktop([...modernDesktop(), self], { refuseSetParent: 2 });
    assert.equal(await inject(api), false);
    assert.deepEqual(api.repainted, []);
});

test('找不到 Progman 时报告失败', async () => {
    const api = fakeDesktop([self]);
    assert.equal(await inject(api), false);
});

test('win32 调用出错时报告失败，不把异常抛给主进程', async () => {
    const api = fakeDesktop([...modernDesktop(), self]);
    api.setParent = async () => { throw new Error('boom'); };
    assert.equal(await inject(api), false);
});

test('窗口句柄无效时不注入', async () => {
    assert.equal(await injectToWallpaperLayer(Buffer.alloc(8), { api: fakeDesktop([]) }), false);
});

test('Electron 给的 8 字节句柄转成数字', () => {
    const handle = Buffer.alloc(8);
    handle.writeUInt32LE(0x1609e0, 0);
    assert.equal(toHwndNumber(handle), 0x1609e0);
});
