'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const D = require('../src/depth/processing');
const { encodeGrayPng } = require('../src/depth/png');

/** 固定种子的伪随机数（mulberry32），测试数据可复现 */
function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function randomPlane(width, height, seed) {
    const next = rng(seed);
    return Float32Array.from({ length: width * height }, () => next());
}

/** 左半边近（模型输出值大），右半边远；故意用任意量纲的原始值 */
function step() {
    const raw = new Float32Array(120 * 40).fill(3);
    for (let y = 0; y < 40; y++) for (let x = 0; x < 60; x++) raw[y * 120 + x] = 7;
    return raw;
}

// ---------- 尺寸 ----------

test('depthOutputSize：小图保持原尺寸，大图最长边缩到 1920', () => {
    assert.deepEqual(D.depthOutputSize(1280, 720), [1280, 720]);
    assert.deepEqual(D.depthOutputSize(3840, 2560), [1920, 1280]);
    assert.deepEqual(D.depthOutputSize(2000, 4000), [960, 1920]);
});

test('roundHalfEven 和 Python 的 round 一样，恰好一半时取偶数', () => {
    assert.deepEqual([0.5, 1.5, 2.5, 3.5, 2.4, 2.6].map(D.roundHalfEven), [0, 2, 2, 4, 2, 3]);
});

// ---------- 外扩和模糊 ----------

test('dilateMax 和暴力算法结果一致', () => {
    const w = 31, h = 23;
    const a = randomPlane(w, h, 1);
    for (const r of [0, 1, 2, 5, 9, 40]) {
        const out = D.dilateMax(a, w, h, r);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let m = -Infinity;
                for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++) {
                    for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) m = Math.max(m, a[yy * w + xx]);
                }
                assert.equal(out[y * w + x], m, `r=${r} (${x},${y})`);
            }
        }
    }
});

test('gaussianBlur：常数图不变，sigma 为 0 时原样返回', () => {
    const flat = new Float32Array(40 * 30).fill(0.7);
    for (const v of D.gaussianBlur(flat, 40, 30, 5)) assert.ok(Math.abs(v - 0.7) < 1e-6);
    const a = randomPlane(12, 10, 2);
    assert.deepEqual(D.gaussianBlur(a, 12, 10, 0), a);
});

test('gaussianBlur：单点扩散后总和不变、左右对称、标准差接近 sigma', () => {
    const n = 121;
    const a = new Float32Array(n * n);
    a[60 * n + 60] = 1;
    const out = D.gaussianBlur(a, n, n, 6);
    let sum = 0, variance = 0;
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            const v = out[y * n + x];
            sum += v;
            variance += v * (x - 60) * (x - 60);
            assert.ok(Math.abs(v - out[y * n + (n - 1 - x)]) < 1e-7);
        }
    }
    assert.ok(Math.abs(sum - 1) < 1e-4);
    assert.ok(Math.abs(Math.sqrt(variance) - 6) < 0.5);
});

test('gaussianBlur 的影响半径就是 blurSupport', () => {
    const n = 121;
    const a = new Float32Array(n * n);
    a[60 * n + 60] = 1;
    const k = D.blurSupport(6);
    const out = D.gaussianBlur(a, n, n, 6);
    assert.ok(out[60 * n + 60 + k] > 0);
    assert.equal(out[60 * n + 60 + k + 1], 0);
});

// ---------- 后处理 ----------

test('postprocessDepth：不平滑时归一化到 0~255', () => {
    const out = D.postprocessDepth(step(), 120, 40, 120, 40, 0);
    assert.ok(out instanceof Uint8Array);
    assert.equal(out.length, 120 * 40);
    for (let y = 0; y < 40; y++) {
        for (let x = 0; x < 120; x++) assert.equal(out[y * 120 + x], x < 60 ? 255 : 0);
    }
});

test('postprocessDepth：主体一直到轮廓都保持原深度，过渡带整个落在背景一侧', () => {
    const out = D.postprocessDepth(step(), 120, 40, 120, 40, 4);
    const k = D.blurSupport(4);
    for (let y = 0; y < 40; y++) {
        for (let x = 0; x < 60; x++) assert.equal(out[y * 120 + x], 255);
        for (let x = 60 + 2 * k; x < 120; x++) assert.equal(out[y * 120 + x], 0);
    }
    assert.ok(out[60] < 255);
    for (let x = 1; x < 120; x++) assert.ok(out[x] <= out[x - 1]);
});

test('postprocessDepth：反转在平滑之后做', () => {
    const out = D.postprocessDepth(step(), 120, 40, 120, 40, 4);
    const inverted = D.postprocessDepth(step(), 120, 40, 120, 40, 4, true);
    assert.deepEqual(inverted, out.map((v) => 255 - v));
});

test('postprocessDepth：深度没有变化时输出全黑，尺寸按要求缩放', () => {
    assert.ok(D.postprocessDepth(new Float32Array(400).fill(2.5), 20, 20, 20, 20, 4).every((v) => v === 0));
    assert.equal(D.postprocessDepth(randomPlane(518, 518, 3), 518, 518, 300, 200, 2).length, 300 * 200);
});

