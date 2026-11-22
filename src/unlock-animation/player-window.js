/**
 * player-window.js — 解锁动画的全屏窗口（主进程）
 *
 * 下面的配置都是真实锁屏解锁实测过的（见 docs/superpowers/specs/2026-11-05-unlock-animation-design.md）：
 *   - 构造参数里的大小会被裁到工作区（屏幕减去任务栏），建好后再 setBounds 才能盖住任务栏
 *   - focusable: false + showInactive：不抢焦点，用户原来的程序一直是前台，放完可以直接接着用
 *   - backgroundThrottling: false：锁屏期间页面也正常工作，解锁时视频已经加载好
 *   - Windows 11 默认给窗口加圆角和 1 像素灰色描边（无边框窗口也一样），窗口铺满屏幕时
 *     四个角和一圈边缘会露出后面的桌面，要用 DWM 属性关掉（squareCorners）
 */

'use strict';

const path = require('path');
const { toFileUrl } = require('../elements/library');
const { formatQuery } = require('../../shared/crop');

const PAGE = path.join(__dirname, '..', '..', 'renderer', 'unlock-player.html');

/**
 * @param {object} deps
 * @param {typeof import('electron').BrowserWindow} deps.BrowserWindow
 * @param {import('electron').Screen} deps.screen
 * @param {(win: import('electron').BrowserWindow) => void} [deps.squareCorners] - 去掉系统加的圆角和描边
 * @param {{filePath: string, sound: boolean, fadeInMs: number, fadeOutMs: number, crop?: object}} playback
 * @returns {import('electron').BrowserWindow}
 */
function createPlayerWindow({ BrowserWindow, screen, squareCorners }, playback) {
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
    // 显示之前就去掉，免得解锁那一刻露出圆角。去不掉只是边角漏一点，不能因此不放动画
    if (squareCorners) {
        try {
            squareCorners(win);
        } catch (err) {
            console.warn('[UnlockAnimation] 去掉窗口圆角失败:', err.message);
        }
    }
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
