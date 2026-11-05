'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../shared/crop');

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
function closeCrop(a, b) {
    for (const k of ['x', 'y', 'w', 'h']) close(a[k], b[k]);
}

/** 框在图片范围内 */
function assertInside(c) {
    assert.ok(c.x >= -1e-9 && c.y >= -1e-9, JSON.stringify(c));
    assert.ok(c.x + c.w <= 1 + 1e-9 && c.y + c.h <= 1 + 1e-9, JSON.stringify(c));
}

test('normalizeCrop：坏数据返回 null', () => {
    for (const bad of [null, undefined, 'x', 3, {}, { x: 0, y: 0, w: 1 },
        { x: NaN, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: Infinity, h: 1 }, { x: '0', y: 0, w: 1, h: 1 },
        { x: 0, y: 0, w: 0, h: 1 }, { x: 0, y: 0, w: -1, h: 1 }, { x: 2, y: 0, w: 1, h: 1 }]) {
        assert.equal(C.normalizeCrop(bad), null, JSON.stringify(bad));
    }
});

test('normalizeCrop：合法的保持不变，超出图片的收回来', () => {
    assert.deepEqual(C.normalizeCrop({ x: 0.1, y: 0.2, w: 0.5, h: 0.25, extra: 1 }), { x: 0.1, y: 0.2, w: 0.5, h: 0.25 });
    closeCrop(C.normalizeCrop({ x: -0.5, y: 0.5, w: 1, h: 1 }), { x: 0, y: 0.5, w: 0.5, h: 0.5 });
});

test('defaultCrop：3:2 的图放到 16:10 的屏幕，上下各裁一点', () => {
    closeCrop(C.defaultCrop(1920, 1280, 1600, 1000), { x: 0, y: 1 / 32, w: 1, h: 15 / 16 });
});

test('defaultCrop：比例一样时是整张图', () => {
    closeCrop(C.defaultCrop(1600, 1000, 2560, 1600), { x: 0, y: 0, w: 1, h: 1 });
});

test('defaultCrop：竖图放到横屏，宽度占满，高度只留一段', () => {
    const c = C.defaultCrop(1000, 2000, 1600, 1000);
    close(c.w, 1);
    close(c.h, 0.3125);
    close(c.y, (1 - 0.3125) / 2);
});

test('defaultCrop：横图放到竖屏，高度占满，宽度只留一段', () => {
    const c = C.defaultCrop(1920, 1080, 1080, 1920);
    close(c.h, 1);
    close(c.w, (1080 / 1920) / (1920 / 1080));
    close(c.x, (1 - c.w) / 2);
});

