/**
 * ===========================================================================
 * app.js — 互动桌面壁纸 · 伪 3D 深度视差 (Pseudo-3D Depth Parallax)
 * ===========================================================================
 *
 * 【核心技术原理】
 *
 * 本项目的核心是使用 Pixi.js 的 DisplacementFilter（位移滤镜 / 置换贴图滤镜），
 * 结合一张"深度图 (Depth Map)"来实现伪 3D 视差效果。
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  DisplacementFilter 工作原理（通俗解释）：                        │
 * │                                                                  │
 * │  想象你在透过一块"凹凸不平的玻璃"看一张照片。                       │
 * │  玻璃凸起的地方，光线会偏折，让你看到照片上略微偏移的像素。          │
 * │                                                                  │
 * │  DisplacementFilter 就是这块"虚拟玻璃"：                          │
 * │  - 它读取一张"置换贴图"（我们的 depth_map.png）                    │
 * │  - 贴图中每个像素的颜色值决定了该位置的偏移量                       │
 * │  - 白色区域 → 偏移量大（近景，移动时"甩"得远）                     │
 * │  - 黑色区域 → 偏移量小（远景，几乎不动）                           │
 * │  - 灰色区域 → 介于两者之间                                        │
 * │                                                                  │
 * │  当我们用鼠标改变滤镜的 scale（强度）时：                          │
 * │  - 白色（近景）像素被大幅推移 → 看起来离你很近                      │
 * │  - 黑色（远景）像素几乎不动 → 看起来离你很远                       │
 * │  → 这就是"视差"（Parallax）！                                     │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * 【Lerp（线性插值）平滑算法】
 *
 * 如果直接把鼠标坐标映射到滤镜强度，画面会"硬切"——鼠标动一下，画面瞬间跳变。
 * Lerp 让当前值以一定比例"追赶"目标值，每次只接近一点点，形成惯性阻尼效果。
 *
 * 公式：current = current + (target - current) × smoothness
 *
 * 例如：current=0, target=10, smoothness=0.1
 *   第1帧：0   + (10-0)  × 0.1 = 1.0
 *   第2帧：1.0 + (10-1)  × 0.1 = 1.9
 *   第3帧：1.9 + (10-1.9)× 0.1 = 2.71  ... 逐渐逼近 10
 *
 * smoothness 越小 → 越平滑但有延迟感
 * smoothness 越大 → 越灵敏但可能抖动
 */

'use strict';

// ==================== 配置参数 ====================
const CONFIG = {
    /** 视差强度系数 —— 控制位移的最大偏移量 */
    parallaxMultiplier: 20,
    /** 平滑度 —— Lerp 插值的比率 (0~1)，越小越平滑 */
    smoothness: 0.08,
    /** 对焦平面深度 (0.0~1.0) —— 该深度的物体保持完全静止，彻底消除割裂线 */
    focusDepth: 0.50,
    /** 在 Lively Wallpaper 中运行时，设置此项为 true 以隐藏调试面板 */
    hideDebugPanel: false,
};

// ==================== DOM 元素引用 ====================
const debugPanel = document.getElementById('debug-panel');
const debugToggle = document.getElementById('debug-toggle');
const parallaxSlider = document.getElementById('parallax-strength');
const parallaxValueEl = document.getElementById('parallax-value');
const smoothnessSlider = document.getElementById('smoothness');
const smoothnessValueEl = document.getElementById('smoothness-value');
const focusSlider = document.getElementById('focus-depth');
const focusValueEl = document.getElementById('focus-value');

// 如果配置要求隐藏调试面板
if (CONFIG.hideDebugPanel && debugPanel) {
    debugPanel.style.display = 'none';
}

// ==================== Pixi.js 应用初始化 ====================

/**
 * 创建 Pixi.js Application 实例。
 */
const app = new PIXI.Application({
    width: window.innerWidth,             // 初始宽度 = 窗口宽度
    height: window.innerHeight,           // 初始高度 = 窗口高度
    backgroundColor: 0x000000,            // 黑色背景
    antialias: true,                      // 开启抗锯齿
    resolution: window.devicePixelRatio || 1,  // 适配高 DPI 屏幕
    autoDensity: true,
    resizeTo: window,
});

// 将 Pixi.js 生成的 canvas 插入到页面中
document.body.appendChild(app.view);

// ==================== 2.5D 深度视差 Shader 定义 ====================

/**
 * 自定义顶点着色器
 * 核心关键：直接将 aVertexPosition (归一化 0.0 ~ 1.0 的全屏 Quad 坐标) 传给片元着色器。
 * Pixi.js 默认 Filter 顶点着色器会乘以 outputFrame.zw * inputSize.zw，导致由于
 * 内部分配的 Framebuffer 尺寸比例与屏幕不一致而严重横向拉长图片！
 */
const PARALLAX_VERTEX_SHADER = `
attribute vec2 aVertexPosition;
uniform mat3 projectionMatrix;
uniform vec4 outputFrame;

varying vec2 vTextureCoord;

vec4 filterVertexPosition(void) {
    vec2 position = aVertexPosition * max(outputFrame.zw, vec2(0.0)) + outputFrame.xy;
    return vec4((projectionMatrix * vec3(position, 1.0)).xy, 0.0, 1.0);
}

void main(void) {
    gl_Position = filterVertexPosition();
    // 强制传递 0.0 ~ 1.0 的绝对归一化屏幕坐标
    vTextureCoord = aVertexPosition;
}
`;

/**
 * 专属 2.5D 深度视差着色器源码
 *
 * 核心设计：
 * 1. 数学级精确 Cover 坐标映射：彻底杜绝深度图与原图因缩放错位产生的直线刀痕
 * 2. 真实 2D 物理透视位移：X/Y 轴与鼠标方向 100% 严密对应
 * 3. 对焦平面锚定 (uFocus)：主体深度处位移为 0，消灭前后两极相反对拉的剪切割裂
 * 4. 软截断阻尼 (Soft Clamping)：限制最大相对位移，防止大幅度运动拉开大缝隙
 */
