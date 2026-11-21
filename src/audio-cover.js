/**
 * audio-cover.js — 唱片机每首歌的封面（主进程用）
 *
 * 一首歌显示哪张图，按顺序找，找到就停：
 *   1. 用户给这首歌选的图（歌单里的 cover），文件还在
 *   2. 歌曲文件自带的封面：mp3 等开头的 ID3v2（2.2 / 2.3 / 2.4）、flac 的 PICTURE 块、m4a / mp4 的 covr
 *   3. 同一个文件夹里和歌同名的图片（秋绪.mp3 → 秋绪.jpg / .jpeg / .png / .webp）
 *   4. 都没有
 * 认格式看文件开头的字节，不看扩展名（有些"mp3"其实是改了扩展名的 mp4）。
 * 读出来的自带封面存成数据目录下 vinyl_covers/ 里的图片文件，文件名由"歌的路径 + 大小 + 修改时间"算出来，
 * 歌文件改了就会重新读；壁纸和设置页都按普通图片路径用它。
 * 只读需要的那一段（ID3 标签、FLAC 元数据块、mp4 的 moov 盒子），不读整个文件；数据坏了当作没有封面。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/** ID3 标签、mp4 的 moov 最多读这么大（再大多半是坏数据） */
const MAX_ID3_BYTES = 32 * 1024 * 1024;
const MAX_MOOV_BYTES = 64 * 1024 * 1024;
/** 图片类型：封面（front cover），ID3 和 FLAC 里都是 3 */
const FRONT_COVER = 3;
const SIDECAR_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const CACHE_FILE_RE = /^([0-9a-f]{16})\.(jpg|png|gif|webp|bmp)$/;

// ==================== 图片 ====================

/** 按开头字节认图片格式；不是图片返回 null */
function sniffImage(buf) {
    if (!buf || buf.length < 4) return null;
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
    if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return { mime: 'image/png', ext: 'png' };
    if (buf.toString('latin1', 0, 4) === 'GIF8') return { mime: 'image/gif', ext: 'gif' };
    if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
        return { mime: 'image/webp', ext: 'webp' };
    }
    if (buf[0] === 0x42 && buf[1] === 0x4d) return { mime: 'image/bmp', ext: 'bmp' };
    return null;
}

/** 几张图里挑一张：先去掉不是图片的（比如 ID3 里存的链接），有封面类型的用它，没有就用第一张 */
function pickPicture(pictures) {
    const images = pictures.filter((p) => p && sniffImage(p.data));
    const chosen = images.find((p) => p.type === FRONT_COVER) || images[0];
    return chosen ? chosen.data : null;
}

// ==================== ID3v2 ====================

const syncsafeInt = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);

/** 去掉反同步：FF 00 还原成 FF */
function resync(buf) {
    const out = Buffer.alloc(buf.length);
    let n = 0;
    for (let i = 0; i < buf.length; i++) {
        out[n++] = buf[i];
        if (buf[i] === 0xff && buf[i + 1] === 0x00) i++;
    }
    return out.subarray(0, n);
}

/** 从 start 开始跳过一个以 0 结尾的字符串（UTF-16 的两种编码找对齐的 00 00），返回结尾之后的位置；找不到为 -1 */
function skipString(buf, start, encoding) {
    if (encoding === 1 || encoding === 2) {
        for (let i = start; i + 1 < buf.length; i += 2) {
            if (buf[i] === 0 && buf[i + 1] === 0) return i + 2;
        }
        return -1;
    }
    const end = buf.indexOf(0, start);
    return end < 0 ? -1 : end + 1;
}

/** APIC（2.3 / 2.4）或 PIC（2.2）帧内容 → { type, data } */
function parsePictureFrame(body, isV22) {
    if (body.length < 2) return null;
    const encoding = body[0];
    let pos;
    if (isV22) {
        pos = 4;                                // 3 个字符的图片格式，比如 JPG
    } else {
        const mimeEnd = body.indexOf(0, 1);     // MIME 是 latin1，以 0 结尾
        if (mimeEnd < 0) return null;
        pos = mimeEnd + 1;
    }
    if (pos >= body.length) return null;
    const type = body[pos];
    const dataStart = skipString(body, pos + 1, encoding);
    if (dataStart < 0) return null;
    return { type, data: body.subarray(dataStart) };
}

/**
 * ID3v2 标签（tag 从 "ID3" 开始）里的所有图片。
 * 处理：2.3 整个标签的反同步、2.4 每帧的反同步、扩展头、分组和数据长度这两种附加字节；压缩、加密的帧跳过。
 */
