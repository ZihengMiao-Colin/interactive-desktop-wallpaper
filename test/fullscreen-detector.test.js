'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FullscreenDetector } = require('../src/fullscreen-detector');

function detector(options = {}) {
    const calls = { start: 0, end: 0 };
    const d = new FullscreenDetector({
        debounceCount: 2,
        onFullscreenStart: () => { calls.start++; },
        onFullscreenEnd: () => { calls.end++; },
        ...options,
    });
    d.setRendererReady(true);
    return { d, calls };
}

test('本程序自己的全屏窗口（摆放窗口）不算全屏应用', () => {
    const { d, calls } = detector({ ignorePid: 4242 });
    d._helper.feed('FULLSCREEN 4242\nFULLSCREEN 4242\nFULLSCREEN 4242\n');
    assert.equal(calls.start, 0);
});

test('其他程序全屏时照常暂停', () => {
    const { d, calls } = detector({ ignorePid: 4242 });
    d._helper.feed('FULLSCREEN 100\nFULLSCREEN 100\n');
    assert.equal(calls.start, 1);
});

test('其他程序全屏期间切到本程序窗口，视为全屏结束', () => {
    const { d, calls } = detector({ ignorePid: 4242 });
    d._helper.feed('FULLSCREEN 100\nFULLSCREEN 100\nFULLSCREEN 4242\nFULLSCREEN 4242\n');
    assert.equal(calls.start, 1);
    assert.equal(calls.end, 1);
});

test('没带进程号的旧格式仍按全屏处理', () => {
    const { d, calls } = detector({ ignorePid: 4242 });
    d._helper.feed('FULLSCREEN\nFULLSCREEN\n');
    assert.equal(calls.start, 1);
});
