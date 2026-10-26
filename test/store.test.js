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
