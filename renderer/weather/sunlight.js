/**
 * weather/sunlight.js — 光斑：阳光从左上角斜照进画面
 *
 * 三层，从远到近：
 *   - 光柱：几道从画面外左上方照进来的楔形光，明暗缓慢起伏
 *   - 浮尘：细小的亮点，随机游走；飘进光柱时被照亮、闪烁
 *   - 光斑：离镜头很近的失焦光圈（有的边缘亮、有的中间亮），原地淡入淡出
 * 整个图层用滤色叠到壁纸上，暗处显光、亮处不发灰。
 */

'use strict';

/** 光柱条数 */
const SUN_RAYS = 5;
/** 光柱很柔和，画在 1/4 分辨率的离屏画布上再整张放大，省掉几道大面积光柱逐像素叠加的开销 */
const SUN_RAY_SCALE = 0.25;

const sunSprites = WeatherKit.once(() => {
    const disk = (rgb, rim) => WeatherKit.field(96, 96, rgb, (u, v) => {
        const r = Math.hypot(u - 0.5, v - 0.5) * 2;
        const edge = 1 - WeatherKit.smoothstep(0.86, 1, r);
        return rim
            ? (0.45 + 0.55 * WeatherKit.smoothstep(0.55, 0.9, r)) * edge
            : (1 - WeatherKit.smoothstep(0.2, 1, r)) * 0.9;
    });
    const colors = [[255, 226, 160], [255, 200, 125], [255, 242, 214]];
    return {
        // 楔形光柱：v = 0 是光源一端（窄），v = 1 是远端（宽）；两端都渐隐
        ray: WeatherKit.field(64, 256, [255, 218, 160], (u, v) => {
            const x = ((u - 0.5) * 2) / (0.12 + 0.88 * v);
            return Math.exp(-x * x * 2.5) * WeatherKit.smoothstep(0, 0.15, v) * Math.pow(1 - v, 1.3);
        }),
        mote: WeatherKit.field(8, 8, [255, 246, 220], (u, v) => {
            const r = Math.hypot(u - 0.5, v - 0.5) * 2;
            return Math.pow(1 - WeatherKit.smoothstep(0, 1, r), 1.5);
        }),
        bokeh: colors.flatMap((c) => [disk(c, true), disk(c, false)]),
    };
});

class SunlightEffect extends WeatherEffect {
    constructor(count, env) {
        super(count, env);
        this.blend = 'screen';
        const R = WeatherKit.rand;
        this.rays = [];
        for (let i = 0; i < SUN_RAYS; i++) {
            this.rays.push({
                offset: (i / (SUN_RAYS - 1) - 0.5) * 0.64 + R(-0.04, 0.04),   // 相对主方向的角度
                width: R(0.12, 0.26),       // 远端宽度（相对光柱长度）
                peak: R(0.28, 0.44),
                freq: R(0.12, 0.3),
                phase: R(0, Math.PI * 2),
                theta: 0, alpha: 0, half: 0,
            });
        }
        this.motes = [];
        for (let i = 0; i < count * 5; i++) {
            const m = {};
            this.spawnMote(m, env);
            this.motes.push(m);
        }
        this.source = { x: 0, y: 0 };
        this.rayLength = 0;
        this.rayLayer = WeatherKit.canvas(1, 1);
    }

    /** 光斑都是离镜头很近的东西 */
    pickDepth() {
        return 0.55 + 0.45 * Math.random();
    }

    spawn(p, env, initial) {
        const R = WeatherKit.rand;
        p.sprite = WeatherKit.pick(sunSprites().bokeh);
        p.size = (36 + 250 * (p.z - 0.55)) * R(0.8, 1.2);
        p.peak = R(0.2, 0.42);
        p.life = initial ? Math.random() : 0;
        p.duration = R(7, 15);                      // 秒
        // 靠近左上角光源的地方多一些
        p.x = Math.pow(Math.random(), 1.3) * env.width;
        p.y = Math.pow(Math.random(), 1.3) * env.height;
        p.vx = R(-4, 6);                            // 像素 / 秒
        p.vy = R(-8, -2);
        p.twinkle = R(0, Math.PI * 2);
        p.par = WeatherEffect.parallaxOf(p.z);
    }

    /** 光斑原地淡入淡出，一轮结束换个地方重生 */
    step(p, dt, env) {
        const sec = dt / 60;
        p.life += sec / p.duration;
        p.x += (p.vx + env.wind * 4) * sec;
        p.y += p.vy * sec;
        return p.life < 1;
    }

