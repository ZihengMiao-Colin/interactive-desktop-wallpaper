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
    parallaxMultiplier: 30,
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

    // 5. 软截断阻尼 (Soft Clamping)：限制局部最大拉伸距离，彻底根除直线割裂与大缝隙
    float maxDist = 0.045; // 最大允许 4.5% UV 偏移
    float pLen = length(parallax);
    if (pLen > maxDist) {
        parallax = (parallax / pLen) * (maxDist + (pLen - maxDist) * 0.15);
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

        // 视差强度系数转换
        parallaxFilter.uniforms.uStrength = (CONFIG.parallaxMultiplier / 1000.0) * 0.75;

        // 对焦深度
        parallaxFilter.uniforms.uFocus = CONFIG.focusDepth !== undefined ? CONFIG.focusDepth : 0.50;
    }
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
        showToast('壁纸已暂停（检测到全屏应用）', 2000);
    });

    // ---- 监听主进程发来的恢复信号 ----
    window.electronAPI.onResumeRender(() => {
        console.log('[App] 收到恢复信号，恢复渲染');
        if (app && app.ticker) {
            app.ticker.start();
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
