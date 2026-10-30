/**
 * vinyl-player.js — 唱片机的纯逻辑：唱片匀加速 / 匀减速、唱臂随播放进度移动、桌面点击、位置和大小
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

    /** 唱片机显示中且歌单里有歌，点桌面上的它才有意义（播放 / 暂停）；配置已经过 Shared.playlist.normalizeVinyl */
    function isClickable(vinyl) {
        return !!(vinyl && vinyl.enabled && Array.isArray(vinyl.playlist) && vinyl.playlist.length > 0);
    }

    /** 唱片机停靠的四个角；'custom' 是在摆放窗口里拖到的任意位置 */
    const CORNERS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];
    const SCALE_MIN = 0.5;
    const SCALE_MAX = 2;

    /**
     * 唱片机的位置和大小。四个角之一，或者 custom：x / y 是唱盘中心在屏幕上的比例位置（0 ~ 1）。
     * custom 缺坐标、方位写错时回到右下角；大小限制在 0.5 ~ 2。
     * @returns {{ position: string, scale: number, x?: number, y?: number }}
     */
    function normalizeLayout(layout) {
        const l = layout || {};
        const s = Number(l.scale);
        const scale = Number.isFinite(s) && s > 0 ? Math.min(SCALE_MAX, Math.max(SCALE_MIN, s)) : 1;
        if (l.position === 'custom' && Number.isFinite(l.x) && Number.isFinite(l.y)) {
            return { position: 'custom', x: clamp01(l.x), y: clamp01(l.y), scale };
        }
        return { position: CORNERS.includes(l.position) ? l.position : 'bottom-right', scale };
    }

    /**
     * 把唱盘中心 (x, y)（屏幕比例）挪到让整个唱片机都露在屏幕里的范围内。
     * @param {{ left: number, right: number, top: number, bottom: number }} extent - 唱盘中心到唱片机四边的距离（像素）
     * @returns {{ x: number, y: number }} 唱片机比屏幕还大的方向上居中
     */
    function clampCenter(x, y, extent, width, height) {
        const fit = (v, before, after, size) => {
            const min = before / size;
            const max = 1 - after / size;
            return min > max ? (min + max) / 2 : Math.min(max, Math.max(min, v));
        };
        return { x: fit(x, extent.left, extent.right, width), y: fit(y, extent.top, extent.bottom, height) };
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

    return {
        spinRamp, velocityAt, progressOf, armAngle, isClickable, hitTest,
        CORNERS, SCALE_MIN, SCALE_MAX, normalizeLayout, clampCenter,
    };
});
