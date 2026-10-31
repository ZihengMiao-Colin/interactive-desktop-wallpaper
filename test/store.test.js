'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AppStore, UNINSTALL_LIST_FILE } = require('../src/store');

function storeWithConfig(config) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-store-'));
    if (config !== undefined) fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
    return { store: new AppStore({ userDataPath: dir }), dir };
}

test('没有 customElements 的旧配置读出空结构', () => {
    const { store } = storeWithConfig({ parallaxMultiplier: 30 });
    const config = store.getConfig();
    assert.deepEqual(config.customElements, { library: [], instances: [] });
    assert.equal(config.parallaxMultiplier, 30);
});

test('旧配置的视差强度超过 30 时读出 30', () => {
    const { store } = storeWithConfig({ parallaxMultiplier: 80 });
    assert.equal(store.getConfig().parallaxMultiplier, 30);
});

test('新用户的边缘平滑默认 5', () => {
    const { store } = storeWithConfig();
    assert.equal(store.getConfig().blurRadius, 5);
});

test('旧配置里还是旧默认值 8 的边缘平滑读成 5，保存后带上标记写回磁盘', () => {
    const { store, dir } = storeWithConfig({ blurRadius: 8 });
    assert.equal(store.getConfig().blurRadius, 5);
    store.saveConfig({ focusDepth: 0.4 });
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
    assert.equal(onDisk.blurRadius, 5);
    assert.equal(onDisk.blurRadiusVersion, 2);
});

test('旧配置里自己调过的边缘平滑不变', () => {
    const { store } = storeWithConfig({ blurRadius: 12 });
    assert.equal(store.getConfig().blurRadius, 12);
});

test('迁移过之后再调回 8 不会又被改成 5', () => {
    const { store } = storeWithConfig({ blurRadius: 5, blurRadiusVersion: 2 });
    store.saveConfig({ blurRadius: 8 });
    assert.equal(store.getConfig().blurRadius, 8);
});

test('旧配置的单首歌读成一首歌的歌单，保存后写回磁盘的是歌单', () => {
    const { store, dir } = storeWithConfig({ vinyl: { enabled: true, audioPath: 'C:/m/a.mp3', audioName: 'a.mp3', loop: true } });
    const vinyl = store.getConfig().vinyl;
    assert.deepEqual(vinyl.playlist, [{ path: 'C:/m/a.mp3', name: 'a' }]);
    assert.equal(vinyl.current, 'C:/m/a.mp3');
    assert.equal(vinyl.playMode, 'list');
    assert.equal(vinyl.volume, 0.6);
    store.saveConfig({ vinyl: { playing: true } });
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')).vinyl;
    assert.equal(onDisk.playing, true);
    assert.equal(onDisk.audioPath, undefined);
    assert.equal(onDisk.playlist.length, 1);
});

test('新用户没有歌单：空歌单、列表循环', () => {
    const { vinyl } = storeWithConfig().store.getConfig();
    assert.deepEqual([vinyl.playlist, vinyl.current, vinyl.playMode], [[], '', 'list']);
});

test('instances 不是数组时回退为空数组', () => {
    const { store } = storeWithConfig({ customElements: { library: [], instances: 'oops' } });
    assert.deepEqual(store.getConfig().customElements.instances, []);
});

test('saveConfig 整体替换 instances，并保留 library', () => {
    const { store, dir } = storeWithConfig();
    store.saveConfig({ customElements: { library: [{ id: 'user:a' }], instances: [{ id: 'i1' }, { id: 'i2' }] } });
    store.saveConfig({ customElements: { instances: [{ id: 'i3' }] } });
    const ce = store.getConfig().customElements;
    assert.deepEqual(ce.instances.map((i) => i.id), ['i3']);
    assert.deepEqual(ce.library.map((a) => a.id), ['user:a']);
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
    assert.deepEqual(onDisk.customElements.instances, [{ id: 'i3' }]);
});

