'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { pickFrame, IntervalScheduler } = require('../shared/playback');

test('pickFrame 循环', () => {
    assert.equal(pickFrame([100, 100, 100], 0), 0);
    assert.equal(pickFrame([100, 100, 100], 250), 2);
    assert.equal(pickFrame([100, 100, 100], 310), 0);
});

test('pickFrame 0 时长按 100ms', () => {
    assert.equal(pickFrame([0, 0], 150), 1);
});

test('间隔播放时序（rng=0.5 无抖动）', () => {
    const s = new IntervalScheduler({ intervalSec: 10, jitterSec: 3 }, () => 0.5);
    assert.equal(s.tick(0, false), 'start');
    assert.equal(s.playing, true);
    assert.equal(s.tick(5000, false), null);
    assert.equal(s.tick(7000, true), 'hide');
    assert.equal(s.playing, false);
    assert.equal(s.tick(16999, false), null);
    assert.equal(s.tick(17000, false), 'start');
});

test('抖动边界', () => {
    const low = new IntervalScheduler({ intervalSec: 10, jitterSec: 3 }, () => 0);
    low.tick(0, false);
    low.tick(7000, true);
    assert.equal(low.tick(13999, false), null);
    assert.equal(low.tick(14000, false), 'start');

    const high = new IntervalScheduler({ intervalSec: 10, jitterSec: 3 }, () => 1);
    high.tick(0, false);
    high.tick(7000, true);
    assert.equal(high.tick(19999, false), null);
    assert.equal(high.tick(20000, false), 'start');
});

test('最少等 1 秒', () => {
    const s = new IntervalScheduler({ intervalSec: 0.2, jitterSec: 0 }, () => 0.5);
    s.tick(0, false);
    s.tick(500, true);
    assert.equal(s.tick(1499, false), null);
    assert.equal(s.tick(1500, false), 'start');
});

test('暂停期间不计时，待播时间顺延', () => {
    const s = new IntervalScheduler({ intervalSec: 10, jitterSec: 3 }, () => 0.5);
    s.tick(0, false);
    s.tick(7000, true);          // 下一次应在 17000
    s.pause(10000);
    assert.equal(s.tick(18000, false), null, '暂停中不触发');
    s.resume(20000);             // 暂停了 10 秒 → 顺延到 27000
    assert.equal(s.tick(26999, false), null);
    assert.equal(s.tick(27000, false), 'start');
});
