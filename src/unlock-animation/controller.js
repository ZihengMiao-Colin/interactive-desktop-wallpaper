/**
 * controller.js — 解锁动画的控制器（主进程）：管全屏窗口的一生
 *
 * 锁屏时建好窗口、预加载视频，解锁后开始播放，放完淡出到真实桌面再销毁窗口。
 * 实测锁屏界面让开比 unlock-screen 事件还早，等事件到了再建窗口一定会先露出桌面，所以要提前摆好。
 *
 * 用户任何时候都不能被卡在全屏窗口里，所以有好几层保险：
 *   点鼠标在任何状态都能关掉窗口；Esc 在解锁后有效；加载超时、放的时候卡住、窗口崩溃、
 *   收不到解锁事件都有兜底。状态转换规则在 shared/unlock-animation.js 的 transition。
 */

'use strict';

const { transition, isActive, opacityAt, watchdogMs, LOAD_TIMEOUT_MS } = require('../../shared/unlock-animation');

/** 等解锁时多久查一次锁屏状态（毫秒） */
const LOCK_POLL_MS = 1000;
/** 连续这么多次没锁定才当成解锁了 */
const UNLOCKED_POLLS = 2;
/** 淡出时多久改一次透明度（毫秒） */
const FADE_STEP_MS = 16;

/** 播放页面上报的事件 → 状态机事件 */
const PLAYER_EVENTS = { ready: 'ready', 'near-end': 'nearEnd', skip: 'skip', error: 'error' };

class UnlockAnimationController {
    /**
     * @param {object} deps
     * @param {(opts?: {preview?: boolean}) => object|null} deps.getPlayback - 这次要放什么，不放时返回 null
     * @param {(playback: object) => import('electron').BrowserWindow} deps.createWindow
     * @param {(win: import('electron').BrowserWindow) => void} deps.refitWindow - 按当前主显示器重设大小
     * @param {(onSkip: () => void) => boolean} deps.registerSkipKey
     * @param {() => void} deps.unregisterSkipKey
     * @param {() => boolean} deps.isSessionLocked
     * @param {() => void} deps.onHoldChange - holdsWallpaper 变了
     */
    constructor(deps) {
        this._deps = deps;
        this._state = 'idle';
        this._win = null;
        this._playback = null;
        this._stateTimer = null;
        this._fadeTimer = null;
        this._lockPoll = null;
        /** 这次锁屏时准备失败了（视频解不了等）：解锁时不再建窗口，否则会闪一下黑屏 */
        this._skipNextUnlock = false;
    }

    get state() {
        return this._state;
    }

    /** 用户解锁后还在等或者在看动画：壁纸和唱片机要继续暂停 */
    get holdsWallpaper() {
        return isActive(this._state);
    }

    /** lock-screen 时调用。要同步建窗口：睡眠时离 suspend 只有约 90 毫秒 */
    handleLock() {
        this._skipNextUnlock = false;
        const playback = this._deps.getPlayback();
        if (!playback) {
            this._dispatch('abort');
            return;
        }
        this._playback = playback;
        this._dispatch('lock');
    }

    /** unlock-screen 时调用 */
    handleUnlock() {
        const skip = this._skipNextUnlock;
        this._skipNextUnlock = false;
        if (this._state === 'idle') {
            if (skip) return;
            const playback = this._deps.getPlayback();
            if (!playback) return;
            this._playback = playback;
        }
        this._dispatch('unlock');
    }

    /**
     * 不用锁屏，走同一个窗口和播放逻辑。
     * @returns {boolean} 是否开始了预览
     */
    preview() {
        if (this._state !== 'idle') return false;
        const playback = this._deps.getPlayback({ preview: true });
        if (!playback) return false;
        this._playback = playback;
        this._dispatch('preview');
        return true;
    }

    /**
     * 播放页面上报的事件。只认当前窗口：动画中再次锁屏时，旧窗口的事件可能晚到。
     * @param {import('electron').WebContents} sender
     * @param {string} name - 'ready' | 'near-end' | 'skip' | 'error'
     */
    handlePlayerEvent(sender, name) {
        if (!this._win || this._win.isDestroyed() || sender !== this._win.webContents) return;
        const event = PLAYER_EVENTS[name];
        if (event) this._dispatch(event);
    }

