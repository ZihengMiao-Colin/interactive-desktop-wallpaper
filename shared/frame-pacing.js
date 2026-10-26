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

    return { IdleTracker, isSettled, SETTLE_EPSILON };
});
