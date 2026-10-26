/**
 * thumbnail.js — 为导入的自定义元素生成缩略图（设置窗口里运行）
 *
 * 顺带起到"能不能读"的检查作用：Chromium 解不了的文件这里会失败。
 */

'use strict';

/** 缩略图最长边 */
const THUMB_MAX_SIDE = 256;
/** 读取视频首帧的超时 */
const THUMB_VIDEO_TIMEOUT_MS = 10000;

function loadThumbImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('图片无法读取'));
        img.src = url;
    });
}

/** 跳到视频靠前的位置取一帧（开头经常是黑场） */
function loadThumbVideoFrame(url) {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.muted = true;
        video.preload = 'auto';
        const timer = setTimeout(() => reject(new Error('视频读取超时')), THUMB_VIDEO_TIMEOUT_MS);
        video.addEventListener('loadedmetadata', () => {
            video.currentTime = Math.min(0.5, (video.duration || 1) / 2);
        }, { once: true });
        video.addEventListener('seeked', () => { clearTimeout(timer); resolve(video); }, { once: true });
        video.addEventListener('error', () => { clearTimeout(timer); reject(new Error('视频无法播放')); }, { once: true });
        video.src = url;
    });
}

/**
 * @param {string} fileUrl - file:// URL
 * @param {'image'|'animated'|'video'} type
 * @returns {Promise<string>} JPEG Data URL；文件读不了时 reject
 */
async function makeThumbnail(fileUrl, type) {
    // 动图用 <img> 加载时取到的就是第一帧
    const source = type === 'video' ? await loadThumbVideoFrame(fileUrl) : await loadThumbImage(fileUrl);
    const w = source.videoWidth || source.naturalWidth;
    const h = source.videoHeight || source.naturalHeight;
    if (!w || !h) throw new Error('无法读取画面尺寸');

    const scale = Math.min(1, THUMB_MAX_SIDE / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#2b2d38';   // 透明素材垫一层卡片底色，JPEG 没有透明通道
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
}
