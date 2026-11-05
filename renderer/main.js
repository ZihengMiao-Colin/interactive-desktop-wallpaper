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
    parallaxMultiplier: 10,
    /** 平滑度 0~1，越小越平滑 */
    smoothness: 0.08,
    /** 对焦深度 0~1：该深度的物体保持静止 */
    focusDepth: 0.50,
};

// ==================== 自定义元素管理器 ====================

const weatherManager = new WeatherParticleManager();
const vinylManager = new VinylPlayerManager();
// 唱片机换歌、放完停下：存进配置再由广播回来执行，设置页的歌单也跟着变
if (isElectron && !isEditMode) {
    vinylManager.onRequestChange = (partial) => window.electronAPI.saveConfig({ vinyl: partial });
}
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

    // 鼠标右移时近景向左偏，所以传入取反后的值。视频壁纸按效果换算（不动：强度 0；整体平移：全画面在深度 1）
    // 裁剪后画面放大了，强度跟着缩小，屏幕上的位移和不裁时一样
    const strength = Shared.parallax.strengthFromMultiplier(CONFIG.parallaxMultiplier) * Scene.getCropZoom();
    const m = Shared.parallax.motionParams(Scene.getMotion(), strength, Number(CONFIG.focusDepth));
    Scene.setParallax(-currentX, -currentY, m.strength, m.focus);
    elementsLayer.update(now, -currentX, -currentY, m.strength, m.focus, m);

    weatherManager.update(delta, currentX, currentY);
    vinylManager.update(currentX, currentY);

    sleepIfIdle(now);
}

// ==================== 视频壁纸 ====================

/** 当前桌面上的壁纸 { type, path, effect?, sound?, crop? }（Shared.myWallpapers.resolveCurrent 的格式） */
let currentWallpaper = null;
/** 背景是视频时的视频壁纸对象（renderer/video-wallpaper.js） */
let currentVideo = null;
/** 主进程暂停壁纸的原因（'covered' 被窗口挡住 | 'system' 锁屏睡眠 | 'placement' 摆放）；运行中为 null */
let pauseReason = null;
/** 换壁纸一个一个来，连着换几次只认最后一次：加载慢的旧请求不能最后才完成、盖掉新的 */
const wallpaperQueue = Shared.configSync.createLatestQueue();

/** 视频出了新帧：ticker 停着（空闲停帧）时只画这一帧，ticker 在跑时下一帧自然会画 */
function onVideoFrame() {
    if (!renderPaused && !Scene.app.ticker.started) Scene.renderOnce();
}

/** 按暂停状态决定视频放不放：被窗口挡住、并且开了声音时继续放（声音不断），其余暂停时都停 */
function syncVideoPlayback() {
    if (!currentVideo) return;
    const sound = !!(currentWallpaper && currentWallpaper.sound);
    if (!renderPaused || Shared.framePacing.keepVideoPlaying(pauseReason, sound)) currentVideo.play();
    else currentVideo.pause();
}

/**
 * 换上一个视频壁纸。读不出来时抛错，桌面保持原来的壁纸。
 * @param {{path: string, effect: string, sound: boolean, crop?: object}} descriptor
 */
async function showVideoWallpaper(descriptor) {
    const depth = descriptor.effect === 'depth' ? await window.electronAPI.getDepthCache(descriptor.path) : null;
    // 摆放窗口里一直静音（桌面上的壁纸还在出声）
    const video = await createVideoWallpaper(descriptor.path, { sound: !isEditMode && descriptor.sound });
    try {
        await Scene.loadVideo(video, { motion: descriptor.effect, depthSource: depth, crop: descriptor.crop || null });
    } catch (err) {
        video.destroy();
        throw err;
    }
    currentVideo = video;
    currentWallpaper = { ...descriptor, type: 'video' };
    video.onFrame(onVideoFrame);
    syncVideoPlayback();
    wake();
}

/** 换上一张图片壁纸（之前是视频的话 Scene.load 会释放它） */
async function showImageWallpaper(imagePath, depth, crop = null) {
    await Scene.load(imagePath, depth, crop);
    currentVideo = null;
    currentWallpaper = { type: 'image', path: imagePath };
    wake();
}

// ==================== 与主进程的通信 ====================

