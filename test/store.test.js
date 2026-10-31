'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AppStore } = require('../src/store');

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
