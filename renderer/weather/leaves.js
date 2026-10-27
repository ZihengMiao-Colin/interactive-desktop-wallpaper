/**
 * weather/leaves.js — 枫叶
 *
 * 叶片轮廓按裂片生成：七裂（鸡爪槭）和五裂两种，边缘带锯齿，每张随机微调。
 * 颜色是从叶心到叶缘的径向渐变（黄心红边、正红、金黄、深红、黄绿转橙），
 * 有叶脉、叶柄、受光明暗、偏暗的干边，部分带小斑点；背面颜色发浅。
 *
 * 落叶有两种动法：
 *   - 摆荡：像钟摆一样左右滑翔，经过中间时最快，到两头几乎停住、微微上扬
 *   - 翻滚：边转边翻，落得快一些
 */

'use strict';

/**
 * 枫叶轮廓，单位坐标：原点是叶柄连接处，y 向下，主裂片朝上。
 * @param {{ angle: number, len: number }[]} lobes 从左到右排列；angle 是和竖直向上的夹角（右为正）
 * @param {{ sinus: number, bulge: number, teeth: number, tooth: number }} shape
 *   sinus 缺口深度（相对两侧较短裂片的比例）、bulge 裂片边缘外凸程度、teeth 每条边的锯齿数、tooth 锯齿大小
 * @returns {number[][]} 闭合多边形的顶点
 */
function mapleOutline(lobes, shape) {
    const at = (a, r) => [Math.sin(a) * r, -Math.cos(a) * r];
    const first = lobes[0];
    const last = lobes[lobes.length - 1];
    const pts = [[0, 0.04]];
    let prev = at(first.angle - 0.45, first.len * 0.25);
    pts.push(prev);
    lobes.forEach((lobe, i) => {
        const tip = at(lobe.angle, lobe.len);
        const nextLobe = lobes[i + 1];
        const next = nextLobe
            ? at((lobe.angle + nextLobe.angle) / 2, shape.sinus * Math.min(lobe.len, nextLobe.len))
            : at(last.angle + 0.45, last.len * 0.25);
        serrate(pts, prev, tip, shape, true);
        serrate(pts, tip, next, shape, false);
        prev = next;
    });
    pts.push([0, 0.04]);
    return pts;
}

/**
 * 从 a 到 b 的一条外凸、带锯齿的边（不含 a，含 b）。轮廓按顺时针走，(dy, -dx) 指向叶片外侧。
 * 锯齿尖朝向裂片尖端，靠近缺口处变小。
 */
function serrate(pts, a, b, shape, towardTip) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    const nx = dy / len;
    const ny = -dx / len;
    const cx = (a[0] + b[0]) / 2 + nx * shape.bulge * len;
    const cy = (a[1] + b[1]) / 2 + ny * shape.bulge * len;
    const k = shape.teeth * 2;
    for (let j = 1; j <= k; j++) {
        const t = j / k;
        const u = 1 - t;
        let x = u * u * a[0] + 2 * u * t * cx + t * t * b[0];
        let y = u * u * a[1] + 2 * u * t * cy + t * t * b[1];
        if (j % 2 === 1) {
            const size = shape.tooth * len * WeatherKit.smoothstep(0, 0.45, towardTip ? t : u);
            const lean = towardTip ? 0.6 : -0.6;
            x += (nx + (dx / len) * lean) * size;
            y += (ny + (dy / len) * lean) * size;
        }
        pts.push([x, y]);
    }
}