test('deleteConfigKeys 删除 sticker 后读不到', () => {
    const { store } = storeWithConfig({ sticker: { enabled: true, imagePath: 'a.png' } });
    assert.equal(store.getConfig().sticker.enabled, true);
    store.deleteConfigKeys(['sticker']);
    assert.equal(store.getConfig().sticker, undefined);
});

test('getElementsDir 在 userData 下并自动创建', () => {
    const { store, dir } = storeWithConfig();
    const elementsDir = store.getElementsDir();
    assert.equal(elementsDir, path.join(dir, 'custom_elements'));
    assert.ok(fs.existsSync(elementsDir));
});

// ==================== 深度图缓存校验 ====================

const DEPTH_URL = 'data:image/png;base64,' + Buffer.from('depth-bytes').toString('base64');

function storeWithImage() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-depth-'));
    const image = path.join(dir, '壁纸 #1.png');
    fs.writeFileSync(image, 'AAAA');
    return { store: new AppStore({ userDataPath: dir }), image, dir };
}

/** 把原图换成同样大小的内容，并把修改时间往后挪 */
function replaceSameSize(image) {
    fs.writeFileSync(image, 'BBBB');
    const later = new Date(Date.now() + 60 * 1000);
    fs.utimesSync(image, later, later);
}

test('深度缓存：原图没变时命中', () => {
    const { store, image } = storeWithImage();
    assert.equal(store.saveDepthCache(image, DEPTH_URL), true);
    assert.equal(store.hasDepthCache(image), true);
    assert.equal(store.getDepthCache(image), DEPTH_URL);
});

test('深度缓存：原图换成同样大小的另一张图后失效', () => {
    const { store, image } = storeWithImage();
    store.saveDepthCache(image, DEPTH_URL);
    replaceSameSize(image);
    assert.equal(store.hasDepthCache(image), false);
    assert.equal(store.getDepthCache(image), null);
});

test('深度缓存：旧版索引没有记录修改时间时只按大小判断', () => {
    const { store, image, dir } = storeWithImage();
    store.saveDepthCache(image, DEPTH_URL);
    const indexPath = path.join(dir, 'cache_index.json');
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    for (const entry of Object.values(index)) delete entry.imageMtimeMs;
    fs.writeFileSync(indexPath, JSON.stringify(index));

    const reopened = new AppStore({ userDataPath: dir });
    assert.equal(reopened.getDepthCache(image), DEPTH_URL);
});

test('深度缓存：原图被删除时不命中', () => {
    const { store, image } = storeWithImage();
    store.saveDepthCache(image, DEPTH_URL);
    fs.unlinkSync(image);
    assert.equal(store.hasDepthCache(image), false);
    assert.equal(store.getDepthCache(image), null);
});

// ==================== 卸载用的深度图清单 ====================

/** 读卸载清单（UTF-16LE 带 BOM、CRLF 分行），没有清单返回 null */
function readUninstallList(dir) {
    const file = path.join(dir, UNINSTALL_LIST_FILE);
    if (!fs.existsSync(file)) return null;
    const buf = fs.readFileSync(file);
    assert.deepEqual([...buf.subarray(0, 2)], [0xff, 0xfe], '清单要以 UTF-16LE 的 BOM 开头');
    return buf.subarray(2).toString('utf16le').split('\r\n').filter(Boolean);
}

/** 深度图放到 userData 以外的文件夹（路径带中文和空格） */
function storeWithExternalDepthDir() {
    const ctx = storeWithImage();
    const externalDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wp-ext-')), '我的 深度图');
    ctx.store.setDepthCacheDir(externalDir);
    return { ...ctx, externalDir };
}

test('卸载清单：深度图在默认位置时不写清单', () => {
    const { store, image, dir } = storeWithImage();
    store.saveDepthCache(image, DEPTH_URL);
    assert.equal(readUninstallList(dir), null);
});

