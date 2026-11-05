'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// 模拟出过问题的那台电脑：安全软件不让本程序启动 powershell.exe，spawn 直接抛 EPERM
const childProcess = require('child_process');
childProcess.spawn = () => {
    throw Object.assign(new Error('spawn EPERM'), { code: 'EPERM' });
};

const { injectToWallpaperLayer, findWallpaperWorker, toHwndNumber, showBehindOtherWindows } = require('../src/wallpaper-native');

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
        bottomCalls: 0,
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
        /** 紧挨在下面的窗口：同一层里排在它后面的那个 */
        getWindowBelow(hwnd) {
            const siblings = list.filter(w => w.parent === find(hwnd).parent);
            const next = siblings[siblings.indexOf(find(hwnd)) + 1];
            return next ? next.hwnd : 0;
        },
        /** 实测：系统把 Progman 钉在最底下，HWND_BOTTOM 落到它正上方；Progman 被"显示桌面"提上去时才落到真正的最底下 */
        async sendToBottom(hwnd) {
            this.bottomCalls += 1;
            const moved = list.splice(list.indexOf(find(hwnd)), 1)[0];
            const last = list.filter(w => w.parent === moved.parent).pop();
            if (last && last.cls === 'Progman') list.splice(list.indexOf(last), 0, moved);
            else list.push(moved);
        },
        /** 模拟别的窗口落到 hwnd 下面（窗口最小化时就是这样） */
        sink(other, hwnd) {
            const moved = list.splice(list.indexOf(find(other)), 1)[0];
            list.splice(list.indexOf(find(hwnd)) + 1, 0, moved);
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

test('SetParent 一直不生效时把窗口样式改回去，不留下 WS_CHILD', async () => {
    const api = fakeDesktop([...modernDesktop(), { ...self, style: 0x04000000 }], { refuseSetParent: 2 });
    const before = api.getStyle(self.hwnd);
    assert.equal(await inject(api), false);
    assert.equal(api.getStyle(self.hwnd), before);
});

// ==================== 兜底模式 ====================

const SCREEN = { x: 0, y: 0, width: 1707, height: 1067 };
const app = { hwnd: 0x50, cls: 'Chrome_WidgetWin_1', pid: OTHER_PID };

/** 假的 BrowserWindow：记下调用顺序，onShow 用来读显示那一刻窗口排在 Z 序哪里 */
function fakeWindow({ onShow = () => {} } = {}) {
    const handle = Buffer.alloc(8);
    handle.writeUInt32LE(self.hwnd, 0);
    return {
        calls: [],
        destroyed: false,
        getNativeWindowHandle: () => handle,
        isDestroyed() { return this.destroyed; },
        setBounds(bounds) { this.calls.push(['setBounds', bounds]); },
        setIgnoreMouseEvents(ignore) { this.calls.push(['setIgnoreMouseEvents', ignore]); },
        showInactive() { this.calls.push(['showInactive']); onShow(); },
        show() { this.calls.push(['show']); },
        moveTop() { this.calls.push(['moveTop']); },
    };
}

/** 兜底模式的桌面：壁纸窗口刚建好时在最上面，下面是别的程序，Progman 在最底下 */
function fallbackDesktop() {
    const [progman, ...rest] = modernDesktop();
    return fakeDesktop([self, app, ...rest, progman]);
}

const startFallback = (win, api) => showBehindOtherWindows(win, SCREEN, { api });

test('兜底模式：显示之前就放到所有程序后面，不会闪一下盖住它们', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const api = fallbackDesktop();
    let belowWhenShown = null;
    const win = fakeWindow({ onShow: () => { belowWhenShown = api.getWindowBelow(self.hwnd); } });

    assert.equal(await startFallback(win, api), true);
    assert.equal(belowWhenShown, 0x10);
});

test('兜底模式：不抢焦点，也不提到最上面', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const win = fakeWindow();
    await startFallback(win, fallbackDesktop());
    const names = win.calls.map(([name]) => name);
    assert.ok(names.includes('showInactive'));
    assert.ok(!names.includes('show'));
    assert.ok(!names.includes('moveTop'));
});