const PARALLAX_FRAGMENT_SHADER = `
precision mediump float;

varying vec2 vTextureCoord;

uniform sampler2D uImage;
uniform sampler2D uDepth;
uniform vec2 uMouse;
uniform float uStrength;
uniform float uFocus;
uniform vec2 uCoverScale;
uniform vec2 uCoverOffset;

void main(void) {
    // 1. 将全屏 UV 映射为完美的 Cover 模式下的图片 UV 坐标 (0.0 ~ 1.0)
    vec2 baseUV = vTextureCoord * uCoverScale + uCoverOffset;

    // 2. 采样深度信息 (灰度图取 R 通道)
    float depth = texture2D(uDepth, baseUV).r;

    // 3. 计算相对视觉焦点的位移：当 depth == uFocus 时完全静止，主体绝不撕裂
    float diff = depth - uFocus;

    // 4. 2D 真实物理视差：鼠标向右看(uMouse.x>0)，近景(diff>0)向相反方向移动
    vec2 parallax = uMouse * diff * uStrength;

    // 5. 软截断阻尼 (Soft Clamping)：根据视差强度自适应最大位移，强度调大时位移大幅放开
    float maxDist = max(0.035, uStrength * 1.6);
    float pLen = length(parallax);
    if (pLen > maxDist) {
        parallax = (parallax / pLen) * (maxDist + (pLen - maxDist) * 0.2);
    }

    // 6. 最终采样坐标 + 安全微钳制
    vec2 finalUV = clamp(baseUV + parallax, vec2(0.001), vec2(0.999));

    // 7. 采样并输出真实原图色彩
    gl_FragColor = texture2D(uImage, finalUV);
}
`;

/**
 * 深度视差 Filter 类
 */
class DepthParallaxFilter extends PIXI.Filter {
    constructor(imageTexture, depthTexture) {
        super(PARALLAX_VERTEX_SHADER, PARALLAX_FRAGMENT_SHADER, {
            uImage: imageTexture,
            uDepth: depthTexture,
            uMouse: new Float32Array([0.0, 0.0]),
            uStrength: 0.025,
            uFocus: 0.50,
            uCoverScale: new Float32Array([1.0, 1.0]),
            uCoverOffset: new Float32Array([0.0, 0.0]),
        });
    }
}

// ==================== 全局状态变量 ====================

/** 全屏显示精灵 */
let screenSprite = null;

/** 专属深度视差滤镜实例 */
let parallaxFilter = null;

/** 纹理对象缓存 */
let bgTexture = null;
let depthTexture = null;

/** 鼠标位置的目标值（归一化到 [-1, 1]） */
let targetX = 0;
let targetY = 0;

/** 当前位置的插值状态（用于 Lerp 平滑） */
let currentX = 0;
let currentY = 0;

/** 原始图片尺寸缓存（用于计算 Cover 投影） */
let bgNaturalWidth = 0;
let bgNaturalHeight = 0;

// ==================== 图片预加载 ====================

/**
 * 使用 Image 对象预加载图片。
 * @param {string} url - 图片路径或 Data URL
 * @returns {Promise<HTMLImageElement>}
 */
function loadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const displayUrl = url.startsWith('data:') ? url.slice(0, 32) + '...' : url;
            console.log(`[加载完成] ${displayUrl} (${img.naturalWidth}×${img.naturalHeight})`);
            resolve(img);
        };
        img.onerror = (err) => {
            const displayUrl = url.startsWith('data:') ? url.slice(0, 32) + '...' : url;
            console.error(`[加载失败] ${displayUrl}`, err);
            reject(new Error(`无法加载图片: ${displayUrl}`));
        };

        // 如果是 Windows 绝对路径且在 Electron 环境下，优先通过 preload 读取为 Data URL 避免安全性限制
        if (isElectron && window.electronAPI && window.electronAPI.readFileAsDataURL && (url.includes(':') || url.includes('\\'))) {
            try {
                const dataUrl = window.electronAPI.readFileAsDataURL(url);
                if (dataUrl) {
                    img.src = dataUrl;
                    return;
                }
            } catch (readErr) {
                console.warn('[loadImage] 读取本地文件失败，回退到原生路径:', readErr);
            }
        }

        img.src = url;
    });
}

// ==================== Cover 模式投影坐标计算 ====================

/**
 * 计算将原始图片居中 Cover 到当前窗口所需的 UV 缩放与偏移。
 * 确保 Shader 在任何屏幕比例下，原图与深度图 100% 像素级对齐且不产生任何拉伸变形。
 */
function updateCoverUniforms() {
    if (!parallaxFilter) return;

    const screenW = app.screen.width;
    const screenH = app.screen.height;
    const imgW = bgNaturalWidth || screenW;
    const imgH = bgNaturalHeight || screenH;

    const screenAspect = screenW / screenH;
    const imgAspect = imgW / imgH;

    let scaleX = 1.0;
    let scaleY = 1.0;
    let offsetX = 0.0;
    let offsetY = 0.0;

    if (screenAspect > imgAspect) {
        // 屏幕比图片更宽：原图上下被等比居中裁切
        scaleY = imgAspect / screenAspect;
        offsetY = (1.0 - scaleY) * 0.5;
    } else {
        // 屏幕比图片更高：原图左右被等比居中裁切
        scaleX = screenAspect / imgAspect;
        offsetX = (1.0 - scaleX) * 0.5;
    }

    // 核心关键：必须以数组整体赋值，触发 Pixi.js UniformGroup 的 Proxy setter 标记 dirtyId++
    parallaxFilter.uniforms.uCoverScale = [scaleX, scaleY];
    parallaxFilter.uniforms.uCoverOffset = [offsetX, offsetY];
}

// ==================== 主初始化流程 ====================

/**
 * 主初始化函数。
 *
 * 流程：
 * 1. 预加载 background.png 和 depth_map.png
 * 2. 创建纹理和精灵
 * 3. 应用 Cover 缩放
 * 4. 设置 DisplacementFilter
 * 5. 绑定交互事件
 * 6. 启动动画循环
 */
