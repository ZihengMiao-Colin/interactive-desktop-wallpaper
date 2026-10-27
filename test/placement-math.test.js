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

// ---------- 旋转、拉伸、自由变形 ----------

const W = 1920;
const H = 1080;
/** 480×240 的框，中心在屏幕中央 */
const rotated = (deg, extra = {}) => ({ ...base, rotation: deg, ...extra });
const near = (p, q, eps = 1e-6) => { approx(p[0], q[0], eps); approx(p[1], q[1], eps); };

test('rect 计入拉伸', () => {
    assert.deepEqual(P.rectFromTransform({ ...base, stretch: 1.5 }, 2, W, H), { left: 720, top: 360, width: 480, height: 360 });
});

test('toLocal / toScreen：旋转 90° 后框的顶边朝右', () => {
    const t = rotated(90);
    near(P.toLocal(t, 2, 960, 540, W, H), [0.5, 0.5]);
    near(P.toScreen(t, 2, 0.5, 0, W, H), [960 + 120, 540]);
    near(P.toLocal(t, 2, 960 + 120, 540, W, H), [0.5, 0]);
    const t30 = rotated(30, { stretch: 1.3 });
    near(P.toLocal(t30, 2, ...P.toScreen(t30, 2, 0.2, 0.9, W, H), W, H), [0.2, 0.9]);
});

test('旋转后角点缩放：对角在屏幕上不动', () => {
    const t = rotated(90);
    const anchor = P.toScreen(t, 2, 0, 0, W, H);
    const next = P.resizeFromCorner(t, 'se', 960 - 200, 540 + 400, 2, W, H);
    near(P.toScreen(next, 2, 0, 0, W, H), anchor, 1e-3);
    assert.equal(next.rotation, 90);
    assert.ok(next.width > base.width);
});

test('拉伸右边：左边不动、高度不变', () => {
    const next = P.stretchFromEdge(base, 'e', 1440, 700, 2, W, H);
    const r = P.rectFromTransform(next, 2, W, H);
    approx(r.left, 720);
    approx(r.width, 720);
    approx(r.height, 240);
    approx(r.top, 420);
});

test('拉伸下边：上边不动、宽度不变', () => {
    const next = P.stretchFromEdge(base, 's', 100, 900, 2, W, H);
    const r = P.rectFromTransform(next, 2, W, H);
    approx(r.top, 420);
    approx(r.height, 480);
    approx(r.width, 480);
    approx(next.stretch, 2);
});

test('拉伸夹紧到允许范围', () => {
    const next = P.stretchFromEdge(base, 's', 0, 9000, 2, W, H);
    approx(next.stretch, 5);
});

test('rotateToPointer：手柄在框上方，指针方向即朝向；按住 Shift 吸附 15°', () => {
    approx(P.rotateToPointer(base, 960, 100, W, H), 0);
    approx(P.rotateToPointer(base, 1500, 540, W, H), 90);
    approx(P.rotateToPointer(base, 400, 540, W, H), -90);
    approx(P.rotateToPointer(base, 960, 900, W, H), 180);
    const a = (37 * Math.PI) / 180;
    approx(P.rotateToPointer(base, 960 + Math.sin(a) * 300, 540 - Math.cos(a) * 300, W, H, 15), 30);
});

test('quadCorners：没有变形时就是整个框', () => {
    assert.deepEqual(P.quadCorners(base), [[0, 0], [1, 0], [1, 1], [0, 1]]);
});

test('moveWarpCorner：单独拖一个角；拖成凹四边形时不接受', () => {
    const next = P.moveWarpCorner(base, 0, 720 + 48, 420 + 24, 2, W, H);
    near(P.quadCorners(next)[0], [0.1, 0.1]);
    near(P.quadCorners(next)[2], [1, 1]);
    const bad = P.moveWarpCorner(base, 0, 720 + 450, 420 + 230, 2, W, H);
    assert.equal(bad, base);
});

test('pointInElement 计入旋转和变形', () => {
    assert.equal(P.pointInElement(base, 2, 960, 540, W, H), true);
    assert.equal(P.pointInElement(base, 2, 725, 425, W, H), true);
    assert.equal(P.pointInElement(rotated(90), 2, 725, 425, W, H), false, '转 90° 后原来的角落不在框里');
    const warped = P.moveWarpCorner(base, 0, 960, 540 - 60, 2, W, H);
    assert.equal(P.pointInElement(warped, 2, 725, 425, W, H), false, '左上角拖走后那里不再属于元素');
});

test('projectiveWeights：透视插值后贴图中心落在对角线交点', () => {
    approx(new Set(P.projectiveWeights(P.quadCorners(base)).map((q) => q.toFixed(9))).size, 1);
    const pts = [[0.3, 0], [0.7, 0], [1, 1], [0, 1]];   // 上窄下宽的梯形
    const q = P.projectiveWeights(pts);
    // 对角线 p0→p2 上的交点比例 s
    const [p0, , p2] = pts;
    const s = (() => {
        const [x1, y1] = p0; const [x2, y2] = p2; const [x3, y3] = pts[1]; const [x4, y4] = pts[3];
        const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
        return ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
    })();
    const uq = (1 - s) * 0 * q[0] + s * 1 * q[2];
    const qq = (1 - s) * q[0] + s * q[2];
    approx(uq / qq, 0.5);
});

test('bottomCenter 计入旋转：转 180° 后底边在上面', () => {
    const [u, v] = P.bottomCenter(rotated(180), 2, W, H);
    approx(u, 0.5);
    approx(v, 0.5 - 240 / 1080 / 2);
});

test('boundingRect：转 90° 后宽高互换', () => {
    const r = P.boundingRect(rotated(90), 2, W, H);
    approx(r.left, 960 - 120);
    approx(r.right, 960 + 120);
    approx(r.top, 540 - 240);
    approx(r.bottom, 540 + 240);
});

test('sampleGray 取 R 通道并把越界坐标夹紧', () => {
    const data = new Uint8ClampedArray([10, 0, 0, 255, 200, 0, 0, 255]);   // 2×1
    approx(P.sampleGray(data, 2, 1, 0.9, 0.5), 200 / 255);
    approx(P.sampleGray(data, 2, 1, 0.1, 0.5), 10 / 255);
    approx(P.sampleGray(data, 2, 1, -1, 5), 10 / 255);
    approx(P.sampleGray(data, 2, 1, 2, -3), 200 / 255);
});
