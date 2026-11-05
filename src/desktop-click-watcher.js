/**
 * desktop-click-watcher.js — 检测桌面上的鼠标单击
 *
 * 壁纸窗口在桌面图标后面，收不到鼠标事件，所以每隔一小段时间用 user32 读一次左键状态（见 win32.js）：
 * 按下到松开足够快、位置几乎没动才算一次单击（拖选框、拖图标不算）；
 * 松开时鼠标下面是桌面（根窗口类名 Progman / WorkerW）才算数。
 * 只在有"点击播放"的元素、或唱片机里有音乐时开启，没有时停掉，不白占 CPU。
 */

const { getWin32 } = require('./win32');

/** 读取左键状态的间隔（毫秒） */
const POLL_MS = 15;
/** 按下到松开超过这么久不算单击（毫秒） */
const CLICK_MAX_MS = 500;
/** 按下到松开移动超过这么多像素不算单击（100% 缩放时的像素，读到的鼠标位置是物理像素，要按 DPI 换算） */
const CLICK_MAX_MOVE_PX = 6;
/** 100% 缩放的 DPI */
const BASE_DPI = 96;

/** 桌面的根窗口类名（图标层和壁纸层都挂在它们下面） */
const DESKTOP_CLASSES = new Set(['Progman', 'WorkerW']);

class DesktopClickWatcher {
    /**
     * @param {object} options
     * @param {() => void} options.onClick - 桌面被单击时调用（坐标由调用方读当前鼠标位置）
     * @param {object} [options.win32] - win32 接口，测试时传假的
     * @param {() => object} [options.loadWin32] - 取 win32 接口的函数，默认 getWin32
     * @param {() => number} [options.now] - 当前时间（毫秒），测试时传假的
     */
    constructor({ onClick, win32 = null, loadWin32 = getWin32, now = Date.now }) {
        this._onClick = onClick;
        this._win32 = win32;
        this._loadWin32 = loadWin32;
        this._now = now;
        this._timer = null;
        this._dpi = BASE_DPI;
        this._wasDown = false;
        this._start = null;
        this._downAt = 0;
    }

    /** 需要时开启，不需要时停掉 */
    setEnabled(enabled) {
        if (enabled) this._begin();
        else this.stop();
    }

    stop() {
        if (!this._timer) return;
        clearInterval(this._timer);
        this._timer = null;
        console.log('[DesktopClick] Stopped');
    }

    /** user32 加载失败时只是不检测，壁纸照常运行 */
    _begin() {
        if (this._timer) return;

        try {
            if (!this._win32) this._win32 = this._loadWin32();
        } catch (err) {
            console.error('[DesktopClick] Cannot load user32:', err.message);
            return;
        }
        this._dpi = this._win32.getSystemDpi();
        this._wasDown = false;
        this._timer = setInterval(() => this._poll(), POLL_MS);
        console.log('[DesktopClick] Started');
    }

    _poll() {
        const down = this._win32.isLeftButtonDown();
        if (down && !this._wasDown) {
            this._start = this._win32.getCursorPos();
            this._downAt = this._now();
        } else if (!down && this._wasDown && this._isClick()) {
            this._onClick();
        }
        this._wasDown = down;
    }

    /** 刚松开的这一下是不是桌面上的单击 */
    _isClick() {
        const end = this._win32.getCursorPos();
        const maxMove = CLICK_MAX_MOVE_PX * this._dpi / BASE_DPI;
        return this._now() - this._downAt <= CLICK_MAX_MS
            && Math.abs(end.x - this._start.x) <= maxMove
            && Math.abs(end.y - this._start.y) <= maxMove
            && this._isDesktop(end);
    }

    _isDesktop(point) {
        const root = this._win32.getRootWindow(this._win32.windowFromPoint(point));
        return root !== 0 && DESKTOP_CLASSES.has(this._win32.getClassName(root));
    }
}

module.exports = { DesktopClickWatcher };
