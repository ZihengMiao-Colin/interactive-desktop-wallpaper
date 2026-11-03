/**
 * frame-pacing.js — 空闲停帧的判断逻辑
 *
 * 壁纸常驻桌面，鼠标不动、画面也没有动画时没必要每秒渲染 60 帧。
 * 连续若干帧都处于空闲状态才停，避免鼠标刚停下就卡住最后几帧的平滑过渡。
 */

(function (root, factory) {
    const mod = factory();
    if (typeof module === 'object' && module.exports) module.exports = mod;
    else (root.Shared = root.Shared || {}).framePacing = mod;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /** 平滑位置与鼠标目标的差小于这个值就算收敛（归一化坐标，肉眼已看不出差别） */
    const SETTLE_EPSILON = 0.0005;

    /** 平滑后的位置是否已经追上目标 */
    function isSettled(target, current, epsilon = SETTLE_EPSILON) {
        return Math.abs(target - current) < epsilon;
    }

    class IdleTracker {
        /** @param {{graceFrames: number}} options - 连续空闲多少帧后停帧 */
        constructor({ graceFrames }) {
            this.graceFrames = graceFrames;
            this.idleFrames = 0;
        }

        /**
         * 每帧调用一次。
         * @param {boolean} idleNow - 这一帧是否空闲
         * @returns {boolean} 是否应该停帧
         */
        frame(idleNow) {
            this.idleFrames = idleNow ? this.idleFrames + 1 : 0;
            return this.idleFrames >= this.graceFrames;
        }

        reset() {
            this.idleFrames = 0;
        }
    }

    /**
     * 壁纸暂停时视频壁纸要不要接着播放：只是被窗口挡住（reason 'covered'）、并且开了声音时继续放，
     * 让声音不断；锁屏、睡眠（'system'）、摆放元素（'placement'）时都停。
     */
    function keepVideoPlaying(reason, sound) {
        return reason === 'covered' && sound === true;
    }

    /**
     * 主进程该给壁纸窗口发什么：几种状态分开记，按优先级合成一个暂停原因，变了才发。
     * 摆放元素 > 锁屏 / 睡眠 > 被窗口挡住（全屏检测）> 正常。锁屏期间全屏检测照常在跑，
     * 不分开记的话 covered 会盖掉锁屏，开了声音的视频会在锁屏界面出声。
     * @param {{type: 'pause', reason: string} | {type: 'resume'} | null} prev - 上一次发出的消息（还没发过为 null，当成正常）
     * @param {{placement: boolean, system: boolean, covered: boolean}} state
     * @returns {{type: 'pause', reason: 'placement'|'system'|'covered', silent: boolean} | {type: 'resume', silent: boolean} | null}
     *   null 表示不用发。已经暂停时只是换原因、摆放的进出都不弹提示
     */
    function nextWallpaperSignal(prev, { placement, system, covered }) {
        const reason = placement ? 'placement' : system ? 'system' : covered ? 'covered' : null;
        const wasPaused = !!prev && prev.type === 'pause';
        const prevReason = wasPaused ? prev.reason : null;
        if (reason === prevReason) return null;
        if (reason) return { type: 'pause', reason, silent: reason === 'placement' || wasPaused };
        return { type: 'resume', silent: prevReason === 'placement' };
    }

    return { IdleTracker, isSettled, SETTLE_EPSILON, keepVideoPlaying, nextWallpaperSignal };
});