    /** 程序退出时调用，不留下置顶窗口 */
    dispose() {
        this._dispatch('abort');
    }

    // ==================== 内部方法 ====================

    _dispatch(event) {
        const prev = this._state;
        const { state, actions } = transition(prev, event);
        if (state === prev && actions.length === 0) return;

        this._state = state;
        if (state === 'idle' && (prev === 'preparing' || prev === 'ready')) this._skipNextUnlock = true;
        for (const action of actions) this._run(action);
        this._afterStateChange(isActive(prev));
    }

    _run(action) {
        if (action === 'create') this._createWindow();
        else if (action === 'destroy') this._destroyWindow();
        else if (action === 'start') this._start();
        else if (action === 'fade') this._fadeOut();
    }

    _createWindow() {
        let win;
        try {
            win = this._deps.createWindow(this._playback);
        } catch (err) {
            // 这里在电源事件的回调里，异常抛出去会弹错误框
            console.error('[UnlockAnimation] 建窗口失败:', err);
            this._state = 'idle';
            return;
        }
        this._win = win;
        // 只认当前窗口：_destroyWindow 先清掉 this._win，自己销毁窗口时不会再派发一次
        const onGone = () => {
            if (this._win === win) this._dispatch('closed');
        };
        win.on('closed', onGone);
        win.on('unresponsive', onGone);
        win.webContents.on('render-process-gone', onGone);
    }

    _destroyWindow() {
        clearInterval(this._fadeTimer);
        this._fadeTimer = null;
        const win = this._win;
        this._win = null;
        if (win && !win.isDestroyed()) win.destroy();
    }

    _start() {
        this._deps.refitWindow(this._win);
        this._win.webContents.send('unlock:start');
    }

    /** 窗口整体变透明，直接露出真实桌面，不经过黑屏 */
    _fadeOut() {
        const win = this._win;
        const { fadeOutMs } = this._playback;
        const startedAt = Date.now();
        this._fadeTimer = setInterval(() => {
            const opacity = opacityAt(Date.now() - startedAt, fadeOutMs);
            win.setOpacity(opacity);
            if (opacity <= 0) this._dispatch('fadeDone');
        }, FADE_STEP_MS);
    }

    _afterStateChange(wasActive) {
        clearTimeout(this._stateTimer);
        this._stateTimer = null;
        if (this._state === 'starting') {
            this._stateTimer = setTimeout(() => this._dispatch('timeout'), LOAD_TIMEOUT_MS);
        } else if (this._state === 'playing') {
            const { durationMs, fadeInMs } = this._playback;
            this._stateTimer = setTimeout(() => this._dispatch('timeout'), watchdogMs(durationMs, fadeInMs));
        }

        this._syncLockPoll();

        const active = isActive(this._state);
        if (active === wasActive) return;
        if (active) {
            if (!this._deps.registerSkipKey(() => this._dispatch('skip'))) {
                console.warn('[UnlockAnimation] Esc 注册失败，只能点鼠标跳过');
            }
        } else {
            this._deps.unregisterSkipKey();
        }
        this._deps.onHoldChange();
    }

    /**
     * 等解锁时的备用检测：万一收不到 unlock-screen，窗口不能一直盖着桌面。
     * 读到过锁定才生效：getSystemIdleState 如果读不出 locked，这层保险只是不起作用，不会在锁屏时误触发。
     */
    _syncLockPoll() {
        const waiting = this._state === 'preparing' || this._state === 'ready';
        if (!waiting) {
            clearInterval(this._lockPoll);
            this._lockPoll = null;
            return;
        }
        if (this._lockPoll) return;

        let sawLocked = false;
        let unlockedPolls = 0;
        this._lockPoll = setInterval(() => {
            if (this._deps.isSessionLocked()) {
                sawLocked = true;
                unlockedPolls = 0;
            } else if (sawLocked && ++unlockedPolls >= UNLOCKED_POLLS) {
                console.warn('[UnlockAnimation] 没收到解锁事件，按查询结果当成解锁了');
                this._dispatch('unlock');
            }
        }, LOCK_POLL_MS);
    }
}

module.exports = { UnlockAnimationController };
