'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findDepthModel } = require('../src/depth/generator');

test('findDepthModel 取最大的 small 模型，忽略别的档位和别的文件', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-model-'));
    fs.writeFileSync(path.join(dir, 'depth_anything_v2_small.onnx'), Buffer.alloc(20));
    fs.writeFileSync(path.join(dir, 'depth_anything_v2_small_ir9.onnx'), Buffer.alloc(100));
    fs.writeFileSync(path.join(dir, 'depth_anything_v2_small_int8.onnx'), Buffer.alloc(50));
    fs.writeFileSync(path.join(dir, 'depth_anything_v2_base.onnx'), Buffer.alloc(500));
    fs.writeFileSync(path.join(dir, 'notes.txt'), Buffer.alloc(900));
    assert.equal(findDepthModel(dir), path.join(dir, 'depth_anything_v2_small_ir9.onnx'));
});

test('findDepthModel 没有模型或目录不存在时返回 null', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-model-'));
    assert.equal(findDepthModel(dir), null);
    assert.equal(findDepthModel(path.join(dir, 'missing')), null);
});
