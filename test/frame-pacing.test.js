'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { IdleTracker, isSettled } = require('../shared/frame-pacing');

test('连续空闲满 graceFrames 帧才停帧', () => {
    const idle = new IdleTracker({ graceFrames: 3 });
    assert.equal(idle.frame(true), false);
    assert.equal(idle.frame(true), false);
    assert.equal(idle.frame(true), true);
});

test('中途有一帧不空闲就重新计数', () => {
    const idle = new IdleTracker({ graceFrames: 3 });
    idle.frame(true);
    idle.frame(true);
    assert.equal(idle.frame(false), false);
    assert.equal(idle.frame(true), false);
    assert.equal(idle.frame(true), false);
    assert.equal(idle.frame(true), true);
});

test('reset 后重新计数', () => {
    const idle = new IdleTracker({ graceFrames: 2 });
    idle.frame(true);
    idle.reset();
    assert.equal(idle.frame(true), false);
    assert.equal(idle.frame(true), true);
});

test('isSettled：平滑位置追上鼠标才算收敛', () => {
    assert.equal(isSettled(0.5, 0.5), true);
    assert.equal(isSettled(0.5, 0.4999), true);
    assert.equal(isSettled(0.5, 0.49), false);
    assert.equal(isSettled(-1, 1), false);
});
