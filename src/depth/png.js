/**
 * depth/png.js — 8 位灰度 PNG 编码（深度图用，和 Python 版存的格式一样）
 *
 * 推理子进程里用不了 nativeImage，而且 nativeImage 只能存 RGBA，体积大几倍，所以自己编：
 * 每行按 libpng 的启发式挑一种过滤方式，再整体 deflate。
 */

const zlib = require('zlib');

const CRC_TABLE = new Int32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    return c;
});

function crc32(buf) {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
}

function chunk(type, data) {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
}

function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    return pb <= pc ? b : c;
}

/**
 * @param {Uint8Array} gray - 行优先的 8 位灰度
 * @param {number} width
 * @param {number} height
 * @returns {Buffer}
 */
function encodeGrayPng(gray, width, height) {
    const stride = width + 1;
    const raw = Buffer.alloc(stride * height);
    const candidate = new Uint8Array(width);

    for (let y = 0; y < height; y++) {
        const row = y * width;
        let bestScore = Infinity;
        // 0 None / 1 Sub / 2 Up / 3 Average / 4 Paeth：过滤后的字节当有符号数取绝对值求和，取最小的。
        // 算到一半已经不比最好的小就提前放弃，只有整行算完且更好时才写进 raw
        for (let filter = 0; filter <= 4; filter++) {
            let score = 0;
            for (let x = 0; x < width; x++) {
                const v = gray[row + x];
                const a = x > 0 ? gray[row + x - 1] : 0;
                const b = y > 0 ? gray[row - width + x] : 0;
                const c = x > 0 && y > 0 ? gray[row - width + x - 1] : 0;
                const pred = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : paeth(a, b, c);
                const f = (v - pred) & 0xFF;
                candidate[x] = f;
                score += f < 128 ? f : 256 - f;
                if (score >= bestScore) break;
            }
            if (score < bestScore) {
                bestScore = score;
                raw[y * stride] = filter;
                raw.set(candidate, y * stride + 1);
            }
        }
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;   // 位深
    ihdr[9] = 0;   // 灰度
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw)),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

module.exports = { encodeGrayPng };
