'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    DEFAULTS,
    normalizeConfig,
    fitFades,
    fadeOutStartMs,
    watchdogMs,
    opacityAt,
    transition,
    isActive,
} = require('../shared/unlock-animation');

test('normalizeConfig 补默认值', () => {
    assert.deepEqual(normalizeConfig(undefined), {
        enabled: false,
        file: '',
        name: '',
        thumb: '',
        duration: 0,
        fadeInMs: 500,
        fadeOutMs: 700,
        sound: false,
    });
    assert.deepEqual(normalizeConfig(undefined), DEFAULTS);
});

test('normalizeConfig 把时长压到范围内并取整', () => {
    assert.equal(normalizeConfig({ fadeInMs: 9999 }).fadeInMs, 3000);
    assert.equal(normalizeConfig({ fadeOutMs: -5 }).fadeOutMs, 0);
    assert.equal(normalizeConfig({ fadeInMs: 'abc' }).fadeInMs, 500);
    assert.equal(normalizeConfig({ fadeInMs: 612.4 }).fadeInMs, 612);
});

test('normalizeConfig 没有视频时开关读成关', () => {
    assert.equal(normalizeConfig({ enabled: true }).enabled, false);
    assert.equal(normalizeConfig({ enabled: true, file: 'a.mp4' }).enabled, true);
});

test('normalizeConfig 类型不对时读成默认值', () => {
    assert.equal(normalizeConfig({ file: 5 }).file, '');
    assert.equal(normalizeConfig({ duration: -1 }).duration, 0);
    assert.equal(normalizeConfig({ sound: 'yes' }).sound, false);
});

test('fitFades：放得下不变，放不下按比例缩短，时长未知不变', () => {
    assert.deepEqual(fitFades(500, 700, 5000), { fadeInMs: 500, fadeOutMs: 700 });
    assert.deepEqual(fitFades(500, 700, 600), { fadeInMs: 250, fadeOutMs: 350 });
    assert.deepEqual(fitFades(500, 700, 0), { fadeInMs: 500, fadeOutMs: 700 });
});

test('fadeOutStartMs：时长未知时返回 Infinity，只靠 ended 结束', () => {
    assert.equal(fadeOutStartMs(6000, 700), 5300);
    assert.equal(fadeOutStartMs(300, 700), 0);
    assert.equal(fadeOutStartMs(0, 700), Infinity);
    assert.equal(fadeOutStartMs(NaN, 700), Infinity);
});

test('watchdogMs', () => {
    assert.equal(watchdogMs(6000, 500), 11500);
    assert.equal(watchdogMs(0, 500), 120000);
});

test('opacityAt', () => {
    assert.equal(opacityAt(0, 700), 1);
    assert.equal(opacityAt(350, 700), 0.5);
    assert.equal(opacityAt(900, 700), 0);
    assert.equal(opacityAt(0, 0), 0);
});

test('transition 和转换表一致', () => {
    const rows = [
        ['idle', 'lock', 'preparing', ['create']],
        ['idle', 'unlock', 'starting', ['create']],
        ['idle', 'preview', 'starting', ['create']],

        ['preparing', 'unlock', 'starting', []],
        ['preparing', 'ready', 'ready', []],
        ['preparing', 'skip', 'idle', ['destroy']],
        ['preparing', 'error', 'idle', ['destroy']],
        ['preparing', 'closed', 'idle', ['destroy']],
        ['preparing', 'abort', 'idle', ['destroy']],

        ['ready', 'unlock', 'playing', ['start']],
        ['ready', 'skip', 'idle', ['destroy']],
        ['ready', 'error', 'idle', ['destroy']],
        ['ready', 'closed', 'idle', ['destroy']],
        ['ready', 'abort', 'idle', ['destroy']],

        ['starting', 'lock', 'preparing', ['destroy', 'create']],
        ['starting', 'ready', 'playing', ['start']],
        ['starting', 'skip', 'idle', ['destroy']],
        ['starting', 'timeout', 'idle', ['destroy']],
        ['starting', 'error', 'idle', ['destroy']],
        ['starting', 'closed', 'idle', ['destroy']],
        ['starting', 'abort', 'idle', ['destroy']],

        ['playing', 'lock', 'preparing', ['destroy', 'create']],
        ['playing', 'nearEnd', 'fadingOut', ['fade']],
        ['playing', 'skip', 'fadingOut', ['fade']],
        ['playing', 'timeout', 'fadingOut', ['fade']],
        ['playing', 'error', 'idle', ['destroy']],
        ['playing', 'closed', 'idle', ['destroy']],
        ['playing', 'abort', 'idle', ['destroy']],

        ['fadingOut', 'lock', 'preparing', ['destroy', 'create']],
        ['fadingOut', 'error', 'idle', ['destroy']],
        ['fadingOut', 'closed', 'idle', ['destroy']],
        ['fadingOut', 'abort', 'idle', ['destroy']],
        ['fadingOut', 'fadeDone', 'idle', ['destroy']],
    ];
    for (const [state, event, nextState, actions] of rows) {
        assert.deepEqual(transition(state, event), { state: nextState, actions }, `${state} + ${event}`);
    }
});

test('没定义的组合不变', () => {
    assert.deepEqual(transition('ready', 'lock'), { state: 'ready', actions: [] });
    assert.deepEqual(transition('preparing', 'lock'), { state: 'preparing', actions: [] });
    assert.deepEqual(transition('idle', 'ready'), { state: 'idle', actions: [] });
    assert.deepEqual(transition('fadingOut', 'skip'), { state: 'fadingOut', actions: [] });
});

test('isActive', () => {
    assert.equal(isActive('starting'), true);
    assert.equal(isActive('playing'), true);
    assert.equal(isActive('ready'), false);
    assert.equal(isActive('fadingOut'), false);
});
