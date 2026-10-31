'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    coverTransform,
    strengthFromMultiplier,
    parallaxUV,
    elementScreenShift,
    screenToImageUV,
    rayMarchUV,
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

// ---- 光线步进 ----
// 深度图 1000×1000、强度 0.1、对焦 0：深度 t 的内容在画面上挪 −mouse × t × 0.1

const RAY = { focus: 0, strength: 0.1, w: 1000, h: 1000 };
const near = (actual, expected, eps) => assert.ok(Math.abs(actual - expected) < eps, `${actual} ≉ ${expected}`);
/** 左半边是深度 0.9 的前景，右半边是深度 0 的背景 */
const stepDepth = (u) => (u < 0.5 ? 0.9 : 0);
const march = (sampleDepth, u, mouseX) =>
    rayMarchUV(sampleDepth, u, 0.5, mouseX, 0, RAY.focus, RAY.strength, RAY.w, RAY.h);

test('rayMarchUV：深度平坦时和单次取样一样', () => {
    const [u, v] = rayMarchUV(() => 0.8, 0.3, 0.6, 1, -0.5, 0.5, 0.025, 1000, 1000);
    const [px, py] = parallaxUV(1, -0.5, 0.8, 0.5, 0.025);
    near(u, 0.3 + px, 1e-4);
    near(v, 0.6 + py, 1e-4);
});

test('rayMarchUV：鼠标在正中时不动', () => {
    approxArr(march(stepDepth, 0.45, 0), [0.45, 0.5]);
});

test('rayMarchUV：前景挪过来时盖住背景', () => {
    // 前景右移 0.09，屏幕 0.55 处应显示前景 0.46；单次取样查到的是背景深度，会显示背景 0.55
    near(march(stepDepth, 0.55, -1)[0], 0.46, 1e-3);
});

test('rayMarchUV：前景挪开露出的地方停在深度台阶上', () => {
    // 前景左移 0.09，屏幕 0.45 原来被前景挡着，没有真正的交点，取台阶（0.5）处的颜色
    near(march(stepDepth, 0.45, 1)[0], 0.5, 1e-3);
});

test('rayMarchUV：斜坡上得到精确解', () => {
    // 深度 = u：要找 u = p + 0.1u，p = 0.45 时 u = 0.5（单次取样得 0.495）
    near(march((u) => u, 0.45, 1)[0], 0.5, 1e-3);
});
