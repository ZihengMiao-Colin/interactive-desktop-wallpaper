'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const url = require('url');
const lib = require('../src/elements/library');

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** 拼一个 PNG chunk（CRC 不校验，填 0） */
const chunk = (type, len = 0) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(len, 0);
    head.write(type, 4, 'ascii');
    return Buffer.concat([head, Buffer.alloc(len), Buffer.alloc(4)]);
};
const pngBytes = Buffer.concat([PNG_SIG, chunk('IHDR', 13), chunk('IDAT', 4), chunk('IEND')]);
const apngBytes = Buffer.concat([PNG_SIG, chunk('IHDR', 13), chunk('acTL', 8), chunk('IDAT', 4), chunk('IEND')]);
/** 拼一个 WebP 文件头，flags 为 VP8X 的标志字节（0x02 = 动画） */
const webpBytes = (fourcc, flags = 0) => {
    const b = Buffer.alloc(40);
    b.write('RIFF', 0, 'ascii');
    b.writeUInt32LE(32, 4);
    b.write('WEBP', 8, 'ascii');
    b.write(fourcc, 12, 'ascii');
    b.writeUInt32LE(10, 16);
    b[20] = flags;
    return b;
};

function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'wp-lib-'));
}
function write(dir, name, bytes) {
    const p = path.join(dir, name);
    fs.writeFileSync(p, bytes);
    return p;
}

test('按扩展名识别图片和视频（大小写不敏感）', () => {
    const dir = tmpDir();
    assert.equal(lib.detectAssetType(write(dir, 'A.PNG', pngBytes)), 'image');
    assert.equal(lib.detectAssetType(write(dir, 'b.JPG', Buffer.alloc(4))), 'image');
    assert.equal(lib.detectAssetType(write(dir, 'c.MP4', Buffer.alloc(4))), 'video');
    assert.equal(lib.detectAssetType(write(dir, 'd.webm', Buffer.alloc(4))), 'video');
    assert.equal(lib.detectAssetType(write(dir, 'e.gif', Buffer.alloc(4))), 'animated');
    assert.equal(lib.detectAssetType(write(dir, 'f.txt', Buffer.alloc(4))), null);
});

test('动态 webp 和 apng 识别为 animated，静态的识别为 image', () => {
    const dir = tmpDir();
    assert.equal(lib.detectAssetType(write(dir, 'anim.webp', webpBytes('VP8X', 0x02))), 'animated');
    assert.equal(lib.detectAssetType(write(dir, 'still.webp', webpBytes('VP8X', 0x10))), 'image');
    assert.equal(lib.detectAssetType(write(dir, 'lossy.webp', webpBytes('VP8 '))), 'image');
    assert.equal(lib.detectAssetType(write(dir, 'anim.png', apngBytes)), 'animated');
    assert.equal(lib.detectAssetType(write(dir, 'anim.apng', apngBytes)), 'animated');
});

test('导入含中文、空格、#、% 的文件', () => {
    const src = write(tmpDir(), '猫 #1 100%.PNG', pngBytes);
    const libDir = path.join(tmpDir(), 'custom_elements');
    const a = lib.importUserAsset(src, libDir, 'user:abc');
    assert.equal(a.id, 'user:abc');
    assert.equal(a.type, 'image');
    assert.equal(a.name, '猫 #1 100%');
    assert.equal(a.builtin, false);
    assert.equal(a.file, path.join(libDir, 'abc.png'));
    assert.ok(fs.existsSync(a.file));

    const u = lib.toFileUrl(src);
    assert.ok(!u.includes('#'), u);
    assert.ok(u.startsWith('file:///'));
    assert.equal(url.fileURLToPath(u), src);
});

test('导入不支持的文件抛 UNSUPPORTED_FILE', () => {
    const src = write(tmpDir(), 'notes.txt', Buffer.from('hi'));
    assert.throws(() => lib.importUserAsset(src, tmpDir(), 'user:x'), /UNSUPPORTED_FILE/);
});

test('loadBuiltinAssets 读 manifest 并跳过缺文件的条目', () => {
    const dir = tmpDir();
    write(dir, 'ok.mp4', Buffer.alloc(4));
    write(dir, 'ok_thumb.jpg', Buffer.alloc(4));
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
        version: 1,
        elements: [
            { id: 'ok', name: '有', type: 'video', file: 'ok.mp4', thumb: 'ok_thumb.jpg' },
            { id: 'gone', name: '没有', type: 'video', file: 'gone.mp4' },
        ],
    }));
    const assets = lib.loadBuiltinAssets(dir);
    assert.deepEqual(assets.map((a) => a.id), ['builtin:ok']);
    assert.equal(assets[0].file, path.join(dir, 'ok.mp4'));
    assert.equal(assets[0].thumb, path.join(dir, 'ok_thumb.jpg'));
});

test('loadBuiltinAssets 没有 manifest 时返回空数组', () => {
    assert.deepEqual(lib.loadBuiltinAssets(tmpDir()), []);
});

test('removeUserAssetFiles 文件已不存在也不报错', () => {
    const dir = tmpDir();
    const file = write(dir, 'x.png', pngBytes);
    lib.removeUserAssetFiles({ file, thumb: path.join(dir, 'missing.jpg') });
    assert.ok(!fs.existsSync(file));
    lib.removeUserAssetFiles({ file, thumb: null });
});

test('saveThumbnail 写出 jpg 并返回路径', () => {
    const dir = tmpDir();
    const p = lib.saveThumbnail(dir, 'user:abc', 'data:image/jpeg;base64,' + Buffer.from('jpeg!').toString('base64'));
    assert.equal(p, path.join(dir, 'abc_thumb.jpg'));
    assert.equal(fs.readFileSync(p, 'utf8'), 'jpeg!');
});

test('项目自带的 manifest 能读出两个爆炸视频素材', () => {
    const assets = lib.loadBuiltinAssets(path.join(__dirname, '..', 'elements'));
    assert.deepEqual(assets.map((a) => a.id), ['builtin:bomb1', 'builtin:bomb2']);
    for (const a of assets) {
        assert.equal(a.type, 'video');
        assert.ok(fs.existsSync(a.file), a.file);
        assert.ok(a.thumb && fs.existsSync(a.thumb), a.thumb);
        assert.equal(a.defaults.playback.mode, 'interval');
        assert.equal(a.defaults.chroma.enabled, true);
        assert.ok(a.aspect > 0);
    }
});
