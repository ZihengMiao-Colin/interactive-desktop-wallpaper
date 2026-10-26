/**
 * sources.js — 自定义元素的素材源：把图片 / 动图 / 视频统一成可以喂给 Pixi 的纹理
 *
 * 统一接口 ElementSource：
 *   texture, width, height, animated
 *   play() / pause() / restart() / setLoop(loop) / hasEnded()
 *   update(nowMs)   动图在这里换帧，其他类型为空操作
 *   destroy()
 */

'use strict';

/** 动图最多解码这么多帧，超出部分截断（防止超长 GIF 占满内存） */
const MAX_ANIMATED_FRAMES = 600;
/** 视频加载超时 */
const VIDEO_LOAD_TIMEOUT_MS = 15000;

const ANIMATED_MIME = { gif: 'image/gif', webp: 'image/webp', png: 'image/png', apng: 'image/png' };

function extOf(filePath) {
    const m = /\.([^.\\/]+)$/.exec(filePath);
    return m ? m[1].toLowerCase() : '';
}

/** 一个不会动的素材源（静态图片、单帧动图共用） */
function staticSource(texture, width, height) {
    return {
        texture,
        width,
        height,
        animated: false,
        play() {},
        pause() {},
        restart() {},
        setLoop() {},
        hasEnded: () => false,
        update() {},
        destroy() { texture.destroy(true); },
    };
}

function loadHtmlImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('无法加载图片: ' + url));
        img.src = url;
    });
}

async function createImageSource(asset) {
    const img = await loadHtmlImage(Host.fileUrl(asset.file));
    return staticSource(PIXI.Texture.from(img), img.naturalWidth, img.naturalHeight);
}

/**
 * 动图：用 WebCodecs ImageDecoder 解出所有帧（ImageBitmap + 时长），
 * 播放时按经过的时间挑帧画到 canvas 上，再通知 Pixi 更新纹理。
 */
async function createAnimatedSource(asset) {
    if (typeof ImageDecoder === 'undefined') {
        console.warn('[Elements] 当前环境不支持 ImageDecoder，动图按静态图片显示:', asset.file);
        return createImageSource(asset);
    }

    const data = await Host.readBytes(asset.file);
    const decoder = new ImageDecoder({ data, type: ANIMATED_MIME[extOf(asset.file)] || 'image/gif' });
    const frames = [];
    const durations = [];
    try {
        // 两个都要等：tracks.ready 之前 selectedTrack 为 null，completed 之前 frameCount 可能还不完整
        await decoder.tracks.ready;
        await decoder.completed;
        const total = decoder.tracks.selectedTrack.frameCount;
        if (total > MAX_ANIMATED_FRAMES) {
            console.warn(`[Elements] 动图有 ${total} 帧，只取前 ${MAX_ANIMATED_FRAMES} 帧:`, asset.file);
        }
        for (let i = 0; i < Math.min(total, MAX_ANIMATED_FRAMES); i++) {
            const { image } = await decoder.decode({ frameIndex: i });
            durations.push((image.duration || 0) / 1000);   // 微秒 → 毫秒
            frames.push(await createImageBitmap(image));
            image.close();
        }
    } finally {
        decoder.close();
    }
    if (frames.length === 0) throw new Error('动图没有可用的帧: ' + asset.file);

    const canvas = document.createElement('canvas');
    canvas.width = frames[0].width;
    canvas.height = frames[0].height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(frames[0], 0, 0);
    const texture = PIXI.Texture.from(canvas);

    if (frames.length === 1) {
        frames[0].close();
        return staticSource(texture, canvas.width, canvas.height);
    }

    const totalMs = durations.reduce((a, d) => a + (d > 0 ? d : 100), 0);
    let playing = false;
    let loop = true;
    let ended = false;
    let elapsedMs = 0;       // 暂停时累计的播放时长
    let startMs = null;      // 本轮开始播放的时间点（null 表示下一帧再对齐）
    let currentFrame = 0;

    function drawFrame(index) {
        if (index === currentFrame) return;
        currentFrame = index;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(frames[index], 0, 0);
        texture.baseTexture.update();
    }

    return {
        texture,
        width: canvas.width,
        height: canvas.height,
        animated: true,
        play() {
            if (playing) return;
            playing = true;
            startMs = null;
        },
        pause() {
            playing = false;
        },
        restart() {
            elapsedMs = 0;
            ended = false;
            startMs = null;
            drawFrame(0);
        },
        setLoop(value) {
            loop = value;
        },
        hasEnded: () => ended,
        update(nowMs) {
            if (!playing || ended) return;
            if (startMs === null) startMs = nowMs - elapsedMs;
            elapsedMs = nowMs - startMs;
            if (!loop && elapsedMs >= totalMs) {
                ended = true;
                drawFrame(frames.length - 1);
                return;
            }
            drawFrame(Shared.playback.pickFrame(durations, elapsedMs));
        },
        destroy() {
            frames.forEach((f) => f.close());
            texture.destroy(true);
        },
    };
}

/** 视频：隐藏的 <video>（静音）作为纹理源，Pixi 在播放时自动更新纹理 */
async function createVideoSource(asset) {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('视频加载超时: ' + asset.file)), VIDEO_LOAD_TIMEOUT_MS);
        video.addEventListener('loadeddata', () => { clearTimeout(timer); resolve(); }, { once: true });
        video.addEventListener('error', () => {
            clearTimeout(timer);
            reject(new Error('视频无法播放（格式不支持或文件损坏）: ' + asset.file));
        }, { once: true });
        video.src = Host.fileUrl(asset.file);
    });

    const texture = PIXI.Texture.from(video, { resourceOptions: { autoPlay: false } });
    return {
        texture,
        width: video.videoWidth,
        height: video.videoHeight,
        animated: true,
        play() {
            video.play().catch((err) => console.warn('[Elements] 视频播放失败:', err.message));
        },
        pause() {
            video.pause();
        },
        restart() {
            video.currentTime = 0;
        },
        setLoop(value) {
            video.loop = value;
        },
        hasEnded: () => video.ended,
        update() {},
        destroy() {
            video.pause();
            texture.destroy(true);
            video.removeAttribute('src');
            video.load();
        },
    };
}

/**
 * 按素材类型创建素材源，加载失败时 reject。
 * @param {import('../../shared/elements-model').Asset} asset
 */
async function createElementSource(asset) {
    switch (asset.type) {
        case 'image': return createImageSource(asset);
        case 'animated': return createAnimatedSource(asset);
        case 'video': return createVideoSource(asset);
        default: throw new Error('未知的素材类型: ' + asset.type);
    }
}
