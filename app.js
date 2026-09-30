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
    /** 视差强度系数 —— 控制位移的最大像素偏移量 */
    parallaxMultiplier: 30,
    /** 平滑度 —— Lerp 插值的比率 (0~1)，越小越平滑 */
    smoothness: 0.08,
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

// 如果配置要求隐藏调试面板
if (CONFIG.hideDebugPanel && debugPanel) {
    debugPanel.style.display = 'none';
}

// ==================== Pixi.js 应用初始化 ====================

/**
 * 创建 Pixi.js Application 实例。
 *
 * Pixi.js 会自动创建一个 <canvas> 元素并将其添加到 document.body 中。
 * 我们设置 resizeTo: window 让画布在窗口大小变化时自动调整分辨率。
 */
const app = new PIXI.Application({
    width: window.innerWidth,             // 初始宽度 = 窗口宽度
    height: window.innerHeight,           // 初始高度 = 窗口高度
    backgroundColor: 0x000000,            // 黑色背景（图片加载前显示）
    antialias: true,                      // 开启抗锯齿，画面更平滑
    resolution: window.devicePixelRatio || 1,  // 适配高 DPI 屏幕（Retina 等）
    autoDensity: true,                    // 让 CSS 尺寸匹配物理分辨率
    resizeTo: window,                     // 窗口大小改变时自动调整渲染器大小
});

// 将 Pixi.js 生成的 canvas 插入到页面中
document.body.appendChild(app.view);

// ==================== 图片预加载 ====================

/**
 * 使用 Image 对象预加载图片。
 *
 * 为什么不用 PIXI.Assets？
 * - 在本地壁纸环境中，直接使用 Image 对象加载本地文件更简单可靠
 * - 不依赖额外的 loader 配置
 *
 * @param {string} url - 图片路径（相对于 index.html）
 * @returns {Promise<HTMLImageElement>} 加载完成的 Image 对象
 */
function loadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();

        img.onload = () => {
            console.log(`[加载完成] ${url} (${img.naturalWidth}×${img.naturalHeight})`);
            resolve(img);
        };

        img.onerror = (err) => {
            console.error(`[加载失败] ${url}`, err);
            reject(new Error(`无法加载图片: ${url}`));
        };

        img.src = url;
    });
}

// ==================== Cover 模式缩放计算 ====================

/**
 * 计算 "Cover 模式" 的缩放比例。
 *
 * Cover 模式（类似 CSS background-size: cover）：
 * - 图片等比缩放，确保完全覆盖容器（不留黑边）
 * - 如果图片和容器宽高比不一致，取较大的缩放比例
 * - 超出的部分会被裁剪（在 Pixi.js 中，画布外自然裁剪）
 *
 * 对比 Contain 模式：取较小的缩放比例（图片完整显示，可能有黑边）。
 *
 * @param {number} imgW   - 图片原始宽度
 * @param {number} imgH   - 图片原始高度
 * @param {number} containerW - 容器宽度（窗口宽度）
 * @param {number} containerH - 容器高度（窗口高度）
 * @returns {number} 缩放比例（apply to both width and height to maintain aspect ratio）
 */
function getCoverScale(imgW, imgH, containerW, containerH) {
    const scaleX = containerW / imgW;
    const scaleY = containerH / imgH;
    // Cover = 取最大值，确保任一维度都能填满
    return Math.max(scaleX, scaleY);
}

// ==================== 全局状态变量 ====================

/** 背景图片的 Pixi.js 精灵（Sprite） */
let bgSprite = null;

/** 深度图对应的精灵 —— 作为 DisplacementFilter 的置换贴图来源 */
let depthSprite = null;

/** 位移滤镜实例 */
let displacementFilter = null;

/** 用于统一管理背景和深度图的容器 */
let container = null;

/** 鼠标位置的目标值（归一化到 [-1, 1]） */
let targetX = 0;
let targetY = 0;

/** 当前位置的插值状态（用于 Lerp 平滑） */
let currentX = 0;
let currentY = 0;