// ---------- 和 Pillow 逐像素一致的 bicubic 缩放 ----------
// 期望值由 venv 里的 Pillow 12.3 生成：Image.resize(size, Image.BICUBIC)

/** 7×5 的 RGBA 测试图，像素值按公式算（和生成期望值的 Python 脚本一致） */
function sampleRgba() {
    const w = 7, h = 5;
    const rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            rgba[i] = (x * 37 + y * 11) % 256;
            rgba[i + 1] = (x * 5 + y * 71 + 13) % 256;
            rgba[i + 2] = (x * y * 29 + 200) % 256;
            rgba[i + 3] = 255;
        }
    }
    return rgba;
}

test('resizeRgb8 缩小和 Pillow 结果一致', () => {
    const expected = [29, 27, 200, 113, 38, 165, 197, 49, 177, 42, 114, 137, 126, 124, 62, 210, 141, 115, 56, 213, 96, 140, 229, 127, 227, 171, 148, 69, 84, 133, 160, 97, 104, 158, 82, 91];
    assert.deepEqual(Array.from(D.resizeRgb8(sampleRgba(), 7, 5, 3, 4)), expected);
});

test('resizeRgb8 放大和 Pillow 结果一致', () => {
    const expected = [0, 7, 200, 12, 9, 198, 39, 12, 199, 63, 16, 212, 86, 19, 216, 110, 22, 214, 134, 25, 212, 157, 28, 211, 181, 32, 209, 208, 35, 208, 224, 37, 207, 2, 30, 199, 16, 32, 210, 43, 35, 212, 67, 39, 160, 90, 42, 142, 114, 45, 150, 138, 48, 155, 161, 51, 159, 185, 55, 163, 212, 58, 174, 228, 60, 181, 7, 75, 197, 23, 77, 227, 50, 80, 225, 74, 84, 64, 97, 87, 12, 121, 90, 40, 145, 93, 56, 168, 96, 73, 192, 100, 88, 219, 103, 114, 235, 105, 130, 13, 116, 205, 29, 118, 178, 56, 121, 123, 80, 125, 33, 103, 128, 17, 127, 131, 52, 151, 134, 88, 174, 136, 124, 198, 140, 150, 225, 152, 104, 241, 160, 62, 19, 155, 214, 35, 157, 115, 62, 160, 0, 86, 164, 37, 109, 167, 81, 133, 170, 118, 157, 173, 155, 180, 176, 199, 204, 180, 238, 231, 183, 121, 247, 185, 22, 25, 212, 214, 41, 214, 114, 68, 217, 2, 92, 221, 60, 115, 224, 132, 139, 227, 184, 163, 230, 121, 186, 237, 110, 209, 240, 182, 247, 144, 161, 255, 79, 133, 31, 215, 212, 47, 217, 126, 74, 220, 33, 98, 224, 95, 121, 227, 161, 145, 230, 196, 169, 233, 88, 193, 242, 41, 217, 244, 101, 232, 98, 172, 236, 0, 218, 38, 94, 210, 54, 96, 133, 81, 99, 54, 105, 103, 139, 128, 106, 143, 152, 109, 86, 176, 112, 108, 204, 118, 96, 230, 121, 39, 142, 76, 103, 71, 45, 165, 42, 26, 210, 58, 28, 137, 85, 31, 65, 109, 35, 162, 132, 38, 131, 156, 41, 22, 180, 44, 120, 210, 46, 132, 237, 51, 8, 92, 66, 63, 0, 77, 129];
    assert.deepEqual(Array.from(D.resizeRgb8(sampleRgba(), 7, 5, 11, 9)), expected);
});

test('resizeRgb8 尺寸不变时只是去掉透明通道', () => {
    const rgba = sampleRgba();
    const rgb = D.resizeRgb8(rgba, 7, 5, 7, 5);
    for (let i = 0; i < 35; i++) assert.deepEqual(Array.from(rgb.subarray(i * 3, i * 3 + 3)), Array.from(rgba.subarray(i * 4, i * 4 + 3)));
});

/** 6×4 的浮点测试图（和生成期望值的 Python 脚本一致） */
function samplePlane() {
    return Float32Array.from({ length: 24 }, (_, i) => {
        const x = i % 6, y = Math.floor(i / 6);
        return ((x * 0.37 + y * 1.3) % 1.7) - 0.2;
    });
}

function assertClose(actual, expected) {
    assert.equal(actual.length, expected.length);
    expected.forEach((v, i) => assert.ok(Math.abs(actual[i] - v) < 1e-6, `#${i}: ${actual[i]} != ${v}`));
}

