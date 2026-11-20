'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fileKind, collectPaths, replacePaths, relinkMoves } = require('../src/file-tracking/paths');

/** 各个字段都用上的配置 */
function fullConfig() {
    return {
        myWallpapers: [
            { path: 'C:\\w\\a.jpg', type: 'image', thumb: 't1.png', crop: { x: 0.1, y: 0, w: 0.8, h: 1 } },
            { path: 'C:\\w\\v.mp4', type: 'video', effect: 'pan', sound: true },
        ],
        currentImage: 'c:/w/A.jpg',                       // 和第一格是同一个文件
        currentImageCrop: { path: 'C:\\w\\a.jpg', x: 0.1, y: 0, w: 0.8, h: 1 },
        currentVideo: { path: 'C:\\w\\v.mp4', effect: 'pan', sound: true, imageAtTime: 'C:\\w\\old.png' },
        vinyl: { enabled: true, playlist: [{ path: 'D:\\m\\s.mp3', name: 's' }], current: 'D:\\m\\s.mp3', coverPath: 'D:\\m\\c.png', volume: 0.5 },
        videoOverlay: { enabled: true, customPath: 'C:\\w\\v.mp4', customName: 'v.mp4', opacity: 0.8 },
        weather: { type: 'rain' },
    };
}

test('fileKind 按扩展名分三类，不认识的是 null', () => {
    assert.equal(fileKind('C:\\a\\B.JPG'), 'image');
    assert.equal(fileKind('C:\\a\\b.gif'), 'image');
    assert.equal(fileKind('C:\\a\\b.m4v'), 'video');
    assert.equal(fileKind('C:\\a\\b.flac'), 'audio');
    assert.equal(fileKind('C:\\a\\b.txt'), null);
    assert.equal(fileKind('C:\\a\\noext'), null);
    assert.equal(fileKind(''), null);
});

test('collectPaths 收集所有字段并去重', () => {
    assert.deepEqual(collectPaths(fullConfig()).sort(),
        ['C:\\w\\a.jpg', 'C:\\w\\old.png', 'C:\\w\\v.mp4', 'D:\\m\\c.png', 'D:\\m\\s.mp3'].sort());
    assert.deepEqual(collectPaths({}), []);
    assert.deepEqual(collectPaths(undefined), []);
});

test('replacePaths 换掉每一处引用，包括 imageAtTime 和 vinyl.current', () => {
    const partial = replacePaths(fullConfig(), [
        { from: 'C:\\w\\a.jpg', to: 'E:\\x\\a2.jpg' },
        { from: 'C:\\w\\old.png', to: 'E:\\x\\old2.png' },
        { from: 'D:\\m\\s.mp3', to: 'E:\\m\\s.mp3' },
        { from: 'D:\\m\\c.png', to: 'E:\\m\\c2.png' },
    ]);
    assert.equal(partial.myWallpapers[0].path, 'E:\\x\\a2.jpg');
    assert.equal(partial.myWallpapers[0].thumb, 't1.png');
    assert.deepEqual(partial.myWallpapers[0].crop, { x: 0.1, y: 0, w: 0.8, h: 1 });
    assert.equal(partial.myWallpapers[1].path, 'C:\\w\\v.mp4');
    assert.equal(partial.myWallpapers[1].effect, 'pan');
    assert.equal(partial.currentImage, 'E:\\x\\a2.jpg');
    assert.deepEqual(partial.currentImageCrop, { path: 'E:\\x\\a2.jpg', x: 0.1, y: 0, w: 0.8, h: 1 });
    assert.equal(partial.currentVideo.imageAtTime, 'E:\\x\\old2.png');
    assert.equal(partial.currentVideo.path, 'C:\\w\\v.mp4');
    assert.equal(partial.currentVideo.effect, 'pan');
    assert.deepEqual(partial.vinyl.playlist, [{ path: 'E:\\m\\s.mp3', name: 's' }]);
    assert.equal(partial.vinyl.current, 'E:\\m\\s.mp3');
    assert.equal(partial.vinyl.coverPath, 'E:\\m\\c2.png');
    assert.equal(partial.vinyl.volume, 0.5);
    assert.ok(!('videoOverlay' in partial));
    assert.ok(!('weather' in partial));
});

