'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { UnlockAnimationController } = require('../src/unlock-animation/controller');

const PLAYBACK = { filePath: 'v.mp4', sound: false, fadeInMs: 500, fadeOutMs: 700, durationMs: 6000 };

/** 模拟 BrowserWindow：destroy() 会同步触发 closed 事件 */
class FakeWin extends EventEmitter {
    constructor() {
        super();
        this.webContents = new EventEmitter();
        this.webContents.sent = [];
        this.webContents.send = (channel) => this.webContents.sent.push(channel);
        this.opacities = [];
        this.destroyed = false;
    }
    setOpacity(value) { this.opacities.push(value); }
    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.emit('closed');
    }
    isDestroyed() { return this.destroyed; }
}

function setup(t, overrides = {}) {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
    const wins = [];
    const calls = { refit: 0, register: 0, unregister: 0, hold: 0, onSkip: null, lastOpts: undefined };
    const session = { locked: true };
    const c = new UnlockAnimationController({
        getPlayback: (opts) => { calls.lastOpts = opts; return PLAYBACK; },
        createWindow: () => { const w = new FakeWin(); wins.push(w); return w; },
        refitWindow: () => { calls.refit++; },
        registerSkipKey: (onSkip) => { calls.register++; calls.onSkip = onSkip; return true; },
        unregisterSkipKey: () => { calls.unregister++; },
        isSessionLocked: () => session.locked,
        onHoldChange: () => { calls.hold++; },
        ...overrides,
    });
    return { c, wins, calls, session };
}

/** 走到 playing：锁屏 → 视频加载好 → 解锁 */
function play({ c, wins }) {
    c.handleLock();
    c.handlePlayerEvent(wins[0].webContents, 'ready');
    c.handleUnlock();
}

test('锁屏建窗口，解锁只发 start，不再建窗口', (t) => {
    const { c, wins, calls } = setup(t);
    c.handleLock();
    assert.equal(wins.length, 1);
    c.handlePlayerEvent(wins[0].webContents, 'ready');
    c.handleUnlock();
    assert.equal(c.state, 'playing');
    assert.equal(wins.length, 1);
    assert.deepEqual(wins[0].webContents.sent, ['unlock:start']);
    assert.equal(calls.refit, 1);
});

test('功能关着时锁屏解锁什么都不做', (t) => {
    const { c, wins } = setup(t, { getPlayback: () => null });
    c.handleLock();
    c.handleUnlock();
    assert.equal(wins.length, 0);
    assert.equal(c.state, 'idle');
});

test('视频没加载好就解锁：加载好再放', (t) => {
    const { c, wins } = setup(t);
    c.handleLock();
    c.handleUnlock();
    assert.equal(c.state, 'starting');
    assert.deepEqual(wins[0].webContents.sent, []);
    c.handlePlayerEvent(wins[0].webContents, 'ready');
    assert.equal(c.state, 'playing');
    assert.deepEqual(wins[0].webContents.sent, ['unlock:start']);
});

test('解锁后 3 秒还没加载好就关窗口', (t) => {
    const { c, wins } = setup(t);
    c.handleLock();
    c.handleUnlock();
    t.mock.timers.tick(2999);
    assert.equal(c.state, 'starting');
    t.mock.timers.tick(1);
    assert.equal(c.state, 'idle');
    assert.equal(wins[0].isDestroyed(), true);
});

test('解锁时没有窗口：当场建窗口，加载好就放', (t) => {
    const { c, wins } = setup(t);
    c.handleUnlock();
    assert.equal(wins.length, 1);
    c.handlePlayerEvent(wins[0].webContents, 'ready');
    assert.equal(c.state, 'playing');
});

test('解锁时没有窗口，功能又关着：什么都不做', (t) => {
    const { c, wins } = setup(t, { getPlayback: () => null });
    c.handleUnlock();
    assert.equal(wins.length, 0);
});

