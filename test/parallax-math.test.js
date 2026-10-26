'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    coverTransform,
    strengthFromMultiplier,
    parallaxUV,
    elementScreenShift,
    screenToImageUV,
} = require('../shared/parallax-math');

const EPS = 1e-6;
const approx = (actual, expected) => assert.ok(Math.abs(actual - expected) < EPS, `${actual} ≉ ${expected}`);
const approxArr = (actual, expected) => {
    assert.equal(actual.length, expected.length);
    actual.forEach((v, i) => approx(v, expected[i]));
};

test('cover：同比例无裁切', () => {
    assert.deepEqual(coverTransform(1920, 1080, 1920, 1080), { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 });
});

test('cover：超宽屏上下裁切', () => {
    const c = coverTransform(2560, 1080, 1920, 1080);
    approx(c.scaleY, 0.75);
    approx(c.offsetY, 0.125);
    assert.equal(c.scaleX, 1);
    assert.equal(c.offsetX, 0);
});

test('cover：竖屏左右裁切', () => {
    const c = coverTransform(1080, 1920, 1920, 1080);
    approx(c.scaleX, (1080 / 1920) / (1920 / 1080));
    approx(c.offsetX, (1 - c.scaleX) / 2);
    assert.equal(c.scaleY, 1);
});

test('分辨率无关：同比例不同分辨率结果相同', () => {
    assert.deepEqual(coverTransform(1920, 1080, 4000, 3000), coverTransform(2560, 1440, 4000, 3000));
});

test('强度换算', () => {
    approx(strengthFromMultiplier(20), 0.025);
});

test('parallaxUV：普通位移', () => {
    approxArr(parallaxUV(1, 0, 0.8, 0.5, 0.025), [0.0075, 0]);
});

test('parallaxUV：软截断', () => {
    approxArr(parallaxUV(3, 0, 1, 0, 0.025), [0.047, 0]);
});

test('parallaxUV：焦平面不动', () => {
    approxArr(parallaxUV(1, 1, 0.5, 0.5, 0.05), [0, 0]);
});

test('elementScreenShift 按 cover 换算且取反', () => {
    const cover = { scaleX: 0.5, scaleY: 1, offsetX: 0.25, offsetY: 0 };
    approxArr(elementScreenShift(1, 0, 0.8, 0.5, 0.025, cover), [-0.015, 0]);
});

test('screenToImageUV', () => {
    const cover = { scaleX: 0.5, scaleY: 1, offsetX: 0.25, offsetY: 0 };
    approxArr(screenToImageUV(0.5, 0.2, cover), [0.5, 0.2]);
    approxArr(screenToImageUV(0, 1, cover), [0.25, 1]);
});