test('moveCrop：拖出图片时贴边', () => {
    const start = { x: 0.2, y: 0.3, w: 0.5, h: 0.5 };
    closeCrop(C.moveCrop(start, 0.1, -0.1), { x: 0.3, y: 0.2, w: 0.5, h: 0.5 });
    closeCrop(C.moveCrop(start, -9, -9), { x: 0, y: 0, w: 0.5, h: 0.5 });
    closeCrop(C.moveCrop(start, 9, 9), { x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
});

test('resizeCrop：四个角都是对角不动、比例不变、不超出图片', () => {
    const ratio = 1.2;
    const start = { x: 0.25, y: 0.3, w: 0.48, h: 0.4 };
    const cases = { nw: [-0.1, -0.05], ne: [0.1, -0.05], se: [0.1, 0.05], sw: [-0.1, 0.05] };
    for (const [corner, [dx, dy]] of Object.entries(cases)) {
        const c = C.resizeCrop(start, corner, dx, dy, ratio);
        close(c.w / c.h, ratio);
        assertInside(c);
        assert.ok(c.w > start.w, corner);
        if (corner.includes('e')) close(c.x, start.x); else close(c.x + c.w, start.x + start.w);
        if (corner.includes('s')) close(c.y, start.y); else close(c.y + c.h, start.y + start.h);
    }
});

test('resizeCrop：只上下拖也能缩放', () => {
    const c = C.resizeCrop({ x: 0.2, y: 0.2, w: 0.3, h: 0.3 }, 'se', 0, 0.2, 1);
    close(c.w, 0.5);
    close(c.h, 0.5);
});

test('resizeCrop：拖到图片外面时停在图片边上', () => {
    const c = C.resizeCrop({ x: 0.2, y: 0.5, w: 0.3, h: 0.3 }, 'se', 5, 5, 1);
    assertInside(c);
    close(c.w, 0.5);
    close(c.h, 0.5);
    close(c.x, 0.2);
    close(c.y, 0.5);
});

test('resizeCrop：缩小时宽高都不小于最小值', () => {
    for (const ratio of [0.5, 1, 2]) {
        const c = C.resizeCrop({ x: 0.2, y: 0.2, w: 0.6 * Math.min(1, ratio), h: 0.6 * Math.min(1, 1 / ratio) }, 'se', -9, -9, ratio);
        assert.ok(c.w >= C.MIN_SIDE - 1e-9 && c.h >= C.MIN_SIDE - 1e-9, JSON.stringify(c));
        close(c.w / c.h, ratio);
    }
});

test('resizeCrop：图片放不下最小值时不超出图片', () => {
    // 框很扁（比例 20），贴着底边缩放时高度放不下最小值
    const c = C.resizeCrop({ x: 0, y: 0.97, w: 0.6, h: 0.03 }, 'se', -9, -9, 20);
    assertInside(c);
    close(c.w / c.h, 20);
});

test('fitCropToRatio：比例不同时收进原来的范围，中心不变', () => {
    const old = { x: 0.1, y: 0.2, w: 0.8, h: 0.5 };
    for (const ratio of [0.5, 1, 3]) {
        const c = C.fitCropToRatio(old, ratio);
        close(c.w / c.h, ratio);
        close(c.x + c.w / 2, old.x + old.w / 2);
        close(c.y + c.h / 2, old.y + old.h / 2);
        assert.ok(c.x >= old.x - 1e-9 && c.y >= old.y - 1e-9);
        assert.ok(c.x + c.w <= old.x + old.w + 1e-9 && c.y + c.h <= old.y + old.h + 1e-9);
    }
});

test('ratioLabel：常见比例、DIP 尺寸有误差也能认，竖屏对调，认不出写小数', () => {
    assert.equal(C.ratioLabel(1707, 1067), '16:10');
    assert.equal(C.ratioLabel(1920, 1080), '16:9');
    assert.equal(C.ratioLabel(3440, 1440), '21:9');
    assert.equal(C.ratioLabel(1080, 1920), '9:16');
    assert.equal(C.ratioLabel(1000, 900), '1.11:1');
    assert.equal(C.ratioLabel(900, 1000), '1:1.11');
});

test('isLowRes：裁剪后的像素比屏幕小才算，差一点点不算', () => {
    const full = { x: 0, y: 0, w: 1, h: 1 };
    assert.equal(C.isLowRes(full, 2560, 1600, 2560, 1600), false);
    assert.equal(C.isLowRes(full, 2545, 1590, 2560, 1600), false);
    assert.equal(C.isLowRes({ ...full, w: 0.5, h: 0.5 }, 2560, 1600, 2560, 1600), true);
    assert.equal(C.isLowRes({ ...full, w: 0.5, h: 0.5 }, 5120, 3200, 2560, 1600), false);
    assert.equal(C.isLowRes(full, 2560, 1000, 2560, 1600), true);
});

test('viewBoxInset：上右下左的百分比', () => {
    assert.equal(C.viewBoxInset({ x: 0.1, y: 0.2, w: 0.5, h: 0.25 }),
        'inset(20.0000% 40.0000% 55.0000% 10.0000%)');
});

test('formatQuery / parseQuery：来回不变，坏的读成 null', () => {
    const c = { x: 0.125, y: 0.25, w: 0.5, h: 0.5 };
    assert.deepEqual(C.parseQuery(C.formatQuery(c)), c);
    for (const bad of ['', 'a,b', '1,2,3', '0,0,0,0', null, undefined]) assert.equal(C.parseQuery(bad), null);
});
