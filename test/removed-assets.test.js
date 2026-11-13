'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanupRemovedBuiltins } = require('../src/removed-assets');

const inst = (id, assetId) => ({ id, assetId, visible: true });

test('cleanupRemovedBuiltins：用的是删掉的视频特效、没导入过自己的视频时，换成 custom 并关掉', () => {
    const patch = cleanupRemovedBuiltins({ videoOverlay: { enabled: true, presetId: 'snow2', customPath: '' } });
    assert.deepEqual(patch, { videoOverlay: { presetId: 'custom', enabled: false } });
});

test('cleanupRemovedBuiltins：导入过自己的视频时换成它，开关状态不变', () => {
    const patch = cleanupRemovedBuiltins({ videoOverlay: { enabled: true, presetId: 'rain1', customPath: 'D:\\v\\my.mp4' } });
    assert.deepEqual(patch, { videoOverlay: { presetId: 'custom' } });
});

test('cleanupRemovedBuiltins：去掉壁纸上用删掉的爆炸素材摆的元素，其他元素保留', () => {
    const config = {
        videoOverlay: { presetId: 'custom' },
        customElements: {
            library: [{ id: 'user:a' }],
            instances: [inst('1', 'builtin:bomb1'), inst('2', 'user:a'), inst('3', 'builtin:bomb2')],
        },
    };
    const patch = cleanupRemovedBuiltins(config);
    assert.deepEqual(patch, { customElements: { instances: [inst('2', 'user:a')] } });
});

test('cleanupRemovedBuiltins：没有引用删掉的素材时返回 null', () => {
    assert.equal(cleanupRemovedBuiltins({
        videoOverlay: { enabled: true, presetId: 'custom', customPath: 'D:\\v\\my.mp4' },
        customElements: { library: [], instances: [inst('2', 'user:a')] },
    }), null);
    assert.equal(cleanupRemovedBuiltins({}), null);
});
