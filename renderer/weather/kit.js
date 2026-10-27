/**
 * weather/kit.js — 天气特效共用：离屏贴图、按矩阵贴图、随机数、粒子特效基类
 *
 * 花瓣、枫叶、雪花这些形状在第一次用到时画成贴图并缓存，之后每帧只是 drawImage，
 * 不再每帧现画路径和渐变。各特效文件把自己的类登记到 WeatherEffects 里。
 */

'use strict';

/** 天气类型 → 特效类（rain / snow / sakura / leaves / sunlight） */
const WeatherEffects = {};

const WeatherKit = (() => {
    function canvas(w, h) {
        const c = document.createElement('canvas');
        c.width = Math.ceil(w);
        c.height = Math.ceil(h);
        return c;
    }

    /** 画一张 w×h 的贴图：draw(ctx, w, h) */
    function sprite(w, h, draw) {
        const c = canvas(w, h);
        draw(c.getContext('2d'), w, h);
        return c;
    }

    /**
     * 逐像素生成单色贴图：alphaAt(u, v) 返回 0~1 的不透明度，u、v 是像素中心的 0~1 坐标。
     * 光柱、光斑这类柔和的渐变用它画，比叠渐变好控制。
     */
    function field(w, h, rgb, alphaAt) {
        const c = canvas(w, h);
        const ctx = c.getContext('2d');
        const img = ctx.createImageData(c.width, c.height);
        const d = img.data;
        for (let j = 0; j < c.height; j++) {
            for (let i = 0; i < c.width; i++) {
                const a = alphaAt((i + 0.5) / c.width, (j + 0.5) / c.height);
                const k = (j * c.width + i) * 4;
                d[k] = rgb[0];
                d[k + 1] = rgb[1];
                d[k + 2] = rgb[2];
                d[k + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
            }
        }
        ctx.putImageData(img, 0, 0);
        return c;
    }

    /**
     * 失焦版本（景深）：四周留出模糊余量。返回的画布比原图大，
     * growX / growY 记下放大比例，draw() 会按它放大，看起来和原图一样大。
     */
    function blurred(src, radius) {
        const pad = Math.ceil(radius * 2.5);
        const c = canvas(src.width + pad * 2, src.height + pad * 2);
        const ctx = c.getContext('2d');
        ctx.filter = `blur(${radius}px)`;
        ctx.drawImage(src, pad, pad);
        c.growX = c.width / src.width;
        c.growY = c.height / src.height;
        return c;
    }

    /**
     * 以 (x, y) 为中心贴图，变换顺序是 平移 → 旋转 → 缩放。
     * dpr 直接并进矩阵，省掉 save / restore。w、h 是 CSS 像素；sx 为负数时左右镜像（翻到背面）。
     */
    function draw(ctx, dpr, img, x, y, w, h, rot = 0, sx = 1, sy = 1) {
        const c = Math.cos(rot) * dpr;
        const s = Math.sin(rot) * dpr;
        ctx.setTransform(c * sx, s * sx, -s * sy, c * sy, x * dpr, y * dpr);
        const gw = w * (img.growX || 1);
        const gh = h * (img.growY || 1);
        ctx.drawImage(img, -gw / 2, -gh / 2, gw, gh);
    }

    /** 只在第一次调用时执行 build，之后返回缓存 */
    function once(build) {
        let value = null;
        return () => value || (value = build());
    }

    const rand = (a, b) => a + Math.random() * (b - a);
    const pick = (list) => list[Math.floor(Math.random() * list.length)];
    const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
    const smoothstep = (a, b, v) => {
        const t = clamp01((v - a) / (b - a));
        return t * t * (3 - 2 * t);
    };

    /** 缓慢起伏的阵风，大约 -1 ~ 1；几个不成整数倍的正弦叠起来，看不出周期 */
    function gust(t) {
        return Math.sin(t * 0.21) * 0.55 + Math.sin(t * 0.53 + 1.3) * 0.3 + Math.sin(t * 1.37 + 2.1) * 0.15;
    }

    return { canvas, sprite, field, blurred, draw, once, rand, pick, clamp01, smoothstep, gust };
})();

/**
 * 粒子特效基类。每个粒子都有深度 z（0 远 ~ 1 近），按 z 从远到近排好序；
 * 粒子离开画面后原地重生，深度不变，所以顺序一直是对的。
 *
 * 子类实现：
 *   spawn(p, env, initial)   设置粒子属性；initial 为 true 时撒满整个画面，否则从画面外进来
 *   step(p, dt, env)         移动一帧，返回 false 表示离开画面、需要重生
 *   drawParticle(ctx, p, env)（粒子多、能共用变换时可以直接重写 draw）
 *
 * env 由 WeatherParticleManager 每帧提供：
 *   { width, height, dpr, time（秒）, wind（约 -2 ~ 2，正数向右）, px, py（最近一层的视差位移，CSS 像素） }
 */
class WeatherEffect {
    constructor(count, env) {
        this.particles = [];
        for (let i = 0; i < count; i++) {
            const p = { z: this.pickDepth() };
            this.spawn(p, env, true);
            this.particles.push(p);
        }
        this.particles.sort((a, b) => a.z - b.z);
    }

    /** 远处的多、近处的少 */
    pickDepth() {
        return Math.pow(Math.random(), 1.4);
    }

    /** 深度 z 的粒子跟着视差移动的比例：最远 0.15，最近 1 */
    static parallaxOf(z) {
        return 0.15 + 0.85 * z;
    }

    update(dt, env) {
        for (const p of this.particles) {
            if (!this.step(p, dt, env)) this.spawn(p, env, false);
        }
    }

    draw(ctx, env) {
        for (const p of this.particles) this.drawParticle(ctx, p, env);
    }

    /**
     * 横向出界就绕到另一边（大风时左右两侧也不会空），出了底边返回 false。
     * 粒子用 bx 记录不含摆动的横向位置。
     */
    static wrapX(p, env, margin) {
        const span = env.width + margin * 2;
        if (p.bx < -margin) p.bx += span;
        else if (p.bx > env.width + margin) p.bx -= span;
        return p.y < env.height + margin;
    }
}
