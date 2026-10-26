/**
 * main.js — 壁纸页入口：配置、鼠标输入、动画循环、与主进程的 IPC
 *
 * 平滑算法：current += (target - current) × k，k 按帧时间换算，
 * 保证不同帧率下的跟手速度一致。smoothness 越小越平滑、延迟越大。
 */

'use strict';

/** 是否运行在 Electron 中（浏览器直接打开 index.html 时为 false） */
const isElectron = !!window.electronAPI;

/** 视差参数（会被主进程下发的配置覆盖） */
const CONFIG = {
    /** 视差强度系数 */
    parallaxMultiplier: 20,
    /** 平滑度 0~1，越小越平滑 */
    smoothness: 0.08,
    /** 对焦深度 0~1：该深度的物体保持静止 */
    focusDepth: 0.50,
    /** 隐藏右上角调试面板 */
    hideDebugPanel: false,
};

// ==================== 调试面板 ====================

const debugPanel = document.getElementById('debug-panel');
const debugToggle = document.getElementById('debug-toggle');
const parallaxSlider = document.getElementById('parallax-strength');
const parallaxValueEl = document.getElementById('parallax-value');
const smoothnessSlider = document.getElementById('smoothness');
const smoothnessValueEl = document.getElementById('smoothness-value');
const focusSlider = document.getElementById('focus-depth');
const focusValueEl = document.getElementById('focus-value');

/** 把 CONFIG 同步到调试面板，并按配置显示/隐藏面板 */
function syncDebugPanel() {
    if (parallaxSlider) parallaxSlider.value = CONFIG.parallaxMultiplier;
    if (parallaxValueEl) parallaxValueEl.textContent = CONFIG.parallaxMultiplier;
    if (smoothnessSlider) smoothnessSlider.value = Math.round(CONFIG.smoothness * 100);
    if (smoothnessValueEl) smoothnessValueEl.textContent = CONFIG.smoothness.toFixed(2);
    if (focusSlider) focusSlider.value = Math.round(CONFIG.focusDepth * 100);
    if (focusValueEl) focusValueEl.textContent = Number(CONFIG.focusDepth).toFixed(2);
    if (debugPanel) debugPanel.style.display = CONFIG.hideDebugPanel ? 'none' : '';
}

/** 调试面板改动后保存到主进程 */
function saveParallaxConfig() {
    if (!isElectron) return;
    window.electronAPI.saveConfig({
        parallaxMultiplier: CONFIG.parallaxMultiplier,
        smoothness: CONFIG.smoothness,
        focusDepth: CONFIG.focusDepth,
    });
}

// ==================== 自定义元素管理器 ====================

const weatherManager = new WeatherParticleManager();
const stickerManager = new StickerManager();
const vinylManager = new VinylPlayerManager();
const videoOverlayManager = new VideoOverlayManager();

function applyCustomElementsConfig(config) {
    if (!config) return;
    if (config.weather) weatherManager.setConfig(config.weather);
    if (config.sticker) stickerManager.setConfig(config.sticker);
    if (config.vinyl) vinylManager.setConfig(config.vinyl);
    if (config.videoOverlay) videoOverlayManager.setConfig(config.videoOverlay);
}

// ==================== 鼠标与动画循环 ====================

/** 鼠标目标位置，归一化到 [-1, 1] */
let targetX = 0;
let targetY = 0;
/** 平滑后的当前位置 */
let currentX = 0;
let currentY = 0;

function bindEvents() {
    if (isElectron) {
        // 壁纸挂在 WorkerW 层收不到 mousemove，坐标由主进程轮询后推送
        window.electronAPI.onMouseMove((pos) => {
            targetX = (pos.x / window.innerWidth) * 2 - 1;
            targetY = (pos.y / window.innerHeight) * 2 - 1;
        });
    } else {
        window.addEventListener('mousemove', (e) => {
            targetX = (e.clientX / window.innerWidth) * 2 - 1;
            targetY = (e.clientY / window.innerHeight) * 2 - 1;
        });
    }

    if (parallaxSlider) {
        parallaxSlider.addEventListener('input', () => {
            CONFIG.parallaxMultiplier = parseInt(parallaxSlider.value, 10);
            if (parallaxValueEl) parallaxValueEl.textContent = CONFIG.parallaxMultiplier;
            saveParallaxConfig();
        });
    }
    if (smoothnessSlider) {
        smoothnessSlider.addEventListener('input', () => {
            CONFIG.smoothness = parseFloat(smoothnessSlider.value) / 100;
            if (smoothnessValueEl) smoothnessValueEl.textContent = CONFIG.smoothness.toFixed(2);
            saveParallaxConfig();
        });
    }
    if (focusSlider) {
        focusSlider.addEventListener('input', () => {
            CONFIG.focusDepth = parseInt(focusSlider.value, 10) / 100;
            if (focusValueEl) focusValueEl.textContent = CONFIG.focusDepth.toFixed(2);
            saveParallaxConfig();
        });
    }
    if (debugToggle && debugPanel) {
        debugToggle.addEventListener('click', () => {
            debugPanel.classList.toggle('collapsed');
            debugToggle.textContent = debugPanel.classList.contains('collapsed') ? '+' : '−';
        });
    }
}