const leafSprites = WeatherKit.once(() => {
    const palettes = [
        { center: '#f7c948', mid: '#ee7a22', edge: '#c0341d', vein: 'rgba(255, 228, 160, 0.5)', stem: '#8a3a12' },  // 黄心红边
        { center: '#ef5a32', mid: '#d6301f', edge: '#9b1616', vein: 'rgba(255, 196, 150, 0.45)', stem: '#7a1d10' }, // 正红
        { center: '#ffd75a', mid: '#f6a524', edge: '#e0701b', vein: 'rgba(150, 85, 20, 0.35)', stem: '#9a5a16' },   // 金黄
        { center: '#cf2a2a', mid: '#a5161f', edge: '#6e0d14', vein: 'rgba(255, 160, 130, 0.4)', stem: '#5e0f10' },  // 深红
        { center: '#cdbf4a', mid: '#e8a23a', edge: '#d1561d', vein: 'rgba(120, 90, 30, 0.35)', stem: '#7a5a1a' },   // 黄绿转橙
    ];
    const deg = Math.PI / 180;
    const shapes = [
        {   // 七裂，裂得深、锯齿细
            angles: [-128, -86, -43, 0, 43, 86, 128], lens: [0.5, 0.78, 0.95, 1, 0.95, 0.78, 0.5],
            sinus: 0.4, bulge: 0.26, teeth: 5, tooth: 0.045,
        },
        {   // 五裂，裂片宽、锯齿大
            angles: [-118, -60, 0, 60, 118], lens: [0.62, 0.92, 1, 0.92, 0.62],
            sinus: 0.42, bulge: 0.24, teeth: 4, tooth: 0.07,
        },
    ];

    function outlineOf(shape) {
        const lobes = shape.angles.map((a, i) => ({
            angle: a * deg + WeatherKit.rand(-0.05, 0.05),
            len: shape.lens[i] * WeatherKit.rand(0.92, 1.05),
        }));
        return { lobes, pts: mapleOutline(lobes, shape) };
    }

    function leaf(outline, pal, back, spots) {
        return WeatherKit.sprite(128, 128, (ctx) => {
            ctx.translate(64, 68);
            ctx.scale(56, 56);
            const path = () => {
                ctx.beginPath();
                outline.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
                ctx.closePath();
            };

            // 叶柄画在叶片下面
            ctx.strokeStyle = pal.stem;
            ctx.lineCap = 'round';
            ctx.lineWidth = 0.05;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.quadraticCurveTo(0.06, 0.22, 0.05, 0.45);
            ctx.stroke();

            path();
            const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
            g.addColorStop(0, pal.center);
            g.addColorStop(0.45, pal.mid);
            g.addColorStop(1, pal.edge);
            ctx.fillStyle = g;
            ctx.fill();

            ctx.save();
            ctx.clip();
            // 左上受光、右下背光
            const light = ctx.createLinearGradient(-1, -1, 1, 1);
            light.addColorStop(0, 'rgba(255, 255, 255, 0.14)');
            light.addColorStop(1, 'rgba(0, 0, 0, 0.16)');
            ctx.fillStyle = light;
            ctx.fillRect(-1.2, -1.2, 2.4, 2.4);
            if (back) {
                ctx.fillStyle = 'rgba(255, 240, 215, 0.18)';
                ctx.fillRect(-1.2, -1.2, 2.4, 2.4);
            }
            for (const s of spots) {
                ctx.fillStyle = 'rgba(70, 25, 10, 0.25)';
                ctx.beginPath();
                ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
                ctx.fill();
            }
            // 叶脉：从叶柄连接处到每个裂片尖端，越往外越细
            ctx.fillStyle = pal.vein;
            for (const lobe of outline.lobes) {
                const sx = Math.sin(lobe.angle);
                const sy = -Math.cos(lobe.angle);
                const r = lobe.len * 0.9;
                ctx.beginPath();
                ctx.moveTo(-sy * 0.018, sx * 0.018);
                ctx.lineTo(sx * r - sy * 0.003, sy * r + sx * 0.003);
                ctx.lineTo(sx * r + sy * 0.003, sy * r - sx * 0.003);
                ctx.lineTo(sy * 0.018, -sx * 0.018);
                ctx.fill();
            }
            // 干边：只留在叶片里面的半圈描边
            path();
            ctx.strokeStyle = 'rgba(60, 15, 5, 0.32)';
            ctx.lineWidth = 0.05;
            ctx.stroke();
            ctx.restore();
        });
    }

    const variants = [];
    for (const pal of palettes) {
        for (const shape of shapes) {
            const outline = outlineOf(shape);
            const spots = [];
            if (Math.random() < 0.5) {
                const n = 3 + Math.floor(Math.random() * 5);
                for (let i = 0; i < n; i++) {
                    const a = WeatherKit.rand(0, Math.PI * 2);
                    const r = WeatherKit.rand(0.1, 0.55);
                    spots.push({ x: Math.cos(a) * r, y: Math.sin(a) * r - 0.2, r: WeatherKit.rand(0.015, 0.045) });
                }
            }
            const front = leaf(outline, pal, false, spots);
            variants.push({ front, back: leaf(outline, pal, true, spots), blurred: WeatherKit.blurred(front, 3) });
        }
    }
    return variants;
});

