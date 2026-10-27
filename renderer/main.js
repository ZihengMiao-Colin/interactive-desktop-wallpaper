/**
 * main.js — 壁纸页入口：配置、鼠标输入、动画循环、与主进程的 IPC
 *
 * 平滑算法：current += (target - current) × k，k 按帧时间换算，
 * 保证不同帧率下的跟手速度一致。smoothness 越小越平滑、延迟越大。
 */

'use strict';

/** 是否运行在 Electron 中（浏览器直接打开 index.html 时为 false） */
const isElectron = !!window.electronAPI;

/** 摆放窗口：只渲染背景和自定义元素，背景视差冻结在中心 */
const isEditMode = Host.mode === 'edit';

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

/** 调试面板拖动时节流保存：第一次立即发送，之后每 100ms 最多一次 */
const parallaxSaver = isElectron
    ? Shared.configSync.createConfigSaver((partial) => window.electronAPI.saveConfig(partial), 100)
    : null;

/** 调试面板改动后保存到主进程 */
function saveParallaxConfig() {
    wake();
    if (!parallaxSaver) return;
    parallaxSaver.save({
        parallaxMultiplier: CONFIG.parallaxMultiplier,
        smoothness: CONFIG.smoothness,
        focusDepth: CONFIG.focusDepth,
    });
}

// ==================== 自定义元素管理器 ====================

const weatherManager = new WeatherParticleManager();
const vinylManager = new VinylPlayerManager();
const videoOverlayManager = new VideoOverlayManager();

/** 用户自定义元素（图片 / 动图 / 视频），在 Pixi 场景内渲染 */
const elementsLayer = new ElementsLayer(Scene);
/** 默认素材列表（启动时读取一次） */
let builtinAssets = [];

/**
 * 上一次应用过的各段配置（JSON 快照）。主进程每次都发完整配置，
 * 这里只把真正变了的段交给对应的管理器，拖一个滑块不会把所有东西重新配置一遍。
 */
let appliedSections = {};

/** 同步自定义元素（配置里的 customElements 段变了才同步） */
async function syncCustomElements(config) {
    const { changed, snapshot } = Shared.configSync.changedSections(appliedSections, config, ['customElements']);
    appliedSections = snapshot;
    if (!changed.length) return;
    await elementsLayer.setElements(config.customElements, builtinAssets);
    wake();
}

/** 读取配置并同步自定义元素；之后配置变化时自动刷新 */
async function loadCustomElements() {
    const [config, builtin] = await Promise.all([Host.getConfig(), Host.getBuiltinAssets()]);
    builtinAssets = builtin;
    await syncCustomElements(config);
    Host.onConfig((next) => {
        if (next) syncCustomElements(next);
    });
}

/** 天气、唱片机、视频特效：只重新应用变了的段 */
function applyCustomElementsConfig(config) {
    if (!config) return;
    const { changed, snapshot } = Shared.configSync.changedSections(
        appliedSections, config, ['weather', 'vinyl', 'videoOverlay']);
    appliedSections = snapshot;
    if (changed.includes('weather')) weatherManager.setConfig(config.weather);
    if (changed.includes('vinyl')) vinylManager.setConfig(config.vinyl);
    if (changed.includes('videoOverlay')) videoOverlayManager.setConfig(config.videoOverlay);
    if (changed.length) wake();
}

// ==================== 鼠标与动画循环 ====================

/** 鼠标目标位置，归一化到 [-1, 1] */
let targetX = 0;
let targetY = 0;
/** 平滑后的当前位置 */
let currentX = 0;
let currentY = 0;

