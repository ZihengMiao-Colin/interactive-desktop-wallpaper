/**
 * vinyl-player.js — 唱片机的纯逻辑：唱片匀加速 / 匀减速、唱臂随播放进度移动、桌面点击
 *
 * 唱片旋转交给 Web Animations 在合成器线程上跑，这里算出一段加减速对应的
 * 时长、转过的角度和缓动曲线，保证和前后两段衔接时速度连续（不会突然一顿）。
 * 主进程用 isClickable 决定要不要开桌面点击检测，壁纸页用 hitTest 判断点没点中唱片机。
 */

(function (root, factory) {
    const mod = factory();
    if (typeof module === 'object' && module.exports) module.exports = mod;
    else (root.Shared = root.Shared || {}).vinylPlayer = mod;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

    /**
     * 角速度从 v0 匀变速到 v1（度 / 毫秒）。加速度固定：从静止到全速用 rampMs，差得少就用得少。
     * 匀变速的位置曲线是二次曲线，写成 cubic-bezier 时控制点为
     * (1/3, 2c/3)、(2/3, (1+2c)/3)，c = v0 / (v0 + v1)，起止斜率正好对应 v0 和 v1。
     * @returns {{ duration: number, delta: number, easing: number[] }} 时长（毫秒）、转过的角度、cubic-bezier 参数
     */
    function spinRamp(v0, v1, { rampMs, fullSpeed }) {
        const duration = (rampMs * Math.abs(v1 - v0)) / fullSpeed;
        const delta = ((v0 + v1) / 2) * duration;
        const c = delta > 0 ? (v0 * duration) / (2 * delta) : 0;
        return { duration, delta, easing: [1 / 3, (2 * c) / 3, 2 / 3, (1 + 2 * c) / 3] };
    }

    /**
     * 一段加减速里 now 时刻的角速度。
     * @param {{ v0: number, v1: number, start: number, duration: number }} seg
     */
    function velocityAt(seg, now) {
        if (!(seg.duration > 0)) return seg.v1;
        return seg.v0 + (seg.v1 - seg.v0) * clamp01((now - seg.start) / seg.duration);
    }

    /** 播放进度 0 ~ 1；时长还不知道（没加载完、直播流）时为 0 */
    function progressOf(currentTime, duration) {
        if (!(duration > 0) || !isFinite(duration)) return 0;
        return clamp01(currentTime / duration);
    }

    /** 唱臂角度：进度 0 在唱片最外圈（start），1 在最内圈（end） */
    function armAngle(progress, start, end) {
        return start + (end - start) * clamp01(progress);
    }

    /** 唱片机显示中且导入了音乐，点桌面上的它才有意义（播放 / 暂停） */
    function isClickable(vinyl) {
        return !!(vinyl && vinyl.enabled && vinyl.audioPath);
    }

    /**
     * 点 (x, y) 是否落在唱片圆盘或歌名胶囊上（都是屏幕像素）。
     * @param {{ cx: number, cy: number, r: number }} disc
     * @param {{ left: number, top: number, right: number, bottom: number } | null} card
     */
    function hitTest(x, y, disc, card) {
        if (Math.hypot(x - disc.cx, y - disc.cy) <= disc.r) return true;
        return !!card && x >= card.left && x <= card.right && y >= card.top && y <= card.bottom;
    }

    return { spinRamp, velocityAt, progressOf, armAngle, isClickable, hitTest };
});
