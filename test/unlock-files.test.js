'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DEFAULTS } = require('../shared/unlock-animation');
const { importVideo, removeFiles, cleanupUnlockFiles, resolvePlayback } = require('../src/unlock-animation/files');

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'wp-unlock-'));
}

function writeFile(dir, name) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, 'x');
    return file;
}

/** 有一段导入好的视频：video_abc.mp4，6 秒，功能开着 */
function setup() {
    const dir = tempDir();
    const cfg = { ...DEFAULTS, enabled: true, file: 'video_abc.mp4', duration: 6 };
    writeFile(dir, cfg.file);
    return { dir, cfg };
}

test('importVideo 用 ASCII 文件名，中文和特殊字符的原文件也能导入', async () => {
    const dir = tempDir();
    const src = writeFile(tempDir(), '我的 #1.MP4');
    assert.equal(await importVideo(src, dir, 'video_abc'), 'video_abc.mp4');
    assert.ok(fs.existsSync(path.join(dir, 'video_abc.mp4')));
});

test('importVideo 拒绝不支持的扩展名', async () => {
    const dir = tempDir();
    await assert.rejects(importVideo(writeFile(tempDir(), 'a.txt'), dir, 'x'), /UNSUPPORTED_FILE/);
    assert.deepEqual(fs.readdirSync(dir), []);
});

test('resolvePlayback 返回文件路径、声音和换算成毫秒的时长', () => {
    const { dir, cfg } = setup();
    assert.deepEqual(resolvePlayback({ ...cfg, sound: true }, dir), {
        filePath: path.join(dir, 'video_abc.mp4'),
        sound: true,
        fadeInMs: 500,
        fadeOutMs: 700,
        durationMs: 6000,
    });
});

test('resolvePlayback：关着或没有文件时返回 null', () => {
    const { dir, cfg } = setup();
    assert.equal(resolvePlayback({ ...cfg, enabled: false }, dir), null);
    assert.equal(resolvePlayback({ ...cfg, file: '' }, dir), null);
});

test('resolvePlayback：文件被删了返回 null', () => {
    const { dir, cfg } = setup();
    fs.unlinkSync(path.join(dir, cfg.file));
    assert.equal(resolvePlayback(cfg, dir), null);
});

test('resolvePlayback：预览不看开关', () => {
    const { dir, cfg } = setup();
    assert.ok(resolvePlayback({ ...cfg, enabled: false }, dir, { preview: true }));
});

test('resolvePlayback：预览也要有文件', () => {
    const { dir, cfg } = setup();
    assert.equal(resolvePlayback({ ...cfg, file: '' }, dir, { preview: true }), null);
});

test('resolvePlayback：短视频的淡入淡出按比例缩短', () => {
    const { dir, cfg } = setup();
    const p = resolvePlayback({ ...cfg, duration: 0.6 }, dir);
    assert.deepEqual([p.fadeInMs, p.fadeOutMs, p.durationMs], [250, 350, 600]);
});

test('cleanupUnlockFiles 只留配置引用的文件', () => {
    const { dir, cfg } = setup();
    writeFile(dir, 'old.mp4');
    writeFile(dir, 'thumb.jpg');
    assert.deepEqual(cleanupUnlockFiles(dir, { ...cfg, thumb: 'thumb.jpg' }), ['old.mp4']);
    assert.ok(fs.existsSync(path.join(dir, cfg.file)));
    assert.ok(fs.existsSync(path.join(dir, 'thumb.jpg')));
});

test('cleanupUnlockFiles：没有视频时清空目录', () => {
    const { dir } = setup();
    assert.deepEqual(cleanupUnlockFiles(dir, DEFAULTS), ['video_abc.mp4']);
});

test('removeFiles 删掉文件，跳过空名字和不存在的文件', () => {
    const { dir, cfg } = setup();
    assert.doesNotThrow(() => removeFiles(dir, ['', 'nope.mp4', cfg.file]));
    assert.equal(fs.existsSync(path.join(dir, cfg.file)), false);
});
