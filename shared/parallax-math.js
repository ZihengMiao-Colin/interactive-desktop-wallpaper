/**
 * parallax-math.js — 视差相关的纯数学函数（Node 测试与渲染进程共用）
 *
 * 和 renderer/shaders.js 里的 PARALLAX_GLSL 是同一套公式，改一边必须同步改另一边。
 */

(function (root, factory) {
    const mod = factory();
    if (typeof module === 'object' && module.exports) module.exports = mod;
    else (root.Shared = root.Shared || {}).parallax = mod;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /**
     * 原图以 Cover 方式铺满屏幕时，屏幕 UV → 图片 UV 的缩放与偏移。
     * imageUV = screenUV × scale + offset
     */
    function coverTransform(screenW, screenH, imgW, imgH) {
        const screenAspect = screenW / screenH;
        const imgAspect = imgW / imgH;
        const t = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };
        if (screenAspect > imgAspect) {
            // 屏幕更宽：上下居中裁切
            t.scaleY = imgAspect / screenAspect;
            t.offsetY = (1 - t.scaleY) * 0.5;
        } else if (screenAspect < imgAspect) {
            // 屏幕更高：左右居中裁切
            t.scaleX = screenAspect / imgAspect;
            t.offsetX = (1 - t.scaleX) * 0.5;
        }
        return t;
    }

    /** 设置里的"视差强度"（5~100）换算成着色器的 uStrength */
    function strengthFromMultiplier(multiplier) {
        return (multiplier / 1000) * 1.25;
    }

    /**
     * 某个深度处的采样坐标偏移（图片 UV 单位），含软截断。
     * @param {number} mouseX - 写入 uMouse 的值（已取反）
     * @param {number} mouseY
     * @param {number} depth - 0 远 ~ 1 近
     * @param {number} focus - 对焦深度
     * @param {number} strength
     * @returns {[number, number]}
     */
    function parallaxUV(mouseX, mouseY, depth, focus, strength) {
        const diff = depth - focus;
        let px = mouseX * diff * strength;
        let py = mouseY * diff * strength;
        const maxDist = Math.max(0.035, strength * 1.6);
        const len = Math.hypot(px, py);
        if (len > maxDist) {
            const k = (maxDist + (len - maxDist) * 0.2) / len;
            px *= k;
            py *= k;
        }
        return [px, py];
    }

    /**
     * 深度为 depth 的内容在屏幕上的位移（屏幕归一化单位）。
     * 背景着色器在屏幕点 p 采样 baseUV(p) + parallax，所以内容看起来移动了 −parallax，
     * 再从图片 UV 换算回屏幕 UV 要除以 cover 缩放。
     */
    function elementScreenShift(mouseX, mouseY, depth, focus, strength, cover) {
        const [px, py] = parallaxUV(mouseX, mouseY, depth, focus, strength);
        return [-px / cover.scaleX, -py / cover.scaleY];
    }

    /** 屏幕归一化坐标 → 图片 UV */
    function screenToImageUV(u, v, cover) {
        return [u * cover.scaleX + cover.offsetX, v * cover.scaleY + cover.offsetY];
    }

    return { coverTransform, strengthFromMultiplier, parallaxUV, elementScreenShift, screenToImageUV };
});