test('快放完时淡出，透明度降到 0 后销毁窗口', (t) => {
    const s = setup(t);
    const { c, wins } = s;
    play(s);
    c.handlePlayerEvent(wins[0].webContents, 'near-end');
    assert.equal(c.state, 'fadingOut');
    assert.equal(wins[0].isDestroyed(), false);
    t.mock.timers.tick(350);
    assert.ok(wins[0].opacities.at(-1) > 0.4 && wins[0].opacities.at(-1) < 0.6);
    t.mock.timers.tick(450);
    assert.equal(wins[0].opacities.at(-1), 0);
    assert.equal(c.state, 'idle');
    assert.equal(wins[0].isDestroyed(), true);
});

test('淡出时长为 0：马上销毁窗口', (t) => {
    const s = setup(t, { getPlayback: () => ({ ...PLAYBACK, fadeOutMs: 0 }) });
    const { c, wins } = s;
    play(s);
    c.handlePlayerEvent(wins[0].webContents, 'near-end');
    t.mock.timers.tick(16);
    assert.equal(c.state, 'idle');
    assert.equal(wins[0].isDestroyed(), true);
});

test('Esc 解锁后才注册，淡出时注销', (t) => {
    const { c, wins, calls } = setup(t);
    c.handleLock();
    c.handlePlayerEvent(wins[0].webContents, 'ready');
    assert.equal(calls.register, 0);
    c.handleUnlock();
    assert.equal(calls.register, 1);
    calls.onSkip();
    assert.equal(c.state, 'fadingOut');
    assert.equal(calls.unregister, 1);
});

test('Esc 注册失败时点鼠标仍然有效', (t) => {
    const s = setup(t, { registerSkipKey: () => false });
    play(s);
    s.c.handlePlayerEvent(s.wins[0].webContents, 'skip');
    assert.equal(s.c.state, 'fadingOut');
});

test('等加载时跳过：直接关窗口', (t) => {
    const { c, wins } = setup(t);
    c.handleUnlock();
    c.handlePlayerEvent(wins[0].webContents, 'skip');
    assert.equal(c.state, 'idle');
    assert.equal(wins[0].isDestroyed(), true);
});

test('收不到解锁事件时点鼠标也能关掉窗口', (t) => {
    const { c, wins } = setup(t);
    c.handleLock();
    c.handlePlayerEvent(wins[0].webContents, 'ready');
    c.handlePlayerEvent(wins[0].webContents, 'skip');
    assert.equal(c.state, 'idle');
    assert.equal(wins[0].isDestroyed(), true);
});

test('看门狗到时走淡出', (t) => {
    const s = setup(t);
    play(s);
    t.mock.timers.tick(11499);
    assert.equal(s.c.state, 'playing');
    t.mock.timers.tick(1);
    assert.equal(s.c.state, 'fadingOut');
});

test('播放出错直接关窗口', (t) => {
    const s = setup(t);
    play(s);
    s.c.handlePlayerEvent(s.wins[0].webContents, 'error');
    assert.equal(s.c.state, 'idle');
    assert.equal(s.wins[0].isDestroyed(), true);
});

test('锁屏时视频解不了：关窗口，解锁时不再建窗口闪一下黑屏', (t) => {
    const { c, wins } = setup(t);
    c.handleLock();
    c.handlePlayerEvent(wins[0].webContents, 'error');
    assert.equal(wins[0].isDestroyed(), true);
    c.handleUnlock();
    assert.equal(wins.length, 1);
    assert.equal(c.state, 'idle');
});

test('上次锁屏时视频解不了，下次锁屏照常准备', (t) => {
    const { c, wins } = setup(t);
    c.handleLock();
    c.handlePlayerEvent(wins[0].webContents, 'error');
    c.handleUnlock();
    c.handleLock();
    assert.equal(wins.length, 2);
    assert.equal(c.state, 'preparing');
});

test('放到一半再次锁屏：换新窗口，旧窗口的事件被忽略', (t) => {
    const s = setup(t);
    const { c, wins } = s;
    play(s);
    const old = wins[0];
    c.handleLock();
    assert.equal(old.isDestroyed(), true);
    assert.equal(c.state, 'preparing');
    assert.equal(wins.length, 2);
    c.handlePlayerEvent(old.webContents, 'ready');
    assert.equal(c.state, 'preparing');
});

