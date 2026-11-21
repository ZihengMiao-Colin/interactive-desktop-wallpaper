'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sniffImage, readEmbeddedCover, sidecarCover, CoverResolver } = require('../src/audio-cover');

// ---------- 拼字节的小工具 ----------

const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const u24 = (n) => Buffer.from([(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
const syncsafe = (n) => Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
const cat = (...parts) => Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : p)));

/** 两张小"图片"：只要开头的标志字节对；JPEG 里故意带 FF 00，用来测反同步 */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 0xff, 0x00, 3, 0xff, 0xd9]);
const PNG = cat(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'png-body');

/** 反同步：每个 FF 后面插一个 00（解码时把 FF 00 还原成 FF） */
function unsync(buf) {
    const out = [];
    for (const x of buf) {
        out.push(x);
        if (x === 0xff) out.push(0);
    }
    return Buffer.from(out);
}

/** APIC 帧内容（ID3v2.3 / 2.4）：编码、MIME、图片类型、描述、图片 */
const apicBody = (type, data, { mime = 'image/jpeg', desc = cat('cover', Buffer.from([0])), enc = 0 } = {}) =>
    cat(Buffer.from([enc]), mime, Buffer.from([0, type]), desc, data);

const frame23 = (id, body, flags = [0, 0]) => cat(id, u32(body.length), Buffer.from(flags), body);
const frame24 = (id, body, flags = [0, 0]) => cat(id, syncsafe(body.length), Buffer.from(flags), body);

/** ID3v2 标签：头 + 帧 + 一点填充 */
const id3 = (version, frames, flags = 0) => {
    const rest = cat(frames, Buffer.alloc(16));
    return cat('ID3', Buffer.from([version, 0, flags]), syncsafe(rest.length), rest);
};

/** FLAC 元数据块：STREAMINFO 在前，最后一块打上"最后"标志 */
const flacBlock = (type, body, last) => cat(Buffer.from([(last ? 0x80 : 0) | type]), u24(body.length), body);
const flacPicture = (type, data, mime = 'image/png') =>
    cat(u32(type), u32(mime.length), mime, u32(0), u32(10), u32(10), u32(24), u32(0), u32(data.length), data);
const flac = (...pictures) => cat('fLaC',
    flacBlock(0, Buffer.alloc(34), pictures.length === 0),
    ...pictures.map((p, i) => flacBlock(6, p, i === pictures.length - 1)),
    'audio-frames');

/** MP4 盒子 */
const box = (type, ...content) => { const body = cat(...content); return cat(u32(8 + body.length), type, body); };
const mp4Cover = (data, { moovLast = false } = {}) => {
    const moov = box('moov',
        box('mvhd', Buffer.alloc(100)),
        box('udta', box('meta', Buffer.alloc(4), box('hdlr', Buffer.alloc(25)),
            box('ilst', box('©nam', box('data', u32(1), u32(0), 'song')), box('covr', box('data', u32(13), u32(0), data))))));
    const parts = [box('ftyp', 'M4A ', u32(0), 'isomM4A '), moov, box('mdat', Buffer.alloc(64))];
    if (moovLast) parts.push(parts.splice(1, 1)[0]);
    return cat(...parts);
};

/** 读内存里的字节，模拟按位置读文件 */
const readerOf = (buf) => async (offset, length) => buf.subarray(offset, offset + length);
const embedded = (buf) => readEmbeddedCover(readerOf(buf), buf.length);

// ---------- sniffImage ----------

test('sniffImage：按开头字节认出 jpeg / png / gif / webp / bmp，别的不算图片', () => {
    assert.deepEqual(sniffImage(JPEG), { mime: 'image/jpeg', ext: 'jpg' });
    assert.deepEqual(sniffImage(PNG), { mime: 'image/png', ext: 'png' });
    assert.equal(sniffImage(cat('GIF89a', Buffer.alloc(8))).ext, 'gif');
    assert.equal(sniffImage(cat('RIFF', u32(20), 'WEBPVP8 ', Buffer.alloc(8))).ext, 'webp');
    assert.equal(sniffImage(cat('BM', Buffer.alloc(20))).ext, 'bmp');
    assert.equal(sniffImage(cat('http://x.jpg')), null);
    assert.equal(sniffImage(Buffer.alloc(0)), null);
});

// ---------- ID3 ----------

test('ID3v2.3：有好几张图时用"封面"那张，没有封面类型时用第一张', async () => {
    const tag = id3(3, cat(frame23('TIT2', cat(Buffer.from([0]), 'song')), frame23('APIC', apicBody(0, PNG)), frame23('APIC', apicBody(3, JPEG))));
    assert.deepEqual(await embedded(cat(tag, 'mp3-audio')), JPEG);
    const noFront = id3(3, cat(frame23('APIC', apicBody(4, PNG)), frame23('APIC', apicBody(0, JPEG))));
    assert.deepEqual(await embedded(noFront), PNG);
});

