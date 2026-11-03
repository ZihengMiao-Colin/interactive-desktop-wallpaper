/**
 * video-wallpaper.js — 视频壁纸的素材源：隐藏的 <video> 做 Pixi 纹理
 *
 * 纹理不让 Pixi 自己更新（autoUpdate 关掉），由这里的 requestVideoFrameCallback 循环在每个新视频帧
 * 先更新纹理、再通知外面要不要重画。这样空闲停帧时（ticker 停了）视频也能按自己的帧率出画面，
 * 纹理更新和"要不要重画"只有一个来源。
 */

'use strict';

/** 读取视频壁纸的超时（名字不能和 elements/sources.js 的 VIDEO_LOAD_TIMEOUT_MS 重复，普通脚本共用全局） */
const VIDEO_WALLPAPER_LOAD_TIMEOUT_MS = 15000;

/**
 * @param {string} filePath - 视频的本地路径
 * @param {{sound?: boolean}} [options]
 * @returns {Promise<{
 *   video: HTMLVideoElement, texture: PIXI.Texture, width: number, height: number,
 *   play: () => void, pause: () => void, setSound: (on: boolean) => void,
 *   onFrame: (cb: () => void) => void, destroy: () => void,
 * }>}
 */
async function createVideoWallpaper(filePath, { sound = false } = {}) {
    const video = document.createElement('video');
    video.loop = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.muted = !sound;

    try {
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('视频读取超时')), VIDEO_WALLPAPER_LOAD_TIMEOUT_MS);
            video.addEventListener('loadeddata', () => { clearTimeout(timer); resolve(); }, { once: true });
            video.addEventListener('error', () => { clearTimeout(timer); reject(new Error('视频无法播放')); }, { once: true });
            video.src = Host.fileUrl(filePath);
        });
    } catch (err) {
        video.removeAttribute('src');
        video.load();
        throw err;
    }
    let frameCallback = null;
    let frameHandle = null;
    let destroyed = false;

    // 播放中途解码出错：画面停在最后一帧，只记日志（destroy 时清掉 src 也会触发 error，那时不算）
    video.addEventListener('error', () => {
        if (!destroyed) console.error('[VideoWallpaper] 播放出错:', filePath);
    });

    const texture = PIXI.Texture.from(video, { resourceOptions: { autoPlay: false } });
    const resource = texture.baseTexture.resource;
    resource.autoUpdate = false;
    function onVideoFrame() {
        frameHandle = video.requestVideoFrameCallback(onVideoFrame);
        resource.update();
        if (frameCallback) frameCallback();
    }
    frameHandle = video.requestVideoFrameCallback(onVideoFrame);
    createVideoWallpaper.live++;

    return {
        video,
        texture,
        width: video.videoWidth,
        height: video.videoHeight,
        play() {
            if (destroyed || !video.paused) return;
            video.play().catch((err) => console.warn('[VideoWallpaper] 播放失败:', err.message));
        },
        pause() {
            if (!destroyed) video.pause();
        },
        setSound(on) {
            video.muted = !on;
        },
        onFrame(cb) {
            frameCallback = cb;
        },
        destroy() {
            if (destroyed) return;
            destroyed = true;
            frameCallback = null;
            if (frameHandle !== null) video.cancelVideoFrameCallback(frameHandle);
            video.pause();
            video.removeAttribute('src');
            video.load();
            texture.destroy(true);
            createVideoWallpaper.live--;
        },
    };
}

/** 还没 destroy 的视频壁纸个数（实测用：反复切换后应该一直是 0 或 1） */
createVideoWallpaper.live = 0;