class LeavesEffect extends WeatherEffect {
    spawn(p, env, initial) {
        const z = p.z;
        const R = WeatherKit.rand;
        const sign = () => (Math.random() < 0.5 ? -1 : 1);
        p.near = z > 0.9;
        p.variant = Math.floor(Math.random() * leafSprites().length);
        p.size = p.near ? R(70, 96) : (26 + 34 * z) * R(0.85, 1.15);   // 贴图边长（像素），叶片约占八成
        p.alpha = p.near ? R(0.7, 0.85) : 0.72 + 0.28 * z;
        p.tumble = Math.random() < 0.35;
        p.fall = (0.55 + 1.1 * z) * R(0.85, 1.15) * (p.tumble ? 1.25 : 1);
        p.amp = p.tumble ? 4 + 10 * z : (18 + 46 * z) * R(0.7, 1.3);    // 左右摆荡幅度（像素）
        p.freq = p.tumble ? R(0.6, 1.0) : R(1.1, 1.8);                  // 摆荡频率（弧度 / 秒）
        p.phase = R(0, Math.PI * 2);
        p.rot = p.tumble ? R(0, Math.PI * 2) : R(-0.6, 0.6);
        p.spin = p.tumble ? R(1.2, 2.6) * sign() : R(-0.15, 0.15);
        p.flip = R(0, Math.PI * 2);
        p.flipSpeed = (p.tumble ? R(2.0, 4.0) : R(0.25, 0.7)) * sign();
        p.swing = p.tumble ? 0 : R(0.5, 0.8);                            // 摆荡时的倾斜幅度（弧度）
        p.par = WeatherEffect.parallaxOf(z);
        p.bx = R(0, env.width);
        p.y = initial ? R(-40, env.height) : -p.size - R(20, 120);
    }

    step(p, dt, env) {
        const sec = dt / 60;
        p.phase += p.freq * sec;
        p.rot += p.spin * sec;
        p.flip += p.flipSpeed * sec;
        // 摆荡：经过中间时最快、往下掉得多，到两头几乎停住
        const c = Math.cos(p.phase);
        p.y += p.fall * (p.tumble ? 1 : 0.35 + 0.95 * c * c) * dt;
        p.bx += (0.15 + env.wind) * (0.25 + 0.9 * p.z) * dt;
        return WeatherEffect.wrapX(p, env, 80);
    }

    drawParticle(ctx, p, env) {
        const v = leafSprites()[p.variant];
        const c = Math.cos(p.phase);
        const f = Math.cos(p.flip);
        const front = f >= 0;
        const sx = (front ? 1 : -1) * (0.25 + 0.75 * Math.abs(f));
        // 摆到两头时微微上扬（钟摆的弧线），叶片朝运动方向倾斜
        const arc = p.tumble ? 0 : p.amp * 0.12 * Math.cos(2 * p.phase);
        const sy = p.tumble ? 0.85 + 0.15 * Math.sin(p.flip * 0.7) : 0.7 + 0.3 * c * c;
        const img = p.near ? v.blurred : front ? v.front : v.back;
        ctx.globalAlpha = p.alpha;
        WeatherKit.draw(ctx, env.dpr, img,
            p.bx + p.amp * Math.sin(p.phase) + env.px * p.par, p.y + arc + env.py * p.par,
            p.size, p.size, p.rot + p.swing * c, sx, sy);
    }
}
LeavesEffect.counts = { low: 14, medium: 28, high: 50 };
WeatherEffects.leaves = LeavesEffect;