test('replacePaths 同一个文件被壁纸和视频特效同时引用时两处都换', () => {
    const partial = replacePaths(fullConfig(), [{ from: 'C:\\w\\v.mp4', to: 'E:\\x\\v2.mp4' }]);
    assert.equal(partial.myWallpapers[1].path, 'E:\\x\\v2.mp4');
    assert.equal(partial.currentVideo.path, 'E:\\x\\v2.mp4');
    assert.equal(partial.videoOverlay.customPath, 'E:\\x\\v2.mp4');
    assert.equal(partial.videoOverlay.opacity, 0.8);
});

test('replacePaths 歌名和视频特效名等于旧文件名时跟着换，用户改过的不动', () => {
    const config = {
        vinyl: { playlist: [{ path: 'D:\\m\\s.mp3', name: 's' }, { path: 'D:\\m\\t.mp3', name: '我的歌' }], current: 'D:\\m\\t.mp3' },
        videoOverlay: { customPath: 'C:\\w\\v.mp4', customName: 'v.mp4' },
    };
    const partial = replacePaths(config, [
        { from: 'D:\\m\\s.mp3', to: 'D:\\m\\新名字.mp3' },
        { from: 'D:\\m\\t.mp3', to: 'D:\\n\\t2.mp3' },
        { from: 'C:\\w\\v.mp4', to: 'C:\\w\\v2.mp4' },
    ]);
    assert.deepEqual(partial.vinyl.playlist, [
        { path: 'D:\\m\\新名字.mp3', name: '新名字' },
        { path: 'D:\\n\\t2.mp3', name: '我的歌' },
    ]);
    assert.equal(partial.vinyl.current, 'D:\\n\\t2.mp3');
    assert.equal(partial.videoOverlay.customName, 'v2.mp4');
});

test('replacePaths 不分大小写和斜杠方向；没变的段不出现在结果里', () => {
    const partial = replacePaths({ currentImage: 'C:\\W\\A.JPG', vinyl: { playlist: [] } }, [{ from: 'c:/w/a.jpg', to: 'C:\\w\\b.jpg' }]);
    assert.deepEqual(partial, { currentImage: 'C:\\w\\b.jpg' });
});

test('replacePaths 配置里没有这些路径时返回 null', () => {
    assert.equal(replacePaths({ currentImage: 'C:\\a.jpg' }, [{ from: 'C:\\b.jpg', to: 'C:\\c.jpg' }]), null);
    assert.equal(replacePaths(fullConfig(), []), null);
});

test('relinkMoves 第一项是用户选的，同一个旧文件夹（含子文件夹）里同类型且存在的顺带接上', () => {
    const exists = (p) => ['E:\\new\\b.jpg', 'E:\\new\\sub\\c.mp4', 'E:\\new\\d.png'].includes(p);
    const moves = relinkMoves({
        from: 'C:\\old\\a.jpg', to: 'E:\\new\\a2.jpg',
        missing: ['C:\\old\\a.jpg', 'C:\\OLD\\b.jpg', 'C:\\old\\sub\\c.mp4', 'C:\\old\\d.jpg', 'C:\\other\\e.jpg', 'C:\\old\\f.jpg', 'C:\\older\\g.jpg'],
        exists,
    });
    assert.deepEqual(moves, [
        { from: 'C:\\old\\a.jpg', to: 'E:\\new\\a2.jpg' },
        { from: 'C:\\OLD\\b.jpg', to: 'E:\\new\\b.jpg' },
        { from: 'C:\\old\\sub\\c.mp4', to: 'E:\\new\\sub\\c.mp4' },
    ]);
});

test('relinkMoves 不认识类型的文件不顺带接上，别的类型（音频）照样接', () => {
    const moves = relinkMoves({
        from: 'C:\\old\\a.jpg', to: 'E:\\new\\a.jpg',
        missing: ['C:\\old\\x', 'C:\\old\\b.mp3'],
        exists: () => true,
    });
    assert.deepEqual(moves, [
        { from: 'C:\\old\\a.jpg', to: 'E:\\new\\a.jpg' },
        { from: 'C:\\old\\b.mp3', to: 'E:\\new\\b.mp3' },
    ]);
});
