/**
 * depth/processing.js — 深度图生成的数值处理（纯函数，推理子进程和测试共用）
 *
 * 从 generate_depth_map.py 移植，算法和参数保持一致：
 *   - 缩放用 Pillow 的 bicubic 算法：8 位图按 Pillow 的定点数算法，浮点图用双精度系数，
 *     结果和 Python 版逐像素一致（test/depth-processing.test.js 里有 Pillow 生成的对照数据）
 *   - 后处理：归一化 → 用浮点放大到输出尺寸 → 近处轮廓外扩 → 三次均值滤波逼近高斯 → 量化成 8 位
 *
 * 平面数据都是行优先的一维数组，宽高单独传。
 */

/** 模型固定输入 518×518（位置编码定死了，不能保持原图比例） */
const MODEL_INPUT_SIZE = 518;
const IMAGENET_MEAN = [0.485, 0.456, 0.406].map(Math.fround);
const IMAGENET_STD = [0.229, 0.224, 0.225].map(Math.fround);

/** 输出深度图的最长边。深度图本身很平滑，再大看不出差别，只会让后处理变慢、缓存变大 */
const DEPTH_MAX_SIDE = 1920;

const DEFAULT_BLUR = 8;

const f32 = Math.fround;

/** Python 的 round：恰好一半时取偶数 */
function roundHalfEven(x) {
    const r = Math.round(x);
    return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

// ==================== 尺寸 ====================

/**
 * 输出深度图尺寸：保持原图比例，最长边不超过 maxSide。
 * @returns {[number, number]} [宽, 高]
 */
function depthOutputSize(width, height, maxSide = DEPTH_MAX_SIDE) {
    const scale = Math.min(1, maxSide / Math.max(width, height));
    return [Math.max(1, roundHalfEven(width * scale)), Math.max(1, roundHalfEven(height * scale))];
}

// ==================== Pillow 兼容的 bicubic 缩放 ====================

/** Pillow 的 bicubic 核（a = -0.5，支撑半径 2） */
function bicubicFilter(x) {
    const a = -0.5;
    if (x < 0) x = -x;
    if (x < 1) return ((a + 2) * x - (a + 3)) * x * x + 1;
    if (x < 2) return (((x - 5) * x + 8) * x - 4) * a;
    return 0;
}

/**
 * 每个输出像素从哪段输入取样、各自的权重（照搬 Pillow 的 precompute_coeffs）。
 * 缩小时核按比例放大，相当于先抗锯齿再取样。
 */
function precomputeCoeffs(inSize, outSize) {
    const scale = inSize / outSize;
    const filterscale = Math.max(scale, 1);
    const support = 2 * filterscale;
    const ksize = Math.ceil(support) * 2 + 1;
    const bounds = new Int32Array(outSize * 2);
    const kk = new Float64Array(outSize * ksize);

    for (let xx = 0; xx < outSize; xx++) {
        const center = (xx + 0.5) * scale;
        const ss = 1 / filterscale;
        let xmin = Math.trunc(center - support + 0.5);
        if (xmin < 0) xmin = 0;
        let xmax = Math.trunc(center + support + 0.5);
        if (xmax > inSize) xmax = inSize;
        xmax -= xmin;

        const k = xx * ksize;
        let ww = 0;
        for (let x = 0; x < xmax; x++) {
            const w = bicubicFilter((x + xmin - center + 0.5) * ss);
            kk[k + x] = w;
            ww += w;
        }
        if (ww !== 0) {
            for (let x = 0; x < xmax; x++) kk[k + x] /= ww;
        }
        bounds[xx * 2] = xmin;
        bounds[xx * 2 + 1] = xmax;
    }
    return { ksize, bounds, kk };
}

/** 8 位图的定点数精度（Pillow 的 PRECISION_BITS） */
const PRECISION_BITS = 32 - 8 - 2;
const PRECISION_SCALE = 2 ** PRECISION_BITS;

/** 权重转成定点整数（Pillow 的 normalize_coeffs_8bpc） */
function fixedCoeffs(kk) {
    return Int32Array.from(kk, (k) => Math.trunc(k < 0 ? -0.5 + k * PRECISION_SCALE : 0.5 + k * PRECISION_SCALE));
}

function clip8(sum) {
    const v = Math.floor(sum / PRECISION_SCALE);
    return v < 0 ? 0 : v > 255 ? 255 : v;
}

/**
 * 8 位 RGB 一维缩放：沿 step 方向，每条线 length 个像素，共 lines 条线。
 * 每个像素 3 个通道连续存放。
 */
function resampleLines8(src, dst, lines, inLen, outLen, srcLineStride, srcStep, dstLineStride, dstStep) {
    const { ksize, bounds, kk: weights } = precomputeCoeffs(inLen, outLen);
    const kk = fixedCoeffs(weights);
    const half = 1 << (PRECISION_BITS - 1);
    for (let line = 0; line < lines; line++) {
        const s0 = line * srcLineStride;
        const d0 = line * dstLineStride;
        for (let xx = 0; xx < outLen; xx++) {
            const xmin = bounds[xx * 2];
            const xmax = bounds[xx * 2 + 1];
            const k = xx * ksize;
            let r = half, g = half, b = half;
            for (let x = 0; x < xmax; x++) {
                const p = s0 + (x + xmin) * srcStep;
                const w = kk[k + x];
                r += src[p] * w;
                g += src[p + 1] * w;
                b += src[p + 2] * w;
            }
            const q = d0 + xx * dstStep;
            dst[q] = clip8(r);
            dst[q + 1] = clip8(g);
            dst[q + 2] = clip8(b);
        }
    }
}

/**
 * RGBA 图缩放成 RGB（丢掉透明通道，和 Pillow 的 convert('RGB') 一样），等同于 Pillow 的
 * Image.resize(size, Image.BICUBIC)：先水平后垂直，两遍之间按 8 位取整。
 * @param {Uint8Array|Uint8ClampedArray} rgba
 * @returns {Uint8Array} 每像素 3 字节
 */
function resizeRgb8(rgba, inW, inH, outW, outH) {
    // 先转成 RGB，后面两遍都按每像素 3 字节处理
    let cur = new Uint8Array(inW * inH * 3);
    for (let i = 0, j = 0; i < cur.length; i += 3, j += 4) {
        cur[i] = rgba[j];
        cur[i + 1] = rgba[j + 1];
        cur[i + 2] = rgba[j + 2];
    }
    if (outW !== inW) {
        const next = new Uint8Array(outW * inH * 3);
        resampleLines8(cur, next, inH, inW, outW, inW * 3, 3, outW * 3, 3);
        cur = next;
    }
    if (outH !== inH) {
        const next = new Uint8Array(outW * outH * 3);
        resampleLines8(cur, next, outW, inH, outH, 3, outW * 3, 3, outW * 3);
        cur = next;
    }
    return cur;
}

/** 浮点图一维缩放（Pillow 的 32 位浮点版本：双精度累加，存回单精度） */
function resampleLinesF(src, dst, lines, inLen, outLen, srcLineStride, srcStep, dstLineStride, dstStep) {
    const { ksize, bounds, kk } = precomputeCoeffs(inLen, outLen);
    for (let line = 0; line < lines; line++) {
        const s0 = line * srcLineStride;
        const d0 = line * dstLineStride;
        for (let xx = 0; xx < outLen; xx++) {
            const xmin = bounds[xx * 2];
            const xmax = bounds[xx * 2 + 1];
            const k = xx * ksize;
            let sum = 0;
            for (let x = 0; x < xmax; x++) sum += src[s0 + (x + xmin) * srcStep] * kk[k + x];
            dst[d0 + xx * dstStep] = sum;
        }
    }
}

/**
 * 浮点图缩放，等同于 Pillow 'F' 模式的 Image.resize(size, Image.BICUBIC)。
 * @param {Float32Array} data
 * @returns {Float32Array}
 */
function resizeFloat(data, inW, inH, outW, outH) {
    let cur = data;
    if (outW !== inW) {
        const next = new Float32Array(outW * inH);
        resampleLinesF(cur, next, inH, inW, outW, inW, 1, outW, 1);
        cur = next;
    }
    if (outH !== inH) {
        const next = new Float32Array(outW * outH);
        resampleLinesF(cur, next, outW, inH, outH, 1, outW, 1, outW);
        cur = next;
    }
    return cur === data ? Float32Array.from(data) : cur;
}

// ==================== 模型输入 ====================

/**
 * RGB 像素 → 模型输入：按 ImageNet 均值方差归一化，排成 NCHW（批大小 1）。
 * @param {Uint8Array} rgb - 每像素 3 字节
 * @param {number} pixelCount
 * @returns {Float32Array}
 */
function toModelInput(rgb, pixelCount) {
    const out = new Float32Array(pixelCount * 3);
    for (let i = 0; i < pixelCount; i++) {
        for (let c = 0; c < 3; c++) {
            // 每一步都按单精度取整，和 numpy 的 float32 运算一致
            out[c * pixelCount + i] = f32(f32(f32(rgb[i * 3 + c] / 255) - IMAGENET_MEAN[c]) / IMAGENET_STD[c]);
        }
    }
    return out;
}

// ==================== 外扩和模糊 ====================

/** 每条线内宽 2r+1 的均值滤波，边缘按最近像素延伸 */
function boxLine(src, dst, start, step, n, r) {
    const size = 2 * r + 1;
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[start + Math.min(Math.max(k, 0), n - 1) * step];
    for (let i = 0; i < n; i++) {
        dst[start + i * step] = sum / size;
        // 窗口右移一格：加上 i+r+1，去掉 i-r
        sum += src[start + Math.min(i + r + 1, n - 1) * step] - src[start + Math.max(i - r, 0) * step];
    }
}

/** 用 passes 次均值滤波逼近标准差为 sigma 的高斯，返回每次的窗口宽度（奇数） */
function boxSizes(sigma, passes = 3) {
    const ideal = Math.sqrt(12 * sigma * sigma / passes + 1);
    let lower = Math.floor(ideal);
    if (lower % 2 === 0) lower -= 1;
    const upper = lower + 2;
    const m = roundHalfEven((12 * sigma * sigma - passes * lower * lower - 4 * passes * lower - 3 * passes)
        / (-4 * lower - 4));
    return Array.from({ length: passes }, (_, i) => (i < m ? lower : upper));
}

/** gaussianBlur 的影响半径（像素）：离得更远的像素互不影响 */
function blurSupport(sigma) {
    if (sigma <= 0) return 0;
    return boxSizes(sigma).reduce((sum, w) => sum + (w - 1) / 2, 0);
}

/**
 * 高斯模糊（三次均值滤波逼近，任意半径都很快）。sigma <= 0 时原样返回。
 * @param {Float32Array} data
 * @returns {Float32Array}
 */
function gaussianBlur(data, width, height, sigma) {
    if (sigma <= 0) return data;
    const out = Float32Array.from(data);
    const tmp = new Float32Array(out.length);
    for (const w of boxSizes(sigma)) {
        const r = (w - 1) / 2;
        if (r <= 0) continue;
        for (let y = 0; y < height; y++) boxLine(out, tmp, y * width, 1, width, r);
        for (let x = 0; x < width; x++) boxLine(tmp, out, x, width, height, r);
    }
    return out;
}

/** 每条线内宽 2r+1 的最大值滤波（单调队列，O(n)） */
function maxLine(src, dst, start, step, n, r, queue) {
    let head = 0, tail = 0, next = 0;
    for (let i = 0; i < n; i++) {
        const hi = Math.min(i + r, n - 1);
        while (next <= hi) {
            const v = src[start + next * step];
            while (tail > head && src[start + queue[tail - 1] * step] <= v) tail--;
            queue[tail++] = next++;
        }
        while (queue[head] < i - r) head++;
        dst[start + i * step] = src[start + queue[head] * step];
    }
}

/**
 * 方形窗口最大值滤波：近处（亮）区域向外扩 radius 像素。
 * @param {Float32Array} data
 * @returns {Float32Array}
 */
function dilateMax(data, width, height, radius) {
    if (radius <= 0) return Float32Array.from(data);
    const tmp = new Float32Array(data.length);
    const out = new Float32Array(data.length);
    const queue = new Int32Array(Math.max(width, height));
    for (let y = 0; y < height; y++) maxLine(data, tmp, y * width, 1, width, radius, queue);
    for (let x = 0; x < width; x++) maxLine(tmp, out, x, width, height, radius, queue);
    return out;
}

// ==================== 后处理 ====================

/**
 * 模型原始输出 → 最终深度图。
 *
 * @param {Float32Array} raw - 模型输出，值越大越近，量纲任意
 * @param {number} rawW
 * @param {number} rawH
 * @param {number} outW - 输出尺寸
 * @param {number} outH
 * @param {number} smoothRadius - 边缘平滑半径（像素，按输出尺寸计），0 表示不处理边缘
 * @param {boolean} [invert=false] - 反转成黑=近（在平滑之后做，外扩的始终是近处）
 * @returns {Uint8Array} 8 位灰度，白=近
 */
function postprocessDepth(raw, rawW, rawH, outW, outH, smoothRadius, invert = false) {
    let lo = Infinity, hi = -Infinity;
    for (const v of raw) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
    }
    if (hi - lo < 1e-8) {
        console.warn('[Depth] 深度几乎没有变化，图片可能是纯色的');
        return new Uint8Array(outW * outH);
    }

    const range = f32(hi - lo);
    let depth = Float32Array.from(raw, (v) => f32(v - lo) / range);
    if (rawW !== outW || rawH !== outH) depth = resizeFloat(depth, rawW, rawH, outW, outH);
    for (let i = 0; i < depth.length; i++) depth[i] = Math.min(Math.max(depth[i], 0), 1);

    if (smoothRadius > 0) {
        // 外扩距离等于模糊的影响半径：原来的主体像素一个都不会被模糊到
        depth = gaussianBlur(dilateMax(depth, outW, outH, blurSupport(smoothRadius)), outW, outH, smoothRadius);
    }

    const out = new Uint8Array(depth.length);
    for (let i = 0; i < depth.length; i++) {
        let d = invert ? f32(1 - depth[i]) : depth[i];
        d = Math.min(Math.max(d, 0), 1);
        out[i] = roundHalfEven(f32(d * 255));
    }
    return out;
}

module.exports = {
    MODEL_INPUT_SIZE,
    DEPTH_MAX_SIDE,
    DEFAULT_BLUR,
    roundHalfEven,
    depthOutputSize,
    resizeRgb8,
    resizeFloat,
    toModelInput,
    boxSizes,
    blurSupport,
    gaussianBlur,
    dilateMax,
    postprocessDepth,
};
