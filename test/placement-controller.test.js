'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { PlacementController } = require('../src/elements/placement-controller');

/** 模拟 BrowserWindow：close() 会同步触发 closed 事件 */
class FakeWin extends EventEmitter {
    constructor() {
        super();
        this.webContents = new EventEmitter();
        this.destroyed = false;
        this.focusCount = 0;
    }
    focus() { this.focusCount++; }
    close() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.emit('closed');
    }
    isDestroyed() { return this.destroyed; }
}

function setup() {
    const wins = [];
    const calls = { commit: [], end: 0 };
    const c = new PlacementController({
        createWindow: () => { const w = new FakeWin(); wins.push(w); return w; },
        onCommit: (instance) => calls.commit.push(instance),
        onEnd: () => { calls.end++; },
    });
    const draft = { instance: { id: 'i1' }, asset: { id: 'builtin:bomb1' }, isNew: true };
    return { c, wins, calls, draft };
}

test('重复 start 只开一个窗口并聚焦已有窗口', () => {
    const { c, wins, draft } = setup();
    assert.equal(c.start(draft), true);
    assert.equal(c.start(draft), false);
    assert.equal(wins.length, 1);
    assert.equal(wins[0].focusCount, 1);
    assert.equal(c.active, true);
    assert.equal(c.getDraft(), draft);
});

test('commit 调 onCommit、关窗、onEnd 一次', () => {
    const { c, wins, calls, draft } = setup();
    c.start(draft);
    assert.equal(c.commit({ id: 'i1', depth: 0.7 }), true);
    assert.deepEqual(calls.commit, [{ id: 'i1', depth: 0.7 }]);
    assert.equal(wins[0].isDestroyed(), true);
    assert.equal(calls.end, 1);
    assert.equal(c.active, false);
    assert.equal(c.getDraft(), null);
});

test('窗口被关掉视为取消', () => {
    const { c, wins, calls, draft } = setup();
    c.start(draft);
    wins[0].close();
    assert.deepEqual(calls.commit, []);
    assert.equal(calls.end, 1);
    assert.equal(c.active, false);
});

test('渲染进程崩溃视为取消并关窗', () => {
    const { c, wins, calls, draft } = setup();
    c.start(draft);
    wins[0].webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    assert.equal(wins[0].isDestroyed(), true);
    assert.deepEqual(calls.commit, []);
    assert.equal(calls.end, 1);
});

test('窗口无响应视为取消并关窗', () => {
    const { c, wins, calls, draft } = setup();
    c.start(draft);
    wins[0].emit('unresponsive');
    assert.equal(wins[0].isDestroyed(), true);
    assert.equal(calls.end, 1);
});

test('commit 之后再 cancel 或 commit 不会重复 onEnd', () => {
    const { c, calls, draft } = setup();
    c.start(draft);
    c.commit({ id: 'i1' });
    c.cancel();
    assert.equal(c.commit({ id: 'i1' }), false);
    assert.equal(calls.end, 1);
    assert.equal(calls.commit.length, 1);
});

test('结束后可以开始新的会话', () => {
    const { c, wins, draft } = setup();
    c.start(draft);
    c.cancel();
    assert.equal(c.start(draft), true);
    assert.equal(wins.length, 2);
});
