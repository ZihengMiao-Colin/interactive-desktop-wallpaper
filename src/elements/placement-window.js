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
 *
 * Windows 11 还会给无边框窗口加圆角和 1 像素灰色描边，四个角和一圈边缘会露出下面的窗口，
 * 要用 DWM 属性关掉（squareCorners，和解锁动画窗口共用）。
 */

/**
 * @param {typeof import('electron').BrowserWindow} BrowserWindow
 * @param {{x: number, y: number, width: number, height: number}} bounds - 显示器的 bounds
 * @param {object} options - 其余窗口选项
 * @param {object} [native]
 * @param {(win: import('electron').BrowserWindow) => void} [native.squareCorners] - 去掉系统加的圆角和描边
 * @returns {import('electron').BrowserWindow}
 */
function createFullScreenWindow(BrowserWindow, bounds, options, { squareCorners } = {}) {
    const win = new BrowserWindow({ ...options, ...bounds });
    win.setBounds(bounds);
    // 去不掉只是边角漏一点，不能因此建不了窗口
    if (squareCorners) {
        try {
            squareCorners(win);
        } catch (err) {
            console.warn('[Placement] 去掉窗口圆角失败:', err.message);
        }
    }
    return win;
}

module.exports = { createFullScreenWindow };