test('ID3v2.3：描述是 UTF-16 时按两个 0 字节找结尾', async () => {
    const desc = Buffer.from([0xff, 0xfe, 0x61, 0x00, 0x00, 0x00]);
    const tag = id3(3, frame23('APIC', apicBody(3, PNG, { enc: 1, desc })));
    assert.deepEqual(await embedded(tag), PNG);
});

test('ID3v2.4：帧长是 syncsafe，帧单独做了反同步也能还原图片', async () => {
    const body = unsync(apicBody(3, JPEG));
    const tag = id3(4, cat(frame24('TIT2', cat(Buffer.from([3]), 'song')), frame24('APIC', body, [0, 0x02])));
    assert.deepEqual(await embedded(tag), JPEG);
});

test('ID3v2.3：整个标签做了反同步也能还原图片', async () => {
    const frames = unsync(frame23('APIC', apicBody(3, JPEG)));
    assert.deepEqual(await embedded(id3(3, frames, 0x80)), JPEG);
});

test('ID3v2.2：PIC 帧', async () => {
    const body = cat(Buffer.from([0]), 'JPG', Buffer.from([3]), 'c', Buffer.from([0]), JPEG);
    const tag = id3(2, cat('PIC', u24(body.length), body));
    assert.deepEqual(await embedded(tag), JPEG);
});

test('ID3：图片数据不是图片（比如链接）就跳过，压缩、加密的帧也跳过', async () => {
    const link = frame23('APIC', apicBody(3, cat('http://x.jpg'), { mime: '-->' }));
    const compressed = frame23('APIC', cat(u32(100), apicBody(3, JPEG)), [0, 0x80]);
    assert.equal(await embedded(id3(3, cat(link, compressed))), null);
    assert.deepEqual(await embedded(id3(3, cat(link, frame23('APIC', apicBody(0, PNG))))), PNG);
});

// ---------- FLAC ----------

test('FLAC：PICTURE 块，优先封面类型', async () => {
    assert.deepEqual(await embedded(flac(flacPicture(0, JPEG), flacPicture(3, PNG))), PNG);
    assert.equal(await embedded(flac()), null);
});

test('FLAC 前面带着 ID3 标签、ID3 里没有图时接着读 FLAC 的图', async () => {
    const tag = id3(3, frame23('TIT2', cat(Buffer.from([0]), 'song')));
    assert.deepEqual(await embedded(cat(tag, flac(flacPicture(3, JPEG)))), JPEG);
});

// ---------- MP4 ----------

test('MP4 / M4A：moov > udta > meta > ilst > covr', async () => {
    assert.deepEqual(await embedded(mp4Cover(JPEG)), JPEG);
});

test('MP4：moov 在 mdat 后面也能找到', async () => {
    assert.deepEqual(await embedded(mp4Cover(PNG, { moovLast: true })), PNG);
});

test('MP4：没有 covr 时为 null', async () => {
    const plain = cat(box('ftyp', 'isom', u32(0)), box('moov', box('mvhd', Buffer.alloc(100))), box('mdat', Buffer.alloc(8)));
    assert.equal(await embedded(plain), null);
});

// ---------- 坏数据 ----------

test('截断、长度乱写、不认识的格式：返回 null，不抛异常', async () => {
    const full = id3(3, frame23('APIC', apicBody(3, JPEG)));
    assert.equal(await embedded(full.subarray(0, 20)), null);
    const lying = cat('ID3', Buffer.from([3, 0, 0]), syncsafe(50), 'APIC', u32(0x7fffffff), Buffer.from([0, 0]), 'xx');
    assert.equal(await embedded(lying), null);
    const badFlac = cat('fLaC', Buffer.from([0x86]), u24(0xffffff), Buffer.alloc(10));
    assert.equal(await embedded(badFlac), null);
    const badMp4 = cat(box('ftyp', 'isom'), u32(0xfffffff0), 'moov', Buffer.alloc(8));
    assert.equal(await embedded(badMp4), null);
    assert.equal(await embedded(cat('RIFF', Buffer.alloc(40))), null);
    assert.equal(await embedded(Buffer.alloc(0)), null);
});

// ---------- 同名图片 ----------

test('sidecarCover：同一个文件夹里同名的 jpg / jpeg / png / webp，按这个顺序找', () => {
    const dir = 'D:\\music';
    const song = path.join(dir, '秋绪.mp3');
    const has = (...names) => (p) => names.some((n) => p === path.join(dir, n));
    assert.equal(sidecarCover(song, has('秋绪.png', '秋绪.jpg')), path.join(dir, '秋绪.jpg'));
    assert.equal(sidecarCover(song, has('秋绪.webp')), path.join(dir, '秋绪.webp'));
    assert.equal(sidecarCover(song, has('别的.png')), '');
    assert.equal(sidecarCover('', has('秋绪.png')), '');
});

