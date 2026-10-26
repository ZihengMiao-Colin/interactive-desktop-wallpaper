'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../shared/placement-math');

const approx = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const base = { x: 0.5, y: 0.5, width: 0.25, rotation: 0 };

test('rect 换分辨率等比', () => {
    assert.deepEqual(P.rectFromTransform(base, 2, 1920, 1080), { left: 720, top: 420, width: 480, height: 240 });
    assert.deepEqual(P.rectFromTransform(base, 2, 2560, 1440), { left: 960, top: 560, width: 640, height: 320 });
});

test('move 按像素移动并把中心夹在屏幕内', () => {
    const moved = P.moveTransform(base, 192, -108, 1920, 1080);
    approx(moved.x, 0.6);
    approx(moved.y, 0.4);
    assert.equal(moved.width, 0.25);
    assert.equal(P.moveTransform({ ...base, x: 0.9 }, 500, 0, 1920, 1080).x, 1);
    assert.equal(P.moveTransform({ ...base, y: 0.1 }, 0, -500, 1920, 1080).y, 0);
});

test('se 角缩放保持 nw 角不动', () => {
    const t = P.resizeFromCorner(base, 'se', 1300, 700, 2, 1920, 1080);
    const r = P.rectFromTransform(t, 2, 1920, 1080);
    approx(r.left, 720);
    approx(r.top, 420);
    approx(r.width, 580);
    approx(r.height, 290);
});

test('nw 角缩放保持 se 角不动', () => {
    const t = P.resizeFromCorner(base, 'nw', 600, 300, 2, 1920, 1080);
    const r = P.rectFromTransform(t, 2, 1920, 1080);
    approx(r.left + r.width, 1200);
    approx(r.top + r.height, 660);
});

test('缩放夹紧到 3%~150%', () => {
    approx(P.resizeFromCorner(base, 'se', 721, 421, 2, 1920, 1080).width, 0.03);
    approx(P.resizeFromCorner(base, 'se', 9000, 9000, 2, 1920, 1080).width, 1.5);
});

test('bottomCenter', () => {
    const [u, v] = P.bottomCenter(base, 2, 1920, 1080);
    approx(u, 0.5);
    approx(v, 0.5 + 240 / 1080 / 2);
});

test('sampleGray 取 R 通道并把越界坐标夹紧', () => {
    const data = new Uint8ClampedArray([10, 0, 0, 255, 200, 0, 0, 255]);   // 2×1
    approx(P.sampleGray(data, 2, 1, 0.9, 0.5), 200 / 255);
    approx(P.sampleGray(data, 2, 1, 0.1, 0.5), 10 / 255);
    approx(P.sampleGray(data, 2, 1, -1, 5), 10 / 255);
    approx(P.sampleGray(data, 2, 1, 2, -3), 200 / 255);
});
