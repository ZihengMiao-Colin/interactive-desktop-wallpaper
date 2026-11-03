'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const FP = require('../shared/frame-pacing');
const { IdleTracker, isSettled } = FP;

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

test('keepVideoPlaying：只有被窗口挡住、并且开了声音时视频继续放', () => {
    assert.equal(FP.keepVideoPlaying('covered', true), true);
    assert.equal(FP.keepVideoPlaying('covered', false), false);
    assert.equal(FP.keepVideoPlaying('system', true), false);
    assert.equal(FP.keepVideoPlaying('placement', true), false);
    assert.equal(FP.keepVideoPlaying(undefined, true), false);
});

test('nextWallpaperSignal：摆放 > 锁屏睡眠 > 被挡住 > 正常，状态没变不发', () => {
    const S = (o) => ({ placement: false, system: false, covered: false, ...o });
    const run = (steps) => {
        let prev = null;
        return steps.map((state) => {
            const next = FP.nextWallpaperSignal(prev, S(state));
            if (next) prev = next;
            return next;
        });
    };
    // 没被挡住时锁屏：暂停（弹提示）→ 锁屏期间全屏检测来回变都不发 → 解锁恢复
    assert.deepEqual(run([{ system: true }, { system: true, covered: true }, { system: true }, {}]), [
        { type: 'pause', reason: 'system', silent: false },
        null,
        null,
        { type: 'resume', silent: false },
    ]);
    // 被挡住时锁屏、解锁时还被挡着：换成 covered（不再弹提示），不会恢复
    assert.deepEqual(run([{ covered: true }, { covered: true, system: true }, { system: true }, { covered: true }]), [
        { type: 'pause', reason: 'covered', silent: false },
        { type: 'pause', reason: 'system', silent: true },
        null,
        { type: 'pause', reason: 'covered', silent: true },
    ]);
    // 摆放：静默暂停；被挡着时结束摆放回到 covered，没被挡着时静默恢复
    assert.deepEqual(run([{ placement: true }, {}]), [
        { type: 'pause', reason: 'placement', silent: true },
        { type: 'resume', silent: true },
    ]);
    assert.deepEqual(run([{ covered: true }, { covered: true, placement: true }, { covered: true }]), [
        { type: 'pause', reason: 'covered', silent: false },
        { type: 'pause', reason: 'placement', silent: true },
        { type: 'pause', reason: 'covered', silent: true },
    ]);
    // 一开始就是正常：不发
    assert.equal(FP.nextWallpaperSignal(null, S({})), null);
});
