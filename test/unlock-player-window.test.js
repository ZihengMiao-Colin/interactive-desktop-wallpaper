'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createPlayerWindow, refitPlayerWindow } = require('../src/unlock-animation/player-window');

/** 主显示器：2560×1600、缩放 150%（实测数据，DIP） */
const SCREEN = { x: 0, y: 0, width: 1707, height: 1067 };
const fakeScreen = { getPrimaryDisplay: () => ({ bounds: SCREEN }) };
const PLAYBACK = { filePath: 'C:/data/video_a.mp4', sound: false, fadeInMs: 500, fadeOutMs: 700, durationMs: 6000 };

class FakeBrowserWindow {
    constructor(options) {
        this.options = options;
        this.calls = [];
    }
    setBounds(...args) { this.calls.push(['setBounds', ...args]); }
    setAlwaysOnTop(...args) { this.calls.push(['setAlwaysOnTop', ...args]); }
    loadFile(...args) { this.calls.push(['loadFile', ...args]); }
    showInactive(...args) { this.calls.push(['showInactive', ...args]); }
}

function make(overrides) {
    return createPlayerWindow({ BrowserWindow: FakeBrowserWindow, screen: fakeScreen }, { ...PLAYBACK, ...overrides });
}

test('窗口选项和 spec 一致', () => {
    const o = make().options;
    assert.equal(o.focusable, false);
    assert.equal(o.skipTaskbar, true);
    assert.equal(o.frame, false);
    assert.equal(o.show, false);
    assert.equal(o.backgroundColor, '#000000');
    assert.equal(o.webPreferences.backgroundThrottling, false);
    assert.ok(fs.existsSync(o.webPreferences.preload));
    assert.equal(path.basename(path.dirname(o.webPreferences.preload)), 'unlock-animation');
});

test('建好后先 setBounds 铺满，再置顶、加载、不抢焦点地显示', () => {
    const win = make();
    assert.deepEqual(win.calls.map((c) => c[0]), ['setBounds', 'setAlwaysOnTop', 'loadFile', 'showInactive']);
    assert.deepEqual(win.calls[0][1], SCREEN);
    assert.deepEqual(win.calls[1].slice(1), [true, 'screen-saver']);
});

test('加载的是播放页面', () => {
    const page = make().calls[2][1];
    assert.equal(path.basename(page), 'unlock-player.html');
    assert.ok(fs.existsSync(page));
});

test('query 带上视频地址、淡入淡出和声音', () => {
    const { query } = make({ sound: true, fadeInMs: 250 }).calls[2][2];
    assert.equal(query.fadeInMs, '250');
    assert.equal(query.fadeOutMs, '700');
    assert.equal(query.sound, '1');
    assert.match(query.video, /^file:\/\//);
});

test('静音时 sound 是 0', () => {
    assert.equal(make().calls[2][2].query.sound, '0');
});

test('refitPlayerWindow 按当前主显示器设大小', () => {
    const win = { setBounds(b) { this.b = b; }, moveTop() {} };
    refitPlayerWindow(win, fakeScreen);
    assert.deepEqual(win.b, SCREEN);
});

test('refitPlayerWindow 把窗口压回最上面：任务栏是前台窗口时会盖在它上面', () => {
    const calls = [];
    const win = { setBounds() { calls.push('setBounds'); }, moveTop() { calls.push('moveTop'); } };
    refitPlayerWindow(win, fakeScreen);
    assert.deepEqual(calls, ['setBounds', 'moveTop']);
});