function registerIpcListeners() {
    // info.silent：摆放模式等内部暂停，不弹提示；info.reason 决定视频壁纸停不停
    window.electronAPI.onPauseRender((info) => {
        renderPaused = true;
        pauseReason = info.reason || 'system';
        clearTimeout(wakeTimer);
        Scene.app.ticker.stop();
        videoOverlayManager.pause();
        elementsLayer.pause(performance.now());
        syncVideoPlayback();
        if (!info.silent) UI.showToast('壁纸已暂停（检测到全屏应用）', 2000);
    });

    window.electronAPI.onResumeRender((info) => {
        renderPaused = false;
        pauseReason = null;
        videoOverlayManager.resume();
        elementsLayer.resume(performance.now());
        syncVideoPlayback();
        wake();
        if (!info.silent) UI.showToast('壁纸已恢复', 1500);
    });

    // 解锁动画开着声音时，唱片机的音量降到 0
    window.electronAPI.onVinylDuck((ducked) => vinylManager.setDucked(ducked));

    // 点击桌面：点中唱片机就播放 / 暂停（唱片机在最上层，点中了就不再传给元素），否则触发"点击播放"的元素
    window.electronAPI.onDesktopClick(({ x, y }) => {
        if (renderPaused) return;
        if (vinylManager.hitTest(x, y)) {
            const playing = vinylManager.clickToggle();
            // 存进配置再由广播回来执行，设置页的播放按钮也会跟着变
            if (playing !== null) window.electronAPI.saveConfig({ vinyl: { playing } });
            return;
        }
        if (elementsLayer.handleClick(x, y)) wake();
    });

    window.electronAPI.onShowWallpaper((descriptor) => wallpaperQueue.run(async () => {
        if (!descriptor) return;
        UI.showLoading('正在加载新壁纸...');
        if (descriptor.type === 'video') {
            try {
                await showVideoWallpaper(descriptor);
                UI.showToast('壁纸已更换', 2000);
            } catch (err) {
                console.error('[App] 切换视频壁纸失败:', err);
                UI.showToast('切换壁纸失败: ' + err.message, 3000);
            }
            UI.hideLoading();
            return;
        }
        const imagePath = descriptor.path;
        try {
            const cachedDepth = await window.electronAPI.getDepthCache(imagePath);
            if (cachedDepth) {
                await showImageWallpaper(imagePath, cachedDepth, descriptor.crop || null);
                UI.showToast('壁纸已更换', 2000);
            } else {
                UI.showToast('请先在设置窗口中生成深度图（托盘菜单 → 打开设置）', 4000);
            }
        } catch (err) {
            console.error('[App] 切换壁纸失败:', err);
            UI.showToast('切换壁纸失败: ' + err.message, 3000);
        }
        UI.hideLoading();
    }));

    window.electronAPI.onLoadConfig((config) => {
        if (!config) return;
        const before = [CONFIG.parallaxMultiplier, CONFIG.smoothness, CONFIG.focusDepth].join();
        if (config.parallaxMultiplier !== undefined) CONFIG.parallaxMultiplier = config.parallaxMultiplier;
        if (config.smoothness !== undefined) CONFIG.smoothness = config.smoothness;
        if (config.focusDepth !== undefined) CONFIG.focusDepth = config.focusDepth;
        // 视差参数变了，静止的画面也要按新参数重画
        if ([CONFIG.parallaxMultiplier, CONFIG.smoothness, CONFIG.focusDepth].join() !== before) wake();
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
        // 当前壁纸可能是图片（currentImage）或视频（currentVideo），规则见 shared/my-wallpapers.js
        const current = Shared.myWallpapers.resolveCurrent(config);
        if (!current) return fallback;
        if (!window.electronAPI.fileExists(current.path)) return { ...fallback, missing: current.path };
        if (current.type === 'video') return { ...fallback, video: current };
        const cachedDepth = await window.electronAPI.getDepthCache(current.path);
        return { bg: current.path, depth: cachedDepth || null, crop: current.crop || null };
    } catch (err) {
        console.warn('[App] 读取上次的壁纸配置失败:', err);
    }
    return fallback;
}

async function start() {
    UI.showLoading('正在加载壁纸素材...');
    if (isElectron && !isEditMode) registerIpcListeners();

    // 上次的壁纸文件找不到、视频读不出来时退回自带的 background.png，加载完再提示
    let notice = '';
    // 和换壁纸走同一个队列（读配置也放在里面）：启动加载期间设置页又换了壁纸，要等这次加载完再换
    await wallpaperQueue.run(async () => {
        const sources = await resolveInitialSources();
        if (sources.missing) notice = '找不到上次的壁纸：' + sources.missing.split(/[\\/]/).pop();
        try {
            if (sources.video) {
                try {
                    await showVideoWallpaper(sources.video);
                } catch (err) {
                    console.error('[App] 视频壁纸加载失败，改用 background.png:', err);
                    notice = '视频壁纸加载失败：' + err.message;
                    await showImageWallpaper(sources.bg, sources.depth);
                }
            } else {
                await showImageWallpaper(sources.bg, sources.depth, sources.crop);
            }
        } catch (err) {
            console.error('[App] 壁纸加载失败，改用项目自带的 background.png:', err);
            try {
                await Scene.load('background.png', 'depth_map.png');
            } catch (err2) {
                UI.showError('没有找到可用的壁纸图片。\n' + err2.message);
            }
        }
    });

    try {
        await loadCustomElements();
    } catch (err) {
        // 自定义元素出问题不能影响壁纸本身
        console.error('[App] 自定义元素加载失败:', err);
    }

    bindEvents();
    Scene.app.ticker.add(updateLoop);
    UI.hideLoading();
    if (notice) UI.showToast(notice, 4000);

    if (isEditMode) {
        await startEditMode({ scene: Scene, layer: elementsLayer, host: Host, vinyl: vinylManager });
        return;
    }

    if (isElectron) {
        window.electronAPI.notifyReady();
        console.log('[App] 已通知主进程渲染就绪');
    }
}

start();
