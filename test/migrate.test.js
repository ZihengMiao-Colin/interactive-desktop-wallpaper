'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AppStore } = require('../src/store');
const { migrateLegacySticker } = require('../src/elements/migrate');

function setup(sticker) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-migrate-'));
    const image = path.join(dir, '贴纸.png');
    fs.writeFileSync(image, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const config = sticker === undefined ? {} : { sticker: typeof sticker === 'function' ? sticker(image) : sticker };
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
    const store = new AppStore({ userDataPath: dir });
    return { store, image };
}

const deps = { screenSize: { width: 1920, height: 1080 }, getImageAspect: () => 1 };

test('启用的旧贴纸迁移为图片素材和实例，并删除旧配置', () => {
    const { store, image } = setup((img) => ({
        enabled: true, imagePath: img, positionX: 85, positionY: 20, size: 192, opacity: 0.9, depth: 0.7,
    }));
    assert.equal(migrateLegacySticker({ store, ...deps }), true);

    const config = store.getConfig();
    assert.equal(config.sticker, undefined);
    const [asset] = config.customElements.library;
    assert.equal(asset.type, 'image');
    assert.equal(asset.name, '贴纸');
    assert.ok(fs.existsSync(asset.file));
    assert.notEqual(asset.file, image, '应当复制到素材库目录');

    const [instance] = config.customElements.instances;
    assert.equal(instance.assetId, asset.id);
    assert.ok(Math.abs(instance.transform.x - 0.9) < 1e-6);
    assert.ok(Math.abs(instance.transform.width - 0.1) < 1e-6);
    assert.equal(instance.depth, 0.7);
    assert.equal(instance.depthAuto, false);
    assert.equal(instance.opacity, 0.9);
});

test('未启用的旧贴纸只删除配置', () => {
    const { store } = setup((img) => ({ enabled: false, imagePath: img }));
    assert.equal(migrateLegacySticker({ store, ...deps }), false);
    const config = store.getConfig();
    assert.equal(config.sticker, undefined);
    assert.deepEqual(config.customElements, { library: [], instances: [] });
});

test('图片已不存在时不报错，只删除配置', () => {
    const { store } = setup({ enabled: true, imagePath: 'C:\\不存在\\a.png' });
    assert.equal(migrateLegacySticker({ store, ...deps }), false);
    assert.equal(store.getConfig().sticker, undefined);
});

test('没有旧贴纸配置时什么都不做', () => {
    const { store } = setup();
    assert.equal(migrateLegacySticker({ store, ...deps }), false);
    assert.deepEqual(store.getConfig().customElements.instances, []);
});
