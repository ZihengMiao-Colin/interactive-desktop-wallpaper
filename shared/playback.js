/**
 * playback.js — 元素播放相关的纯逻辑：动图取帧、间隔播放调度
 */

(function (root, factory) {
    const mod = factory();
    if (typeof module === 'object' && module.exports) module.exports = mod;
    else (root.Shared = root.Shared || {}).playback = mod;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /** 时长缺失或为 0 的帧按这个时长处理（浏览器播放 GIF 也是类似做法） */
    const FALLBACK_FRAME_MS = 100;
    /** 两次播放之间最少间隔 */
    const MIN_GAP_MS = 1000;

    /**
     * 循环播放时，经过 elapsedMs 后应显示第几帧。
     * @param {number[]} durationsMs - 每帧时长
     * @param {number} elapsedMs
     */
    function pickFrame(durationsMs, elapsedMs) {
        const durations = durationsMs.map((d) => (d > 0 ? d : FALLBACK_FRAME_MS));
        const total = durations.reduce((a, b) => a + b, 0);
        let t = ((elapsedMs % total) + total) % total;
        for (let i = 0; i < durations.length; i++) {
            if (t < durations[i]) return i;
            t -= durations[i];
        }
        return durations.length - 1;
    }

    /**
     * 间隔播放调度：第一次立即播放；播完隐藏，等待 intervalSec ± jitterSec 秒（至少 1 秒）后再播。
     * 暂停期间不计时。
     */
    class IntervalScheduler {
        /**
         * @param {{intervalSec: number, jitterSec: number}} options
         * @param {() => number} [rng] - 返回 [0, 1) 的随机数，测试时可注入
         */
        constructor({ intervalSec, jitterSec }, rng = Math.random) {
            this.intervalSec = intervalSec;
            this.jitterSec = jitterSec || 0;
            this.rng = rng;
            this.state = 'first';      // first → playing → waiting → playing ...
            this.nextStartMs = 0;
            this.pausedAtMs = null;
        }

        get playing() {
            return this.state === 'playing';
        }

        /** 是否需要每帧 tick：还没开始第一次播放，或者正在播放 */
        get needsFrames() {
            return this.state !== 'waiting';
        }

        /** 等待下一次播放时返回开始时间（用来定时唤醒停掉的渲染），其余情况为 null */
        get nextEventMs() {
            return this.state === 'waiting' && this.pausedAtMs === null ? this.nextStartMs : null;
        }

        /**
         * 每帧调用。
         * @param {number} nowMs
         * @param {boolean} ended - 素材这一轮是否已经播完
         * @returns {'start'|'hide'|null} 需要执行的动作
         */
        tick(nowMs, ended) {
            if (this.pausedAtMs !== null) return null;

            if (this.state === 'first') {
                this.state = 'playing';
                return 'start';
            }
            if (this.state === 'playing') {
                if (!ended) return null;
                const jitter = (this.rng() * 2 - 1) * this.jitterSec;
                this.nextStartMs = nowMs + Math.max(MIN_GAP_MS, (this.intervalSec + jitter) * 1000);
                this.state = 'waiting';
                return 'hide';
            }
            if (nowMs >= this.nextStartMs) {
                this.state = 'playing';
                return 'start';
            }
            return null;
        }

        pause(nowMs) {
            if (this.pausedAtMs === null) this.pausedAtMs = nowMs;
        }

        resume(nowMs) {
            if (this.pausedAtMs === null) return;
            if (this.state === 'waiting') this.nextStartMs += nowMs - this.pausedAtMs;
            this.pausedAtMs = null;
        }
    }

    return { pickFrame, IntervalScheduler };
});