// ---------- CoverResolver ----------

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'audio-cover-'));
}

test('CoverResolver：自选图 → 自带封面 → 同名图片 → 没有', async () => {
    const dir = tempDir();
    const tagged = path.join(dir, 'a.mp3');
    fs.writeFileSync(tagged, cat(id3(3, frame23('APIC', apicBody(3, JPEG))), 'audio'));
    const chosen = path.join(dir, 'chosen.png');
    fs.writeFileSync(chosen, PNG);
    const plain = path.join(dir, 'b.mp3');
    fs.writeFileSync(plain, 'just audio');
    fs.writeFileSync(path.join(dir, 'b.jpg'), JPEG);
    const bare = path.join(dir, 'n.mp3');
    fs.writeFileSync(bare, 'just audio');
    const resolver = new CoverResolver({ cacheDir: path.join(dir, 'covers') });

    assert.deepEqual(await resolver.resolve({ path: tagged, cover: chosen }), { file: chosen, source: 'manual' });

    const fromTag = await resolver.resolve({ path: tagged });
    assert.equal(fromTag.source, 'embedded');
    assert.equal(path.dirname(fromTag.file), path.join(dir, 'covers'));
    assert.equal(path.extname(fromTag.file), '.jpg');
    assert.deepEqual(fs.readFileSync(fromTag.file), JPEG);

    // 自选图被删了：回到自带的
    assert.deepEqual(await resolver.resolve({ path: tagged, cover: path.join(dir, 'gone.png') }), fromTag);
    assert.deepEqual(await resolver.resolve({ path: plain }), { file: path.join(dir, 'b.jpg'), source: 'sidecar' });
    assert.deepEqual(await resolver.resolve({ path: bare }), { file: '', source: 'none' });
    assert.deepEqual(await resolver.resolve({ path: path.join(dir, 'missing.mp3') }), { file: '', source: 'none' });
    assert.deepEqual(await resolver.resolve(null), { file: '', source: 'none' });
});

test('CoverResolver：已经缓存过的封面不重写（换一个实例也认得磁盘上的缓存）', async () => {
    const dir = tempDir();
    const song = path.join(dir, 'a.flac');
    fs.writeFileSync(song, flac(flacPicture(3, PNG)));
    const cacheDir = path.join(dir, 'covers');
    const first = await new CoverResolver({ cacheDir }).resolve({ path: song });
    const past = new Date('2020-01-01T00:00:00Z');
    fs.utimesSync(first.file, past, past);
    const again = await new CoverResolver({ cacheDir }).resolve({ path: song });
    assert.equal(again.file, first.file);
    assert.equal(fs.statSync(first.file).mtimeMs, past.getTime());
});

test('CoverResolver：歌文件改了以后重新读', async () => {
    const dir = tempDir();
    const song = path.join(dir, 'a.mp3');
    fs.writeFileSync(song, id3(3, frame23('APIC', apicBody(3, JPEG))));
    const resolver = new CoverResolver({ cacheDir: path.join(dir, 'covers') });
    const before = await resolver.resolve({ path: song });
    fs.writeFileSync(song, id3(3, frame23('APIC', apicBody(3, PNG, { mime: 'image/png' }))));
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(song, later, later);
    const after = await resolver.resolve({ path: song });
    assert.notEqual(after.file, before.file);
    assert.deepEqual(fs.readFileSync(after.file), PNG);
});

test('CoverResolver.prune：删掉不属于歌单里任何一首的缓存，返回删了几个', async () => {
    const dir = tempDir();
    const keep = path.join(dir, 'keep.mp3');
    const drop = path.join(dir, 'drop.mp3');
    fs.writeFileSync(keep, id3(3, frame23('APIC', apicBody(3, JPEG))));
    fs.writeFileSync(drop, id3(3, frame23('APIC', apicBody(3, PNG, { mime: 'image/png' }))));
    const cacheDir = path.join(dir, 'covers');
    const resolver = new CoverResolver({ cacheDir });
    const kept = await resolver.resolve({ path: keep });
    const dropped = await resolver.resolve({ path: drop });
    fs.writeFileSync(path.join(cacheDir, 'readme.txt'), 'not ours');

    assert.equal(await resolver.prune([{ path: keep }, { path: path.join(dir, 'missing.mp3') }]), 1);
    assert.equal(fs.existsSync(kept.file), true);
    assert.equal(fs.existsSync(dropped.file), false);
    assert.equal(fs.existsSync(path.join(cacheDir, 'readme.txt')), true);
    // 删掉的那首再要时重新读出来
    assert.equal(fs.existsSync((await resolver.resolve({ path: drop })).file), true);
    // 缓存目录还没建过时不报错
    assert.equal(await new CoverResolver({ cacheDir: path.join(dir, 'none') }).prune([]), 0);
});