/** 原始图片尺寸缓存（用于 resize 时重新计算缩放） */
let bgNaturalWidth = 0;
let bgNaturalHeight = 0;

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

        // ---- 第 1 步：加载背景图（必需） ----
        let bgImg;
        try {
            bgImg = await loadImage('background.png');
        } catch (err) {
            console.error('[初始化] background.png 加载失败:', err.message);
            // 尝试从 userData 目录加载
            if (isElectron && window.electronAPI) {
                try {
                    const userPath = await window.electronAPI.getUserDataPath();
                    const altBgPath = userPath + '\\background.png';
                    console.log('[初始化] 尝试备用路径:', altBgPath);
                    bgImg = await loadImage(altBgPath);
                } catch (e2) {
                    throw new Error(
                        '未找到 background.png。\n\n' +
                        '请通过托盘菜单 → "更换壁纸" 来选择一张图片作为壁纸。'
                    );
                }
            } else {
                throw new Error(
                    '未找到 background.png。\n请确保 background.png 与 index.html 在同一目录。'
                );
            }
        }

        // ---- 第 2 步：加载深度图（可选，缺失时自动生成灰色占位图） ----
        let depthImg;
        try {
            depthImg = await loadImage('depth_map.png');
            console.log('[初始化] depth_map.png 加载成功');
        } catch (depthErr) {
            console.warn('[初始化] depth_map.png 未找到，使用默认灰色深度图（无深度视差效果）');
            console.warn('[初始化] 可使用「生成深度图.bat」生成真正的深度图');
            depthImg = createFallbackDepthImage(bgImg.naturalWidth, bgImg.naturalHeight);
        }

        // 缓存原始尺寸
        bgNaturalWidth = bgImg.naturalWidth;
        bgNaturalHeight = bgImg.naturalHeight;

        // ---- 第 2 步：从 Image 对象创建 Pixi.js 纹理 ----
        // PIXI.Texture.from() 可以直接接收 HTMLImageElement
        const bgTexture = PIXI.Texture.from(bgImg);
        const depthTexture = PIXI.Texture.from(depthImg);

        // ---- 第 3 步：设置深度图纹理的包裹模式 ----
        /**
         * WRAP_MODES.CLAMP（钳制模式）：
         * 当滤镜采样超出纹理边缘时，不重复、不镜像，而是取最近的边缘像素颜色。
         * 这可以防止画面边缘出现"卷边"或"重复"的视觉瑕疵。
         *
         * 如果不设置，默认是 WRAP_MODES.REPEAT，边缘可能会采样到对侧的内容。
         */
        depthTexture.baseTexture.wrapMode = PIXI.WRAP_MODES.CLAMP;

        // ---- 第 4 步：创建精灵（Sprite） ----
        // 背景精灵 —— 实际显示在画面上的彩色壁纸
        bgSprite = new PIXI.Sprite(bgTexture);
        bgSprite.anchor.set(0.5, 0.5);  // 锚点设为中心，方便定位和缩放

        /**
         * 深度图精灵 —— DisplacementFilter 的"置换贴图"。
         *
         * 【重要】深度精灵需要跟背景精灵共享相同的 worldTransform（位置+缩放），
         * 因为 DisplacementFilter 通过它来映射"屏幕像素 → 深度图纹理坐标"。
         *
         * 我们把它放入与背景相同的容器中（作为兄弟节点），
         * 并设置 renderable = false，确保它不被绘制但 transform 自动保持同步。
         */
        depthSprite = new PIXI.Sprite(depthTexture);
        depthSprite.anchor.set(0.5, 0.5);
        depthSprite.renderable = false;  // 不渲染，只提供纹理数据给滤镜

        // ---- 第 5 步：创建容器并添加精灵 ----
        // 将背景和深度图都放入同一个容器，位置统一管理
        container = new PIXI.Container();
        container.x = app.screen.width / 2;
        container.y = app.screen.height / 2;

        // 先添加深度精灵（在底层），再添加背景（在上层）
        container.addChild(depthSprite);
        container.addChild(bgSprite);

        // ---- 第 6 步：应用 Cover 缩放 ----
        applyCoverScale();

        // ---- 第 7 步：创建位移滤镜 ----
        /**
         * new PIXI.DisplacementFilter(sprite, scale)
         *
         * @param sprite - 提供置换贴图纹理的精灵
         * @param scale  - 初始滤镜强度（可以是数字或 PIXI.Point）
         *
         * 滤镜的 scale 控制白色区域的最大像素偏移量：
         * - scale = 0   → 完全无偏移（原图）
         * - scale = 50  → 白色区域偏移最多 50px，黑色区域不动
         *
         * 我们后续会在动画循环中动态修改 scale，由鼠标位置驱动。
         */
        displacementFilter = new PIXI.DisplacementFilter(depthSprite, 0);
        // 将滤镜应用到容器上（所有容器内的精灵都会被滤镜处理）
        container.filters = [displacementFilter];

        // ---- 第 8 步：将容器添加到 Pixi.js 舞台 ----
        app.stage.addChild(container);

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

