/**
 * weather/sakura.js — 落樱
 *
 * 花瓣是樱花真实的形状：基部窄、顶端宽、顶端中间有一个 V 形缺口。
 * 颜色从基部的粉红渐变到顶端近白，带几条很淡的脉纹；背面颜色略深。
 * 下落时在三个方向上翻转（平面旋转 + 两个轴的透视压缩），翻到背面换背面贴图；
 * 最近的一层是失焦的大花瓣。
 */

'use strict';

/** 花瓣贴图的宽高比（宽 / 长） */
const PETAL_ASPECT = 0.75;

const sakuraSprites = WeatherKit.once(() => {
    // 基部、中段、顶端三个颜色；第二种接近染井吉野的白，第三种偏深
    const palettes = [
        ['#ef86a2', '#f8b8c8', '#fff0f4'],
        ['#eaa3b6', '#fbd3dd', '#fffafb'],
        ['#e56b8d', '#f4a2b8', '#fde2ea'],
    ];

    /** 单位坐标里的花瓣轮廓：y = 1 是基部（窄而钝），y = -1 是顶端，最宽处在上部，顶端中间一个小 V 形缺口 */
    function petalPath(ctx) {
        ctx.beginPath();
        ctx.moveTo(-0.07, 1);
        ctx.lineTo(0.07, 1);
        ctx.bezierCurveTo(0.35, 0.7, 0.72, 0.05, 0.66, -0.55);
        ctx.bezierCurveTo(0.62, -0.88, 0.38, -1.0, 0.16, -0.98);
        ctx.lineTo(0, -0.84);
        ctx.lineTo(-0.16, -0.98);
        ctx.bezierCurveTo(-0.38, -1.0, -0.62, -0.88, -0.66, -0.55);
        ctx.bezierCurveTo(-0.72, 0.05, -0.35, 0.7, -0.07, 1);
        ctx.closePath();
    }

    function petal(colors, back) {
        return WeatherKit.sprite(48, 64, (ctx, w, h) => {
            ctx.translate(w / 2, h / 2);
            ctx.scale(30, 30);
            petalPath(ctx);
            const g = ctx.createLinearGradient(0, 1, 0, -1);
            g.addColorStop(0, colors[0]);
            g.addColorStop(0.45, colors[1]);
            g.addColorStop(1, colors[2]);
            ctx.fillStyle = g;
            ctx.fill();

            ctx.save();
            ctx.clip();
            ctx.globalCompositeOperation = 'source-atop';
            // 两侧略暗、中间略亮，花瓣有一点弧度
            const side = ctx.createLinearGradient(-0.7, 0, 0.7, 0);
            side.addColorStop(0, 'rgba(190, 70, 110, 0.14)');
            side.addColorStop(0.5, 'rgba(255, 255, 255, 0.1)');
            side.addColorStop(1, 'rgba(190, 70, 110, 0.14)');
            ctx.fillStyle = side;
            ctx.fillRect(-1, -1, 2, 2);
            if (back) {
                ctx.fillStyle = 'rgba(205, 85, 125, 0.16)';
                ctx.fillRect(-1, -1, 2, 2);
            }
            // 从基部散开的脉纹
            ctx.strokeStyle = 'rgba(214, 96, 132, 0.18)';
            ctx.lineWidth = 0.025;
            for (const x of [-0.36, -0.18, 0, 0.18, 0.36]) {
                ctx.beginPath();
                ctx.moveTo(0, 0.95);
                ctx.quadraticCurveTo(x * 0.5, 0.2, x, -0.6);
                ctx.stroke();
            }
            ctx.restore();

            petalPath(ctx);
            ctx.strokeStyle = 'rgba(225, 110, 145, 0.25)';
            ctx.lineWidth = 0.04;
            ctx.stroke();
        });
    }

    const front = palettes.map((c) => petal(c, false));
    return {
        front,
        back: palettes.map((c) => petal(c, true)),
        blurred: front.map((img) => WeatherKit.blurred(img, 2.5)),
    };
});

class SakuraEffect extends WeatherEffect {
    spawn(p, env, initial) {
        const z = p.z;
        const R = WeatherKit.rand;
        p.near = z > 0.9;
        p.variant = Math.floor(Math.random() * 3);
        p.size = p.near ? R(30, 44) : (11 + 17 * z) * R(0.85, 1.15);   // 花瓣长度（像素）
        p.alpha = p.near ? R(0.55, 0.75) : 0.6 + 0.4 * z;
        p.fall = (0.45 + 0.9 * z) * R(0.8, 1.2);
        p.amp = (6 + 24 * z) * R(0.6, 1.3);
        p.freq = R(0.5, 1.0);
        p.phase = R(0, Math.PI * 2);
        p.rot = R(0, Math.PI * 2);
        p.spin = R(-1.2, 1.2);
        p.flip = R(0, Math.PI * 2);
        p.flipSpeed = R(1.2, 3.2) * (Math.random() < 0.5 ? -1 : 1);
        p.tilt = R(0, Math.PI * 2);
        p.tiltSpeed = R(0.4, 1.2);
        p.par = WeatherEffect.parallaxOf(z);
        p.bx = R(0, env.width);
        p.y = initial ? R(-20, env.height) : -p.size - R(10, 100);
    }

    step(p, dt, env) {
        const sec = dt / 60;
        p.phase += p.freq * sec;
        p.rot += p.spin * sec;
        p.flip += p.flipSpeed * sec;
        p.tilt += p.tiltSpeed * sec;
        // 侧面朝下时阻力小，落得快一点；平着的时候慢慢飘
        p.y += p.fall * (0.75 + 0.5 * Math.abs(Math.sin(p.flip))) * dt;
        p.bx += (0.25 + env.wind) * (0.3 + p.z) * dt;
        return WeatherEffect.wrapX(p, env, 60);
    }

    drawParticle(ctx, p, env) {
        const sp = sakuraSprites();
        const c = Math.cos(p.flip);
        const front = c >= 0;
        // 侧对镜头时也留一些宽度，不压成一条线（细线看起来像雨丝）
        const sx = (front ? 1 : -1) * (0.3 + 0.7 * Math.abs(c));
        const img = p.near ? sp.blurred[p.variant] : (front ? sp.front : sp.back)[p.variant];
        ctx.globalAlpha = p.alpha;
        WeatherKit.draw(ctx, env.dpr, img,
            p.bx + p.amp * Math.sin(p.phase) + env.px * p.par, p.y + env.py * p.par,
            p.size * PETAL_ASPECT, p.size, p.rot, sx, 0.8 + 0.2 * Math.cos(p.tilt));
    }
}
SakuraEffect.counts = { low: 35, medium: 70, high: 130 };
WeatherEffects.sakura = SakuraEffect;
