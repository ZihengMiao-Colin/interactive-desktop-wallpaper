'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AppStore } = require('../src/store');
const { createFileTracking } = require('../src/file-tracking');
const { samePath } = require('../shared/my-wallpapers');

const DEPTH_URL = 'data:image/png;base64,' + Buffer.from('depth-bytes').toString('base64');

/** 临时数据目录 + 用户文件目录 + 记录各种调用的桩 */
function setup({ config = {}, pick = null } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-tracking-'));
    const userData = path.join(dir, 'userData');
    const files = path.join(dir, 'files');
    fs.mkdirSync(userData);
    fs.mkdirSync(files);
    const store = new AppStore({ userDataPath: userData });
    store.saveConfig(config);
    const calls = [];
    const tracking = createFileTracking({
        store,
        dataFile: path.join(userData, 'file_ids.json'),
        shouldTrack: () => true,
        sendToWindows: (channel, payload) => calls.push(['send', channel, payload]),
        broadcastConfig: () => calls.push(['broadcast']),
        applyWallpaper: (descriptor) => calls.push(['apply', descriptor]),
        showRelinkDialog: async (args) => {
            calls.push(['dialog', args]);
            return typeof pick === 'function' ? pick(args) : pick;
        },
        log: () => {},
    });
    const make = (rel, content = 'data') => {
        const p = path.join(files, rel);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, content);
        return p;
    };
    return { dir, files, store, tracking, calls, make };
}

test('scan：当前图片壁纸改名后，配置里所有引用、深度图缓存都换成新路径，窗口收到 files:relocated', async () => {
    const ctx = setup();
    const a = ctx.make('a.jpg');
    ctx.store.saveConfig({
        currentImage: a,
        currentImageCrop: { path: a, x: 0.1, y: 0, w: 0.8, h: 1 },
        myWallpapers: [{ path: a, type: 'image', addedAt: 1, lastUsedAt: 1, crop: { x: 0.1, y: 0, w: 0.8, h: 1 } }],
    });
    ctx.store.saveDepthCache(a, DEPTH_URL);
    await ctx.tracking.scan();

    const b = path.join(ctx.files, 'b.jpg');
    fs.renameSync(a, b);
    await ctx.tracking.scan();

    const config = ctx.store.getConfig();
    assert.ok(samePath(config.currentImage, b));
    assert.ok(samePath(config.currentImageCrop.path, b));
    assert.ok(samePath(config.myWallpapers[0].path, b));
    assert.deepEqual(config.myWallpapers[0].crop, { x: 0.1, y: 0, w: 0.8, h: 1 });
    assert.equal(ctx.store.hasDepthCache(config.currentImage), true);

    const sendIndex = ctx.calls.findIndex((c) => c[0] === 'send' && c[1] === 'files:relocated');
    assert.ok(sendIndex >= 0);
    assert.equal(ctx.calls[sendIndex][2].length, 1);
    assert.equal(ctx.calls[sendIndex][2][0].from, a);
    assert.ok(samePath(ctx.calls[sendIndex][2][0].to, b));
    assert.deepEqual(ctx.calls[sendIndex + 1], ['broadcast']);
});

test('scan：配置里已经没有的路径（扫描期间被移除）不改配置', () => {
    const ctx = setup({ config: { currentImage: 'C:\\x\\keep.jpg' } });
    const before = JSON.stringify(ctx.store.getConfig());
    ctx.tracking.applyMoves([{ from: 'C:\\x\\gone.jpg', to: 'C:\\x\\new.jpg' }]);
    assert.equal(JSON.stringify(ctx.store.getConfig()), before);
    assert.deepEqual(ctx.calls, []);
});

test('两次 scan 同时调用只跑一遍', async () => {
    const ctx = setup();
    const first = ctx.tracking.scan();
    const second = ctx.tracking.scan();
    assert.equal(first, second);
    await first;
});

test('relink：选了新文件夹里的文件，同一个旧文件夹里其它找不到的顺带接上，返回总数', async () => {
    let picked = null;
    const ctx = setup({ pick: () => picked });
    const oldDir = path.join(ctx.files, 'old');
    picked = ctx.make('new\\a2.jpg');
    const b = ctx.make('new\\b.mp4');
    ctx.store.saveConfig({
        myWallpapers: [
            { path: path.join(oldDir, 'a.jpg'), type: 'image', addedAt: 3, lastUsedAt: 3 },
            { path: path.join(oldDir, 'b.mp4'), type: 'video', addedAt: 2, lastUsedAt: 2 },
            { path: path.join(oldDir, 'c.jpg'), type: 'image', addedAt: 1, lastUsedAt: 1 },
        ],
    });

    const result = await ctx.tracking.relink(path.join(oldDir, 'a.jpg'));
    assert.deepEqual(result, { to: picked, count: 2 });
    const list = ctx.store.getConfig().myWallpapers;
    assert.equal(list[0].path, picked);
    assert.equal(list[1].path, b);
    assert.equal(list[2].path, path.join(oldDir, 'c.jpg'));
    const dialog = ctx.calls.find((c) => c[0] === 'dialog')[1];
    assert.equal(dialog.fromPath, path.join(oldDir, 'a.jpg'));
    assert.equal(dialog.kind, 'image');
    assert.equal(ctx.calls.filter((c) => c[0] === 'apply').length, 0);
});

