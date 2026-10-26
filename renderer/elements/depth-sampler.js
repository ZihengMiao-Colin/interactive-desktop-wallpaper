/**
 * depth-sampler.js — 在 CPU 上读取深度图，摆放模式"自动贴地"用
 */

'use strict';

/** 取样用的深度图最长边，够用且读像素很快 */
const DEPTH_SAMPLER_MAX_SIDE = 512;

/**
 * @param {HTMLImageElement|HTMLCanvasElement} depthImage
 * @returns {{ sample: (u: number, v: number) => number }} u / v 是图片 UV，返回 0~1
 */
function createDepthSampler(depthImage) {
    const srcW = depthImage.naturalWidth || depthImage.width;
    const srcH = depthImage.naturalHeight || depthImage.height;
    const scale = Math.min(1, DEPTH_SAMPLER_MAX_SIDE / Math.max(srcW, srcH));
    const w = Math.max(1, Math.round(srcW * scale));
    const h = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(depthImage, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;

    return { sample: (u, v) => Shared.placement.sampleGray(data, w, h, u, v) };
}
