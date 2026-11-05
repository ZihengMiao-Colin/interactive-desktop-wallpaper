/**
 * crop.js — 裁剪区域的纯逻辑（主进程、设置页、壁纸页、解锁动画播放页共用）
 *
 * 裁剪区域 { x, y, w, h }：相对原图的比例（0 ~ 1），左上角为原点。
 * 不存像素：换了分辨率、原文件尺寸变了都还能用。
 *
 * 裁剪框的比例始终是屏幕比例。图片 UV 里横竖的单位不一样长，
 * 所以框的宽高比要换算成 ratioInImage（屏幕比例 ÷ 图片比例）。
 */

(function (root, factory) {
    const mod = factory();
    if (typeof module === 'object' && module.exports) module.exports = mod;
    else (root.Shared = root.Shared || {}).crop = mod;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /** 配置里读到的区域小于这个就当坏数据 */
    const MIN_VALID = 0.01;
    /** 拖动时框的最小边长（占图片的比例） */
    const MIN_SIDE = 0.1;
    /** 比例文字要匹配的常见比例（宽 ≥ 高），误差在 RATIO_TOLERANCE 以内就算 */
    const COMMON_RATIOS = [[16, 9], [16, 10], [21, 9], [32, 9], [4, 3], [3, 2], [5, 4], [5, 3]];
    const RATIO_TOLERANCE = 0.025;
    /** 裁剪后的像素比屏幕少这么多才算模糊，避免差一两个像素也提示 */
    const LOW_RES_TOLERANCE = 0.01;

    const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

    /**
     * 把配置里读到的值整理成合法区域。读不出来（类型不对、不是有限数、收回范围后太小）返回 null。
     * @param {*} value
     * @returns {{x: number, y: number, w: number, h: number} | null}
     */
    function normalizeCrop(value) {
        if (!value || typeof value !== 'object') return null;
        const { x, y, w, h } = value;
        if (![x, y, w, h].every(Number.isFinite)) return null;
        const left = clamp(x, 0, 1);
        const top = clamp(y, 0, 1);
        // 不用右边减左边：合法的值读一次要原样不变，减法有浮点误差
        const width = Math.min(w + Math.min(x, 0), 1 - left);
        const height = Math.min(h + Math.min(y, 0), 1 - top);
        if (width < MIN_VALID || height < MIN_VALID) return null;
        return { x: left, y: top, w: width, h: height };
    }

    /** 框在图片 UV 里的宽高比（w ÷ h） */
    function ratioInImage(imgW, imgH, screenW, screenH) {
        return (screenW / screenH) / (imgW / imgH);
    }

    /** 在范围内收成某个比例，中心不变 */
    function fitCropToRatio(crop, ratio) {
        const w = Math.min(crop.w, crop.h * ratio);
        const h = w / ratio;
        return { x: crop.x + (crop.w - w) / 2, y: crop.y + (crop.h - h) / 2, w, h };
    }

    /** 框的默认位置，也就是现在自动裁切留下的区域：比例不符的方向居中裁 */
    function defaultCrop(imgW, imgH, screenW, screenH) {
        return fitCropToRatio({ x: 0, y: 0, w: 1, h: 1 }, ratioInImage(imgW, imgH, screenW, screenH));
    }

    /** 整体移动，贴到图片边上就停 */
    function moveCrop(crop, dx, dy) {
        return {
            ...crop,
            x: clamp(crop.x + dx, 0, 1 - crop.w),
            y: clamp(crop.y + dy, 0, 1 - crop.h),
        };
    }

    /**
     * 拖一个角缩放：对角不动，比例不变，不超出图片，宽高都不小于 MIN_SIDE。
     * 图片本身放不下最小值时（比如极端比例的框）取放得下的最大值。
     * @param {{x: number, y: number, w: number, h: number}} start - 开始拖的时候的框
     * @param {'nw'|'ne'|'se'|'sw'} corner
     * @param {number} dx - 从开始拖到现在的位移（图片 UV）
     * @param {number} dy
     * @param {number} ratio - ratioInImage
     */
    function resizeCrop(start, corner, dx, dy, ratio) {
        const west = corner.includes('w');
        const north = corner.includes('n');
        const right = start.x + start.w;
        const bottom = start.y + start.h;

        // 横竖两个方向哪个想要的框大就听哪个，这样只上下拖也能缩放
        const wanted = Math.max(start.w + (west ? -dx : dx), (start.h + (north ? -dy : dy)) * ratio);
        const maxW = Math.min(west ? right : 1 - start.x, (north ? bottom : 1 - start.y) * ratio);
        const minW = Math.min(Math.max(MIN_SIDE, MIN_SIDE * ratio), maxW);
        const w = clamp(wanted, minW, maxW);
        const h = w / ratio;
        return { x: west ? right - w : start.x, y: north ? bottom - h : start.y, w, h };
    }

    /** 比例文字：能对上常见比例就写 16:10，对不上写 1.60:1。竖屏把两个数对调 */
    function ratioLabel(screenW, screenH) {
        const portrait = screenW < screenH;
        const ratio = portrait ? screenH / screenW : screenW / screenH;
        const match = COMMON_RATIOS.find(([a, b]) => Math.abs(ratio / (a / b) - 1) <= RATIO_TOLERANCE);
        if (!match) return portrait ? `1:${ratio.toFixed(2)}` : `${ratio.toFixed(2)}:1`;
        return portrait ? `${match[1]}:${match[0]}` : `${match[0]}:${match[1]}`;
    }

    /** 裁剪后的像素比屏幕少：放到桌面上会被放大，可能模糊 */
    function isLowRes(crop, imgW, imgH, screenPxW, screenPxH) {
        const limit = 1 - LOW_RES_TOLERANCE;
        return crop.w * imgW < screenPxW * limit || crop.h * imgH < screenPxH * limit;
    }

    /** CSS object-view-box 的值：视频里只显示这个区域 */
    function viewBoxInset(crop) {
        const pct = (v) => `${(v * 100).toFixed(4)}%`;
        return `inset(${pct(crop.y)} ${pct(1 - crop.x - crop.w)} ${pct(1 - crop.y - crop.h)} ${pct(crop.x)})`;
    }

    /** 放进网址参数（解锁动画的播放页） */
    function formatQuery(crop) {
        return [crop.x, crop.y, crop.w, crop.h].join(',');
    }

    function parseQuery(text) {
        const parts = String(text || '').split(',').map(Number);
        if (parts.length !== 4) return null;
        const [x, y, w, h] = parts;
        return normalizeCrop({ x, y, w, h });
    }

    return {
        MIN_SIDE,
        normalizeCrop,
        ratioInImage,
        defaultCrop,
        moveCrop,
        resizeCrop,
        fitCropToRatio,
        ratioLabel,
        isLowRes,
        viewBoxInset,
        formatQuery,
        parseQuery,
    };
});
