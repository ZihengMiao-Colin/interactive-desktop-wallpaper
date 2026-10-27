'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spinRamp, velocityAt, progressOf, armAngle, isClickable, hitTest } = require('../shared/vinyl-player');

const FULL = 0.2;   // 度 / 毫秒
const RAMP = 1000;  // 从静止到全速的毫秒数

/** 缓动曲线起点、终点的斜率换算成角速度（度 / 毫秒） */
function endSpeeds(r) {
    const [x1, y1, x2, y2] = r.easing;
    const scale = r.delta / r.duration;
    return { start: (y1 / x1) * scale, end: ((1 - y2) / (1 - x2)) * scale };
}

test('从静止加速到全速：用满加速时间，转过的角度是平均速度乘时间，起止速度对得上', () => {
    const r = spinRamp(0, FULL, { rampMs: RAMP, fullSpeed: FULL });
    assert.equal(r.duration, RAMP);
    assert.ok(Math.abs(r.delta - (FULL / 2) * RAMP) < 1e-9);
    const s = endSpeeds(r);
    assert.ok(Math.abs(s.start - 0) < 1e-9);
    assert.ok(Math.abs(s.end - FULL) < 1e-9);
});

test('从全速停下：起点是全速，终点速度为 0', () => {
    const r = spinRamp(FULL, 0, { rampMs: RAMP, fullSpeed: FULL });
    assert.equal(r.duration, RAMP);
    const s = endSpeeds(r);
    assert.ok(Math.abs(s.start - FULL) < 1e-9);
    assert.ok(Math.abs(s.end - 0) < 1e-9);
});

test('从半速加到全速：加速度不变，所以只用一半时间', () => {
    const r = spinRamp(FULL / 2, FULL, { rampMs: RAMP, fullSpeed: FULL });
    assert.equal(r.duration, RAMP / 2);
    assert.ok(Math.abs(r.delta - ((FULL / 2 + FULL) / 2) * (RAMP / 2)) < 1e-9);
    const s = endSpeeds(r);
    assert.ok(Math.abs(s.start - FULL / 2) < 1e-9);
    assert.ok(Math.abs(s.end - FULL) < 1e-9);
});

test('速度不变时不需要过渡', () => {
    const r = spinRamp(FULL, FULL, { rampMs: RAMP, fullSpeed: FULL });
    assert.equal(r.duration, 0);
    assert.equal(r.delta, 0);
});

test('velocityAt：在一段加减速里线性插值，前后分别是起止速度', () => {
    const seg = { v0: 0, v1: FULL, start: 100, duration: 1000 };
    assert.equal(velocityAt(seg, 50), 0);
    assert.ok(Math.abs(velocityAt(seg, 600) - FULL / 2) < 1e-9);
    assert.equal(velocityAt(seg, 5000), FULL);
    assert.equal(velocityAt({ v0: 0, v1: FULL, start: 0, duration: 0 }, 10), FULL);
});

test('progressOf：时长未知时为 0，超出范围时截断', () => {
    assert.equal(progressOf(10, NaN), 0);
    assert.equal(progressOf(10, Infinity), 0);
    assert.equal(progressOf(10, 0), 0);
    assert.equal(progressOf(30, 120), 0.25);
    assert.equal(progressOf(130, 120), 1);
});

test('armAngle：进度 0 在最外圈，1 在最内圈', () => {
    assert.equal(armAngle(0, 4, 26), 4);
    assert.equal(armAngle(1, 4, 26), 26);
    assert.equal(armAngle(0.5, 4, 26), 15);
    assert.equal(armAngle(-1, 4, 26), 4);
    assert.equal(armAngle(2, 4, 26), 26);
});

test('isClickable：显示中且导入了音乐才响应桌面点击', () => {
    assert.equal(isClickable({ enabled: true, audioPath: 'C:/music/a.mp3' }), true);
    assert.equal(isClickable({ enabled: false, audioPath: 'C:/music/a.mp3' }), false);
    assert.equal(isClickable({ enabled: true, audioPath: '' }), false);
    assert.equal(isClickable(undefined), false);
});

test('hitTest：点在唱片圆盘或歌名胶囊上算点中，圆盘外接方形的四个角不算', () => {
    const disc = { cx: 100, cy: 100, r: 50 };
    const card = { left: 60, top: 170, right: 140, bottom: 200 };
    assert.equal(hitTest(100, 100, disc, card), true);    // 圆心
    assert.equal(hitTest(140, 120, disc, card), true);    // 圆内
    assert.equal(hitTest(145, 145, disc, card), false);   // 外接方形的角上
    assert.equal(hitTest(100, 185, disc, card), true);    // 胶囊里
    assert.equal(hitTest(150, 185, disc, card), false);   // 胶囊右边
    assert.equal(hitTest(100, 185, disc, null), false);   // 没有胶囊
});
