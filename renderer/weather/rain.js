/**
 * weather/rain.js — 细雨：带运动模糊的细雨丝
 *
 * 雨丝是一张竖直的渐变贴图：下端（雨滴所在）最亮，往上拖出渐隐的尾巴。
 * 远处的雨丝短、细、淡、落得慢；最近的一层又粗又虚（景深）。所有雨丝顺着同一个风向斜落。
 * 不画落地水花：不知道壁纸里的地面在哪，水花溅在半空会很假。
 */

'use strict';

const rainSprites = WeatherKit.once(() => {
    const color = [215, 232, 255];
    // v 从 0（尾）到 1（头）：尾巴渐隐，头部最亮，末端收成圆头
    const along = (v) => Math.pow(WeatherKit.smoothstep(0, 0.9, v), 1.6) * (1 - WeatherKit.smoothstep(0.94, 1, v) * 0.7);
    const across = (u, sigma) => Math.exp(-Math.pow((u - 0.5) / sigma, 2));
    return {
        sharp: WeatherKit.field(8, 96, color, (u, v) => along(v) * across(u, 0.2)),
        soft: WeatherKit.field(12, 96, color, (u, v) => along(v) * across(u, 0.32) * 0.8),
    };
});

class RainEffect extends WeatherEffect {
    constructor(count, env) {
        super(count, env);
        this.slope = 0;
    }

    spawn(p, env, initial) {
        const z = p.z;
        p.speed = (10 + 18 * z) * WeatherKit.rand(0.9, 1.1);   // 每帧（60fps）下落的像素
        p.len = p.speed * WeatherKit.rand(1.6, 2.2);           // 运动模糊长度 ≈ 速度 × 快门
        p.w = 0.9 + 1.6 * z;
        p.soft = z > 0.82;
        p.alpha = p.soft ? WeatherKit.rand(0.15, 0.26) : (0.22 + 0.4 * z) * WeatherKit.rand(0.7, 1.15);
        p.par = WeatherEffect.parallaxOf(z);
        p.bx = WeatherKit.rand(0, env.width);
        p.y = initial ? WeatherKit.rand(-p.len, env.height) : -p.len - WeatherKit.rand(0, 120);
    }

    update(dt, env) {
        // 风把雨吹斜：每下落 1 像素横移 slope 像素
        this.slope = 0.04 + 0.16 * env.wind;
        super.update(dt, env);
    }

    step(p, dt, env) {
        p.y += p.speed * dt;
        p.bx += p.speed * this.slope * dt;
        return WeatherEffect.wrapX(p, env, 80);
    }

    /** 所有雨丝方向相同：整帧只设一次旋转，再把每滴雨的屏幕坐标逆旋转到这个坐标系里贴图 */
    draw(ctx, env) {
        const sp = rainSprites();
        const dpr = env.dpr;
        const rot = -Math.atan(this.slope);
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        ctx.setTransform(cos * dpr, sin * dpr, -sin * dpr, cos * dpr, 0, 0);
        for (const p of this.particles) {
            const x = p.bx + env.px * p.par;
            const y = p.y + env.py * p.par;
            const u = cos * x + sin * y;
            const v = -sin * x + cos * y;
            const w = p.soft ? p.w * 1.6 : p.w;
            ctx.globalAlpha = p.alpha;
            ctx.drawImage(p.soft ? sp.soft : sp.sharp, u - w / 2, v - p.len / 2, w, p.len);
        }
    }
}
RainEffect.counts = { low: 120, medium: 240, high: 420 };
WeatherEffects.rain = RainEffect;
