/**
 * weather.js — 天气粒子特效（Canvas 2D），随鼠标做视差漂移
 */

'use strict';

class WeatherParticleManager {
    constructor() {
        this.canvas = document.getElementById('weather-canvas');
        this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
        this.type = 'none';
        this.density = 'medium';
        this.speed = 1.0;
        this.parallax = true;
        this.particles = [];
        this.width = window.innerWidth;
        this.height = window.innerHeight;

        window.addEventListener('resize', () => this.resize());
        this.resize();
    }

    resize() {
        if (!this.canvas) return;
        this.width = window.innerWidth;
        this.height = window.innerHeight;
        this.canvas.width = this.width;
        this.canvas.height = this.height;
    }

    setConfig(config) {
        if (!config) return;
        const typeChanged = this.type !== config.type;
        const densityChanged = this.density !== config.density;
        this.type = config.type || 'none';
        this.density = config.density || 'medium';
        this.speed = config.speed !== undefined ? config.speed : 1.0;
        this.parallax = config.parallax !== false;

        if (typeChanged || densityChanged) {
            this.initParticles();
        }
    }

    initParticles() {
        this.particles = [];
        if (this.type === 'none' || !this.ctx) {
            if (this.ctx) this.ctx.clearRect(0, 0, this.width, this.height);
            return;
        }

        const counts = {
            rain:     { low: 80,  medium: 160, high: 280 },
            snow:     { low: 50,  medium: 100, high: 200 },
            sakura:   { low: 25,  medium: 50,  high: 90 },
            leaves:   { low: 20,  medium: 40,  high: 75 },
            sunlight: { low: 30,  medium: 65,  high: 120 },
        };

        const count = (counts[this.type] && counts[this.type][this.density]) || 60;

        for (let i = 0; i < count; i++) {
            this.particles.push(this.createParticle(true));
        }
    }

    createParticle(randomY = false) {
        const y = randomY ? Math.random() * this.height : -30;
        const x = Math.random() * this.width;
        const depth = 0.2 + Math.random() * 0.8; // 深度 0.2 (远景) ~ 1.0 (近景)

        switch (this.type) {
            case 'rain':
                return {
                    x, y,
                    len: (16 + Math.random() * 14) * (depth * 0.6 + 0.7),
                    speed: (18 + Math.random() * 8) * (depth * 0.5 + 0.7),
                    depth,
                    alpha: (0.35 + Math.random() * 0.45) * depth,
                };
            case 'snow':
                return {
                    x, y,
                    radius: (2.0 + Math.random() * 3.5) * depth,
                    speed: (1.2 + Math.random() * 1.8) * depth,
                    angle: Math.random() * Math.PI * 2,
                    swingSpeed: 0.02 + Math.random() * 0.03,
                    swingRadius: 1.0 + Math.random() * 2.0,
                    depth,
                    alpha: 0.4 + Math.random() * 0.5,
                };
            case 'sakura':
                return {
                    x, y,
                    size: (10 + Math.random() * 8) * depth,
                    speed: (1.4 + Math.random() * 1.6) * depth,
                    rot: Math.random() * Math.PI * 2,
                    rotSpeed: (Math.random() - 0.5) * 0.04,
                    flip: Math.random() * Math.PI,
                    flipSpeed: 0.02 + Math.random() * 0.03,
                    depth,
                    color: Math.random() > 0.4 ? 'rgba(255, 183, 197, ' : 'rgba(255, 160, 180, ',
                };
            case 'leaves':
                const colors = ['#e25822', '#d35400', '#f39c12', '#e67e22', '#c0392b'];
                return {
                    x, y,
                    size: (12 + Math.random() * 12) * depth,
                    speed: (1.6 + Math.random() * 1.8) * depth,
                    rot: Math.random() * Math.PI * 2,
                    rotSpeed: (Math.random() - 0.5) * 0.03,
                    flip: Math.random() * Math.PI,
                    flipSpeed: 0.02 + Math.random() * 0.025,
                    color: colors[Math.floor(Math.random() * colors.length)],
                    depth,
                };
            case 'sunlight':
                return {
                    x, y: Math.random() * this.height,
                    radius: (15 + Math.random() * 35) * depth,
                    speedY: -(0.2 + Math.random() * 0.5) * depth,
                    speedX: (Math.random() - 0.5) * 0.4,
                    phase: Math.random() * Math.PI * 2,
                    pulseSpeed: 0.015 + Math.random() * 0.02,
                    depth,
                    baseAlpha: 0.15 + Math.random() * 0.25,
                };
            default:
                return { x, y, depth: 1 };
        }
    }

    update(delta, mouseX, mouseY) {
        if (this.type === 'none' || !this.ctx || this.particles.length === 0) return;
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.width, this.height);

