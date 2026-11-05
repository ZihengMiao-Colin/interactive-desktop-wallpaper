'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFullScreenWindow } = require('../src/elements/placement-window');

/** 主显示器：2560×1600、缩放 150%（实测数据，DIP），任务栏在底部时工作区矮 48 */
const SCREEN = { x: 0, y: 0, width: 1707, height: 1067 };
const WORK_AREA_BOTTOM_BAR = { x: 0, y: 0, width: 1707, height: 1019 };
const WORK_AREA_TOP_BAR = { x: 0, y: 48, width: 1707, height: 1019 };

/**
 * 模拟 Electron 在 Windows 上的行为：构造参数里的矩形会被裁到工作区，setBounds 不会。
 * @param {{x: number, y: number, width: number, height: number}} workArea
 */
function fakeBrowserWindow(workArea) {
    return class FakeBrowserWindow {
        constructor(options) {
            this.options = options;
            const top = Math.max(options.y, workArea.y);
            const bottom = Math.min(options.y + options.height, workArea.y + workArea.height);
            this.bounds = { x: options.x, y: top, width: options.width, height: bottom - top };
        }
        setBounds(bounds) { this.bounds = { ...bounds }; }
        getBounds() { return { ...this.bounds }; }
    };
}

test('任务栏在底部：窗口铺满整个屏幕，不被裁到工作区', () => {
    const win = createFullScreenWindow(fakeBrowserWindow(WORK_AREA_BOTTOM_BAR), SCREEN, {});
    assert.deepEqual(win.getBounds(), SCREEN);
});

test('任务栏在顶部：窗口的上边也回到屏幕顶端', () => {
    const win = createFullScreenWindow(fakeBrowserWindow(WORK_AREA_TOP_BAR), SCREEN, {});
    assert.deepEqual(win.getBounds(), SCREEN);
});

test('窗口选项原样传给 BrowserWindow', () => {
    const win = createFullScreenWindow(fakeBrowserWindow(WORK_AREA_BOTTOM_BAR), SCREEN, { frame: false, show: false });
    assert.equal(win.options.frame, false);
    assert.equal(win.options.show, false);
});