async function init() {
    try {
        console.log('[初始化] 开始加载图片素材...');

        // ---- 检查是否有上次保存的壁纸与深度图 ----
        let targetBgPath = 'background.png';
        let targetDepthSource = 'depth_map.png';

        if (isElectron && window.electronAPI) {
            try {
                const savedConfig = await window.electronAPI.getConfig();
                if (savedConfig) {
                    applyCustomElementsConfig(savedConfig);
                }
                if (savedConfig && savedConfig.currentImage && window.electronAPI.fileExists(savedConfig.currentImage)) {
                    targetBgPath = savedConfig.currentImage;
                    console.log('[初始化] 发现上次保存的壁纸:', targetBgPath);
                    const cachedDepth = await window.electronAPI.getDepthCache(targetBgPath);
                    if (cachedDepth) {
                        targetDepthSource = cachedDepth;
                        console.log('[初始化] 发现配套的深度图缓存');
                    }
                }
            } catch (cfgErr) {
                console.warn('[初始化] 检查上次壁纸配置失败:', cfgErr);
            }
        }

        // ---- 第 1 步：加载背景图（必需） ----
        let bgImg;
        try {
            bgImg = await loadImage(targetBgPath);
        } catch (err) {
            console.error(`[初始化] ${targetBgPath} 加载失败:`, err.message);
            // 尝试回退到 background.png
            try {
                bgImg = await loadImage('background.png');
            } catch (err2) {
                // 尝试从 userData 目录加载
                if (isElectron && window.electronAPI) {
                    try {
                        const userPath = await window.electronAPI.getUserDataPath();
                        const altBgPath = userPath + '\\background.png';
                        console.log('[初始化] 尝试备用路径:', altBgPath);
                        bgImg = await loadImage(altBgPath);
                    } catch (e2) {
                        throw new Error(
                            '未找到有效的背景图片。\n\n' +
                            '请通过托盘菜单 → "更换壁纸" 来选择一张图片作为壁纸。'
                        );
                    }
                } else {
                    throw new Error(
                        '未找到 background.png。\n请确保 background.png 与 index.html 在同一目录。'
                    );
                }
            }
        }

        // ---- 第 2 步：加载深度图（可选，缺失时自动生成灰色占位图） ----
        let depthImg;
        try {
            depthImg = await loadImage(targetDepthSource);
            console.log('[初始化] 深度图加载成功');
        } catch (depthErr) {
            console.warn('[初始化] 深度图未找到，使用默认灰色深度图（无深度视差效果）');
            console.warn('[初始化] 可通过设置面板生成真正的深度图');
            depthImg = createFallbackDepthImage(bgImg.naturalWidth, bgImg.naturalHeight);
        }

        // 缓存原始尺寸
        bgNaturalWidth = bgImg.naturalWidth;
        bgNaturalHeight = bgImg.naturalHeight;

        // ---- 第 2 步：从 Image 对象创建 Pixi.js 纹理 ----
        bgTexture = PIXI.Texture.from(bgImg);
        depthTexture = PIXI.Texture.from(depthImg);
        bgTexture.baseTexture.wrapMode = PIXI.WRAP_MODES.CLAMP;
        depthTexture.baseTexture.wrapMode = PIXI.WRAP_MODES.CLAMP;

        // ---- 第 3 步：创建全屏显示精灵与专属深度视差 Shader ----
        screenSprite = new PIXI.Sprite(PIXI.Texture.WHITE);
        screenSprite.width = app.screen.width;
        screenSprite.height = app.screen.height;

        parallaxFilter = new DepthParallaxFilter(bgTexture, depthTexture);
        screenSprite.filters = [parallaxFilter];

        // ---- 第 4 步：将精灵添加到 Pixi.js 舞台并计算 Cover 映射 ----
        app.stage.addChild(screenSprite);
        updateCoverUniforms();

        console.log('[初始化] 2.5D 深度视差 Shader 已加载！');

        console.log('[初始化] 完成！移动鼠标查看视差效果。');
        console.log(`[初始化] 窗口: ${app.screen.width}×${app.screen.height}`);
        console.log(`[初始化] 图片: ${bgNaturalWidth}×${bgNaturalHeight}`);

        // ---- 第 9 步：绑定事件 ----
        bindEvents();

        // ---- 第 10 步：启动动画循环 ----
        // Pixi.js 的 ticker 会在每帧（通常 60fps）调用我们的更新函数
        app.ticker.add(updateLoop);

        // 先手动出一帧：主进程有可能紧接着就发来"暂停渲染"信号
        // （比如启动瞬间恰好有全屏窗口），那样 ticker 会被停掉。
        // 这里保证画面上一定有内容，不会留下空白/黑屏。
        app.renderer.render(app.stage);

    } catch (error) {
        console.error('[初始化失败]', error);

        // 在页面上显示错误信息，方便排查
        showErrorMessage(error.message);
    }
}

// ==================== 事件绑定 ====================

function bindEvents() {
    // ---- 全局鼠标移动 ----
    if (isElectron && window.electronAPI) {
        // Electron 环境：使用主进程 IPC 推送的全局鼠标坐标
        window.electronAPI.onMouseMove((pos) => {
            targetX = (pos.x / window.innerWidth) * 2 - 1;
            targetY = (pos.y / window.innerHeight) * 2 - 1;
        });
        console.log('[事件] 使用 IPC 全局鼠标位置（WorkerW 兼容模式）');
    } else {
        // 浏览器环境：直接监听窗口内鼠标移动
        window.addEventListener('mousemove', (e) => {
            targetX = (e.clientX / window.innerWidth) * 2 - 1;
            targetY = (e.clientY / window.innerHeight) * 2 - 1;
        });
        console.log('[事件] 使用 window mousemove');
    }

    // ---- 窗口大小变化 ----
    window.addEventListener('resize', () => {
        if (screenSprite) {
            screenSprite.width = app.screen.width;
            screenSprite.height = app.screen.height;
        }
        updateCoverUniforms();
        console.log(`[窗口变化] ${app.screen.width}×${app.screen.height}`);
    });

    // ---- 调试面板：视差强度滑块 ----
    if (parallaxSlider) {
        parallaxSlider.addEventListener('input', () => {
            CONFIG.parallaxMultiplier = parseInt(parallaxSlider.value, 10);
            if (parallaxValueEl) {
                parallaxValueEl.textContent = CONFIG.parallaxMultiplier;
            }
            if (isElectron && window.electronAPI) {
                window.electronAPI.saveConfig({
                    parallaxMultiplier: CONFIG.parallaxMultiplier,
                    smoothness: CONFIG.smoothness,
                    focusDepth: CONFIG.focusDepth,
                });
            }
        });
    }

    // ---- 调试面板：平滑度滑块 ----
    if (smoothnessSlider) {
        smoothnessSlider.addEventListener('input', () => {
            CONFIG.smoothness = parseInt(smoothnessSlider.value, 10) / 100;
            if (smoothnessValueEl) {
                smoothnessValueEl.textContent = CONFIG.smoothness.toFixed(2);
            }
            if (isElectron && window.electronAPI) {
                window.electronAPI.saveConfig({
                    parallaxMultiplier: CONFIG.parallaxMultiplier,
                    smoothness: CONFIG.smoothness,
                    focusDepth: CONFIG.focusDepth,
                });
            }
        });
    }

    // ---- 调试面板：对焦深度滑块 ----
    if (focusSlider) {
        focusSlider.addEventListener('input', () => {
            CONFIG.focusDepth = parseInt(focusSlider.value, 10) / 100.0;
            if (focusValueEl) {
                focusValueEl.textContent = CONFIG.focusDepth.toFixed(2);
            }
            if (isElectron && window.electronAPI) {
                window.electronAPI.saveConfig({
                    parallaxMultiplier: CONFIG.parallaxMultiplier,
                    smoothness: CONFIG.smoothness,
                    focusDepth: CONFIG.focusDepth,
                });
            }
        });
    }

    // ---- 调试面板：折叠/展开按钮 ----
    if (debugToggle && debugPanel) {
        debugToggle.addEventListener('click', () => {
            debugPanel.classList.toggle('collapsed');
            const isCollapsed = debugPanel.classList.contains('collapsed');
            debugToggle.textContent = isCollapsed ? '+' : '−';
        });
    }
}