function id3Pictures(tag) {
    if (tag.length < 10) return [];
    const version = tag[3];
    const flags = tag[5];
    if (version < 2 || version > 4) return [];
    if (version === 2 && (flags & 0x40)) return [];            // 2.2 的压缩标签，没有定义怎么解
    let body = tag.subarray(10, 10 + syncsafeInt(tag, 6));
    if (version < 4 && (flags & 0x80)) body = resync(body);     // 2.2 / 2.3：整个标签做了反同步
    let pos = 0;
    if (version >= 3 && (flags & 0x40)) {                      // 扩展头
        if (body.length < 4) return [];
        pos = version === 3 ? body.readUInt32BE(0) + 4 : syncsafeInt(body, 0);
    }
    const isV22 = version === 2;
    const headerLength = isV22 ? 6 : 10;
    const pictures = [];
    while (pos + headerLength <= body.length && body[pos] !== 0) {
        const id = body.toString('latin1', pos, pos + (isV22 ? 3 : 4));
        let size;
        if (isV22) size = (body[pos + 3] << 16) | (body[pos + 4] << 8) | body[pos + 5];
        else if (version === 3) size = body.readUInt32BE(pos + 4);
        else size = syncsafeInt(body, pos + 4);
        const start = pos + headerLength;
        if (size <= 0 || start + size > body.length) break;
        if (id === 'APIC' || id === 'PIC') {
            const frame = pictureFrameData(body.subarray(start, start + size), version, isV22 ? 0 : body[pos + 9], flags);
            const picture = frame && parsePictureFrame(frame, isV22);
            if (picture) pictures.push(picture);
        }
        pos = start + size;
    }
    return pictures;
}

/** 按帧标志去掉附加字节、还原反同步；压缩或加密的帧返回 null */
function pictureFrameData(frame, version, frameFlags, tagFlags) {
    if (version === 3) {
        if (frameFlags & 0xc0) return null;                    // 0x80 压缩、0x40 加密
        return frameFlags & 0x20 ? frame.subarray(1) : frame;  // 分组标识占 1 字节
    }
    if (version === 4) {
        if (frameFlags & 0x0c) return null;                    // 0x08 压缩、0x04 加密
        let data = frame;
        if (frameFlags & 0x40) data = data.subarray(1);        // 分组标识
        if (frameFlags & 0x01) data = data.subarray(4);        // 数据长度（syncsafe，不受反同步影响）
        if ((frameFlags & 0x02) || (tagFlags & 0x80)) data = resync(data);
        return data;
    }
    return frame;
}

// ==================== FLAC ====================

/** PICTURE 块内容 → { type, data } */
function parseFlacPicture(body) {
    try {
        const type = body.readUInt32BE(0);
        let pos = 8 + body.readUInt32BE(4);                    // MIME
        pos += 4 + body.readUInt32BE(pos);                     // 描述
        pos += 16;                                             // 宽、高、色深、调色板颜色数
        const length = body.readUInt32BE(pos);
        const data = body.subarray(pos + 4, pos + 4 + length);
        return data.length === length ? { type, data } : null;
    } catch (_) {
        return null;
    }
}

/** 从 offset（"fLaC" 之后）开始读元数据块，找 PICTURE（类型 6） */
async function flacCover(read, offset) {
    const pictures = [];
    let pos = offset;
    for (let i = 0; i < 256; i++) {
        const header = await read(pos, 4);
        if (header.length < 4) break;
        const type = header[0] & 0x7f;
        const length = (header[1] << 16) | (header[2] << 8) | header[3];
        if (type === 127) break;                               // 无效块
        if (type === 6) {
            const body = await read(pos + 4, length);
            if (body.length < length) break;
            const picture = parseFlacPicture(body);
            if (picture) pictures.push(picture);
        }
        if (header[0] & 0x80) break;                           // 最后一块
        pos += 4 + length;
    }
    return pickPicture(pictures);
}

// ==================== MP4 / M4A ====================

/** 盒子头：{ type, size, header }；不完整或长度不对时为 null */
function boxHeader(h, room) {
    if (h.length < 8) return null;
    let size = h.readUInt32BE(0);
    let header = 8;
    if (size === 1) {
        if (h.length < 16) return null;
        size = Number(h.readBigUInt64BE(8));
        header = 16;
    } else if (size === 0) {
        size = room;                                           // 一直到结尾
    }
    if (size < header || size > room) return null;
    return { type: h.toString('latin1', 4, 8), size, header };
}

