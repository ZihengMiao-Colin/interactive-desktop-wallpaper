/**
 * placement-math.js — 摆放模式的几何计算：归一化 transform ↔ 屏幕像素矩形、拖动、角点缩放、深度取样
 *
 * transform.x / y 是元素中心（屏幕归一化 0~1），transform.width 是相对屏幕宽度的比例，
 * 高度 = 宽度 ÷ 素材宽高比。
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

    /** transform → 屏幕像素矩形 */
    function rectFromTransform(transform, assetAspect, screenW, screenH) {
        const width = transform.width * screenW;
        const height = width / assetAspect;
        return {
            left: transform.x * screenW - width / 2,
            top: transform.y * screenH - height / 2,
            width,
            height,
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
     * 拖动角点等比缩放：对角固定不动。
     * 新宽度取"指针到对角的水平距离"和"垂直距离 × 宽高比"中较大的一个，再夹紧到允许范围。
     * @param {'nw'|'ne'|'sw'|'se'} corner - 被拖动的角
     */
    function resizeFromCorner(transform, corner, pointerX, pointerY, assetAspect, screenW, screenH) {
        const r = rectFromTransform(transform, assetAspect, screenW, screenH);
        const west = corner === 'nw' || corner === 'sw';
        const north = corner === 'nw' || corner === 'ne';
        // 固定的对角
        const anchorX = west ? r.left + r.width : r.left;
        const anchorY = north ? r.top + r.height : r.top;

        const wanted = Math.max(Math.abs(pointerX - anchorX), Math.abs(pointerY - anchorY) * assetAspect);
        const width = elements.clampWidth(wanted / screenW);
        const widthPx = width * screenW;
        const heightPx = widthPx / assetAspect;

        const left = west ? anchorX - widthPx : anchorX;
        const top = north ? anchorY - heightPx : anchorY;
        return {
            ...transform,
            x: (left + widthPx / 2) / screenW,
            y: (top + heightPx / 2) / screenH,
            width,
        };
    }

    /** 元素底边中点（屏幕归一化），用于"自动贴地"取深度 */
    function bottomCenter(transform, assetAspect, screenW, screenH) {
        const heightNorm = (transform.width * screenW) / assetAspect / screenH;
        return [transform.x, transform.y + heightNorm / 2];
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

    return { rectFromTransform, moveTransform, resizeFromCorner, bottomCenter, sampleGray };
});