// ==================== 动画循环（核心 Shader 驱动） ====================

/**
 * 每帧更新函数 —— 由 Pixi.js Ticker 驱动（约 60fps）。
 * @param {number} delta - 帧时间增量
 */
function updateLoop(delta) {
    const frameAdjustedSmoothness = 1 - Math.pow(1 - CONFIG.smoothness, delta);

    // ---- Lerp 插值 ----
    currentX += (targetX - currentX) * frameAdjustedSmoothness;
    currentY += (targetY - currentY) * frameAdjustedSmoothness;

    // ---- 驱动 2.5D 深度视差 Shader ----
    if (parallaxFilter) {
        // 鼠标右移时 (currentX > 0)，近景往左移产生透视反差（整体赋值触发 Proxy setter）
        parallaxFilter.uniforms.uMouse = [-currentX, -currentY];

        // 视差强度系数转换：增大动态范围，让低强度微动细腻，高强度视差极强
        parallaxFilter.uniforms.uStrength = (CONFIG.parallaxMultiplier / 1000.0) * 1.25;

        // 对焦深度
        parallaxFilter.uniforms.uFocus = CONFIG.focusDepth !== undefined ? Number(CONFIG.focusDepth) : 0.50;
    }

    // ---- 驱动自定义元素 ----
    if (weatherManager) weatherManager.update(delta, currentX, currentY);
    if (stickerManager) stickerManager.update(currentX, currentY);
    if (vinylManager) vinylManager.update(currentX, currentY);
}

// ==================== 壁纸自定义元素管理器 ====================

// 1. 天气粒子特效管理器
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

// 2. 自定义本地贴纸/挂件管理器
class StickerManager {
    constructor() {
        this.container = document.getElementById('sticker-container');
        this.img = document.getElementById('sticker-img');
        this.config = null;
        this.currentPath = '';
    }

    setConfig(config) {
        this.config = config;
        if (!this.container || !this.img) return;

        if (!config || !config.enabled || !config.imagePath) {
            this.container.style.display = 'none';
            return;
        }

        // 加载贴纸图片
        if (this.currentPath !== config.imagePath) {
            this.currentPath = config.imagePath;
            if (isElectron && window.electronAPI) {
                const dataUrl = window.electronAPI.readFileAsDataURL(config.imagePath);
                if (dataUrl) {
                    this.img.src = dataUrl;
                } else {
                    this.img.src = config.imagePath;
                }
            } else {
                this.img.src = config.imagePath;
            }
        }

        this.container.style.display = 'block';
        this.container.style.width = (config.size || 180) + 'px';
        this.container.style.opacity = config.opacity !== undefined ? config.opacity : 0.9;
    }

    update(mouseX, mouseY) {
        if (!this.container || !this.config || !this.config.enabled || !this.config.imagePath) return;

        const posX = (window.innerWidth * (this.config.positionX !== undefined ? this.config.positionX : 85)) / 100;
        const posY = (window.innerHeight * (this.config.positionY !== undefined ? this.config.positionY : 20)) / 100;

        // 根据所选深度计算视差位移
        const diff = (this.config.depth !== undefined ? this.config.depth : 0.7) - (CONFIG.focusDepth !== undefined ? CONFIG.focusDepth : 0.5);
        const offsetX = -mouseX * diff * (CONFIG.parallaxMultiplier * 1.5);
        const offsetY = -mouseY * diff * (CONFIG.parallaxMultiplier * 1.5);

        this.container.style.left = `${posX + offsetX}px`;
        this.container.style.top = `${posY + offsetY}px`;
    }
}

// 3. 黑胶唱片机动态组件管理器
class VinylPlayerManager {
    constructor() {
        this.widget = document.getElementById('vinyl-widget');
        this.record = document.getElementById('vinyl-record');
        this.tonearm = document.getElementById('vinyl-tonearm');
        this.coverImg = document.getElementById('vinyl-cover-img');
        this.defaultCover = document.getElementById('vinyl-default-cover');
        this.soundWaves = document.getElementById('vinyl-sound-waves');
        this.songNameEl = document.getElementById('vinyl-song-name');
        this.statusEl = document.getElementById('vinyl-play-status');
        this.audio = document.getElementById('bg-audio');

        this.config = null;
        this.currentAudioPath = '';
        this.currentCoverPath = '';
        this.audioBlobUrl = null;
    }