/** 在内存里的 [start, end) 中找第一个类型为 type 的盒子 → { start: 内容开始, end } */
function findBox(buf, start, end, type) {
    for (let pos = start; pos + 8 <= end;) {
        const box = boxHeader(buf.subarray(pos, Math.min(end, pos + 16)), end - pos);
        if (!box) return null;
        if (box.type === type) return { start: pos + box.header, end: pos + box.size };
        pos += box.size;
    }
    return null;
}

/** 顶层按盒子往后找 moov（只读盒子头），读进来再找 udta > meta > ilst > covr 里的 data */
async function mp4Cover(read, offset, size) {
    let moov = null;
    for (let pos = offset; pos + 8 <= size;) {
        const box = boxHeader(await read(pos, 16), size - pos);
        if (!box) return null;
        if (box.type === 'moov') {
            moov = { start: pos + box.header, end: pos + box.size };
            break;
        }
        pos += box.size;
    }
    if (!moov || moov.end - moov.start > MAX_MOOV_BYTES) return null;
    const buf = await read(moov.start, moov.end - moov.start);
    const udta = findBox(buf, 0, buf.length, 'udta');
    const meta = (udta && findBox(buf, udta.start, udta.end, 'meta')) || findBox(buf, 0, buf.length, 'meta');
    if (!meta) return null;
    // iTunes 的 meta 是带 4 字节版本 / 标志的 full box；QuickTime 的不带（紧跟着就是 hdlr）
    const childrenStart = buf.toString('latin1', meta.start + 4, meta.start + 8) === 'hdlr' ? meta.start : meta.start + 4;
    const ilst = findBox(buf, childrenStart, meta.end, 'ilst');
    const covr = ilst && findBox(buf, ilst.start, ilst.end, 'covr');
    if (!covr) return null;
    const pictures = [];
    for (let pos = covr.start; pos + 8 <= covr.end;) {
        const box = boxHeader(buf.subarray(pos, Math.min(covr.end, pos + 16)), covr.end - pos);
        if (!box) break;
        // data 盒子：4 字节类型（13 JPEG / 14 PNG）+ 4 字节语言，后面是图片
        if (box.type === 'data' && box.size > box.header + 8) {
            pictures.push({ type: 0, data: buf.subarray(pos + box.header + 8, pos + box.size) });
        }
        pos += box.size;
    }
    return pickPicture(pictures);
}

// ==================== 入口 ====================

/**
 * 歌曲文件自带的封面图片。
 * @param {(offset: number, length: number) => Promise<Buffer>} read - 按位置读文件（读到结尾时可以比要的短）
 * @param {number} size - 文件大小
 * @returns {Promise<Buffer | null>} 图片字节（一定是认得出的图片格式）；没有或数据坏了为 null
 */
async function readEmbeddedCover(read, size) {
    try {
        let offset = 0;
        let head = await read(0, 12);
        if (head.length >= 10 && head.toString('latin1', 0, 3) === 'ID3') {
            const tagSize = 10 + syncsafeInt(head, 6) + (head[5] & 0x10 ? 10 : 0);   // 2.4 可能带 10 字节的尾
            if (tagSize <= MAX_ID3_BYTES) {
                const cover = pickPicture(id3Pictures(await read(0, tagSize)));
                if (cover) return cover;
            }
            // ID3 里没有图：有些 flac 前面也带着 ID3 标签，接着看后面是什么
            offset = tagSize;
            head = await read(offset, 12);
        }
        if (head.length >= 4 && head.toString('latin1', 0, 4) === 'fLaC') return await flacCover(read, offset + 4);
        if (head.length >= 8 && head.toString('latin1', 4, 8) === 'ftyp') return await mp4Cover(read, offset, size);
        return null;
    } catch (_) {
        return null;
    }
}

/** 和歌同一个文件夹、同名的图片（按 jpg、jpeg、png、webp 的顺序找）；没有为 '' */
function sidecarCover(audioPath, exists) {
    if (!audioPath) return '';
    const dir = path.dirname(audioPath);
    const base = path.basename(audioPath, path.extname(audioPath));
    for (const ext of SIDECAR_EXTENSIONS) {
        const candidate = path.join(dir, base + ext);
        if (exists(candidate)) return candidate;
    }
    return '';
}

const NO_COVER = Object.freeze({ file: '', source: 'none' });