    spawnMote(m, env) {
        const R = WeatherKit.rand;
        m.z = R(0.1, 0.8);
        m.size = 1.6 + 2.6 * m.z;
        m.x = R(0, env.width);
        m.y = R(0, env.height);
        m.vx = R(-6, 6);
        m.vy = R(-6, 3);
        m.base = R(0.18, 0.4);
        m.freq = R(1.5, 4);
        m.phase = R(0, Math.PI * 2);
        m.par = WeatherEffect.parallaxOf(m.z);
        m.alpha = 0;
    }

    update(dt, env) {
        super.update(dt, env);
        const sec = dt / 60;
        const R = WeatherKit.rand;
        const t = env.time;

        // 光源在画面外左上方，主方向指向画面中下部
        const src = this.source;
        src.x = -0.12 * env.width + env.px * 0.25;
        src.y = -0.3 * env.height + env.py * 0.25;
        this.rayLength = 1.5 * Math.hypot(env.width, env.height);
        const aim = Math.atan2(0.75 * env.height - src.y, 0.55 * env.width - src.x);
        for (const ray of this.rays) {
            ray.theta = aim + ray.offset + 0.015 * Math.sin(t * 0.11 + ray.phase);
            ray.alpha = ray.peak * (0.55 + 0.45 * Math.sin(t * ray.freq + ray.phase));
            ray.half = 0.44 * ray.width;            // 光柱在角度上的半宽（弧度，近似）
        }

        const margin = 20;
        for (const m of this.motes) {
            // 随机游走，带一点阻尼和上升气流
            m.vx += R(-1, 1) * 8 * sec;
            m.vy += R(-1, 1) * 8 * sec;
            m.vx *= 1 - 0.5 * sec;
            m.vy *= 1 - 0.5 * sec;
            m.x += (m.vx + env.wind * 8 * m.z) * sec;
            m.y += (m.vy - 2) * sec;
            if (m.x < -margin) m.x += env.width + margin * 2;
            else if (m.x > env.width + margin) m.x -= env.width + margin * 2;
            if (m.y < -margin) m.y += env.height + margin * 2;
            else if (m.y > env.height + margin) m.y -= env.height + margin * 2;

            // 在光柱里的浮尘被照亮
            const phi = Math.atan2(m.y - src.y, m.x - src.x);
            let lit = 0;
            for (const ray of this.rays) {
                const d = (phi - ray.theta) / ray.half;
                lit += (ray.alpha / 0.44) * Math.exp(-2.5 * d * d);
            }
            const twinkle = 0.6 + 0.4 * Math.sin(t * m.freq + m.phase);
            m.alpha = Math.min(1, m.base * (0.4 + 3 * lit) * twinkle);
        }
    }

    draw(ctx, env) {
        const sp = sunSprites();
        const dpr = env.dpr;
        ctx.globalCompositeOperation = 'lighter';

        const layer = this.rayLayer;
        const lw = Math.ceil(env.width * SUN_RAY_SCALE);
        const lh = Math.ceil(env.height * SUN_RAY_SCALE);
        if (layer.width !== lw || layer.height !== lh) {
            layer.width = lw;
            layer.height = lh;
        }
        const lctx = layer.getContext('2d');
        lctx.setTransform(1, 0, 0, 1, 0, 0);
        lctx.clearRect(0, 0, lw, lh);
        lctx.globalCompositeOperation = 'lighter';
        const L = this.rayLength;
        for (const ray of this.rays) {
            lctx.globalAlpha = ray.alpha;
            const cx = this.source.x + Math.cos(ray.theta) * L / 2;
            const cy = this.source.y + Math.sin(ray.theta) * L / 2;
            // 贴图的 +y 方向（光源 → 远端）转到 theta 方向
            WeatherKit.draw(lctx, SUN_RAY_SCALE, sp.ray, cx, cy, L * ray.width, L, ray.theta - Math.PI / 2);
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.drawImage(layer, 0, 0, ctx.canvas.width, ctx.canvas.height);

        for (const m of this.motes) {
            ctx.globalAlpha = m.alpha;
            WeatherKit.draw(ctx, dpr, sp.mote, m.x + env.px * m.par, m.y + env.py * m.par, m.size, m.size);
        }

        super.draw(ctx, env);
    }

    drawParticle(ctx, p, env) {
        const fade = Math.pow(Math.sin(Math.PI * p.life), 2);
        ctx.globalAlpha = p.peak * fade * (0.85 + 0.15 * Math.sin(env.time * 1.7 + p.twinkle));
        WeatherKit.draw(ctx, env.dpr, p.sprite, p.x + env.px * p.par, p.y + env.py * p.par, p.size, p.size);
    }
}
SunlightEffect.counts = { low: 12, medium: 20, high: 32 };
WeatherEffects.sunlight = SunlightEffect;
