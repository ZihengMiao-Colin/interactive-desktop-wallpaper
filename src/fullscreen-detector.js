/**
 * fullscreen-detector.js — 全屏检测：用户在用全屏应用（游戏、视频播放器等）时暂停壁纸渲染，释放 GPU
 *
 * 每秒用 user32 读一次前台窗口（见 win32.js）：铺满屏幕且不是桌面 / 任务栏就算全屏，
 * 连续几次同状态才真正切换（防抖）。这几个调用不发消息，开销很小，直接在主进程定时跑。
 */

const { getWin32 } = require('./win32');

/** 前台窗口占屏幕的比例达到这么多算全屏 */
const FULLSCREEN_COVERAGE = 0.90;

/** 桌面和任务栏铺满屏幕也不算全屏应用 */
const SHELL_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'MSTaskSwWClass']);

/**
 * 前台窗口是全屏应用时返回它的进程号，否则返回 null。
 * @param {object} api - win32 接口
 * @returns {number|null}
 */
function fullscreenForegroundPid(api) {
    const hwnd = api.getForegroundWindow();
    if (!hwnd) return null;

    const { left, top, right, bottom } = api.getWindowRect(hwnd);
    const { width, height } = api.getScreenSize();
    const coverage = ((right - left) * (bottom - top)) / (width * height);
    if (coverage < FULLSCREEN_COVERAGE || SHELL_CLASSES.has(api.getClassName(hwnd))) return null;

    return api.getProcessId(hwnd);
}

class FullscreenDetector {
    /**
     * @param {Object} options
     * @param {number} options.pollInterval - 检测间隔（毫秒）
     * @param {number} options.debounceCount - 防抖次数（默认 2）
     * @param {Function} options.onFullscreenStart - 全屏开始回调
     * @param {Function} options.onFullscreenEnd - 全屏结束回调
     * @param {number} [options.ignorePid] - 属于这个进程的全屏窗口不算全屏应用（传主进程 pid）
     * @param {object} [options.win32] - win32 接口，测试时传假的
     * @param {() => object} [options.loadWin32] - 取 win32 接口的函数，默认 getWin32
     */
    constructor(options = {}) {
        this.pollInterval = options.pollInterval || 1000;
        this.debounceCount = options.debounceCount || 2;
        this.onFullscreenStart = options.onFullscreenStart || (() => {});
        this.onFullscreenEnd = options.onFullscreenEnd || (() => {});
        this.ignorePid = options.ignorePid || null;

        this._win32 = options.win32 || null;
        this._loadWin32 = options.loadWin32 || getWin32;
        this._timer = null;

        this._isFullscreen = false;
        this._fullscreenCounter = 0;
        this._normalCounter = 0;
        this._rendererReady = false;
    }

    /**
     * 设置渲染器是否就绪。
     * 如果渲染器还没准备好，即使检测到全屏结束也不发送 resume。
     */
    setRendererReady(ready) {
        this._rendererReady = ready;
    }

    /** 启动检测。user32 加载失败时只是不检测，壁纸照常运行 */
    start() {
        if (this._timer) return;

        try {
            if (!this._win32) this._win32 = this._loadWin32();
        } catch (err) {
            console.error('[FullscreenDetector] Cannot load user32:', err.message);
            return;
        }
        this._timer = setInterval(() => this._poll(), this.pollInterval);
        console.log('[FullscreenDetector] Started');
    }

    /** 停止检测 */
    stop() {
        if (!this._timer) return;
        clearInterval(this._timer);
        this._timer = null;
        console.log('[FullscreenDetector] Stopped');
    }

    // ==================== 内部方法 ====================

    _poll() {
        const pid = fullscreenForegroundPid(this._win32);
        this._report(pid !== null && pid !== this.ignorePid);
    }

    /**
     * 带防抖的状态上报：连续 N 次同状态才真正切换。
     * @param {boolean} isFullscreenNow
     */
    _report(isFullscreenNow) {
        if (isFullscreenNow) {
            this._fullscreenCounter++;
            this._normalCounter = 0;

            if (this._fullscreenCounter >= this.debounceCount && !this._isFullscreen) {
                console.log('[FullscreenDetector] Pausing render');
                this._isFullscreen = true;
                this.onFullscreenStart();
            }
        } else {
            this._normalCounter++;
            this._fullscreenCounter = 0;

            if (this._normalCounter >= this.debounceCount && this._isFullscreen) {
                if (this._rendererReady) {
                    console.log('[FullscreenDetector] Resuming render');
                    this._isFullscreen = false;
                    this.onFullscreenEnd();
                }
            }
        }
    }
}

module.exports = { FullscreenDetector };
