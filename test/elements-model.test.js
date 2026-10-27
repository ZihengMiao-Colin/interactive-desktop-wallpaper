'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../shared/elements-model');

const imageAsset = { id: 'user:img', name: '猫', type: 'image', file: 'a.png', thumb: null, builtin: false };
const gifAsset = { id: 'user:gif', name: 'gif', type: 'animated', file: 'a.gif', thumb: null, builtin: false };
const videoAsset = { id: 'user:vid', name: 'vid', type: 'video', file: 'a.mp4', thumb: null, builtin: false };
const bombAsset = {
    id: 'builtin:bomb1', name: '爆炸 1', type: 'video', file: 'bomb1_cut.mp4', thumb: null, builtin: true,
    defaults: {
        width: 0.2,
        playback: { mode: 'interval', intervalSec: 10, jitterSec: 3 },
        chroma: { enabled: true, strength: 0.5 },
    },
};

const inst = (id, assetId, depth) => ({ ...M.createInstance({ ...imageAsset, id: assetId }, id), depth });

test('图片默认静止，动图和用户视频默认循环，用户视频不抠像', () => {
    assert.equal(M.defaultPlayback(imageAsset).mode, 'static');
    assert.equal(M.defaultPlayback(gifAsset).mode, 'loop');
    assert.equal(M.defaultPlayback(videoAsset).mode, 'loop');
    assert.equal(M.createInstance(videoAsset, 'i1').chroma.enabled, false);
});

test('默认素材的播放配置优先', () => {
    assert.deepEqual(M.defaultPlayback(bombAsset), { mode: 'interval', intervalSec: 10, jitterSec: 3 });
    assert.equal(M.createInstance(bombAsset, 'i1').chroma.enabled, true);
});

test('createInstance 默认值', () => {
    const i = M.createInstance(imageAsset, 'i1');
    assert.deepEqual(i.transform, {
        x: 0.5, y: 0.5, width: 0.25, rotation: 0, stretch: 1, flipX: false, flipY: false, warp: null,
    });
    assert.equal(i.id, 'i1');
    assert.equal(i.assetId, 'user:img');
    assert.equal(i.opacity, 1);
    assert.equal(i.depthAuto, true);
    assert.equal(i.visible, true);
    assert.deepEqual(i.effects, M.DEFAULT_EFFECTS);
});

test('transformOf / effectsOf 给旧实例补齐新字段', () => {
    const old = { transform: { x: 0.2, y: 0.3, width: 0.1, rotation: 0 }, effects: {} };
    assert.deepEqual(M.transformOf(old), {
        x: 0.2, y: 0.3, width: 0.1, rotation: 0, stretch: 1, flipX: false, flipY: false, warp: null,
    });
    assert.deepEqual(M.effectsOf(old), M.DEFAULT_EFFECTS);
    assert.deepEqual(M.effectsOf({}), M.DEFAULT_EFFECTS);
    assert.equal(M.effectsOf({ effects: { hue: 40 } }).hue, 40);
});

test('normalizeRotation 落在 (-180, 180]', () => {
    assert.equal(M.normalizeRotation(45), 45);
    assert.equal(M.normalizeRotation(190), -170);
    assert.equal(M.normalizeRotation(-180), 180);
    assert.equal(M.normalizeRotation(540), 180);
    assert.equal(M.normalizeRotation(-725), -5);
});

test('colorUniforms：色相换成圈数，染色颜色解析成 0~1', () => {
    const u = M.colorUniforms({ ...M.DEFAULT_EFFECTS, hue: 90, saturation: 1.5, brightness: 0.8, tint: '#ff8000', tintAmount: 0.4 });
    assert.equal(u.hue, 0.25);
    assert.equal(u.saturation, 1.5);
    assert.equal(u.brightness, 0.8);
    assert.deepEqual(u.tint, [1, 128 / 255, 0]);
    assert.equal(u.tintAmount, 0.4);
    assert.deepEqual(M.colorUniforms({ tint: 'oops' }).tint, [1, 1, 1], '颜色写错时按白色处理');
    assert.equal(M.colorUniforms({}).saturation, 1, '缺字段用默认值');
});

test('patchInstance 夹紧拉伸、规整旋转角，effects 只合并给出的字段', () => {
    const ce = { library: [], instances: [M.createInstance(imageAsset, 'i1')] };
    const i = M.patchInstance(ce, 'i1', { transform: { stretch: 99, rotation: 270 }, effects: { hue: 30 } }).instances[0];
    assert.equal(i.transform.stretch, M.LIMITS.maxStretch);
    assert.equal(i.transform.rotation, -90);
    assert.equal(i.effects.hue, 30);
    assert.equal(i.effects.saturation, 1);
});

test('createInstance 使用素材自带默认宽度', () => {
    assert.equal(M.createInstance(bombAsset, 'i1').transform.width, 0.2);
});

test('clampWidth 夹到 0.03~1.5', () => {
    assert.equal(M.clampWidth(0.001), 0.03);
    assert.equal(M.clampWidth(9), 1.5);
    assert.equal(M.clampWidth(0.4), 0.4);
});

test('sortForRender 远的在前、同深度保持顺序且不改原数组', () => {
    const list = [inst('a', 'x', 0.8), inst('b', 'x', 0.2), inst('c', 'x', 0.8), inst('d', 'x', 0.5)];
    const sorted = M.sortForRender(list);
    assert.deepEqual(sorted.map((i) => i.id), ['b', 'd', 'a', 'c']);
    assert.deepEqual(list.map((i) => i.id), ['a', 'b', 'c', 'd']);
});