    setConfig(config) {
        this.config = config;
        if (!this.widget || !this.audio) return;

        if (!config || !config.enabled) {
            this.widget.style.display = 'none';
            if (!this.audio.paused) {
                this.audio.pause();
            }
            return;
        }

        this.widget.style.display = 'flex';

        // 停靠方位
        const posClass = `pos-${config.position || 'bottom-right'}`;
        this.widget.className = `vinyl-widget ${posClass}`;

        // 音频加载
        if (config.audioPath && this.currentAudioPath !== config.audioPath) {
            this.currentAudioPath = config.audioPath;
            this.loadAudioFile(config.audioPath);
        } else if (!config.audioPath && this.currentAudioPath) {
            this.currentAudioPath = '';
            this.audio.pause();
            this.audio.src = '';
            if (this.songNameEl) this.songNameEl.textContent = '未选择音乐';
        }

        // 歌曲名称显示
        if (this.songNameEl) {
            if (config.audioName) {
                this.songNameEl.textContent = config.audioName;
            } else if (config.audioPath) {
                const name = config.audioPath.split('\\').pop().split('/').pop().replace(/\.[^/.]+$/, '');
                this.songNameEl.textContent = name;
            } else {
                this.songNameEl.textContent = '未选择音乐';
            }
        }

        // 唱片中心封面图片
        if (config.coverPath && this.currentCoverPath !== config.coverPath) {
            this.currentCoverPath = config.coverPath;
            if (isElectron && window.electronAPI) {
                const dataUrl = window.electronAPI.readFileAsDataURL(config.coverPath);
                if (dataUrl && this.coverImg) {
                    this.coverImg.src = dataUrl;
                    this.coverImg.style.display = 'block';
                    if (this.defaultCover) this.defaultCover.style.display = 'none';
                }
            }
        } else if (!config.coverPath) {
            this.currentCoverPath = '';
            if (this.coverImg) this.coverImg.style.display = 'none';
            if (this.defaultCover) this.defaultCover.style.display = 'flex';
        }

        // 音量
        const vol = config.volume !== undefined ? Math.max(0, Math.min(1, config.volume)) : 0.6;
        this.audio.volume = vol;
        this.audio.loop = config.loop !== false;

        // 播放状态控制
        if (config.playing && config.audioPath) {
            if (this.audio.paused) {
                this.audio.play().catch(err => {
                    console.warn('[Vinyl] 播放音频未启动:', err);
                });
            }
            if (this.record) {
                this.record.classList.add('spinning');
                this.record.classList.remove('paused');
            }
            if (this.tonearm) this.tonearm.classList.add('playing');
            if (this.soundWaves) this.soundWaves.classList.add('active');
            if (this.statusEl) this.statusEl.textContent = '正在播放';
        } else {
            if (!this.audio.paused) {
                this.audio.pause();
            }
            if (this.record) {
                this.record.classList.add('paused');
            }
            if (this.tonearm) this.tonearm.classList.remove('playing');
            if (this.soundWaves) this.soundWaves.classList.remove('active');
            if (this.statusEl) this.statusEl.textContent = config.audioPath ? '已暂停' : '请导入音乐';
        }
    }

    loadAudioFile(filePath) {
        if (!isElectron || !window.electronAPI) {
            this.audio.src = filePath;
            return;
        }

        try {
            // 优先使用高效 Uint8Array -> Blob -> createObjectURL
            if (window.electronAPI.readFileBuffer) {
                const buffer = window.electronAPI.readFileBuffer(filePath);
                if (buffer) {
                    if (this.audioBlobUrl) {
                        URL.revokeObjectURL(this.audioBlobUrl);
                    }
                    const ext = filePath.split('.').pop().toLowerCase();
                    const mimeMap = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4' };
                    const blob = new Blob([buffer], { type: mimeMap[ext] || 'audio/mpeg' });
                    this.audioBlobUrl = URL.createObjectURL(blob);
                    this.audio.src = this.audioBlobUrl;
                    console.log('[Vinyl] 音频加载成功 (Blob URL)');
                    return;
                }
            }

            // 回退到 Data URL
            const dataUrl = window.electronAPI.readFileAsDataURL(filePath);
            if (dataUrl) {
                this.audio.src = dataUrl;
                console.log('[Vinyl] 音频加载成功 (Data URL)');
            }
        } catch (err) {
            console.error('[Vinyl] 音频加载失败:', err);
        }
    }

    update(mouseX, mouseY) {
        if (!this.widget || !this.config || !this.config.enabled) return;
        const scale = this.config.scale !== undefined ? this.config.scale : 1.0;
        // 微小视差浮动
        const pX = -mouseX * 10;
        const pY = -mouseY * 10;
        this.widget.style.transform = `translate3d(${pX}px, ${pY}px, 0) scale(${scale})`;
    }
}

// 4. 视频特效覆盖层管理器 (支持 CSS Screen 滤色混合 与 WebGL 绿幕抠图)
class VideoOverlayManager {
    constructor() {
        this.video = document.getElementById('overlay-video');
        this.canvas = document.getElementById('overlay-chroma-canvas');
        this.gl = null;
        this.program = null;
        this.texture = null;
        this.uResolution = null;
        this.uVideoResolution = null;
        this.uOpacity = null;
        this.animFrameId = null;
        this.isRendering = false;
        this.isPaused = false;

        this.config = {
            enabled: false,
            presetId: 'snow2',
            customPath: '',
            customName: '',
            blendMode: 'auto',
            opacity: 0.85,
            speed: 1.0,
        };

        this.presets = {
            'rain1': { mode: 'screen', path: 'overlay/rain1.mp4' },
            'rain2': { mode: 'screen', path: 'overlay/rain2.mp4' },
            'snow1': { mode: 'screen', path: 'overlay/snow1.mp4' },
            'snow2': { mode: 'chroma', path: 'overlay/snow2.mp4' },
            'snow3': { mode: 'screen', path: 'overlay/snow3.mp4' },
            'old1':  { mode: 'screen', path: 'overlay/old1.mp4' },
            'old2':  { mode: 'screen', path: 'overlay/old2.mp4' },
            'old3':  { mode: 'screen', path: 'overlay/old3.mp4' },
        };

        this._initWebGL();
        window.addEventListener('resize', () => this._onResize());
    }

