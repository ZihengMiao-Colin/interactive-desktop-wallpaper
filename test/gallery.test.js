'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadGallery, findGalleryEntry, migrateLegacyImagePath } = require('../src/gallery');

function galleryDir(entries, { skipFiles = [] } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-gallery-'));
    for (const e of entries) {
        for (const f of [e.file, e.depth, e.thumb]) {
            if (!f || skipFiles.includes(f)) continue;
            fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
            fs.writeFileSync(path.join(dir, f), 'x');
        }
    }
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ version: 1, wallpapers: entries }));
    return dir;
}

const cat = { id: 'cat', name: '小猫', file: 'cat.jpg', depth: 'depth/cat.png', thumb: 'thumbs/cat.jpg', credit: 'a / Pixabay', origin: 'nennie-cat-7094808_1920.jpg' };
const lake = { id: 'lake', name: '湖光山色', file: 'lake.jpg', depth: 'depth/lake.png', thumb: 'thumbs/lake.jpg', credit: 'b / Pexels', origin: 'pexels-lake-1.jpg' };

test('loadGallery 按 manifest 顺序返回绝对路径', () => {
    const dir = galleryDir([lake, cat]);
    const g = loadGallery(dir);
    assert.deepEqual(g.map((e) => e.id), ['lake', 'cat']);
    assert.equal(g[1].file, path.join(dir, 'cat.jpg'));
    assert.equal(g[1].depth, path.join(dir, 'depth', 'cat.png'));
    assert.equal(g[1].thumb, path.join(dir, 'thumbs', 'cat.jpg'));
    assert.equal(g[1].name, '小猫');
});

test('loadGallery 跳过缺图片或缺深度图的条目，缺缩略图时 thumb 为 null', () => {
    const dir = galleryDir([cat, lake], { skipFiles: ['depth/lake.png', 'thumbs/cat.jpg'] });
    const g = loadGallery(dir);
    assert.deepEqual(g.map((e) => e.id), ['cat']);
    assert.equal(g[0].thumb, null);
});

test('loadGallery 没有 manifest 时返回空数组', () => {
    assert.deepEqual(loadGallery(fs.mkdtempSync(path.join(os.tmpdir(), 'wp-gallery-'))), []);
});

test('findGalleryEntry 按路径匹配，不区分大小写和分隔符写法', () => {
    const dir = galleryDir([cat]);
    const g = loadGallery(dir);
    assert.equal(findGalleryEntry(g, path.join(dir, 'CAT.JPG')).id, 'cat');
    assert.equal(findGalleryEntry(g, dir.replace(/\\/g, '/') + '/cat.jpg').id, 'cat');
    assert.equal(findGalleryEntry(g, path.join(dir, 'other.jpg')), null);
    assert.equal(findGalleryEntry(g, ''), null);
});

test('migrateLegacyImagePath：旧路径已不存在时，按原文件名换成图库里的图片', () => {
    const dir = galleryDir([cat]);
    const g = loadGallery(dir);
    const old = 'C:\\project\\default wallpaper\\nennie-cat-7094808_1920.jpg';
    assert.equal(migrateLegacyImagePath(old, g, () => false), path.join(dir, 'cat.jpg'));
});

test('migrateLegacyImagePath：旧文件还在、对不上原文件名、或路径为空时保持不变', () => {
    const g = loadGallery(galleryDir([cat]));
    const old = 'C:\\project\\default wallpaper\\nennie-cat-7094808_1920.jpg';
    assert.equal(migrateLegacyImagePath(old, g, () => true), old);
    assert.equal(migrateLegacyImagePath('C:\\x\\unknown.jpg', g, () => false), 'C:\\x\\unknown.jpg');
    assert.equal(migrateLegacyImagePath('', g, () => false), '');
});

test('项目自带的图库能读出 17 张壁纸，图片、深度图、缩略图都在', () => {
    const g = loadGallery(path.join(__dirname, '..', 'wallpapers'));
    assert.equal(g.length, 17);
    for (const e of g) {
        assert.ok(fs.existsSync(e.file), e.file);
        assert.ok(fs.existsSync(e.depth), e.depth);
        assert.ok(e.thumb && fs.existsSync(e.thumb), e.id);
        assert.ok(e.name && e.origin, e.id);
    }
    assert.equal(new Set(g.map((e) => e.id)).size, 17, 'id 不重复');
});