function bindEvents() {
    if (isEditMode) {
        // 摆放模式下鼠标用来拖元素，不驱动视差
    } else if (isElectron) {
        // 壁纸挂在 WorkerW 层收不到 mousemove，坐标由主进程轮询后推送
        window.electronAPI.onMouseMove((pos) => {
            targetX = (pos.x / window.innerWidth) * 2 - 1;
            targetY = (pos.y / window.innerHeight) * 2 - 1;
            wake();
        });
    } else {
        window.addEventListener('mousemove', (e) => {
            targetX = (e.clientX / window.innerWidth) * 2 - 1;
            targetY = (e.clientY / window.innerHeight) * 2 - 1;
            wake();
        });
    }
    // 窗口尺寸变了 Pixi 会重建画布内容，必须重新出帧
    window.addEventListener('resize', wake);

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

// ==================== 空闲停帧 ====================
// 鼠标不动、视差已收敛、也没有天气粒子和播放中的视频 / 动图时停掉 ticker，
// 最后一帧会一直留在屏幕上；鼠标一动或配置变化再唤醒。

/** 连续空闲这么多帧（约半秒）后停帧，让鼠标停下后的平滑过渡走完 */
const IDLE_GRACE_FRAMES = 30;
const idleTracker = new Shared.framePacing.IdleTracker({ graceFrames: IDLE_GRACE_FRAMES });
/** 主进程要求暂停渲染（全屏应用、锁屏、摆放模式）期间不自行唤醒 */
let renderPaused = false;
let wakeTimer = null;

/** 画面可能要变了：重新开始出帧（已经在跑时只重置空闲计数） */
function wake() {
    idleTracker.reset();
    clearTimeout(wakeTimer);
    wakeTimer = null;
    if (!renderPaused && !Scene.app.ticker.started) Scene.app.ticker.start();
}

/** 每帧末尾调用：满足空闲条件就停掉 ticker */
function sleepIfIdle(nowMs) {
    if (isEditMode) return;
    const { isSettled } = Shared.framePacing;
    const settled = isSettled(targetX, currentX) && isSettled(targetY, currentY);
    const animating = weatherManager.isActive() || elementsLayer.needsFrames();
    if (!idleTracker.frame(settled && !animating)) return;

    Scene.app.ticker.stop();
    // 间隔播放的元素到点要重新出现，定时叫醒
    const next = elementsLayer.nextWakeMs();
    if (next !== null) wakeTimer = setTimeout(wake, Math.max(0, next - nowMs));
}

/**
 * 每帧更新（Pixi ticker 驱动）。
 * @param {number} delta - 以 60fps 为 1 的帧时间倍数
 */
function updateLoop(delta) {
    const now = performance.now();
    const k = 1 - Math.pow(1 - CONFIG.smoothness, delta);
    currentX += (targetX - currentX) * k;
    currentY += (targetY - currentY) * k;

    // 鼠标右移时近景向左偏，所以传入取反后的值
    const strength = Shared.parallax.strengthFromMultiplier(CONFIG.parallaxMultiplier);
    const focus = Number(CONFIG.focusDepth);
    Scene.setParallax(-currentX, -currentY, strength, focus);
    elementsLayer.update(now, -currentX, -currentY, strength, focus);

    weatherManager.update(delta, currentX, currentY);
    vinylManager.update(currentX, currentY);

    sleepIfIdle(now);
}

// ==================== 与主进程的通信 ====================

function registerIpcListeners() {
    // info.silent：摆放模式等内部暂停，不弹提示
    window.electronAPI.onPauseRender((info) => {
        renderPaused = true;
        clearTimeout(wakeTimer);
        Scene.app.ticker.stop();
        videoOverlayManager.pause();
        elementsLayer.pause(performance.now());
        if (!info.silent) UI.showToast('壁纸已暂停（检测到全屏应用）', 2000);
    });

    window.electronAPI.onResumeRender((info) => {
        renderPaused = false;
        videoOverlayManager.resume();
        elementsLayer.resume(performance.now());
        wake();
        if (!info.silent) UI.showToast('壁纸已恢复', 1500);
    });

    // 点击桌面：触发"点击播放"的元素
    window.electronAPI.onDesktopClick(({ x, y }) => {
        if (renderPaused) return;
        if (elementsLayer.handleClick(x, y)) wake();
    });

    window.electronAPI.onNewImage(async (imagePath) => {
        UI.showLoading('正在加载新壁纸...');
        try {
            const cachedDepth = await window.electronAPI.getDepthCache(imagePath);
            if (cachedDepth) {
                await Scene.load(imagePath, cachedDepth);
                wake();
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
        const before = [CONFIG.parallaxMultiplier, CONFIG.smoothness, CONFIG.focusDepth].join();
        if (config.parallaxMultiplier !== undefined) CONFIG.parallaxMultiplier = config.parallaxMultiplier;
        if (config.smoothness !== undefined) CONFIG.smoothness = config.smoothness;
        if (config.focusDepth !== undefined) CONFIG.focusDepth = config.focusDepth;
        // 视差参数变了，静止的画面也要按新参数重画
        if ([CONFIG.parallaxMultiplier, CONFIG.smoothness, CONFIG.focusDepth].join() !== before) wake();
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
        if (!isEditMode) applyCustomElementsConfig(config);
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
    if (isEditMode) CONFIG.hideDebugPanel = true;
    syncDebugPanel();
    if (isElectron && !isEditMode) registerIpcListeners();

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

    try {
        await loadCustomElements();
    } catch (err) {
        // 自定义元素出问题不能影响壁纸本身
        console.error('[App] 自定义元素加载失败:', err);
    }

    bindEvents();
    Scene.app.ticker.add(updateLoop);
    UI.hideLoading();

    if (isEditMode) {
        await startEditMode({ scene: Scene, layer: elementsLayer, host: Host });
        return;
    }

    if (isElectron) {
        window.electronAPI.notifyReady();
        console.log('[App] 已通知主进程渲染就绪');
    }
}

start();
