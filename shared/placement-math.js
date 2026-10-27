/**
 * placement-math.js — 摆放模式的几何计算：归一化 transform ↔ 屏幕像素、拖动、缩放、拉伸、旋转、自由变形、点击命中
 *
 * transform.x / y 是元素中心（屏幕归一化 0~1），transform.width 是相对屏幕宽度的比例，
 * 高度 = 宽度 ÷ 素材宽高比 × stretch。rotation 是绕中心顺时针旋转的角度。
 *
 * "框坐标"(u, v)：未旋转的元素框里的归一化坐标，左上角 (0, 0)，右下角 (1, 1)。
 * 自由变形时四个角可以离开框（transform.warp 记录偏移），贴图按透视映射到这个四边形上。
 */

(function (root, factory) {
    const elements = (typeof module === 'object' && module.exports)
        ? require('./elements-model')
        : root.Shared.elements;
    const mod = factory(elements);
    if (typeof module === 'object' && module.exports) module.exports = mod;
    else (root.Shared = root.Shared || {}).placement = mod;
})(typeof self !== 'undefined' ? self : this, function (elements) {
    'use strict';

    const clamp01 = (v) => Math.min(1, Math.max(0, v));
    const DEG = Math.PI / 180;
    /** 框的四个角（左上、右上、右下、左下） */
    const BOX_CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]];
    /** 自由变形时角点最多拖出框多远（框尺寸的倍数） */
    const WARP_REACH = 1;

    /** 元素框的像素尺寸 */
    function elementSize(transform, assetAspect, screenW) {
        const width = transform.width * screenW;
        return { width, height: (width / assetAspect) * (transform.stretch || 1) };
    }

    /** transform → 屏幕像素矩形（未旋转的框） */
    function rectFromTransform(transform, assetAspect, screenW, screenH) {
        const { width, height } = elementSize(transform, assetAspect, screenW);
        return {
            left: transform.x * screenW - width / 2,
            top: transform.y * screenH - height / 2,
            width,
            height,
        };
    }

    /** 屏幕像素点 → 框坐标 */
    function toLocal(transform, assetAspect, px, py, screenW, screenH) {
        const { width, height } = elementSize(transform, assetAspect, screenW);
        const a = (transform.rotation || 0) * DEG;
        const dx = px - transform.x * screenW;
        const dy = py - transform.y * screenH;
        const lx = Math.cos(a) * dx + Math.sin(a) * dy;
        const ly = -Math.sin(a) * dx + Math.cos(a) * dy;
        return [lx / width + 0.5, ly / height + 0.5];
    }

    /** 框坐标 → 屏幕像素点 */
    function toScreen(transform, assetAspect, u, v, screenW, screenH) {
        const { width, height } = elementSize(transform, assetAspect, screenW);
        const a = (transform.rotation || 0) * DEG;
        const lx = (u - 0.5) * width;
        const ly = (v - 0.5) * height;
        return [
            transform.x * screenW + Math.cos(a) * lx - Math.sin(a) * ly,
            transform.y * screenH + Math.sin(a) * lx + Math.cos(a) * ly,
        ];
    }

    /** 屏幕向量 → 元素自身坐标轴上的分量（像素） */
    function toAxes(transform, dx, dy) {
        const a = (transform.rotation || 0) * DEG;
        return [Math.cos(a) * dx + Math.sin(a) * dy, -Math.sin(a) * dx + Math.cos(a) * dy];
    }

    /** 从固定点 anchor 出发，沿元素自身坐标轴走 (lx, ly) 像素后的位置 → 新的中心（归一化） */
    function centerFrom(transform, anchor, lx, ly, screenW, screenH) {
        const a = (transform.rotation || 0) * DEG;
        return {
            x: (anchor[0] + Math.cos(a) * lx - Math.sin(a) * ly) / screenW,
            y: (anchor[1] + Math.sin(a) * lx + Math.cos(a) * ly) / screenH,
        };
    }

    /** 按像素平移，中心点夹在屏幕内 */
    function moveTransform(transform, dxPx, dyPx, screenW, screenH) {
        return {
            ...transform,
            x: clamp01(transform.x + dxPx / screenW),
            y: clamp01(transform.y + dyPx / screenH),
        };
    }

    /**
     * 拖动角点等比缩放：对角固定不动（考虑旋转）。
     * 新宽度取"指针到对角沿元素横轴的距离"和"沿纵轴的距离换算成宽度"中较大的一个，再夹紧到允许范围。
     * @param {'nw'|'ne'|'sw'|'se'} corner - 被拖动的角
     */
    function resizeFromCorner(transform, corner, pointerX, pointerY, assetAspect, screenW, screenH) {
        const west = corner === 'nw' || corner === 'sw';
        const north = corner === 'nw' || corner === 'ne';
        const anchor = toScreen(transform, assetAspect, west ? 1 : 0, north ? 1 : 0, screenW, screenH);
        const [lx, ly] = toAxes(transform, pointerX - anchor[0], pointerY - anchor[1]);

        const stretch = transform.stretch || 1;
        const wanted = Math.max(Math.abs(lx), (Math.abs(ly) * assetAspect) / stretch);
        const width = elements.clampWidth(wanted / screenW);
        const widthPx = width * screenW;
        const heightPx = (widthPx / assetAspect) * stretch;
        const sx = west ? -1 : 1;
        const sy = north ? -1 : 1;
        return { ...transform, ...centerFrom(transform, anchor, (sx * widthPx) / 2, (sy * heightPx) / 2, screenW, screenH), width };
    }

    /**
     * 拖动边的中点单向拉伸：对边固定不动。左右拉伸只改宽度（高度不变），上下拉伸只改高度。
     * @param {'n'|'e'|'s'|'w'} edge
     */
    function stretchFromEdge(transform, edge, pointerX, pointerY, assetAspect, screenW, screenH) {
        const horizontal = edge === 'e' || edge === 'w';
        const sign = edge === 'e' || edge === 's' ? 1 : -1;
        const anchorUV = { e: [0, 0.5], w: [1, 0.5], s: [0.5, 0], n: [0.5, 1] }[edge];
        const anchor = toScreen(transform, assetAspect, anchorUV[0], anchorUV[1], screenW, screenH);
        const [lx, ly] = toAxes(transform, pointerX - anchor[0], pointerY - anchor[1]);
        const old = elementSize(transform, assetAspect, screenW);

        let width = transform.width;
        let stretch;
        if (horizontal) {
            width = elements.clampWidth(Math.max(1, sign * lx) / screenW);
            stretch = elements.clampStretch((old.height * assetAspect) / (width * screenW));
        } else {
            stretch = elements.clampStretch((Math.max(1, sign * ly) * assetAspect) / old.width);
        }
        const next = { ...transform, width, stretch };
        const size = elementSize(next, assetAspect, screenW);
        const center = horizontal
            ? centerFrom(transform, anchor, (sign * size.width) / 2, 0, screenW, screenH)
            : centerFrom(transform, anchor, 0, (sign * size.height) / 2, screenW, screenH);
        return { ...next, ...center };
    }

    /**
     * 旋转手柄在框的正上方：指针相对中心的方向就是元素"上方"的朝向。
     * @param {number} [snapDeg] - 大于 0 时吸附到这个角度的整数倍
     * @returns {number} 新的 rotation（-180, 180]
     */
    function rotateToPointer(transform, pointerX, pointerY, screenW, screenH, snapDeg = 0) {
        const angle = Math.atan2(pointerY - transform.y * screenH, pointerX - transform.x * screenW) / DEG + 90;
        const snapped = snapDeg > 0 ? Math.round(angle / snapDeg) * snapDeg : angle;
        return elements.normalizeRotation(snapped);
    }

    /** 四个角的框坐标（左上、右上、右下、左下），计入自由变形 */
    function quadCorners(transform) {
        const warp = transform.warp;
        return BOX_CORNERS.map(([u, v], i) => (warp ? [u + warp[i][0], v + warp[i][1]] : [u, v]));
    }

    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

    /** 四边形是否为严格凸（顶点按顺序给出） */
    function isConvexQuad(points) {
        const signs = points.map((p, i) => Math.sign(cross(p, points[(i + 1) % 4], points[(i + 2) % 4])));
        return signs.every((s) => s !== 0 && s === signs[0]);
    }

    /**
     * 自由变形：把第 index 个角拖到指针位置。拖成凹四边形或自交时不接受，原样返回。
     */
    function moveWarpCorner(transform, index, pointerX, pointerY, assetAspect, screenW, screenH) {
        const [u, v] = toLocal(transform, assetAspect, pointerX, pointerY, screenW, screenH);
        const lo = -WARP_REACH;
        const hi = 1 + WARP_REACH;
        const points = quadCorners(transform);
        points[index] = [Math.min(hi, Math.max(lo, u)), Math.min(hi, Math.max(lo, v))];
        if (!isConvexQuad(points)) return transform;
        return { ...transform, warp: points.map(([pu, pv], i) => [pu - BOX_CORNERS[i][0], pv - BOX_CORNERS[i][1]]) };
    }

    /** 屏幕像素点是否落在元素上（计入旋转和自由变形） */
    function pointInElement(transform, assetAspect, px, py, screenW, screenH) {
        const p = toLocal(transform, assetAspect, px, py, screenW, screenH);
        const points = quadCorners(transform);
        const signs = points.map((a, i) => Math.sign(cross(a, points[(i + 1) % 4], p)));
        return signs.every((s) => s >= 0) || signs.every((s) => s <= 0);
    }

    /**
     * 透视贴图的齐次权重 q：顶点上传 (u·q, v·q, q)，片元里除以 q，贴图就按透视铺到四边形上。
     * 做法是取两条对角线的交点，按交点到各顶点的距离比算 q。仿射变换不改变共线距离比，
     * 所以直接用框坐标算即可。
     * @param {number[][]} points - 四个角（左上、右上、右下、左下），须为凸四边形
     */
    function projectiveWeights(points) {
        const [p0, p1, p2, p3] = points;
        const den = (p0[0] - p2[0]) * (p1[1] - p3[1]) - (p0[1] - p2[1]) * (p1[0] - p3[0]);
        if (Math.abs(den) < 1e-12) return [1, 1, 1, 1];
        const s = ((p0[0] - p1[0]) * (p1[1] - p3[1]) - (p0[1] - p1[1]) * (p1[0] - p3[0])) / den;
        const c = [p0[0] + s * (p2[0] - p0[0]), p0[1] + s * (p2[1] - p0[1])];
        const d = points.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1]));
        if (d.some((x) => x < 1e-12)) return [1, 1, 1, 1];
        return [(d[0] + d[2]) / d[2], (d[1] + d[3]) / d[3], (d[2] + d[0]) / d[0], (d[3] + d[1]) / d[1]];
    }

    /** 元素四个角在屏幕上的外接矩形（像素） */
    function boundingRect(transform, assetAspect, screenW, screenH) {
        const pts = quadCorners(transform).map(([u, v]) => toScreen(transform, assetAspect, u, v, screenW, screenH));
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
    }

    /** 元素底边中点（屏幕归一化），用于"自动贴地"取深度；计入旋转和自由变形 */
    function bottomCenter(transform, assetAspect, screenW, screenH) {
        const [, , br, bl] = quadCorners(transform);
        const [px, py] = toScreen(transform, assetAspect, (br[0] + bl[0]) / 2, (br[1] + bl[1]) / 2, screenW, screenH);
        return [px / screenW, py / screenH];
    }

    /**
     * 从 RGBA 像素数据里取 R 通道（最近邻），返回 0~1。u / v 越界时夹紧。
     * @param {Uint8ClampedArray} data
     */
    function sampleGray(data, w, h, u, v) {
        const px = Math.min(w - 1, Math.floor(clamp01(u) * w));
        const py = Math.min(h - 1, Math.floor(clamp01(v) * h));
        return data[(py * w + px) * 4] / 255;
    }

    return {
        elementSize,
        rectFromTransform,
        toLocal,
        toScreen,
        moveTransform,
        resizeFromCorner,
        stretchFromEdge,
        rotateToPointer,
        quadCorners,
        isConvexQuad,
        moveWarpCorner,
        pointInElement,
        projectiveWeights,
        boundingRect,
        bottomCenter,
        sampleGray,
    };
});