    _initWebGL() {
        if (!this.canvas) return;
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;

        try {
            this.gl = this.canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false });
        } catch (e) {
            console.warn('[VideoOverlay] WebGL 初始化失败:', e);
            return;
        }

        const gl = this.gl;
        if (!gl) return;

        const vsSource = `
            attribute vec2 a_position;
            varying vec2 v_texCoord;
            void main() {
                v_texCoord = vec2((a_position.x + 1.0) * 0.5, (1.0 - a_position.y) * 0.5);
                gl_Position = vec4(a_position, 0.0, 1.0);
            }
        `;

        const fsSource = `
            precision mediump float;
            uniform sampler2D u_texture;
            uniform float u_opacity;
            uniform vec2 u_resolution;
            uniform vec2 u_videoResolution;
            varying vec2 v_texCoord;

            void main() {
                vec2 uv = v_texCoord;
                float screenRatio = u_resolution.x / u_resolution.y;
                float videoRatio = u_videoResolution.x / u_videoResolution.y;

                if (screenRatio > videoRatio) {
                    uv.y = (uv.y - 0.5) * (videoRatio / screenRatio) + 0.5;
                } else {
                    uv.x = (uv.x - 0.5) * (screenRatio / videoRatio) + 0.5;
                }

                if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
                    discard;
                }

                vec4 color = texture2D(u_texture, uv);

                // 绿幕色度键 (Chroma Key) 计算: greenness = G - max(R, B)
                float maxRB = max(color.r, color.b);
                float greenness = color.g - maxRB;

                // 边缘羽化 (0.04 ~ 0.14)
                float alpha = 1.0 - smoothstep(0.04, 0.14, greenness);

                // 去溢色处理 (Despill): 消除主体边缘被绿幕反射出的绿色
                if (color.g > maxRB) {
                    color.g = maxRB;
                }

                gl_FragColor = vec4(color.rgb, color.a * alpha * u_opacity);
            }
        `;

        function createShader(gl, type, source) {
            const shader = gl.createShader(type);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                console.error('[VideoOverlay] Shader compile error:', gl.getShaderInfoLog(shader));
                gl.deleteShader(shader);
                return null;
            }
            return shader;
        }

        const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
        const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error('[VideoOverlay] Program link error:', gl.getProgramInfoLog(program));
            return;
        }

        this.program = program;
        gl.useProgram(program);

        // 创建屏幕 Quad 顶点缓冲区 (2个三角形构成的矩形)
        const positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        const positions = new Float32Array([
            -1.0, -1.0,
             1.0, -1.0,
            -1.0,  1.0,
            -1.0,  1.0,
             1.0, -1.0,
             1.0,  1.0,
        ]);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

        const aPosition = gl.getAttribLocation(program, 'a_position');
        gl.enableVertexAttribArray(aPosition);
        gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

        // 获取 Uniform 位置
        this.uResolution = gl.getUniformLocation(program, 'u_resolution');
        this.uVideoResolution = gl.getUniformLocation(program, 'u_videoResolution');
        this.uOpacity = gl.getUniformLocation(program, 'u_opacity');

        // 创建视频纹理
        this.texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        // 开启透明度混合
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }

    _onResize() {
        if (this.canvas) {
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
            if (this.gl) {
                this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
            }
        }
    }

    setConfig(newConfig) {
        if (!newConfig) return;
        const prev = { ...this.config };
        this.config = { ...this.config, ...newConfig };

        const srcChanged = (prev.presetId !== this.config.presetId) ||
                           (prev.customPath !== this.config.customPath) ||
                           (prev.enabled !== this.config.enabled);

        const modeChanged = (prev.blendMode !== this.config.blendMode);

        if (!this.config.enabled) {
            this._stop();
            return;
        }

        if (srcChanged || modeChanged) {
            this._applySource();
        } else {
            this._applyPlaybackProps();
        }
    }

    _resolveCurrentVideo() {
        if (this.config.presetId === 'custom' && this.config.customPath) {
            let mode = this.config.blendMode;
            if (mode === 'auto') mode = 'screen';
            return { path: this.config.customPath, mode: mode };
        }
        const preset = this.presets[this.config.presetId] || this.presets['snow2'];
        let mode = this.config.blendMode;
        if (mode === 'auto') mode = preset.mode;
        return { path: preset.path, mode: mode };
    }

    _applySource() {
        if (!this.video) return;

        const info = this._resolveCurrentVideo();
        if (!info || !info.path) {
            this._stop();
            return;
        }

        let videoUrl = info.path;
        if (!videoUrl.startsWith('http') && !videoUrl.startsWith('data:') && !videoUrl.startsWith('file://')) {
            if (/^[a-zA-Z]:[\\\/]/.test(videoUrl)) {
                videoUrl = encodeURI('file:///' + videoUrl.replace(/\\/g, '/'));
            }
        } else if (videoUrl.startsWith('file://')) {
            videoUrl = encodeURI(videoUrl);
        }

        const isChroma = (info.mode === 'chroma');
        const isSameSrc = (this.video.dataset.currentPath === info.path);

        if (!isSameSrc) {
            this.video.src = videoUrl;
            this.video.dataset.currentPath = info.path;
            this.video.load();
        }

        this.video.playbackRate = this.config.speed || 1.0;
        this.video.muted = true;
        this.video.loop = true;

        if (isChroma) {
            // WebGL 绿幕抠图模式：隐藏原生 video，激活 Canvas
            this.video.style.display = 'none';
            if (this.canvas) {
                this.canvas.style.display = 'block';
                this.canvas.style.opacity = (this.config.opacity !== undefined) ? this.config.opacity : 0.85;
            }
            this._startChromaLoop();
        } else {
            // Screen 滤色模式：直接显示原生 video（GPU 硬件解码混合，0额外开销）
            this._stopChromaLoop();
            if (this.canvas) this.canvas.style.display = 'none';
            this.video.style.display = 'block';
            this.video.style.mixBlendMode = 'screen';
            this.video.style.opacity = (this.config.opacity !== undefined) ? this.config.opacity : 0.85;
        }

        if (!this.isPaused) {
            this.video.play().catch(err => console.warn('[VideoOverlay] 自动播放受阻:', err));
        }
    }

    _applyPlaybackProps() {
        if (!this.video) return;
        this.video.playbackRate = this.config.speed || 1.0;

        const opacity = (this.config.opacity !== undefined) ? this.config.opacity : 0.85;
        const info = this._resolveCurrentVideo();
        if (info.mode === 'chroma' && this.canvas) {
            this.canvas.style.opacity = opacity;
        } else {
            this.video.style.opacity = opacity;
        }
    }

    _startChromaLoop() {
        if (this.isRendering) return;
        this.isRendering = true;

        const renderFrame = () => {
            if (!this.isRendering) return;

            if (this.gl && this.program && this.video && this.video.readyState >= 2 && !this.video.paused) {
                const gl = this.gl;
                gl.useProgram(this.program);

                // 更新视频纹理
                gl.bindTexture(gl.TEXTURE_2D, this.texture);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.video);

                // 传递 Uniform 尺寸
                gl.uniform2f(this.uResolution, this.canvas.width, this.canvas.height);
                gl.uniform2f(this.uVideoResolution, this.video.videoWidth || 1920, this.video.videoHeight || 1080);
                gl.uniform1f(this.uOpacity, 1.0);

                gl.clearColor(0, 0, 0, 0);
                gl.clear(gl.COLOR_BUFFER_BIT);

                gl.drawArrays(gl.TRIANGLES, 0, 6);
            }

            this.animFrameId = requestAnimationFrame(renderFrame);
        };

        this.animFrameId = requestAnimationFrame(renderFrame);
    }

    _stopChromaLoop() {
        this.isRendering = false;
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
    }

    _stop() {
        this._stopChromaLoop();
        if (this.video) {
            this.video.pause();
            this.video.style.display = 'none';
            this.video.dataset.currentPath = '';
        }
        if (this.canvas) {
            this.canvas.style.display = 'none';
        }
    }

    pause() {
        this.isPaused = true;
        if (this.video) this.video.pause();
        this._stopChromaLoop();
    }

    resume() {
        this.isPaused = false;
        if (this.config.enabled && this.video) {
            const info = this._resolveCurrentVideo();
            this.video.play().catch(() => {});
            if (info.mode === 'chroma') {
                this._startChromaLoop();
            }
        }
    }
}

