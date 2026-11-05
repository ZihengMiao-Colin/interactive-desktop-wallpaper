'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FullscreenDetector } = require('../src/fullscreen-detector');

const SCREEN = { width: 2000, height: 1000 };
const FULL_RECT = { left: 0, top: 0, right: 2000, bottom: 1000 };
const SMALL_RECT = { left: 100, top: 100, right: 900, bottom: 700 };

/** 假的 win32 接口：hwnd 就是窗口描述对象 */
function fakeWin32() {
    return {
        foreground: null,
        getForegroundWindow() { return this.foreground; },
        getWindowRect: hwnd => hwnd.rect,
        getClassName: hwnd => hwnd.cls,
        getProcessId: hwnd => hwnd.pid,
        getScreenSize: () => SCREEN,
    };
}

function detector(options = {}) {
    const calls = { start: 0, end: 0 };
    const win32 = fakeWin32();
    const d = new FullscreenDetector({
        debounceCount: 2,
        win32,
        onFullscreenStart: () => { calls.start++; },
        onFullscreenEnd: () => { calls.end++; },
        ...options,
    });
    d.setRendererReady(true);
    /** 让某个窗口在前台，检测 times 次 */
    const poll = (foreground, times = 2) => {
        win32.foreground = foreground;
        for (let i = 0; i < times; i++) d._poll();
    };
    return { d, calls, poll };
}

const fullscreenApp = (pid = 100) => ({ pid, cls: 'UnityWndClass', rect: FULL_RECT });

test('本程序自己的全屏窗口（摆放窗口）不算全屏应用', () => {
    const { calls, poll } = detector({ ignorePid: 4242 });
    poll(fullscreenApp(4242), 3);
    assert.equal(calls.start, 0);
});

test('其他程序全屏时照常暂停', () => {
    const { calls, poll } = detector({ ignorePid: 4242 });
    poll(fullscreenApp());
    assert.equal(calls.start, 1);
});

test('其他程序全屏期间切到本程序窗口，视为全屏结束', () => {
    const { calls, poll } = detector({ ignorePid: 4242 });
    poll(fullscreenApp());
    poll(fullscreenApp(4242));
    assert.equal(calls.start, 1);
    assert.equal(calls.end, 1);
});

test('只检测到一次全屏不切换（防抖）', () => {
    const { calls, poll } = detector();
    poll(fullscreenApp(), 1);
    assert.equal(calls.start, 0);
});

test('窗口没铺满屏幕不算全屏', () => {
    const { calls, poll } = detector();
    poll({ pid: 100, cls: 'Notepad', rect: SMALL_RECT });
    assert.equal(calls.start, 0);
});

test('桌面和任务栏铺满屏幕也不算全屏', () => {
    for (const cls of ['Progman', 'WorkerW', 'Shell_TrayWnd', 'MSTaskSwWClass']) {
        const { calls, poll } = detector();
        poll({ pid: 100, cls, rect: FULL_RECT });
        assert.equal(calls.start, 0, cls);
    }
});

test('没有前台窗口（切换窗口的瞬间）不算全屏', () => {
    const { calls, poll } = detector();
    poll(0);
    assert.equal(calls.start, 0);
});

test('全屏应用退出后恢复，渲染器没就绪时先不恢复', () => {
    const { d, calls, poll } = detector();
    poll(fullscreenApp());
    d.setRendererReady(false);
    poll(0);
    assert.equal(calls.end, 0);
    d.setRendererReady(true);
    poll(0);
    assert.equal(calls.end, 1);
});

test('start 重复调用只开一个定时器，stop 后不再检测', () => {
    const { d } = detector({ pollInterval: 1000 });
    d.start();
    const timer = d._timer;
    d.start();
    assert.equal(d._timer, timer);
    d.stop();
    assert.equal(d._timer, null);
});

test('user32 加载失败时只是不检测，不影响启动', () => {
    const d = new FullscreenDetector({ loadWin32: () => { throw new Error('no user32'); } });
    assert.doesNotThrow(() => d.start());
    assert.equal(d._timer, null);
});