// ==================== Cover 缩放应用 ====================

/**
 * 根据窗口大小重新计算并应用 Cover 缩放。
 *
 * 背景精灵和深度精灵使用相同的缩放比例，
 * 确保 DisplacementFilter 的坐标映射正确。
 */
function applyCoverScale() {
    if (!bgSprite || !depthSprite) return;

    const scale = getCoverScale(
        bgNaturalWidth,
        bgNaturalHeight,
        app.screen.width,
        app.screen.height
    );

    // 两个精灵使用相同的缩放
    bgSprite.scale.set(scale);
    depthSprite.scale.set(scale);
}

// ==================== 事件绑定 ====================

function bindEvents() {
    // ---- 全局鼠标移动 ----
    /**
     * 当鼠标移动时，计算相对于屏幕中心的归一化偏移。
     *
     * 归一化公式：
     *   normalizedX = (mouseX / screenWidth)  × 2 - 1
     *   normalizedY = (mouseY / screenHeight) × 2 - 1
     *
     * Electron 环境：通过主进程轮询全局鼠标位置（WorkerW 层收不到 mousemove 事件）
     * 浏览器环境：直接监听 window mousemove
     */
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
        // 更新容器位置到新的屏幕中央
        // 深度精灵作为容器的子节点，位置自动跟随，无需手动同步
        if (container) {
            container.x = app.screen.width / 2;
            container.y = app.screen.height / 2;
        }

        // 重新计算 Cover 缩放
        applyCoverScale();

        console.log(`[窗口变化] ${app.screen.width}×${app.screen.height}`);
    });

    // ---- 调试面板：视差强度滑块 ----
    if (parallaxSlider) {
        parallaxSlider.addEventListener('input', () => {
            CONFIG.parallaxMultiplier = parseInt(parallaxSlider.value, 10);
            if (parallaxValueEl) {
                parallaxValueEl.textContent = CONFIG.parallaxMultiplier;
            }
            // Electron 环境：自动保存配置
            if (isElectron && window.electronAPI) {
                window.electronAPI.saveConfig({
                    parallaxMultiplier: CONFIG.parallaxMultiplier,
                    smoothness: CONFIG.smoothness,
                });
            }
        });
    }

    // ---- 调试面板：平滑度滑块 ----
    if (smoothnessSlider) {
        smoothnessSlider.addEventListener('input', () => {
            // 滑块的值为 1~30，实际平滑度为 value/100，即 0.01 ~ 0.30
            CONFIG.smoothness = parseInt(smoothnessSlider.value, 10) / 100;
            if (smoothnessValueEl) {
                smoothnessValueEl.textContent = CONFIG.smoothness.toFixed(2);
            }
            // Electron 环境：自动保存配置
            if (isElectron && window.electronAPI) {
                window.electronAPI.saveConfig({
                    parallaxMultiplier: CONFIG.parallaxMultiplier,
                    smoothness: CONFIG.smoothness,
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

// ==================== 动画循环（核心 Lerp 逻辑） ====================

/**
 * 每帧更新函数 —— 由 Pixi.js Ticker 驱动（约 60fps）。
 *
 * 【Lerp 平滑插值说明】
 *
 * 这里不直接把 targetX/Y 赋给滤镜，而是用 Lerp（线性插值）让 current 逐步追赶 target。
 *
 * 直观理解：
 * ┌────────────────────────────────────────────────────┐
 * │  target 是"你的手"（鼠标实时位置）                  │
 * │  current 是"弹簧末端拴着的小球"                     │
 * │  smoothness 是"弹簧的软硬程度"                      │
 * │                                                    │
 * │  手移动 → 弹簧拉伸 → 小球逐渐跟上（有惯性延迟）      │
 * │  手停下 → 小球震荡几下后停在手的位置                │
 * │                                                    │
 * │  这就是为什么画面不会"硬切"而是平滑漂移的原因。      │
 * └────────────────────────────────────────────────────┘
 *
 * @param {number} delta - Pixi.js 提供的帧时间增量（用于帧率无关的动画）
 */
function updateLoop(delta) {
    // delta 大约为 1（在 60fps 时），我们用它来让 lerp 与帧率无关
    // 帧率较高的屏幕（如 144Hz）不会让动画变快，帧率较低时也不会变慢
    const frameAdjustedSmoothness = 1 - Math.pow(1 - CONFIG.smoothness, delta);

    // ---- Lerp 插值 ----
    // 核心公式：current += (target - current) × factor
    currentX += (targetX - currentX) * frameAdjustedSmoothness;
    currentY += (targetY - currentY) * frameAdjustedSmoothness;

    // ---- 将插值结果映射到滤镜强度 ----
    /**
     * displacementFilter.scale.x / y 控制 X 轴和 Y 轴的位移强度。
     *
     * currentX 的范围是 [-1, 1]（鼠标在左边时为负，右边为正），
     * 乘以 parallaxMultiplier 后得到实际的像素偏移量。
     *
     * 例如 parallaxMultiplier = 30 时：
     *   - 鼠标在最左边  → scale.x = -30  （像素向左偏移）
     *   - 鼠标在正中间  → scale.x =   0  （无偏移）
     *   - 鼠标在最右边  → scale.x = +30  （像素向右偏移）
     */
    displacementFilter.scale.x = currentX * CONFIG.parallaxMultiplier;
    displacementFilter.scale.y = currentY * CONFIG.parallaxMultiplier;
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
        if (config && config.parallaxMultiplier !== undefined) {
            CONFIG.parallaxMultiplier = config.parallaxMultiplier;
            CONFIG.smoothness = config.smoothness || 0.08;
            CONFIG.hideDebugPanel = config.hideDebugPanel !== false;

            // 同步 UI 滑块
            if (parallaxSlider) parallaxSlider.value = CONFIG.parallaxMultiplier;
            if (parallaxValueEl) parallaxValueEl.textContent = CONFIG.parallaxMultiplier;
            if (smoothnessSlider) smoothnessSlider.value = Math.round(CONFIG.smoothness * 100);
            if (smoothnessValueEl) smoothnessValueEl.textContent = CONFIG.smoothness.toFixed(2);

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
    if (typeof depthSource === 'string' && depthSource.startsWith('data:')) {
        depthImg = await loadImageFromDataURL(depthSource);
    }

    // 更新纹理
    const bgTexture = PIXI.Texture.from(bgImg);
    const depthTexture = PIXI.Texture.from(depthImg);
    depthTexture.baseTexture.wrapMode = PIXI.WRAP_MODES.CLAMP;

    // 更新精灵
    if (bgSprite) bgSprite.texture = bgTexture;
    if (depthSprite) depthSprite.texture = depthTexture;

    // 更新尺寸缓存
    bgNaturalWidth = bgImg.naturalWidth || bgImg.width;
    bgNaturalHeight = bgImg.naturalHeight || bgImg.height;

    // 重新缩放
    applyCoverScale();

    // 恢复动画
    app.ticker.start();

    console.log('[App] 壁纸已重新加载');
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