// 实例化管理器
const weatherManager = new WeatherParticleManager();
const stickerManager = new StickerManager();
const vinylManager = new VinylPlayerManager();
const videoOverlayManager = new VideoOverlayManager();

function applyCustomElementsConfig(config) {
    if (!config) return;
    if (config.weather && weatherManager) weatherManager.setConfig(config.weather);
    if (config.sticker && stickerManager) stickerManager.setConfig(config.sticker);
    if (config.vinyl && vinylManager) vinylManager.setConfig(config.vinyl);
    if (config.videoOverlay && videoOverlayManager) videoOverlayManager.setConfig(config.videoOverlay);
}

// ==================== 错误处理 ====================

/**
 * 在页面上显示错误提示，用于图片加载失败等场景。
 *
 * @param {string} message - 错误描述
 */
function showErrorMessage(message) {
    const errorEl = document.createElement('div');
    errorEl.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(200, 40, 40, 0.9);
        color: white;
        padding: 24px 32px;
        border-radius: 12px;
        font-size: 16px;
        z-index: 99999;
        text-align: center;
        max-width: 80vw;
        font-family: 'Microsoft YaHei', sans-serif;
    `;
    errorEl.innerHTML = `
        <strong>⚠️ 初始化失败</strong><br><br>
        ${message}<br><br>
        <small>请确保 background.png 和 depth_map.png 与 index.html 在同一目录下。</small>
    `;
    document.body.appendChild(errorEl);
}

// ==================== Electron IPC 集成 ====================

/** 是否在 Electron 环境中运行 */
const isElectron = !!(window.electronAPI);

/** 加载提示 DOM */
const loadingOverlay = document.getElementById('loading-overlay');
const statusToast = document.getElementById('status-toast');

/**
 * 显示加载提示。
 * @param {string} message - 提示文字
 */
function showLoading(message) {
    if (loadingOverlay) {
        const textEl = document.getElementById('loading-text');
        if (textEl) textEl.textContent = message || '正在加载...';
        loadingOverlay.style.display = 'flex';
    }
}

/**
 * 隐藏加载提示。
 */
function hideLoading() {
    if (loadingOverlay) {
        loadingOverlay.style.display = 'none';
    }
}

/**
 * 显示状态 Toast（短暂提示后自动消失）。
 * @param {string} message - 提示文字
 * @param {number} duration - 持续时间（毫秒），默认 2500
 */
function showToast(message, duration = 2500) {
    if (!statusToast) return;
    statusToast.textContent = message;
    statusToast.classList.add('visible');
    clearTimeout(statusToast._timeout);
    statusToast._timeout = setTimeout(() => {
        statusToast.classList.remove('visible');
    }, duration);
}

// ==================== Electron 专属初始化 ====================

if (isElectron) {
    console.log('[App] 检测到 Electron 环境，注册 IPC 监听...');

    // ---- 监听主进程发来的暂停信号 ----
    window.electronAPI.onPauseRender(() => {
        console.log('[App] 收到暂停信号，停止渲染');
        if (app && app.ticker) {
            app.ticker.stop();
        }
        if (videoOverlayManager) {
            videoOverlayManager.pause();
        }
        showToast('壁纸已暂停（检测到全屏应用）', 2000);
    });

    // ---- 监听主进程发来的恢复信号 ----
    window.electronAPI.onResumeRender(() => {
        console.log('[App] 收到恢复信号，恢复渲染');
        if (app && app.ticker) {
            app.ticker.start();
        }
        if (videoOverlayManager) {
            videoOverlayManager.resume();
        }
        showToast('壁纸已恢复', 1500);
    });

    // ---- 监听主进程发来的新图片信号 ----
    window.electronAPI.onNewImage(async (imagePath) => {
        console.log('[App] 收到新图片:', imagePath);
        showLoading('正在加载新壁纸...');

        try {
            // 检查是否有缓存的深度图
            const cachedDepth = await window.electronAPI.getDepthCache(imagePath);

            if (cachedDepth) {
                // 命中缓存：直接使用
                console.log('[App] 命中深度图缓存');
                const img = await loadImage(imagePath);
                reloadWithNewImages(img, cachedDepth);
                showToast('壁纸已更换（使用缓存的深度图）', 2000);
            } else {
                // 需要生成深度图
                console.log('[App] 未命中深度图缓存');
                showToast('请在设置窗口中生成深度图（打开托盘菜单 → 设置）', 4000);
            }
        } catch (err) {
            console.error('[App] 切换图片失败:', err);
            showToast('切换图片失败: ' + err.message, 3000);
        }

        hideLoading();
    });

    // ---- 监听主进程发来的配置加载 ----
    window.electronAPI.onLoadConfig((config) => {
        console.log('[App] 加载已保存的配置:', config);
        if (config) {
            if (config.parallaxMultiplier !== undefined) CONFIG.parallaxMultiplier = config.parallaxMultiplier;
            if (config.smoothness !== undefined) CONFIG.smoothness = config.smoothness;
            if (config.focusDepth !== undefined) CONFIG.focusDepth = config.focusDepth;
            CONFIG.hideDebugPanel = config.hideDebugPanel !== false;

            // 同步 UI 滑块
            if (parallaxSlider) parallaxSlider.value = CONFIG.parallaxMultiplier;
            if (parallaxValueEl) parallaxValueEl.textContent = CONFIG.parallaxMultiplier;
            if (smoothnessSlider) smoothnessSlider.value = Math.round(CONFIG.smoothness * 100);
            if (smoothnessValueEl) smoothnessValueEl.textContent = CONFIG.smoothness.toFixed(2);
            if (focusSlider) focusSlider.value = Math.round(CONFIG.focusDepth * 100);
            if (focusValueEl) focusValueEl.textContent = Number(CONFIG.focusDepth).toFixed(2);

            // 根据配置隐藏调试面板
            if (CONFIG.hideDebugPanel && debugPanel) {
                debugPanel.style.display = 'none';
            }

            // 更新自定义元素（唱片机、天气、贴纸）
            applyCustomElementsConfig(config);
        }
    });

    // ---- 保存配置到主进程的辅助函数 ----
    function saveConfigToMain() {
        if (isElectron && window.electronAPI) {
            window.electronAPI.saveConfig({
                parallaxMultiplier: CONFIG.parallaxMultiplier,
                smoothness: CONFIG.smoothness,
                focusDepth: CONFIG.focusDepth,
                hideDebugPanel: CONFIG.hideDebugPanel,
            });
        }
    }

    // 监听配置变更（在 bindEvents 中触发）
    const originalBindEvents = bindEvents;
    // Note: bindEvents 已经在 init 中调用，这里我们通过拦截 slider 事件来实现自动保存
}

// ==================== 启动 ====================

/**
 * 页面加载完成后启动。
 *
 * 在 Electron 环境中：
 *   - 先检查缓存中是否有配置和深度图
 *   - 加载完成后通知主进程渲染就绪
 *
 * 在浏览器环境中：
 *   - 直接加载本地 background.png 和 depth_map.png
 */
async function start() {
    showLoading('正在加载壁纸素材...');

    try {
        await init();
    } catch (err) {
        showErrorMessage(err.message);
    }

    hideLoading();

    // Electron 环境：通知主进程渲染器已就绪
    if (isElectron && window.electronAPI) {
        window.electronAPI.notifyReady();
        console.log('[App] 已通知主进程渲染就绪');
    }
}

// 启动应用
start();

// ==================== 重新加载新图片 ====================

/**
 * 用新图片重新加载壁纸（保留现有 Pixi.js 实例和滤镜）。
 * 用于 Electron 的"更换壁纸"功能。
 *
 * @param {HTMLImageElement} bgImg - 新的背景图片
 * @param {string|HTMLImageElement} depthSource - 深度图 Data URL 或 Image 对象
 */
async function reloadWithNewImages(bgImg, depthSource) {
    // 停止动画
    app.ticker.stop();

    // 解析深度图来源
    let depthImg = depthSource;
    if (typeof depthSource === 'string') {
        depthImg = await loadImage(depthSource);
    }

    // 更新纹理
    bgTexture = PIXI.Texture.from(bgImg);
    depthTexture = PIXI.Texture.from(depthImg);
    bgTexture.baseTexture.wrapMode = PIXI.WRAP_MODES.CLAMP;
    depthTexture.baseTexture.wrapMode = PIXI.WRAP_MODES.CLAMP;

    // 更新尺寸缓存
    bgNaturalWidth = bgImg.naturalWidth || bgImg.width;
    bgNaturalHeight = bgImg.naturalHeight || bgImg.height;

    // 更新 Shader Uniforms
    if (parallaxFilter) {
        parallaxFilter.uniforms.uImage = bgTexture;
        parallaxFilter.uniforms.uDepth = depthTexture;
        updateCoverUniforms();
    }

    // 恢复动画
    app.ticker.start();

    console.log('[App] 壁纸与深度图已重新加载并应用 Parallax Shader');
}

/**
 * 从 Data URL 加载图片。
 * @param {string} dataUrl
 * @returns {Promise<HTMLImageElement>}
 */
function loadImageFromDataURL(dataUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = dataUrl;
    });
}

/**
 * 创建默认的灰色深度图占位图。
 *
 * 当 depth_map.png 缺失时使用。中性灰色 (RGB 128,128,128) 在 DisplacementFilter
 * 中表示"无位移"，因此整个画面不会产生视差效果。用户可以稍后生成真正的深度图。
 *
 * @param {number} width - 应与背景图宽度一致
 * @param {number} height - 应与背景图高度一致
 * @returns {HTMLImageElement}
 */
function createFallbackDepthImage(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width || 1920;
    canvas.height = height || 1080;
    const ctx = canvas.getContext('2d');

    // 填充中性灰色 —— 位移滤镜中灰色 = 不偏移
    ctx.fillStyle = 'rgb(128, 128, 128)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 添加渐变提示（中心略亮），让深度图不至于完全平坦
    const gradient = ctx.createRadialGradient(
        canvas.width / 2, canvas.height / 2, 0,
        canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) * 0.6
    );
    gradient.addColorStop(0, 'rgb(140, 140, 140)');
    gradient.addColorStop(1, 'rgb(118, 118, 118)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 将 canvas 转为 Image 对象
    const img = new Image();
    img.src = canvas.toDataURL('image/png');
    img.width = canvas.width;
    img.height = canvas.height;

    console.log(`[初始化] 已生成占位深度图 (${canvas.width}×${canvas.height})`);
    return img;
}