test('卸载清单：深度图换到别的文件夹后，清单里是那里的每一张深度图', () => {
    const { store, image, dir, externalDir } = storeWithExternalDepthDir();
    store.saveDepthCache(image, DEPTH_URL);
    const list = readUninstallList(dir);
    assert.equal(list.length, 1);
    assert.equal(path.dirname(list[0]), externalDir);
    assert.ok(fs.existsSync(list[0]));
    // 卸载脚本只删 depth_*.png（build/installer.nsh）
    assert.match(path.basename(list[0]), /^depth_[0-9a-f]+\.png$/);
});

test('卸载清单：先生成深度图再换位置，清单里是搬过去之后的路径', () => {
    const { store, image, dir } = storeWithImage();
    store.saveDepthCache(image, DEPTH_URL);
    const externalDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wp-ext-')), 'depth');
    store.setDepthCacheDir(externalDir);
    const list = readUninstallList(dir);
    assert.equal(list.length, 1);
    assert.equal(path.dirname(list[0]), externalDir);
});

test('卸载清单：原图改过、缓存失效后从清单里去掉', () => {
    const { store, image, dir } = storeWithExternalDepthDir();
    store.saveDepthCache(image, DEPTH_URL);
    replaceSameSize(image);
    store.hasDepthCache(image);
    assert.equal(readUninstallList(dir), null);
});

test('卸载清单：清除缓存后清单也删掉', () => {
    const { store, image, dir } = storeWithExternalDepthDir();
    store.saveDepthCache(image, DEPTH_URL);
    store.clearAllCache();
    assert.equal(readUninstallList(dir), null);
});

test('卸载清单：旧版本没有清单，打开软件时补上', () => {
    const { store, image, dir } = storeWithExternalDepthDir();
    store.saveDepthCache(image, DEPTH_URL);
    fs.unlinkSync(path.join(dir, UNINSTALL_LIST_FILE));
    new AppStore({ userDataPath: dir });
    assert.equal(readUninstallList(dir).length, 1);
});

// ==================== 深度图文件夹里有用户自己的文件 ====================

/** 深度图放在一个本来就有用户文件的文件夹里（比如"图片"） */
function storeWithSharedDepthDir() {
    const ctx = storeWithImage();
    const shared = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-shared-'));
    fs.writeFileSync(path.join(shared, '旅行照片.png'), 'PNG');
    fs.writeFileSync(path.join(shared, 'notes.txt'), 'text');
    fs.mkdirSync(path.join(shared, '子文件夹'));
    ctx.store.setDepthCacheDir(shared);
    ctx.store.saveDepthCache(ctx.image, DEPTH_URL);
    return { ...ctx, shared };
}

test('清除缓存只删深度图：同一文件夹里用户自己的图片、文件和子文件夹都留着', () => {
    const { store, image, shared } = storeWithSharedDepthDir();
    store.clearAllCache();
    assert.deepEqual(fs.readdirSync(shared).sort(), ['notes.txt', '子文件夹', '旅行照片.png'].sort());
    assert.equal(store.getDepthCache(image), null);
});

test('清除缓存也删掉索引里没有的旧深度图（depth_*.png）', () => {
    const { store, shared } = storeWithSharedDepthDir();
    fs.writeFileSync(path.join(shared, 'depth_abc123.png'), 'old');
    store.clearAllCache();
    assert.equal(fs.readdirSync(shared).filter(f => f.startsWith('depth_')).length, 0);
});

test('更改位置只搬深度图：用户自己的图片留在原来的文件夹', () => {
    const { store, shared } = storeWithSharedDepthDir();
    const next = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-next-'));
    const res = store.setDepthCacheDir(next);
    assert.equal(res.movedCount, 1);
    assert.deepEqual(fs.readdirSync(shared).sort(), ['notes.txt', '子文件夹', '旅行照片.png'].sort());
    assert.deepEqual(fs.readdirSync(next).map(f => /^depth_[0-9a-f]+\.png$/.test(f)), [true]);
});
