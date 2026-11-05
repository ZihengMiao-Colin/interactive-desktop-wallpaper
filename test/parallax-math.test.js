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

// ---- 视频壁纸：整体平移 ----
const P = require('../shared/parallax-math');
const close = approx;

test('panCover：整体平移时放大画面，四周至少留出 maxShift 的余量', () => {
    const c = P.panCover({ scaleX: 1, scaleY: 0.8, offsetX: 0, offsetY: 0.1 }, 0.05);
    close(c.scaleX, 0.9); close(c.scaleY, 0.72); close(c.offsetX, 0.05); close(c.offsetY, 0.14);
    assert.deepEqual(P.panCover({ scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 }, 0), { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 });
});

test('motionParams：三种效果换算出的强度、对焦、元素深度和遮挡', () => {
    assert.deepEqual(P.motionParams('depth', 0.02, 0.5), { strength: 0.02, focus: 0.5, elementDepth: null, occlusion: true });
    assert.deepEqual(P.motionParams('none', 0.02, 0.5), { strength: 0, focus: 0.5, elementDepth: null, occlusion: false });
    assert.deepEqual(P.motionParams('pan', 0.02, 0.5), { strength: 0.02, focus: 0, elementDepth: 1, occlusion: false });
    assert.deepEqual(P.motionParams('zoom', 0.02, 0.5), P.motionParams('depth', 0.02, 0.5));
});

test('整体平移：元素的屏幕位移和背景一样，移到最边上也不出图片范围', () => {
    const s = P.strengthFromMultiplier(30);
    const cover = P.panCover(P.coverTransform(1920, 1080, 1920, 1080), s);
    const m = P.motionParams('pan', s, 0.5);
    for (const [mx, my] of [[1, 1], [-1, -1], [0.6, -0.4]]) {
        const [u, v] = P.rayMarchUV(() => 1, 0.5, 0.5, mx, my, m.focus, m.strength, 1, 1);
        const [dx, dy] = P.elementScreenShift(mx, my, m.elementDepth, m.focus, m.strength, cover);
        close(dx, -(u - 0.5) / cover.scaleX);
        close(dy, -(v - 0.5) / cover.scaleY);
        // 屏幕四角对应的图片 UV 加上位移后仍在 [0, 1] 里
        for (const [sx, sy] of [[0, 0], [1, 1]]) {
            const [iu, iv] = P.screenToImageUV(sx, sy, cover);
            const [ru, rv] = P.rayMarchUV(() => 1, iu, iv, mx, my, m.focus, m.strength, 1, 1);
            assert.ok(ru >= -1e-9 && ru <= 1 + 1e-9 && rv >= -1e-9 && rv <= 1 + 1e-9);
        }
    }
});

// ---- 裁剪 ----

/** 16:10 的屏幕、3:2 的图片，这张图里和屏幕同比例的区域 */
const SW = 1600;
const SH = 1000;
const IW = 1920;
const IH = 1280;
const SAME_RATIO_CROP = { x: 0.2, y: 0.1, w: 0.5, h: 0.5 / (1.6 / 1.5) };

function assertCornersInside(cover, crop) {
    for (const [sx, sy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const [u, v] = P.screenToImageUV(sx, sy, cover);
        assert.ok(u >= crop.x - 1e-9 && u <= crop.x + crop.w + 1e-9, `u=${u}`);
        assert.ok(v >= crop.y - 1e-9 && v <= crop.y + crop.h + 1e-9, `v=${v}`);
    }
}

test('cropCover：没有裁剪时和 coverTransform 一样，放大比例是 1', () => {
    assert.deepEqual(P.cropCover(SW, SH, IW, IH, null), P.coverTransform(SW, SH, IW, IH));
    assert.equal(P.cropZoom(SW, SH, IW, IH, null), 1);
});

test('cropCover：区域和屏幕同比例时刚好铺满区域', () => {
    const c = P.cropCover(SW, SH, IW, IH, SAME_RATIO_CROP);
    close(c.scaleX, SAME_RATIO_CROP.w);
    close(c.scaleY, SAME_RATIO_CROP.h);
    close(c.offsetX, SAME_RATIO_CROP.x);
    close(c.offsetY, SAME_RATIO_CROP.y);
});

test('cropCover：屏幕比例和区域不一样时（换了显示器）在区域内再裁，不超出', () => {
    for (const [w, h] of [[1920, 1080], [1000, 1000], [1080, 1920], [3440, 1440]]) {
        assertCornersInside(P.cropCover(w, h, IW, IH, SAME_RATIO_CROP), SAME_RATIO_CROP);
    }
});

test('cropZoom：裁成一半大小，放大比例是一半', () => {
    const full = P.coverTransform(SW, SH, IW, IH);
    close(P.cropZoom(SW, SH, IW, IH, SAME_RATIO_CROP), 0.5 / full.scaleX);
});

test('裁剪后视差在屏幕上的位移和不裁时一样', () => {
    const s = P.strengthFromMultiplier(10);
    const k = P.cropZoom(SW, SH, IW, IH, SAME_RATIO_CROP);
    const plain = P.coverTransform(SW, SH, IW, IH);
    const cropped = P.cropCover(SW, SH, IW, IH, SAME_RATIO_CROP);
    const [ax, ay] = P.elementScreenShift(1, -0.6, 0.9, 0.5, s, plain);
    const [bx, by] = P.elementScreenShift(1, -0.6, 0.9, 0.5, s * k, cropped);
    close(ax, bx);
    close(ay, by);
});

test('cropBounds：没有裁剪时是原来写死的范围，有裁剪时在区域内留一点余量', () => {
    const [a, b, c, d] = P.cropBounds(null);
    close(a, 0.001); close(b, 0.001); close(c, 0.999); close(d, 0.999);
    const crop = { x: 0.2, y: 0.1, w: 0.5, h: 0.4 };
    const [minX, minY, maxX, maxY] = P.cropBounds(crop);
    close(minX, 0.2005); close(minY, 0.1004); close(maxX, 0.6995); close(maxY, 0.4996);
});

test('整体平移：裁剪后移到最边上也不出区域', () => {
    const k = P.cropZoom(SW, SH, IW, IH, SAME_RATIO_CROP);
    const s = P.strengthFromMultiplier(30) * k;
    const cover = P.panCover(P.cropCover(SW, SH, IW, IH, SAME_RATIO_CROP), s, SAME_RATIO_CROP);
    const m = P.motionParams('pan', s, 0.5);
    for (const [mx, my] of [[1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        for (const [sx, sy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
            const [iu, iv] = P.screenToImageUV(sx, sy, cover);
            const [ru, rv] = P.rayMarchUV(() => 1, iu, iv, mx, my, m.focus, m.strength, 1, 1);
            assert.ok(ru >= SAME_RATIO_CROP.x - 1e-9 && ru <= SAME_RATIO_CROP.x + SAME_RATIO_CROP.w + 1e-9, `u=${ru}`);
            assert.ok(rv >= SAME_RATIO_CROP.y - 1e-9 && rv <= SAME_RATIO_CROP.y + SAME_RATIO_CROP.h + 1e-9, `v=${rv}`);
        }
    }
});
