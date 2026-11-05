/**
 * player-window.js — 解锁动画的全屏窗口（主进程）
 *
 * 下面的配置都是真实锁屏解锁实测过的（见 docs/superpowers/specs/2026-11-05-unlock-animation-design.md）：
 *   - 构造参数里的大小会被裁到工作区（屏幕减去任务栏），建好后再 setBounds 才能盖住任务栏
 *   - focusable: false + showInactive：不抢焦点，用户原来的程序一直是前台，放完可以直接接着用
 *   - backgroundThrottling: false：锁屏期间页面也正常工作，解锁时视频已经加载好
 */

'use strict';

const path = require('path');
const { toFileUrl } = require('../elements/library');
const { formatQuery } = require('../../shared/crop');

const PAGE = path.join(__dirname, '..', '..', 'renderer', 'unlock-player.html');

/**
 * @param {{BrowserWindow: typeof import('electron').BrowserWindow, screen: import('electron').Screen}} electron
 * @param {{filePath: string, sound: boolean, fadeInMs: number, fadeOutMs: number, crop?: object}} playback
 * @returns {import('electron').BrowserWindow}
 */
function createPlayerWindow({ BrowserWindow, screen }, playback) {
    const { bounds } = screen.getPrimaryDisplay();
    const win = new BrowserWindow({
        ...bounds,
        frame: false,
        show: false,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        focusable: false,
        hasShadow: false,
        backgroundColor: '#000000',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            backgroundThrottling: false,
        },
    });
    win.setBounds(bounds);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.loadFile(PAGE, {
        query: {
            video: toFileUrl(playback.filePath),
            fadeInMs: String(playback.fadeInMs),
            fadeOutMs: String(playback.fadeOutMs),
            sound: playback.sound ? '1' : '0',
            ...(playback.crop ? { crop: formatQuery(playback.crop) } : {}),
        },
    });
    win.showInactive();
    return win;
}

/**
 * 解锁时再铺一次：锁屏期间可能接了显示器、改了分辨率。
 * 也要压回最上面：任务栏是前台窗口时（比如锁屏前刚点过它）会盖在全屏窗口上面。
 */
function refitPlayerWindow(win, screen) {
    win.setBounds(screen.getPrimaryDisplay().bounds);
    win.moveTop();
}

module.exports = { createPlayerWindow, refitPlayerWindow };
