'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DesktopClickWatcher } = require('../src/desktop-click-watcher');

/** 假的 win32 接口：down / cursor / rootClass 由测试直接改 */
function setup({ dpi = 96 } = {}) {
    let clicks = 0;
    let now = 1000;
    const win32 = {
        down: false,
        cursor: { x: 100, y: 100 },
        rootClass: 'Progman',
        isLeftButtonDown() { return this.down; },
        getCursorPos() { return { ...this.cursor }; },
        windowFromPoint: () => 1,
        getRootWindow: () => 2,
        getClassName() { return this.rootClass; },
        getSystemDpi: () => dpi,
    };
    const watcher = new DesktopClickWatcher({
        onClick: () => { clicks++; },
        win32,
        now: () => now,
    });
    watcher._dpi = dpi;

    /** 按下，过 ms 毫秒，鼠标挪到 to，松开 */
    const click = (ms = 100, to = win32.cursor) => {
        win32.down = true;
        watcher._poll();
        now += ms;
        win32.cursor = to;
        win32.down = false;
        watcher._poll();
    };
    return { watcher, win32, click, clicks: () => clicks };
}

test('在桌面上单击算一次', () => {
    const { click, clicks } = setup();
    click();
    assert.equal(clicks(), 1);
});

test('壁纸层（WorkerW）上单击也算', () => {
    const { win32, click, clicks } = setup();
    win32.rootClass = 'WorkerW';
    click();
    assert.equal(clicks(), 1);
});

test('在别的窗口上单击不算', () => {
    const { win32, click, clicks } = setup();
    win32.rootClass = 'Chrome_WidgetWin_1';
    click();
    assert.equal(clicks(), 0);
});

test('按住太久不算单击', () => {
    const { click, clicks } = setup();
    click(501);
    assert.equal(clicks(), 0);
});

test('拖动超过 6 像素不算单击（拖选框、拖图标）', () => {
    const { click, clicks } = setup();
    click(100, { x: 107, y: 100 });
    assert.equal(clicks(), 0);
});

test('移动范围按屏幕缩放换算：150% 时 9 个物理像素还算单击', () => {
    const { click, clicks } = setup({ dpi: 144 });
    click(100, { x: 109, y: 100 });
    assert.equal(clicks(), 1);
});

test('一直按着不重复触发', () => {
    const { watcher, win32, clicks } = setup();
    win32.down = true;
    watcher._poll();
    watcher._poll();
    watcher._poll();
    assert.equal(clicks(), 0);
});

test('关掉之后定时器停止，打开两次只有一个定时器', () => {
    const { watcher } = setup();
    watcher.setEnabled(true);
    const timer = watcher._timer;
    watcher.setEnabled(true);
    assert.equal(watcher._timer, timer);
    watcher.setEnabled(false);
    assert.equal(watcher._timer, null);
});

test('user32 加载失败时只是不检测，不影响启动', () => {
    const watcher = new DesktopClickWatcher({
        onClick: () => {},
        loadWin32: () => { throw new Error('no user32'); },
    });
    assert.doesNotThrow(() => watcher.setEnabled(true));
    assert.equal(watcher._timer, null);
});
