'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const MW = require('../shared/my-wallpapers');

test('wallpaperType：按扩展名分图片和视频，不分大小写', () => {
    assert.equal(MW.wallpaperType('C:\\a\\b.JPG'), 'image');
    assert.equal(MW.wallpaperType('C:/a/b.webp'), 'image');
    assert.equal(MW.wallpaperType('C:/a/b.MP4'), 'video');
    for (const ext of ['webm', 'mov', 'm4v', 'mkv']) assert.equal(MW.wallpaperType('x.' + ext), 'video');
    assert.equal(MW.wallpaperType('C:/a/b.gif'), null);
    assert.equal(MW.wallpaperType('C:/a/noext'), null);
});

test('normalizeList：去掉坏数据、补默认值、按路径去重、按最近用过排序', () => {
    const list = MW.normalizeList([
        null, { path: '' }, { path: 'C:/v/a.gif' },
        { path: 'C:/v/old.mp4', type: 'video', addedAt: 1, lastUsedAt: 1, effect: 'zoom', sound: 'yes' },
        { path: 'C:/p/new.jpg', addedAt: 5, lastUsedAt: 5 },
        { path: 'c:\\v\\OLD.mp4', type: 'video', lastUsedAt: 9 },
    ]);
    assert.deepEqual(list, [
        { path: 'C:/p/new.jpg', type: 'image', addedAt: 5, lastUsedAt: 5, thumb: '', duration: 0 },
        { path: 'C:/v/old.mp4', type: 'video', addedAt: 1, lastUsedAt: 1, thumb: '', duration: 0, effect: 'none', sound: false },
    ]);
    assert.deepEqual(MW.normalizeList(undefined), []);
});

test('addEntry：新的放最前；已有的只更新 lastUsedAt，保留效果和声音，给了缩略图才换', () => {
    let list = MW.addEntry([], { path: 'C:/v/a.mp4', type: 'video', thumb: 'T1', duration: 24 }, 100);
    list = MW.addEntry(list, { path: 'C:/p/b.png', type: 'image' }, 200);
    assert.deepEqual(list.map((e) => e.path), ['C:/p/b.png', 'C:/v/a.mp4']);
    list = MW.updateEntry(list, 'C:/v/a.mp4', { effect: 'pan', sound: true });
    list = MW.addEntry(list, { path: 'c:\\v\\A.mp4', type: 'video' }, 300);
    assert.equal(list.length, 2);
    assert.deepEqual(list[0], { path: 'C:/v/a.mp4', type: 'video', addedAt: 100, lastUsedAt: 300, thumb: 'T1', duration: 24, effect: 'pan', sound: true });
});

test('updateEntry：不认识的效果不改，不动 lastUsedAt；图片没有效果和声音', () => {
    let list = MW.addEntry([], { path: 'C:/v/a.mp4', type: 'video' }, 100);
    list = MW.addEntry(list, { path: 'C:/p/b.png', type: 'image' }, 50);
    list = MW.updateEntry(list, 'C:/v/a.mp4', { effect: 'zoom', sound: true });
    assert.equal(MW.findEntry(list, 'C:/v/a.mp4').effect, 'none');
    assert.equal(MW.findEntry(list, 'C:/v/a.mp4').sound, true);
    assert.equal(MW.findEntry(list, 'C:/v/a.mp4').lastUsedAt, 100);
    list = MW.updateEntry(list, 'C:/p/b.png', { effect: 'pan', sound: true, thumb: 'T' });
    const img = MW.findEntry(list, 'C:/p/b.png');
    assert.equal('effect' in img, false);
    assert.equal('sound' in img, false);
    assert.equal(img.thumb, 'T');
});

test('touchEntry / removeEntry / findEntry', () => {
    let list = MW.addEntry([], { path: 'C:/v/a.mp4', type: 'video' }, 1);
    list = MW.addEntry(list, { path: 'C:/p/b.png', type: 'image' }, 2);
    list = MW.touchEntry(list, 'C:\\V\\A.MP4', 3);
    assert.equal(list[0].path, 'C:/v/a.mp4');
    assert.deepEqual(MW.touchEntry(list, 'C:/none.png', 4), list);
    assert.equal(MW.findEntry(list, 'c:\\p\\B.png').path, 'C:/p/b.png');
    const { list: rest, removed } = MW.removeEntry(list, 'C:/p/b.png');
    assert.equal(removed.path, 'C:/p/b.png');
    assert.deepEqual(rest.map((e) => e.path), ['C:/v/a.mp4']);
    assert.equal(MW.removeEntry(rest, 'C:/zzz.png').removed, null);
});