/** 按"歌的路径 + 大小 + 修改时间"找封面、缓存读出来的自带封面 */
class CoverResolver {
    /** @param {{ cacheDir: string }} options - 自带封面的缓存目录（用到时才创建） */
    constructor({ cacheDir }) {
        this.cacheDir = cacheDir;
        /** 缓存 key → Promise<缓存文件路径，没有自带封面为 ''> */
        this.memo = new Map();
    }

    /**
     * 一首歌该显示哪张图。
     * @param {{ path: string, cover?: string }} track
     * @returns {Promise<{ file: string, source: 'manual' | 'embedded' | 'sidecar' | 'none' }>}
     */
    async resolve(track) {
        if (!track || typeof track.path !== 'string' || !track.path) return { ...NO_COVER };
        if (typeof track.cover === 'string' && track.cover && fs.existsSync(track.cover)) {
            return { file: track.cover, source: 'manual' };
        }
        const embedded = await this.embeddedFile(track.path);
        if (embedded) return { file: embedded, source: 'embedded' };
        const sidecar = sidecarCover(track.path, fs.existsSync);
        if (sidecar) return { file: sidecar, source: 'sidecar' };
        return { ...NO_COVER };
    }

    /** 歌的缓存 key；文件读不到时为 null */
    async keyOf(audioPath) {
        try {
            const stat = await fs.promises.stat(audioPath);
            if (!stat.isFile()) return null;
            const id = `${audioPath.toLowerCase()}|${stat.size}|${Math.round(stat.mtimeMs)}`;
            return crypto.createHash('sha1').update(id).digest('hex').slice(0, 16);
        } catch (_) {
            return null;
        }
    }

    /** 自带封面的缓存文件；没有为 ''。缓存文件被外面删掉了就重新读一次 */
    async embeddedFile(audioPath) {
        const key = await this.keyOf(audioPath);
        if (!key) return '';
        let file = await this.extractOnce(audioPath, key);
        if (file && !fs.existsSync(file)) {
            this.memo.delete(key);
            file = await this.extractOnce(audioPath, key);
        }
        return file;
    }

    extractOnce(audioPath, key) {
        if (!this.memo.has(key)) {
            this.memo.set(key, this.extract(audioPath, key).catch((err) => {
                console.warn('[AudioCover] 读封面失败:', audioPath, err.message);
                return '';
            }));
        }
        return this.memo.get(key);
    }

    /** 磁盘上已经有这个 key 的缓存就直接用；否则读歌文件，有自带封面就写成缓存文件 */
    async extract(audioPath, key) {
        for (const ext of ['jpg', 'png', 'gif', 'webp', 'bmp']) {
            const cached = path.join(this.cacheDir, `${key}.${ext}`);
            if (fs.existsSync(cached)) return cached;
        }
        const handle = await fs.promises.open(audioPath, 'r');
        let data;
        try {
            const { size } = await handle.stat();
            const read = async (offset, length) => {
                const n = Math.max(0, Math.min(length, size - offset));
                if (!n) return Buffer.alloc(0);
                const buf = Buffer.alloc(n);
                const { bytesRead } = await handle.read(buf, 0, n, offset);
                return buf.subarray(0, bytesRead);
            };
            data = await readEmbeddedCover(read, size);
        } finally {
            await handle.close();
        }
        if (!data) return '';
        await fs.promises.mkdir(this.cacheDir, { recursive: true });
        const file = path.join(this.cacheDir, `${key}.${sniffImage(data).ext}`);
        await fs.promises.writeFile(file, data);
        return file;
    }

    /**
     * 删掉不属于歌单里任何一首的缓存文件（只删自己起名的那种，别的文件不动）。
     * @param {Array<{ path: string }>} playlist
     * @returns {Promise<number>} 删了几个
     */
    async prune(playlist) {
        let names;
        try {
            names = await fs.promises.readdir(this.cacheDir);
        } catch (_) {
            return 0;
        }
        const keep = new Set();
        for (const track of Array.isArray(playlist) ? playlist : []) {
            const key = track && typeof track.path === 'string' && track.path ? await this.keyOf(track.path) : null;
            if (key) keep.add(key);
        }
        let removed = 0;
        for (const name of names) {
            const match = CACHE_FILE_RE.exec(name);
            if (!match || keep.has(match[1])) continue;
            try {
                await fs.promises.unlink(path.join(this.cacheDir, name));
                this.memo.delete(match[1]);
                removed += 1;
            } catch (err) {
                console.warn('[AudioCover] 删缓存失败:', name, err.message);
            }
        }
        return removed;
    }
}

module.exports = { sniffImage, readEmbeddedCover, sidecarCover, CoverResolver };