test('relink：选的文件已经是「我的壁纸」里的另一格时不接', async () => {
    let picked = null;
    const ctx = setup({ pick: () => picked });
    const other = ctx.make('other.jpg');
    picked = other.toUpperCase();
    const gone = path.join(ctx.files, 'gone.jpg');
    ctx.store.saveConfig({
        myWallpapers: [
            { path: gone, type: 'image', addedAt: 2, lastUsedAt: 2 },
            { path: other, type: 'image', addedAt: 1, lastUsedAt: 1 },
        ],
    });
    assert.deepEqual(await ctx.tracking.relink(gone), { error: '这个文件已经在「我的壁纸」里了' });
    assert.equal(ctx.store.getConfig().myWallpapers[0].path, gone);
});

test('relink：选了不同类型的文件时不接', async () => {
    let picked = null;
    const ctx = setup({ pick: () => picked });
    picked = ctx.make('song.mp3');
    const gone = path.join(ctx.files, 'gone.jpg');
    ctx.store.saveConfig({ currentImage: gone });
    assert.deepEqual(await ctx.tracking.relink(gone), { error: '要选同一种文件' });
    assert.equal(ctx.store.getConfig().currentImage, gone);
});

test('relink：接上的是当前壁纸就重新应用', async () => {
    let picked = null;
    const ctx = setup({ pick: () => picked });
    const gone = path.join(ctx.files, 'gone.jpg');
    picked = ctx.make('found.jpg');
    ctx.store.saveConfig({ currentImage: gone, myWallpapers: [{ path: gone, type: 'image', addedAt: 1, lastUsedAt: 1 }] });
    await ctx.tracking.relink(gone);
    const applied = ctx.calls.filter((c) => c[0] === 'apply').map((c) => c[1]);
    assert.equal(applied.length, 1);
    assert.equal(applied[0].type, 'image');
    assert.equal(applied[0].path, picked);
});

test('relink：取消对话框返回 { canceled: true }，什么都不改', async () => {
    const ctx = setup({ pick: null, config: { currentImage: 'C:\\nowhere\\a.jpg' } });
    const before = JSON.stringify(ctx.store.getConfig());
    assert.deepEqual(await ctx.tracking.relink('C:\\nowhere\\a.jpg'), { canceled: true });
    assert.equal(JSON.stringify(ctx.store.getConfig()), before);
});

test('locate：文件还在就返回原路径；挪走了找回来并换掉配置；找不到返回 null', async () => {
    const ctx = setup();
    const song = ctx.make('song.mp3');
    ctx.store.saveConfig({ vinyl: { playlist: [{ path: song, name: 'song' }], current: song } });
    await ctx.tracking.scan();
    assert.equal(await ctx.tracking.locate(song), song);

    const moved = path.join(ctx.files, '新歌.mp3');
    fs.renameSync(song, moved);
    const found = await ctx.tracking.locate(song);
    assert.ok(samePath(found, moved));
    const vinyl = ctx.store.getConfig().vinyl;
    assert.ok(samePath(vinyl.current, moved));
    assert.equal(vinyl.playlist[0].name, '新歌');

    assert.equal(await ctx.tracking.locate(path.join(ctx.files, 'never.mp3')), null);
});

test('relink：壁纸图片选了 gif 时不接（「我的壁纸」不支持 gif）', async () => {
    let picked = null;
    const ctx = setup({ pick: () => picked });
    picked = ctx.make('anim.gif');
    const gone = path.join(ctx.files, 'gone.jpg');
    ctx.store.saveConfig({ myWallpapers: [{ path: gone, type: 'image', addedAt: 1, lastUsedAt: 1 }] });
    assert.deepEqual(await ctx.tracking.relink(gone), { error: '要选同一种文件' });
    assert.equal(ctx.store.getConfig().myWallpapers.length, 1);
});

test('scan 结束后通知窗口 files:checked（设置页据此刷新"找不到文件"），找回了文件时在 files:relocated 之后', async () => {
    const ctx = setup();
    const a = ctx.make('a.jpg');
    ctx.store.saveConfig({ currentImage: a });
    await ctx.tracking.scan();
    assert.deepEqual(ctx.calls.filter((c) => c[0] === 'send').map((c) => c[1]), ['files:checked']);

    ctx.calls.length = 0;
    fs.renameSync(a, path.join(ctx.files, 'b.jpg'));
    await ctx.tracking.scan();
    assert.deepEqual(ctx.calls.filter((c) => c[0] === 'send').map((c) => c[1]), ['files:relocated', 'files:checked']);
});