/**
 * 每帧更新（Pixi ticker 驱动）。
 * @param {number} delta - 以 60fps 为 1 的帧时间倍数
 */
function updateLoop(delta) {
    const k = 1 - Math.pow(1 - CONFIG.smoothness, delta);
    currentX += (targetX - currentX) * k;
    currentY += (targetY - currentY) * k;

    // 鼠标右移时近景向左偏，所以传入取反后的值
    const strength = (CONFIG.parallaxMultiplier / 1000) * 1.25;
    Scene.setParallax(-currentX, -currentY, strength, Number(CONFIG.focusDepth));

    weatherManager.update(delta, currentX, currentY);
    stickerManager.update(currentX, currentY);
    vinylManager.update(currentX, currentY);
}

// ==================== 与主进程的通信 ====================

function registerIpcListeners() {
    window.electronAPI.onPauseRender(() => {
        Scene.app.ticker.stop();
        videoOverlayManager.pause();
        UI.showToast('壁纸已暂停（检测到全屏应用）', 2000);
    });

    window.electronAPI.onResumeRender(() => {
        Scene.app.ticker.start();
        videoOverlayManager.resume();
        UI.showToast('壁纸已恢复', 1500);
    });

    window.electronAPI.onNewImage(async (imagePath) => {
        UI.showLoading('正在加载新壁纸...');
        try {
            const cachedDepth = await window.electronAPI.getDepthCache(imagePath);
            if (cachedDepth) {
                await Scene.load(imagePath, cachedDepth);
                UI.showToast('壁纸已更换', 2000);
            } else {
                UI.showToast('请先在设置窗口中生成深度图（托盘菜单 → 打开设置）', 4000);
            }
        } catch (err) {
            console.error('[App] 切换壁纸失败:', err);
            UI.showToast('切换壁纸失败: ' + err.message, 3000);
        }
        UI.hideLoading();
    });

    window.electronAPI.onLoadConfig((config) => {
        if (!config) return;
        if (config.parallaxMultiplier !== undefined) CONFIG.parallaxMultiplier = config.parallaxMultiplier;
        if (config.smoothness !== undefined) CONFIG.smoothness = config.smoothness;
        if (config.focusDepth !== undefined) CONFIG.focusDepth = config.focusDepth;
        // 配置里没写时默认隐藏（壁纸常驻桌面，不该露出调试面板）
        CONFIG.hideDebugPanel = config.hideDebugPanel !== false;
        syncDebugPanel();
        applyCustomElementsConfig(config);
    });
}

// ==================== 启动 ====================

/**
 * 决定启动时加载哪张壁纸和深度图：
 * 有上次应用的壁纸就用它和它的深度缓存；没有缓存时用占位深度图，
 * 不能拿项目自带的 depth_map.png 去配别的图片。
 * @returns {Promise<{bg: string, depth: string|null}>}
 */
async function resolveInitialSources() {
    const fallback = { bg: 'background.png', depth: 'depth_map.png' };
    if (!isElectron) return fallback;

    try {
        const config = await window.electronAPI.getConfig();
        applyCustomElementsConfig(config);
        const current = config && config.currentImage;
        if (current && window.electronAPI.fileExists(current)) {
            const cachedDepth = await window.electronAPI.getDepthCache(current);
            return { bg: current, depth: cachedDepth || null };
        }
    } catch (err) {
        console.warn('[App] 读取上次的壁纸配置失败:', err);
    }
    return fallback;
}

async function start() {
    UI.showLoading('正在加载壁纸素材...');
    syncDebugPanel();
    if (isElectron) registerIpcListeners();

    const sources = await resolveInitialSources();
    try {
        await Scene.load(sources.bg, sources.depth);
    } catch (err) {
        console.error('[App] 壁纸加载失败，改用项目自带的 background.png:', err);
        try {
            await Scene.load('background.png', 'depth_map.png');
        } catch (err2) {
            UI.showError('没有找到可用的壁纸图片。\n' + err2.message);
        }
    }

    bindEvents();
    Scene.app.ticker.add(updateLoop);
    UI.hideLoading();

    if (isElectron) {
        window.electronAPI.notifyReady();
        console.log('[App] 已通知主进程渲染就绪');
    }
}

start();