test('兜底模式：窗口铺满屏幕，只比屏幕矮 1，不被系统当成全屏程序', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const win = fakeWindow();
    await startFallback(win, fallbackDesktop());
    assert.deepEqual(win.calls.find(([name]) => name === 'setBounds'),
        ['setBounds', { ...SCREEN, height: SCREEN.height - 1 }]);
});

test('兜底模式：鼠标穿过壁纸，桌面图标还能点', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const win = fakeWindow();
    await startFallback(win, fallbackDesktop());
    assert.deepEqual(win.calls.find(([name]) => name === 'setIgnoreMouseEvents'), ['setIgnoreMouseEvents', true]);
});

test('窗口落到壁纸下面后（"显示桌面"恢复时就是这样），一秒内把壁纸压回去', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const api = fallbackDesktop();
    await startFallback(fakeWindow(), api);

    api.sink(app.hwnd, self.hwnd);
    assert.equal(api.getWindowBelow(self.hwnd), app.hwnd);

    t.mock.timers.tick(1000);
    assert.equal(api.getWindowBelow(self.hwnd), 0x10);
});

test('已经紧贴桌面时什么也不做', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const api = fallbackDesktop();
    await startFallback(fakeWindow(), api);
    const calls = api.bottomCalls;

    t.mock.timers.tick(5000);
    assert.equal(api.bottomCalls, calls);
});

test('"显示桌面"开着时桌面在壁纸上面，壁纸下面没有窗口，也什么都不做', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const api = fakeDesktop([...modernDesktop(), app, self]);
    await startFallback(fakeWindow(), api);
    const calls = api.bottomCalls;
    assert.equal(api.getWindowBelow(self.hwnd), 0);

    t.mock.timers.tick(5000);
    assert.equal(api.bottomCalls, calls);
});

test('Windows 10 旧结构：下面紧挨着 WorkerW 也算到底了', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const api = fakeDesktop([
        self,
        { hwnd: 0x20, cls: 'WorkerW' },
        { hwnd: 0x22, cls: 'WorkerW' },
        { hwnd: 0x10, cls: 'Progman' },
    ]);
    api.sendToBottom = async () => { api.bottomCalls += 1; };
    await startFallback(fakeWindow(), api);
    const calls = api.bottomCalls;

    t.mock.timers.tick(5000);
    assert.equal(api.bottomCalls, calls);
});

test('放不到最底下时不显示窗口：宁可没有壁纸，也不能挡住用户的程序', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const api = fallbackDesktop();
    api.sendToBottom = async () => { throw new Error('boom'); };
    const win = fakeWindow();

    assert.equal(await startFallback(win, api), false);
    assert.ok(!win.calls.some(([name]) => name === 'showInactive'));
});

test('窗口句柄无效时不显示窗口', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const win = fakeWindow();
    win.getNativeWindowHandle = () => Buffer.alloc(8);

    assert.equal(await startFallback(win, fallbackDesktop()), false);
    assert.ok(!win.calls.some(([name]) => name === 'showInactive'));
});

test('定时压回去时出错只记日志，不抛给主进程', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const api = fallbackDesktop();
    await startFallback(fakeWindow(), api);

    api.sink(app.hwnd, self.hwnd);
    api.sendToBottom = async () => { throw new Error('boom'); };
    const logged = t.mock.method(console, 'error', () => {});
    t.mock.timers.tick(1000);
    await new Promise(setImmediate);
    assert.equal(logged.mock.callCount(), 1);
});

test('读 Z 序时出错只记日志，不抛给主进程', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const api = fallbackDesktop();
    await startFallback(fakeWindow(), api);

    api.getWindowBelow = () => { throw new Error('boom'); };
    const logged = t.mock.method(console, 'error', () => {});
    t.mock.timers.tick(1000);
    await new Promise(setImmediate);
    assert.equal(logged.mock.callCount(), 1);
});

test('窗口关掉后停止检查', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const api = fallbackDesktop();
    const win = fakeWindow();
    await startFallback(win, api);

    win.destroyed = true;
    let reads = 0;
    api.getWindowBelow = () => { reads += 1; return 0; };
    t.mock.timers.tick(5000);
    assert.equal(reads, 0);
});