test('resolveInstances 找不到素材的进 broken', () => {
    const assets = new Map([['user:img', imageAsset]]);
    const r = M.resolveInstances([inst('i1', 'user:img', 0.5), inst('i2', 'user:gone', 0.5)], assets);
    assert.deepEqual(r.ok.map((x) => x.instance.id), ['i1']);
    assert.equal(r.ok[0].asset, imageAsset);
    assert.deepEqual(r.broken, ['i2']);
});

test('patchInstance 改深度后 depthAuto=false，宽度被夹紧，chroma 只合并给出的字段', () => {
    const ce = { library: [], instances: [M.createInstance(bombAsset, 'i1')] };
    const next = M.patchInstance(ce, 'i1', { depth: 0.9, transform: { width: 5 }, chroma: { strength: 0.8 } });
    const i = next.instances[0];
    assert.equal(i.depth, 0.9);
    assert.equal(i.depthAuto, false);
    assert.equal(i.transform.width, 1.5);
    assert.equal(i.transform.x, 0.5);
    assert.deepEqual(i.chroma, { enabled: true, strength: 0.8 });
    assert.equal(ce.instances[0].depth, 0.5, '不修改入参');
});

test('upsertInstance 新增与替换，removeInstance 删除', () => {
    let ce = M.emptyCustomElements();
    ce = M.upsertInstance(ce, inst('i1', 'x', 0.1));
    ce = M.upsertInstance(ce, inst('i2', 'x', 0.2));
    ce = M.upsertInstance(ce, inst('i1', 'x', 0.9));
    assert.deepEqual(ce.instances.map((i) => [i.id, i.depth]), [['i1', 0.9], ['i2', 0.2]]);
    ce = M.removeInstance(ce, 'i1');
    assert.deepEqual(ce.instances.map((i) => i.id), ['i2']);
});

test('removeAsset 级联删除实例', () => {
    const ce = {
        library: [imageAsset, videoAsset],
        instances: [inst('i1', 'user:img', 0), inst('i2', 'user:vid', 0), inst('i3', 'user:img', 0)],
    };
    const r = M.removeAsset(ce, 'user:img');
    assert.deepEqual(r.removedInstanceIds, ['i1', 'i3']);
    assert.deepEqual(r.ce.library.map((a) => a.id), ['user:vid']);
    assert.deepEqual(r.ce.instances.map((i) => i.id), ['i2']);
});

test('normalizeCustomElements 处理 null / instances 不是数组', () => {
    assert.deepEqual(M.normalizeCustomElements(null), { library: [], instances: [] });
    assert.deepEqual(M.normalizeCustomElements({ library: [imageAsset], instances: 'oops' }), { library: [imageAsset], instances: [] });
});

test('assetFromManifestEntry 映射默认素材', () => {
    const a = M.assetFromManifestEntry({
        id: 'bomb1', name: '爆炸 1', type: 'video', file: 'bomb1_cut.mp4', thumb: 'bomb1_thumb.jpg', aspect: 1.5, width: 0.25,
        playback: { mode: 'interval', intervalSec: 10, jitterSec: 3 }, chroma: { enabled: true, strength: 0.5 },
    }, (f) => 'elements/' + f);
    assert.deepEqual(a, {
        id: 'builtin:bomb1', name: '爆炸 1', type: 'video', file: 'elements/bomb1_cut.mp4', thumb: 'elements/bomb1_thumb.jpg',
        builtin: true, aspect: 1.5,
        defaults: { width: 0.25, playback: { mode: 'interval', intervalSec: 10, jitterSec: 3 }, chroma: { enabled: true, strength: 0.5 } },
    });
});

test('legacyStickerToInstance 换算', () => {
    const r = M.legacyStickerToInstance(
        { enabled: true, imagePath: 'a.png', positionX: 85, positionY: 20, size: 192, opacity: 0.9, depth: 0.7 }, 1920, 1080, 1);
    assert.ok(Math.abs(r.x - 0.9) < 1e-6);
    assert.ok(Math.abs(r.y - (0.2 + 192 / 1080 / 2)) < 1e-6);
    assert.ok(Math.abs(r.width - 0.1) < 1e-6);
    assert.equal(r.depth, 0.7);
    assert.equal(r.opacity, 0.9);
});

test('legacyStickerToInstance 未启用或没有图片返回 null', () => {
    assert.equal(M.legacyStickerToInstance({ enabled: false, imagePath: 'a.png' }, 1920, 1080, 1), null);
    assert.equal(M.legacyStickerToInstance({ enabled: true, imagePath: '' }, 1920, 1080, 1), null);
    assert.equal(M.legacyStickerToInstance(undefined, 1920, 1080, 1), null);
});

test('hasClickTriggers：有显示中的点击播放元素才需要检测桌面点击', () => {
    const click = { ...M.createInstance(videoAsset, 'c1'), playback: { mode: 'click', intervalSec: 10, jitterSec: 3 } };
    const loop = M.createInstance(videoAsset, 'l1');
    assert.equal(M.hasClickTriggers({ library: [], instances: [loop] }), false);
    assert.equal(M.hasClickTriggers({ library: [], instances: [loop, click] }), true);
    assert.equal(M.hasClickTriggers({ library: [], instances: [{ ...click, visible: false }] }), false);
    assert.equal(M.hasClickTriggers(null), false);
});
