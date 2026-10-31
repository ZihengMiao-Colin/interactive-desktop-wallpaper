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

    /** 光线步进每一步在深度图上最多走几个像素：越小越不容易跳过细的前景，也越慢 */
    const RAY_STEP_PX = 2.5;
    /** 最多走几步（鼠标在屏幕角、强度最大时约 40 步） */
    const RAY_MAX_STEPS = 48;
    /** 找到交点后再二分几次，把位置收准 */
    const RAY_REFINE_STEPS = 5;

    /**
     * 光线步进：屏幕上一点实际显示的是图片的哪个位置（图片 UV）。和着色器里的 rayMarchUV 是同一算法。
     *
     * 深度为 t 的内容在画面上挪了 −parallaxUV(t)，所以屏幕点 p 显示的图片坐标 u 满足 u = p + parallaxUV(D(u))。
     * 前景挪过来盖住背景时有好几个 u 满足，要取最近的：从最近（t=1）往最远（t=0）逐层试
     * u(t) = p + parallaxUV(t)，第一个 D(u(t)) ≥ t 的就是挡在最前面的表面，再在最后一步里二分收准。
     * 前景挪开、露出原来被挡住的地方时没有真正的交点，会停在深度的台阶上，显示台阶处的颜色。
     *
     * @param {(u: number, v: number) => number} sampleDepth - 图片 UV 处的深度 0~1
     * @param {number} u - 屏幕点对应的图片 UV（还没加视差）
     * @param {number} v
     * @param {number} mouseX - 写入 uMouse 的值（已取反）
     * @param {number} mouseY
     * @param {number} focus
     * @param {number} strength
     * @param {number} depthW - 深度图宽高（像素），按它决定走几步
     * @param {number} depthH
     * @returns {[number, number]}
     */
    function rayMarchUV(sampleDepth, u, v, mouseX, mouseY, focus, strength, depthW, depthH) {
        const at = (t) => {
            const [px, py] = parallaxUV(mouseX, mouseY, t, focus, strength);
            return [u + px, v + py];
        };
        const hits = (t) => sampleDepth(...at(t)) >= t;

        const [nearX, nearY] = parallaxUV(mouseX, mouseY, 1, focus, strength);
        const [farX, farY] = parallaxUV(mouseX, mouseY, 0, focus, strength);
        const spanPx = Math.hypot((nearX - farX) * depthW, (nearY - farY) * depthH);
        const n = Math.min(Math.max(Math.ceil(spanPx / RAY_STEP_PX), 1), RAY_MAX_STEPS);

        // lo：最后一个还在表面前面的层；hi：第一个碰到表面的层（t = 0 一定碰到）
        let lo = 1;
        let hi = 0;
        for (let i = 0; i <= n; i++) {
            const t = Math.max(1 - i / n, 0);
            if (hits(t)) {
                hi = t;
                break;
            }
            lo = t;
        }
        for (let k = 0; k < RAY_REFINE_STEPS; k++) {
            const mid = (lo + hi) / 2;
            if (hits(mid)) hi = mid;
            else lo = mid;
        }
        return at(hi);
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

    return { coverTransform, strengthFromMultiplier, parallaxUV, rayMarchUV, elementScreenShift, screenToImageUV };
});
