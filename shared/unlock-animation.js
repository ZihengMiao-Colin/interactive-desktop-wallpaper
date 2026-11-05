/**
 * unlock-animation.js — 解锁动画的纯逻辑（主进程、设置页、全屏播放页共用）
 *
 * 配置 unlockAnimation：
 *   { enabled, file, name, thumb, duration, fadeInMs, fadeOutMs, sound, crop }
 *   file / thumb 是 userData/unlock_animation/ 里的文件名，name 是原文件名（只用来显示），duration 单位秒。
 *   crop 是裁剪区域（shared/crop.js），没裁过时是 null。
 *
 * 状态：
 *   idle      没有全屏窗口
 *   preparing 锁屏了，窗口建好、视频在加载
 *   ready     视频加载好，等解锁
 *   starting  已经解锁（或者在预览），等视频加载好
 *   playing   正在放
 *   fadingOut 窗口淡出，露出桌面
 */

(function (root, factory) {
    const cropLib = (typeof module === 'object' && module.exports)
        ? require('./crop')
        : root.Shared.crop;
    const mod = factory(cropLib);
    if (typeof module === 'object' && module.exports) module.exports = mod;
    else (root.Shared = root.Shared || {}).unlockAnimation = mod;
})(typeof self !== 'undefined' ? self : this, function (cropLib) {
    'use strict';

    const DEFAULTS = Object.freeze({
        enabled: false,
        file: '',
        name: '',
        thumb: '',
        duration: 0,
        fadeInMs: 500,
        fadeOutMs: 700,
        sound: false,
        crop: null,
    });

    /** 淡入淡出时长上限（毫秒） */
    const FADE_MAX_MS = 3000;
    /** 解锁后等视频加载的最长时间（毫秒） */
    const LOAD_TIMEOUT_MS = 3000;
    /** 看门狗：比视频时长多等这么久（毫秒） */
    const WATCHDOG_MARGIN_MS = 5000;
    /** 看门狗：视频时长未知时的上限（毫秒） */
    const WATCHDOG_UNKNOWN_MS = 120000;

    const text = (value) => (typeof value === 'string' ? value : '');

    function fadeMs(value, fallback) {
        const n = Number(value);
        if (value === null || value === '' || !Number.isFinite(n)) return fallback;
        return Math.min(FADE_MAX_MS, Math.max(0, Math.round(n)));
    }

    /**
     * 补齐配置，把手改过或旧版本的值读成合法值。没有视频时开关读成关。
     * @param {object} [value]
     * @returns {object}
     */
    function normalizeConfig(value) {
        const v = value && typeof value === 'object' ? value : {};
        const file = text(v.file);
        const duration = Number(v.duration);
        return {
            enabled: v.enabled === true && !!file,
            file,
            name: text(v.name),
            thumb: text(v.thumb),
            duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
            fadeInMs: fadeMs(v.fadeInMs, DEFAULTS.fadeInMs),
            fadeOutMs: fadeMs(v.fadeOutMs, DEFAULTS.fadeOutMs),
            sound: v.sound === true,
            crop: cropLib.normalizeCrop(v.crop),
        };
    }

    /**
     * 淡入加淡出比视频还长时按比例缩短。时长未知（0）时不改。
     * @returns {{fadeInMs: number, fadeOutMs: number}}
     */
    function fitFades(fadeInMs, fadeOutMs, durationMs) {
        const total = fadeInMs + fadeOutMs;
        if (!(durationMs > 0) || total <= durationMs) return { fadeInMs, fadeOutMs };
        const scale = durationMs / total;
        return { fadeInMs: Math.floor(fadeInMs * scale), fadeOutMs: Math.floor(fadeOutMs * scale) };
    }

    /** 播到什么时候开始淡出（毫秒）。时长未知时返回 Infinity，只靠 ended 结束 */
    function fadeOutStartMs(durationMs, fadeOutMs) {
        if (!(durationMs > 0)) return Infinity;
        return Math.max(0, durationMs - fadeOutMs);
    }

    /** 解锁后最多放多久（毫秒） */
    function watchdogMs(durationMs, fadeInMs) {
        return durationMs > 0 ? durationMs + fadeInMs + WATCHDOG_MARGIN_MS : WATCHDOG_UNKNOWN_MS;
    }

    /** 淡出开始后过了 elapsedMs，窗口的透明度 */
    function opacityAt(elapsedMs, fadeOutMs) {
        if (fadeOutMs <= 0) return 0;
        return Math.max(0, 1 - elapsedMs / fadeOutMs);
    }

    const toIdle = { state: 'idle', actions: ['destroy'] };
    const relock = { state: 'preparing', actions: ['destroy', 'create'] };
    const fadeOut = { state: 'fadingOut', actions: ['fade'] };

    /** 状态转换表，表里没有的组合就是忽略 */
    const TRANSITIONS = {
        idle: {
            lock: { state: 'preparing', actions: ['create'] },
            unlock: { state: 'starting', actions: ['create'] },
            preview: { state: 'starting', actions: ['create'] },
        },
        preparing: {
            unlock: { state: 'starting', actions: [] },
            ready: { state: 'ready', actions: [] },
            skip: toIdle,
            error: toIdle,
            closed: toIdle,
            abort: toIdle,
        },
        ready: {
            unlock: { state: 'playing', actions: ['start'] },
            skip: toIdle,
            error: toIdle,
            closed: toIdle,
            abort: toIdle,
        },
        starting: {
            lock: relock,
            ready: { state: 'playing', actions: ['start'] },
            skip: toIdle,
            timeout: toIdle,
            error: toIdle,
            closed: toIdle,
            abort: toIdle,
        },
        playing: {
            lock: relock,
            nearEnd: fadeOut,
            skip: fadeOut,
            timeout: fadeOut,
            error: toIdle,
            closed: toIdle,
            abort: toIdle,
        },
        fadingOut: {
            lock: relock,
            error: toIdle,
            closed: toIdle,
            abort: toIdle,
            fadeDone: toIdle,
        },
    };

    /**
     * @param {string} state
     * @param {string} event
     * @returns {{state: string, actions: string[]}} 没定义的组合返回原状态和空数组
     */
    function transition(state, event) {
        const next = TRANSITIONS[state] && TRANSITIONS[state][event];
        return next ? { state: next.state, actions: [...next.actions] } : { state, actions: [] };
    }

    /** 这个状态下用户已经解锁、在等或者在看动画：要占着壁纸，Esc 要有效 */
    function isActive(state) {
        return state === 'starting' || state === 'playing';
    }

    return {
        DEFAULTS,
        FADE_MAX_MS,
        LOAD_TIMEOUT_MS,
        normalizeConfig,
        fitFades,
        fadeOutStartMs,
        watchdogMs,
        opacityAt,
        transition,
        isActive,
    };
});
