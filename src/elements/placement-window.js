/**
 * placement-window.js — 建铺满整个屏幕的窗口（摆放窗口用）
 *
 * BrowserWindow 构造参数里的大小在 Windows 上会被裁到工作区（屏幕减去任务栏），
 * 2560×1600、缩放 150% 的屏幕上传 1707×1067，页面实际只有 1708×1020。
 * 壁纸铺满整个屏幕，元素和唱片机的位置又是相对窗口大小的比例，
 * 窗口矮一截的话，摆好的东西放到壁纸上会往下偏，背景的裁切也不一样。
 *
 * 所以建好后要再 setBounds 一次（setBounds 不受工作区限制）。
 * 要在加载页面之前调，这样页面第一次排版就是全屏大小。
 */

/**
 * @param {typeof import('electron').BrowserWindow} BrowserWindow
 * @param {{x: number, y: number, width: number, height: number}} bounds - 显示器的 bounds
 * @param {object} options - 其余窗口选项
 * @returns {import('electron').BrowserWindow}
 */
function createFullScreenWindow(BrowserWindow, bounds, options) {
    const win = new BrowserWindow({ ...options, ...bounds });
    win.setBounds(bounds);
    return win;
}

module.exports = { createFullScreenWindow };
