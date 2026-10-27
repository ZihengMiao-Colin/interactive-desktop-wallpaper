/**
 * weather.js — 天气特效管理器（Canvas 2D 图层，盖在壁纸上面）
 *
 * 五种天气各自在 renderer/weather/ 下实现，这里只管：画布尺寸、按配置切换特效、
 * 每帧算好时间、风和视差交给特效。
 */

'use strict';

/** 最近一层粒子随鼠标视差移动的最大距离（CSS 像素），远处按深度递减 */
const WEATHER_PARALLAX_PX = 36;

class WeatherParticleManager {
    constructor() {
        this.canvas = document.getElementById('weather-canvas');
        this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
        this.type = 'none';
        this.density = 'medium';
        this.speed = 1.0;
        this.parallax = true;
        /** 当前特效实例，没有天气时为 null */
        this.effect = null;
        /** 特效时间（秒），按速度倍率走 */
        this.time = 0;
        this.env = { width: 0, height: 0, dpr: 1, time: 0, wind: 0, px: 0, py: 0 };

        window.addEventListener('resize', () => this.resize());
        this.resize();
    }

    /** 画布按屏幕像素密度放大，高分屏下粒子不发糊；特效里的坐标仍用 CSS 像素 */
    resize() {
        if (!this.canvas) return;
        const dpr = window.devicePixelRatio || 1;
        this.env.width = window.innerWidth;
        this.env.height = window.innerHeight;
        this.env.dpr = dpr;
        this.canvas.width = Math.round(this.env.width * dpr);
        this.canvas.height = Math.round(this.env.height * dpr);
    }

    /** 是否有粒子在动（需要每帧渲染） */
    isActive() {
        return this.effect !== null;
    }

    setConfig(config) {
        if (!config) return;
        const type = config.type || 'none';
        const density = config.density || 'medium';
        const changed = type !== this.type || density !== this.density;
        this.type = type;
        this.density = density;
        this.speed = config.speed !== undefined ? config.speed : 1.0;
        this.parallax = config.parallax !== false;
        if (changed) this.start();
    }

    /** 按当前类型和密度新建特效；没有天气时清空画布 */
    start() {
        this.effect = null;
        if (!this.ctx) return;
        this.clear();
        const Effect = WeatherEffects[this.type];
        if (Effect) {
            this.updateEnv(0, 0);
            this.effect = new Effect(Effect.counts[this.density] || Effect.counts.medium, this.env);
        }
        // 光斑是"光"，用滤色叠到壁纸上；其他天气正常覆盖
        this.canvas.style.mixBlendMode = (this.effect && this.effect.blend) || '';
    }

    clear() {
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    /** 鼠标左右位置会带来风（mouseX 为 -1 ~ 1），再叠上缓慢的阵风 */
    updateEnv(mouseX, mouseY) {
        const env = this.env;
        env.time = this.time;
        env.wind = 0.3 + 0.35 * WeatherKit.gust(this.time) + 0.9 * mouseX;
        // 鼠标右移时近景向左偏，和壁纸的视差方向一致
        env.px = this.parallax ? -mouseX * WEATHER_PARALLAX_PX : 0;
        env.py = this.parallax ? -mouseY * WEATHER_PARALLAX_PX : 0;
    }

    /**
     * @param {number} delta - 以 60fps 为 1 的帧时间倍数
     * @param {number} mouseX - 平滑后的鼠标位置，-1 ~ 1
     * @param {number} mouseY
     */
    update(delta, mouseX, mouseY) {
        if (!this.effect || !this.ctx) return;
        // 速度倍率直接作用在时间上；卡顿后的第一帧不让粒子一下跳太远
        const dt = Math.min(delta, 4) * this.speed;
        this.time += dt / 60;
        this.updateEnv(mouseX, mouseY);

        this.effect.update(dt, this.env);
        this.clear();
        this.effect.draw(this.ctx, this.env);
        this.ctx.globalAlpha = 1;
        this.ctx.globalCompositeOperation = 'source-over';
    }
}
