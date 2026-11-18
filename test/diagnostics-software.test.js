'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { matchKnownSoftware } = require('../src/diagnostics/software');

test('认出 360 等安全软件，同一个软件的几个进程只算一次', () => {
    const found = matchKnownSoftware(['explorer.exe', '360Tray.exe', 'ZhuDongFangYu.exe', 'HipsTray.exe']);
    assert.deepEqual(found, [
        { category: 'security', name: '360安全卫士', exe: '360Tray.exe' },
        { category: 'security', name: '火绒安全', exe: 'HipsTray.exe' },
    ]);
});

test('进程名不区分大小写', () => {
    const found = matchKnownSoftware(['QQPCTRAY.EXE']);
    assert.deepEqual(found, [{ category: 'security', name: '腾讯电脑管家', exe: 'QQPCTRAY.EXE' }]);
});

test('认出 Wallpaper Engine 等壁纸 / 桌面美化软件', () => {
    const found = matchKnownSoftware(['wallpaper64.exe', 'Rainmeter.exe']);
    assert.deepEqual(found, [
        { category: 'desktop', name: 'Wallpaper Engine', exe: 'wallpaper64.exe' },
        { category: 'desktop', name: 'Rainmeter', exe: 'Rainmeter.exe' },
    ]);
});

test('名单里没有、但名字带 wallpaper 的程序当成其他壁纸软件，显示进程名', () => {
    const found = matchKnownSoftware(['SomeWallpaperApp.exe']);
    assert.deepEqual(found, [{ category: 'desktop', name: 'SomeWallpaperApp.exe', exe: 'SomeWallpaperApp.exe' }]);
});

test('普通进程一个都不列', () => {
    assert.deepEqual(matchKnownSoftware(['explorer.exe', 'chrome.exe', 'svchost.exe', '互动3D壁纸.exe', 'electron.exe']), []);
});

test('安全软件排在前面', () => {
    const found = matchKnownSoftware(['wallpaper32.exe', '360sd.exe']);
    assert.deepEqual(found.map((s) => s.category), ['security', 'desktop']);
});
