'use strict';

// 软件图标：打包配置、设置窗口标题栏、托盘都用 tools/make_icon.py 生成的文件

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadTrayIcon } = require('../src/tray-manager');

const root = path.join(__dirname, '..');
const ICO = path.join(root, 'assets', 'icon.ico');

// 假的 nativeImage：记下调了什么，createFromPath 返回给定的图
function fakeNativeImage(image) {
    const calls = { fromPath: [], fromBuffer: 0 };
    return {
        calls,
        createFromPath(p) { calls.fromPath.push(p); return image; },
        createFromBuffer() { calls.fromBuffer++; return { fallback: true }; },
    };
}

test('打包配置用 assets/icon.ico，文件存在', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.equal(pkg.build.win.icon, 'assets/icon.ico');
    assert.ok(fs.existsSync(path.join(root, pkg.build.win.icon)));
});

test('打包配置：显示名 Kirie 壁纸，exe 叫 Kirie，安装包 Kirie-Setup-<版本>', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.equal(pkg.build.productName, 'Kirie 壁纸');
    assert.equal(pkg.build.executableName, 'Kirie');
    assert.equal(pkg.build.nsis.artifactName, 'Kirie-Setup-${version}.${ext}');
    // 这两个决定数据目录、安装目录和"是不是同一个软件"，改名时不动
    assert.equal(pkg.name, 'interactive-desktop-wallpaper');
    assert.equal(pkg.build.appId, 'com.wallpaper.interactive-3d');
});

test('设置窗口标题栏的 logo 是 assets/icon-20.svg，文件存在', () => {
    const html = fs.readFileSync(path.join(root, 'settings.html'), 'utf8');
    const m = html.match(/<span class="logo"[^>]*>\s*<img[^>]*src="([^"]+)"/);
    assert.ok(m, '标题栏 logo 里要有 <img>');
    assert.equal(m[1], 'assets/icon-20.svg');
    assert.ok(fs.existsSync(path.join(root, m[1])));
});

test('托盘：ico 正常时原样返回，不缩放', () => {
    let resized = 0;
    const image = { isEmpty: () => false, resize() { resized++; return this; } };
    const ni = fakeNativeImage(image);
    assert.equal(loadTrayIcon(ICO, ni), image);
    assert.deepEqual(ni.calls.fromPath, [ICO]);
    assert.equal(resized, 0);
});

test('托盘：ico 读出来是空图时用兜底图标', () => {
    const ni = fakeNativeImage({ isEmpty: () => true });
    assert.deepEqual(loadTrayIcon(ICO, ni), { fallback: true });
    assert.equal(ni.calls.fromBuffer, 1);
});

test('托盘：ico 文件不在时用兜底图标，不抛异常', () => {
    const ni = fakeNativeImage({ isEmpty: () => false });
    assert.deepEqual(loadTrayIcon(path.join(root, 'assets', '不存在.ico'), ni), { fallback: true });
    assert.deepEqual(ni.calls.fromPath, []);
});
