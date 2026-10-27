/**
 * weather/snow.js — 落雪
 *
 * 三种雪花：
 *   - 柔边雪粒：大多数，远处细小、近处稍大
 *   - 六角雪晶：中近景的一小部分，慢慢旋转，能看清枝杈
 *   - 失焦雪团：最近的一层，又大又虚又淡（相机景深）
 * 下落时左右飘摆用两个不同频率的正弦叠出来，不会整齐划一；风越大越斜。
 */

'use strict';

const snowSprites = WeatherKit.once(() => {
    const white = [255, 255, 255];
    const soft = (r, core) => 1 - WeatherKit.smoothstep(core, 1, r);
    const radial = (size, core) => WeatherKit.field(size, size, white, (u, v) => {
        const r = Math.hypot(u - 0.5, v - 0.5) * 2;
        return soft(r, core);
    });

    /** 六角雪晶：六条主枝，每条主枝上对称的几对侧枝，参数随机，三张各不相同 */
    function crystal() {
        const branches = [0.32, 0.52, 0.7].map((at) => ({ at, len: WeatherKit.rand(0.14, 0.3) * (1 - at * 0.6) }));
        const arm = WeatherKit.rand(0.82, 0.94);
        return WeatherKit.sprite(64, 64, (ctx, w, h) => {
            const R = w / 2 - 4;
            ctx.translate(w / 2, h / 2);
            ctx.strokeStyle = '#fff';
            ctx.lineCap = 'round';
            ctx.shadowColor = 'rgba(255,255,255,0.9)';
            ctx.shadowBlur = 3;
            for (let k = 0; k < 6; k++) {
                ctx.save();
                ctx.rotate((k * Math.PI) / 3);
                ctx.lineWidth = 2.6;
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(0, -R * arm);
                ctx.stroke();
                ctx.lineWidth = 1.8;
                for (const b of branches) {
                    const y = -R * b.at;
                    const d = R * b.len;
                    ctx.beginPath();
                    ctx.moveTo(-d * 0.87, y - d * 0.5);
                    ctx.lineTo(0, y);
                    ctx.lineTo(d * 0.87, y - d * 0.5);
                    ctx.stroke();
                }
                ctx.restore();
            }
            // 中心的小六边形
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            for (let k = 0; k < 6; k++) {
                const a = (k * Math.PI) / 3;
                ctx.lineTo(Math.sin(a) * R * 0.16, -Math.cos(a) * R * 0.16);
            }
            ctx.fill();
        });
    }

    return {
        // 小雪粒画得小的贴图，缩小倍数不会太大，移动时不闪
        dotSmall: radial(8, 0.15),
        dot: radial(32, 0.35),
        bokeh: WeatherKit.field(64, 64, white, (u, v) => {
            const r = Math.hypot(u - 0.5, v - 0.5) * 2;
            return soft(r, 0.55) * 0.85;
        }),
        crystals: [crystal(), crystal(), crystal()],
    };
});

class SnowEffect extends WeatherEffect {
    spawn(p, env, initial) {
        const z = p.z;
        const R = WeatherKit.rand;
        if (z > 0.88) {
            p.kind = 'bokeh';
            p.size = R(16, 34);
            p.alpha = R(0.25, 0.4);
        } else if (z > 0.5 && Math.random() < 0.25) {
            p.kind = 'crystal';
            p.sprite = WeatherKit.pick(snowSprites().crystals);
            p.size = 11 + 10 * z;
            p.alpha = R(0.75, 0.95);
        } else {
            p.kind = 'dot';
            p.size = (1.8 + 4.5 * z) * R(0.8, 1.2);
            p.alpha = (0.6 + 0.4 * z) * R(0.85, 1);
        }
        p.fall = (0.35 + 1.1 * z) * R(0.8, 1.2);       // 每帧（60fps）下落的像素
        p.amp = (2 + 10 * z) * R(0.6, 1.4);             // 左右飘摆幅度（像素）
        p.freq = R(0.5, 1.1);                            // 飘摆频率（弧度 / 秒）
        p.phase = R(0, Math.PI * 2);
        p.rot = R(0, Math.PI * 2);
        p.spin = R(-0.6, 0.6);
        p.par = WeatherEffect.parallaxOf(z);
        p.bx = R(0, env.width);
        p.y = initial ? R(-20, env.height) : -p.size - R(10, 80);
    }

    step(p, dt, env) {
        const sec = dt / 60;
        p.phase += p.freq * sec;
        p.rot += p.spin * sec;
        p.y += p.fall * dt;
        p.bx += env.wind * (0.2 + 0.8 * p.z) * dt;
        return WeatherEffect.wrapX(p, env, 60);
    }

    /** 圆形的雪粒不用旋转，共用一个只缩放 dpr 的变换；只有雪晶单独设矩阵，画完再换回来 */
    draw(ctx, env) {
        const sp = snowSprites();
        const dpr = env.dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        for (const p of this.particles) {
            // 两个频率叠加的飘摆
            const sway = p.amp * (0.7 * Math.sin(p.phase) + 0.3 * Math.sin(p.phase * 2.3 + 1));
            const x = p.bx + sway + env.px * p.par;
            const y = p.y + env.py * p.par;
            const s = p.size;
            ctx.globalAlpha = p.alpha;
            if (p.kind === 'crystal') {
                WeatherKit.draw(ctx, dpr, p.sprite, x, y, s, s, p.rot);
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            } else {
                const img = p.kind === 'bokeh' ? sp.bokeh : s * dpr < 4 ? sp.dotSmall : sp.dot;
                ctx.drawImage(img, x - s / 2, y - s / 2, s, s);
            }
        }
    }
}
SnowEffect.counts = { low: 110, medium: 220, high: 400 };
WeatherEffects.snow = SnowEffect;