test('migrateFromCurrentImage：当前是用户自己的图片、文件还在时加进列表', () => {
    const ctx = { isGallery: (p) => p.startsWith('G:'), exists: (p) => !p.includes('gone') };
    assert.deepEqual(MW.migrateFromCurrentImage([], 'C:/p/me.jpg', ctx, 7).map((e) => e.path), ['C:/p/me.jpg']);
    assert.deepEqual(MW.migrateFromCurrentImage([], 'G:/wallpapers/a.jpg', ctx, 7), []);
    assert.deepEqual(MW.migrateFromCurrentImage([], 'C:/p/gone.jpg', ctx, 7), []);
    assert.deepEqual(MW.migrateFromCurrentImage([], '', ctx, 7), []);
});

test('resolveCurrent：有视频且 imageAtTime 对得上就用视频，否则用 currentImage', () => {
    const video = { path: 'C:/v/x.mp4', effect: 'pan', sound: true, imageAtTime: 'C:/p/a.jpg' };
    assert.deepEqual(MW.resolveCurrent({ currentImage: 'C:/p/a.jpg', currentVideo: video }),
        { type: 'video', path: 'C:/v/x.mp4', effect: 'pan', sound: true });
    // 旧版本之后又换了图片
    assert.deepEqual(MW.resolveCurrent({ currentImage: 'C:/p/b.jpg', currentVideo: video }),
        { type: 'image', path: 'C:/p/b.jpg' });
    // 应用视频时还没有当前图片；坏的 effect 读成 none
    assert.deepEqual(MW.resolveCurrent({ currentImage: '', currentVideo: { path: 'C:/v/x.mp4', effect: 'zoom', imageAtTime: '' } }),
        { type: 'video', path: 'C:/v/x.mp4', effect: 'none', sound: false });
    assert.deepEqual(MW.resolveCurrent({ currentImage: 'C:/p/a.jpg', currentVideo: null }), { type: 'image', path: 'C:/p/a.jpg' });
    assert.equal(MW.resolveCurrent({}), null);
});

test('applyPartial：应用图片清掉 currentVideo；应用视频记下当时的 currentImage，不改 currentImage', () => {
    const config = {
        currentImage: 'C:/p/a.jpg',
        myWallpapers: [
            { path: 'C:/p/a.jpg', type: 'image', addedAt: 1, lastUsedAt: 1 },
            { path: 'C:/v/x.mp4', type: 'video', addedAt: 2, lastUsedAt: 2 },
        ],
    };
    const pv = MW.applyPartial(config, { type: 'video', path: 'C:/v/x.mp4', effect: 'depth', sound: false }, 50);
    assert.deepEqual(pv.currentVideo, { path: 'C:/v/x.mp4', effect: 'depth', sound: false, imageAtTime: 'C:/p/a.jpg' });
    assert.equal('currentImage' in pv, false);
    assert.equal(pv.myWallpapers[0].path, 'C:/v/x.mp4');
    assert.equal(pv.myWallpapers[0].lastUsedAt, 50);
    const pi = MW.applyPartial(config, { type: 'image', path: 'C:/p/a.jpg' }, 60);
    assert.equal(pi.currentImage, 'C:/p/a.jpg');
    assert.equal(pi.currentVideo, null);
    assert.equal(pi.myWallpapers[0].path, 'C:/p/a.jpg');
});

test('formatDuration：分:秒，未知时为空', () => {
    assert.equal(MW.formatDuration(24.4), '0:24');
    assert.equal(MW.formatDuration(65), '1:05');
    assert.equal(MW.formatDuration(3661), '61:01');
    assert.equal(MW.formatDuration(0), '');
    assert.equal(MW.formatDuration(NaN), '');
});