test('resizeFloat 放大和 Pillow 的 F 模式结果一致', () => {
    assertClose(D.resizeFloat(samplePlane(), 6, 4, 10, 7), [-0.33104953169822693, -0.195954367518425, 0.06687500327825546, 0.3730250298976898, 0.6543615460395813, 0.8698884844779968, 1.177803874015808, 1.3117307424545288, 0.3772348463535309, -0.2636801600456238, 0.18001709878444672, 0.3470489978790283, 0.5779416561126709, 0.43434789776802063, 0.4163919985294342, 0.711330771446228, 1.014076828956604, 1.1744509935379028, 0.6608964204788208, 0.29631826281547546, 1.0255203247070312, 1.2416661977767944, 1.4234448671340942, 0.5963115096092224, 0.09288834780454636, 0.4316515624523163, 0.6958484053611755, 0.9103944897651672, 1.1172256469726562, 1.2255618572235107, 0.9783254861831665, 1.1622761487960815, 1.3762500286102295, 1.0704001188278198, 0.655750036239624, 0.2529999911785126, 0.3177499771118164, 0.6800000071525574, 1.0105316638946533, 1.1921933889389038, 0.6416809558868408, 0.7804759740829468, 1.0396056175231934, 1.4148151874542236, 1.2857640981674194, 0.3429577350616455, 0.15500213205814362, 0.4496055245399475, 0.7029510736465454, 0.8475300669670105, 0.37762442231178284, 0.515851616859436, 0.7755489945411682, 1.0796959400177002, 1.2196781635284424, 1.0929499864578247, 0.6622861623764038, 0.18554894626140594, 0.3892127275466919, 0.5834735035896301, 0.24034470319747925, 0.3814781904220581, 0.6382692456245422, 0.8505595922470093, 1.132124900817871, 1.536057710647583, 0.9809288382530212, 0.048269230872392654, 0.2229025512933731, 0.44619375467300415]);
});

test('resizeFloat 缩小和 Pillow 的 F 模式结果一致', () => {
    assertClose(D.resizeFloat(samplePlane(), 6, 4, 4, 3), [0.27506357431411743, 0.43631237745285034, 0.9648228883743286, 0.6294997334480286, 1.117939829826355, 0.9418140649795532, 0.3796818256378174, 0.9781910181045532, 0.48200708627700806, 1.1022512912750244, 0.7740090489387512, 0.3530876636505127]);
});

// ---------- 模型输入 ----------

test('toModelInput 按 ImageNet 均值方差归一化，排成 NCHW', () => {
    const rgb = new Uint8Array([255, 0, 128, 10, 20, 30]);
    const x = D.toModelInput(rgb, 2);
    assert.equal(x.length, 6);
    assert.ok(Math.abs(x[0] - (1 - 0.485) / 0.229) < 1e-5);          // R 通道第 1 个像素
    assert.ok(Math.abs(x[1] - (10 / 255 - 0.485) / 0.229) < 1e-5);   // R 通道第 2 个像素
    assert.ok(Math.abs(x[2] - (0 - 0.456) / 0.224) < 1e-5);           // G 通道
    assert.ok(Math.abs(x[5] - (30 / 255 - 0.406) / 0.225) < 1e-5);    // B 通道
});

// ---------- PNG ----------

/** 解出 8 位灰度 PNG 的像素（只支持 encodeGrayPng 会写的格式），顺便校验结构 */
function decodeGrayPng(png) {
    assert.deepEqual(Array.from(png.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
    let pos = 8, width = 0, height = 0;
    const idat = [];
    for (;;) {
        const len = png.readUInt32BE(pos);
        const type = png.toString('latin1', pos + 4, pos + 8);
        const data = png.subarray(pos + 8, pos + 8 + len);
        if (type === 'IHDR') {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            assert.deepEqual(Array.from(data.subarray(8)), [8, 0, 0, 0, 0]);
        } else if (type === 'IDAT') {
            idat.push(data);
        }
        pos += 12 + len;
        if (type === 'IEND') break;
    }
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const out = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (width + 1)];
        for (let x = 0; x < width; x++) {
            const v = raw[y * (width + 1) + 1 + x];
            const a = x > 0 ? out[y * width + x - 1] : 0;
            const b = y > 0 ? out[(y - 1) * width + x] : 0;
            const c = x > 0 && y > 0 ? out[(y - 1) * width + x - 1] : 0;
            const p = a + b - c;
            const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : (Math.abs(p - b) <= Math.abs(p - c) ? b : c);
            const pred = [0, a, b, (a + b) >> 1, paeth][filter];
            out[y * width + x] = (v + pred) & 255;
        }
    }
    return { width, height, pixels: out };
}

test('encodeGrayPng 编出的 PNG 能原样解回来', () => {
    const w = 37, h = 19;
    const next = rng(4);
    // 一半平滑渐变、一半随机，各种过滤方式都会被选到
    const gray = Uint8Array.from({ length: w * h }, (_, i) => (i % w < 18 ? (i % w) * 7 + Math.floor(i / w) : Math.floor(next() * 256)));
    const decoded = decodeGrayPng(encodeGrayPng(gray, w, h));
    assert.equal(decoded.width, w);
    assert.equal(decoded.height, h);
    assert.deepEqual(decoded.pixels, gray);
});