test('淡出时再次锁屏：新窗口不被旧的淡出影响', (t) => {
    const s = setup(t);
    const { c, wins } = s;
    play(s);
    c.handlePlayerEvent(wins[0].webContents, 'near-end');
    c.handleLock();
    t.mock.timers.tick(2000);
    assert.equal(c.state, 'preparing');
    assert.equal(wins[1].isDestroyed(), false);
    assert.deepEqual(wins[1].opacities, []);
});

test('窗口崩溃、无响应、被关掉都回到 idle', (t) => {
    const emitters = [
        (w) => w.webContents.emit('render-process-gone'),
        (w) => w.emit('unresponsive'),
        (w) => w.destroy(),
    ];
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
    for (const emit of emitters) {
        const wins = [];
        const c = new UnlockAnimationController({
            getPlayback: () => PLAYBACK,
            createWindow: () => { const w = new FakeWin(); wins.push(w); return w; },
            refitWindow() {},
            registerSkipKey: () => true,
            unregisterSkipKey() {},
            isSessionLocked: () => true,
            onHoldChange() {},
        });
        play({ c, wins });
        emit(wins[0]);
        assert.equal(c.state, 'idle');
        assert.equal(wins[0].isDestroyed(), true);
    }
});

test('建窗口失败：回到 idle，不让异常抛到电源事件里', (t) => {
    const { c } = setup(t, { createWindow: () => { throw new Error('boom'); } });
    t.mock.method(console, 'error', () => {});
    assert.doesNotThrow(() => c.handleLock());
    assert.equal(c.state, 'idle');
});

test('holdsWallpaper 解锁时变真，淡出时变假，各通知一次', (t) => {
    const { c, wins, calls } = setup(t);
    c.handleLock();
    c.handlePlayerEvent(wins[0].webContents, 'ready');
    assert.equal(c.holdsWallpaper, false);
    c.handleUnlock();
    assert.equal(c.holdsWallpaper, true);
    c.handlePlayerEvent(wins[0].webContents, 'near-end');
    assert.equal(c.holdsWallpaper, false);
    assert.equal(calls.hold, 2);
});

test('读到过锁定后连续两次没锁定，按解锁处理', (t) => {
    const { c, wins, session } = setup(t);
    c.handleLock();
    c.handlePlayerEvent(wins[0].webContents, 'ready');
    t.mock.timers.tick(1000);
    session.locked = false;
    t.mock.timers.tick(1000);
    assert.equal(c.state, 'ready');
    t.mock.timers.tick(1000);
    assert.equal(c.state, 'playing');
});

test('中间又读到锁定：重新计数', (t) => {
    const { c, wins, session } = setup(t);
    c.handleLock();
    c.handlePlayerEvent(wins[0].webContents, 'ready');
    t.mock.timers.tick(1000);
    session.locked = false;
    t.mock.timers.tick(1000);
    session.locked = true;
    t.mock.timers.tick(1000);
    session.locked = false;
    t.mock.timers.tick(1000);
    assert.equal(c.state, 'ready');
});

test('从没读到过锁定：不会自己开始放', (t) => {
    const { c, wins, session } = setup(t);
    session.locked = false;
    c.handleLock();
    c.handlePlayerEvent(wins[0].webContents, 'ready');
    t.mock.timers.tick(10000);
    assert.equal(c.state, 'ready');
});

test('预览不看开关，忙的时候返回 false', (t) => {
    const { c, wins, calls } = setup(t);
    assert.equal(c.preview(), true);
    assert.equal(calls.lastOpts.preview, true);
    assert.equal(wins.length, 1);
    assert.equal(c.preview(), false);
    assert.equal(wins.length, 1);
});

test('预览时没有视频返回 false', (t) => {
    const { c, wins } = setup(t, { getPlayback: () => null });
    assert.equal(c.preview(), false);
    assert.equal(wins.length, 0);
});

test('dispose 销毁窗口、注销按键', (t) => {
    const s = setup(t);
    play(s);
    s.c.dispose();
    assert.equal(s.wins[0].isDestroyed(), true);
    assert.equal(s.calls.unregister, 1);
    assert.equal(s.c.state, 'idle');
});