        const spd = this.speed;
        const pOffset = this.parallax;

        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];

            // 视差位移量：近处粒子漂得更快，产生强烈的真 3D 景深感
            const pX = pOffset ? -mouseX * p.depth * 36 : 0;
            const pY = pOffset ? -mouseY * p.depth * 36 : 0;

            switch (this.type) {
                case 'rain': {
                    p.y += p.speed * spd * delta;
                    const wind = (mouseX * 10 + 2);
                    p.x += wind * spd * delta * 0.3;

                    if (p.y > this.height + 30) {
                        Object.assign(p, this.createParticle(false));
                    }

                    const rx = p.x + pX;
                    const ry = p.y + pY;
                    ctx.beginPath();
                    ctx.moveTo(rx, ry);
                    ctx.lineTo(rx + wind * 0.5, ry + p.len);
                    ctx.strokeStyle = `rgba(180, 215, 255, ${p.alpha})`;
                    ctx.lineWidth = p.depth * 1.5;
                    ctx.stroke();
                    break;
                }
                case 'snow': {
                    p.angle += p.swingSpeed * spd * delta;
                    p.x += (Math.sin(p.angle) * p.swingRadius + mouseX * 2) * spd * delta;
                    p.y += p.speed * spd * delta;

                    if (p.y > this.height + 20) {
                        Object.assign(p, this.createParticle(false));
                    }

                    const rx = p.x + pX;
                    const ry = p.y + pY;
                    ctx.beginPath();
                    ctx.arc(rx, ry, p.radius, 0, Math.PI * 2);
                    ctx.fillStyle = `rgba(255, 255, 255, ${p.alpha})`;
                    ctx.fill();
                    break;
                }
                case 'sakura': {
                    p.rot += p.rotSpeed * spd * delta;
                    p.flip += p.flipSpeed * spd * delta;
                    p.x += (Math.sin(p.flip) * 1.5 + 0.8 + mouseX * 3) * spd * delta;
                    p.y += p.speed * spd * delta;

                    if (p.y > this.height + 30 || p.x > this.width + 30) {
                        Object.assign(p, this.createParticle(false));
                    }

                    const rx = p.x + pX;
                    const ry = p.y + pY;
                    ctx.save();
                    ctx.translate(rx, ry);
                    ctx.rotate(p.rot);
                    ctx.scale(Math.cos(p.flip), 1);

                    ctx.beginPath();
                    ctx.moveTo(0, -p.size);
                    ctx.bezierCurveTo(p.size * 0.8, -p.size * 0.6, p.size * 0.7, p.size * 0.6, 0, p.size);
                    ctx.bezierCurveTo(-p.size * 0.7, p.size * 0.6, -p.size * 0.8, -p.size * 0.6, 0, -p.size);
                    ctx.fillStyle = p.color + '0.85)';
                    ctx.fill();
                    ctx.restore();
                    break;
                }
                case 'leaves': {
                    p.rot += p.rotSpeed * spd * delta;
                    p.flip += p.flipSpeed * spd * delta;
                    p.x += (Math.sin(p.flip) * 2.2 + 0.5 + mouseX * 3) * spd * delta;
                    p.y += p.speed * spd * delta;

                    if (p.y > this.height + 30 || p.x > this.width + 30) {
                        Object.assign(p, this.createParticle(false));
                    }

                    const rx = p.x + pX;
                    const ry = p.y + pY;
                    ctx.save();
                    ctx.translate(rx, ry);
                    ctx.rotate(p.rot);
                    ctx.scale(Math.cos(p.flip), 1);

                    ctx.beginPath();
                    ctx.ellipse(0, 0, p.size * 0.6, p.size, 0, 0, Math.PI * 2);
                    ctx.fillStyle = p.color;
                    ctx.globalAlpha = 0.88 * p.depth;
                    ctx.fill();
                    ctx.restore();
                    break;
                }
                case 'sunlight': {
                    p.phase += p.pulseSpeed * spd * delta;
                    p.y += p.speedY * spd * delta;
                    p.x += (p.speedX + Math.sin(p.phase) * 0.5) * spd * delta;

                    if (p.y < -50) p.y = this.height + 30;
                    if (p.x < -50) p.x = this.width + 30;
                    if (p.x > this.width + 50) p.x = -30;

                    const rx = p.x + pX;
                    const ry = p.y + pY;
                    const alpha = p.baseAlpha * (0.6 + Math.sin(p.phase) * 0.4);

                    const grad = ctx.createRadialGradient(rx, ry, 0, rx, ry, p.radius);
                    grad.addColorStop(0, `rgba(255, 235, 175, ${alpha})`);
                    grad.addColorStop(0.5, `rgba(255, 215, 130, ${alpha * 0.5})`);
                    grad.addColorStop(1, 'rgba(255, 200, 100, 0)');

                    ctx.beginPath();
                    ctx.arc(rx, ry, p.radius, 0, Math.PI * 2);
                    ctx.fillStyle = grad;
                    ctx.fill();
                    break;
                }
            }
        }
    }
}
