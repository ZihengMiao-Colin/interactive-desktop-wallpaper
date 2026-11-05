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

// ---- 裁剪 ----

const CROP = { x: 0.1, y: 0.2, w: 0.5, h: 0.4 };
const OTHER_CROP = { x: 0, y: 0, w: 0.5, h: 0.5 };

test('normalizeList：留下合法的裁剪，丢掉坏的，没有裁剪时不写这个键', () => {
    const [a, b, c] = MW.normalizeList([
        { path: 'C:/a.jpg', lastUsedAt: 3, crop: CROP },
        { path: 'C:/b.jpg', lastUsedAt: 2, crop: { x: NaN, y: 0, w: 1, h: 1 } },
        { path: 'C:/c.mp4', lastUsedAt: 1 },
    ]);
    assert.deepEqual(a.crop, CROP);
    assert.equal('crop' in b, false);
    assert.equal('crop' in c, false);
});

test('addEntry：新条目带裁剪；已有的条目给了新裁剪就换，没给就留着', () => {
    const list = MW.addEntry([], { path: 'C:/a.jpg', type: 'image', crop: CROP }, 1);
    assert.deepEqual(list[0].crop, CROP);
    assert.deepEqual(MW.addEntry(list, { path: 'C:/a.jpg', type: 'image', crop: OTHER_CROP }, 2)[0].crop, OTHER_CROP);
    assert.deepEqual(MW.addEntry(list, { path: 'C:/a.jpg', type: 'image' }, 2)[0].crop, CROP);
});

test('updateEntry：改裁剪、用 null 清掉，别的字段不动，图片和视频都行', () => {
    const list = [{ path: 'C:/a.jpg', type: 'image', crop: CROP }, { path: 'C:/v.mp4', type: 'video', effect: 'pan' }];
    assert.deepEqual(MW.findEntry(MW.updateEntry(list, 'C:/a.jpg', { crop: OTHER_CROP }), 'C:/a.jpg').crop, OTHER_CROP);
    assert.equal('crop' in MW.findEntry(MW.updateEntry(list, 'C:/a.jpg', { crop: null }), 'C:/a.jpg'), false);
    assert.deepEqual(MW.findEntry(MW.updateEntry(list, 'C:/a.jpg', { thumb: 't.jpg' }), 'C:/a.jpg').crop, CROP);
    const video = MW.findEntry(MW.updateEntry(list, 'C:/v.mp4', { crop: CROP }), 'C:/v.mp4');
    assert.deepEqual(video.crop, CROP);
    assert.equal(video.effect, 'pan');
});

test('withCrop：按路径从「我的壁纸」取裁剪，列表里没有裁剪时去掉', () => {
    const config = { myWallpapers: [{ path: 'C:/a.jpg', type: 'image', crop: CROP }, { path: 'C:/b.jpg', type: 'image' }] };
    assert.deepEqual(MW.withCrop({ type: 'image', path: 'c:\\A.JPG' }, config), { type: 'image', path: 'c:\\A.JPG', crop: CROP });
    assert.deepEqual(MW.withCrop({ type: 'image', path: 'C:/b.jpg', crop: CROP }, config), { type: 'image', path: 'C:/b.jpg' });
    assert.deepEqual(MW.withCrop({ type: 'image', path: 'C:/gallery.jpg' }, config), { type: 'image', path: 'C:/gallery.jpg' });
});

test('withCrop：当前壁纸从列表移除后再应用一次，裁剪还在，水印不会回来', () => {
    const image = { currentImage: 'C:/a.jpg', currentImageCrop: { path: 'C:/a.jpg', ...CROP }, myWallpapers: [] };
    assert.deepEqual(MW.withCrop({ type: 'image', path: 'C:/a.jpg' }, image).crop, CROP);
    const video = { currentVideo: { path: 'C:/v.mp4', crop: CROP, imageAtTime: '' }, myWallpapers: [] };
    assert.deepEqual(MW.withCrop({ type: 'video', path: 'C:/v.mp4', effect: 'pan' }, video).crop, CROP);
    // 换成别的不在列表里的壁纸（默认壁纸）时不沿用
    assert.equal('crop' in MW.withCrop({ type: 'image', path: 'C:/gallery.jpg' }, image), false);
});

test('withCrop：列表里的记录优先于当前壁纸的旧裁剪（重新裁剪后马上应用）', () => {
    const config = {
        currentImage: 'C:/a.jpg',
        currentImageCrop: { path: 'C:/a.jpg', ...OTHER_CROP },
        myWallpapers: [{ path: 'C:/a.jpg', type: 'image', crop: CROP }],
    };
    assert.deepEqual(MW.withCrop({ type: 'image', path: 'C:/a.jpg' }, config).crop, CROP);
});

test('applyPartial：把裁剪记到当前壁纸，从「我的壁纸」移除后还在', () => {
    const video = MW.applyPartial({}, { type: 'video', path: 'C:/v.mp4', effect: 'pan', sound: false, crop: CROP }, 1);
    assert.deepEqual(video.currentVideo.crop, CROP);

    const image = MW.applyPartial({}, { type: 'image', path: 'C:/a.jpg', crop: CROP }, 1);
    assert.deepEqual(image.currentImageCrop, { path: 'C:/a.jpg', ...CROP });
    assert.equal(image.currentImage, 'C:/a.jpg');
    assert.deepEqual(MW.resolveCurrent({ ...image, myWallpapers: [] }), { type: 'image', path: 'C:/a.jpg', crop: CROP });
});

test('applyPartial：没有裁剪时清掉上一张图片的裁剪，视频不写 crop 键', () => {
    const config = { currentImage: 'C:/a.jpg', currentImageCrop: { path: 'C:/a.jpg', ...CROP } };
    assert.equal(MW.applyPartial(config, { type: 'image', path: 'C:/b.jpg' }, 1).currentImageCrop, null);
    assert.equal('crop' in MW.applyPartial(config, { type: 'video', path: 'C:/v.mp4' }, 1).currentVideo, false);
});

test('resolveCurrent：视频和图片都带裁剪，没有时不写这个键', () => {
    const currentVideo = { path: 'C:/v.mp4', effect: 'none', crop: CROP, imageAtTime: '' };
    assert.deepEqual(MW.resolveCurrent({ currentImage: '', currentVideo }).crop, CROP);
    assert.equal('crop' in MW.resolveCurrent({ currentImage: 'C:/a.jpg' }), false);
});

test('resolveCurrent：坏的裁剪当没有；图片的裁剪路径对不上时不用（旧版本换过图片）', () => {
    assert.equal('crop' in MW.resolveCurrent({
        currentVideo: { path: 'C:/v.mp4', crop: { x: 'a' }, imageAtTime: '' },
    }), false);
    assert.equal('crop' in MW.resolveCurrent({
        currentImage: 'C:/new.jpg', currentImageCrop: { path: 'C:/old.jpg', ...CROP },
    }), false);
    assert.deepEqual(MW.resolveCurrent({
        currentImage: 'C:/a.jpg', currentImageCrop: { path: 'c:\\A.jpg', ...CROP },
    }).crop, CROP);
});
