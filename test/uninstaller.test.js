'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findUninstaller, uninstallerArgs } = require('../src/uninstaller');

function installDirWith(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-install-'));
    for (const file of files) fs.writeFileSync(path.join(dir, file), '');
    return dir;
}

test('安装目录里有 "Uninstall <产品名>.exe" 时找到它', () => {
    const dir = installDirWith(['互动3D壁纸.exe', 'Uninstall 互动3D壁纸.exe', 'ffmpeg.dll']);
    assert.equal(findUninstaller(dir), path.join(dir, 'Uninstall 互动3D壁纸.exe'));
});

test('没有卸载程序时返回 null', () => {
    const dir = installDirWith(['electron.exe', 'ffmpeg.dll']);
    assert.equal(findUninstaller(dir), null);
});

test('目录不存在时返回 null', () => {
    assert.equal(findUninstaller(path.join(os.tmpdir(), 'wp-no-such-dir-' + Date.now())), null);
});

test('勾了删除数据和没勾时带给卸载程序的参数不同', () => {
    assert.deepEqual(uninstallerArgs(true), ['--delete-user-data']);
    assert.deepEqual(uninstallerArgs(false), ['--keep-user-data']);
});
