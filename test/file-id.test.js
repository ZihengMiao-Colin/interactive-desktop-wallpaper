'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readFileId, volumeOf, findPathById, isLocalDrivePath } = require('../src/file-tracking/file-id');
const { samePath } = require('../shared/my-wallpapers');

/** 临时目录（系统盘，NTFS） */
function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'wp-fileid-'));
}

test('readFileId 读出卷号、编号和大小；文件夹和不存在的文件返回 null', () => {
    const dir = tempDir();
    const file = path.join(dir, 'a.jpg');
    fs.writeFileSync(file, 'hello');
    const rec = readFileId(file);
    assert.match(rec.vol, /^[0-9a-f]+$/);
    assert.match(rec.id, /^\d+$/);
    assert.equal(rec.size, 5);
    assert.equal(readFileId(dir), null);
    assert.equal(readFileId(path.join(dir, 'nope.jpg')), null);
});

test('volumeOf 和文件的卷号一致', () => {
    const dir = tempDir();
    const file = path.join(dir, 'a.jpg');
    fs.writeFileSync(file, 'x');
    assert.equal(volumeOf(path.parse(file).root), readFileId(file).vol);
});

test('同一个盘里移动加改名后，findPathById 找到新路径', () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, 'a', 'b'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'c'));
    const oldPath = path.join(dir, 'a', 'b', '测试 壁纸.mp4');
    fs.writeFileSync(oldPath, 'video');
    const rec = readFileId(oldPath);
    const newPath = path.join(dir, 'c', '改了名字.mp4');
    fs.renameSync(oldPath, newPath);
    const found = findPathById(rec, oldPath);
    assert.ok(samePath(found, newPath), `找到的是 ${found}`);
});

test('文件删掉后 findPathById 返回 null', () => {
    const dir = tempDir();
    const file = path.join(dir, 'a.jpg');
    fs.writeFileSync(file, 'x');
    const rec = readFileId(file);
    fs.unlinkSync(file);
    assert.equal(findPathById(rec, file), null);
});

test('卷号对不上时 findPathById 返回 null', () => {
    const dir = tempDir();
    const file = path.join(dir, 'a.jpg');
    fs.writeFileSync(file, 'x');
    const rec = readFileId(file);
    fs.renameSync(file, path.join(dir, 'b.jpg'));
    assert.equal(findPathById({ ...rec, vol: 'deadbeef' }, file), null);
});

test('isLocalDrivePath：本地盘是 true，UNC 和没有盘符的是 false', () => {
    assert.equal(isLocalDrivePath(path.join(os.tmpdir(), 'x.jpg')), true);
    assert.equal(isLocalDrivePath('\\\\server\\share\\x.jpg'), false);
    assert.equal(isLocalDrivePath('relative\\x.jpg'), false);
    assert.equal(isLocalDrivePath(''), false);
});
