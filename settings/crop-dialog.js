/**
 * crop-dialog.js — 裁剪框：导入壁纸、解锁视频时弹出，用户拖框决定留下哪一块
 *
 * 框的比例固定是屏幕比例，用户不用管比例。框默认放在自动裁切的位置，所以不想裁的人直接点"确定"就行。
 * 这里只负责让用户选出区域，存到哪里由调用的页面决定。几何计算都在 shared/crop.js。
 */

'use strict';

/** 读取视频画面的超时 */
const CROP_VIDEO_TIMEOUT_MS = 15000;
/** 视频打开时停在时长的哪里（和生成深度图取的帧一样，避开开头的黑场） */
const CROP_VIDEO_START_AT = 0.3;
/** 舞台上下留给标题、时间条和按钮的高度 */
const CROP_RESERVED_HEIGHT = 150;
const CROP_RESERVED_HEIGHT_VIDEO = 190;

/**
 * @param {{ api: object }} deps
 * @returns {{ open: (options: {
 *   type: 'image'|'video', url: string, name: string, crop?: object|null,
 * }) => Promise<{x: number, y: number, w: number, h: number}|null> }}
 *   点"取消"时结果是 null；图片或视频打不开时 reject
 */
function initCropDialog({ api }) {
    const { setRange, bindRange } = Controls;
    const C = Shared.crop;
    const { formatDuration } = Shared.myWallpapers;

    const dialog = document.getElementById('crop-dialog');
    const nameEl = document.getElementById('crop-name');
    const stage = document.getElementById('crop-stage');
    const box = document.getElementById('crop-box');
    const timeRow = document.getElementById('crop-time');
    const timeSlider = document.getElementById('crop-time-slider');
    const timeValue = document.getElementById('crop-time-value');
    const ratioEl = document.getElementById('crop-ratio');
    const lowResEl = document.getElementById('crop-lowres');

    /** 这次打开的状态；没打开时为 null */
    let session = null;
    /** 正在读图片或视频：这时候再点一次不开第二个 */
    let opening = false;

    const timeText = (seconds) => formatDuration(seconds) || '0:00';

    function loadImage(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.draggable = false;
            img.onload = () => resolve({ el: img, width: img.naturalWidth, height: img.naturalHeight, duration: 0 });
            img.onerror = () => reject(new Error('图片无法读取'));
            img.src = url;
        });
    }

    function loadVideo(url) {
        return new Promise((resolve, reject) => {
            const video = document.createElement('video');
            video.muted = true;
            video.preload = 'auto';
            video.playsInline = true;
            const fail = (message) => {
                clearTimeout(timer);
                releaseMedia(video);
                reject(new Error(message));
            };
            const timer = setTimeout(() => fail('视频读取超时'), CROP_VIDEO_TIMEOUT_MS);
            video.addEventListener('error', () => fail('视频无法播放'), { once: true });
            video.addEventListener('loadedmetadata', () => {
                if (!video.videoWidth || !video.videoHeight) {
                    fail('无法读取画面尺寸');
                    return;
                }
                video.addEventListener('seeked', () => {
                    clearTimeout(timer);
                    const duration = Number.isFinite(video.duration) ? video.duration : 0;
                    resolve({ el: video, width: video.videoWidth, height: video.videoHeight, duration });
                }, { once: true });
                // 时长未知时也要跳一下，不然等不到 seeked
                video.currentTime = Number.isFinite(video.duration) ? video.duration * CROP_VIDEO_START_AT : 0.1;
            }, { once: true });
            video.src = url;
        });
    }

    /** 放掉视频，不留着占解码器 */
    function releaseMedia(el) {
        el.remove();
        if (el.tagName !== 'VIDEO') return;
        el.pause();
        el.removeAttribute('src');
        el.load();
    }

    /** 按框的位置摆好，顺带更新"可能会模糊"的提示 */
    function paint() {
        const { crop, media, screen } = session;
        box.style.left = crop.x * 100 + '%';
        box.style.top = crop.y * 100 + '%';
        box.style.width = crop.w * 100 + '%';
        box.style.height = crop.h * 100 + '%';
        lowResEl.hidden = !C.isLowRes(crop, media.width, media.height,
            screen.width * screen.scaleFactor, screen.height * screen.scaleFactor);
    }

    /** 舞台按素材比例缩到放得下，窗口变大变小时重算 */
    function fitStage() {
        if (!session) return;
        const { media } = session;
        const aspect = media.width / media.height;
        const style = getComputedStyle(dialog);
        const maxW = dialog.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        const reserved = media.duration ? CROP_RESERVED_HEIGHT_VIDEO : CROP_RESERVED_HEIGHT;
        const maxH = Math.max(120, window.innerHeight - 40 - reserved);
        const width = Math.min(maxW, maxH * aspect);
        stage.style.width = Math.round(width) + 'px';
        stage.style.height = Math.round(width / aspect) + 'px';
    }

    function finish(result) {
        if (!session) return;
        const { media, resolve } = session;
        session = null;
        dialog.close();
        releaseMedia(media.el);
        resolve(result);
    }

    function confirmCrop() {
        if (session) finish(C.normalizeCrop(session.crop));
    }

    // 拖框内部移动，拖四个角缩放。按下时记住起点，松开前都按起点算，不会累积误差
    stage.addEventListener('pointerdown', (e) => {
        if (!session || e.button !== 0 || !box.contains(e.target)) return;
        e.preventDefault();
        const rect = stage.getBoundingClientRect();
        const { corner } = e.target.dataset;
        const start = session.crop;
        const { clientX, clientY } = e;
        stage.setPointerCapture(e.pointerId);

        const onMove = (ev) => {
            if (!session) return;
            const dx = (ev.clientX - clientX) / rect.width;
            const dy = (ev.clientY - clientY) / rect.height;
            session.crop = corner ? C.resizeCrop(start, corner, dx, dy, session.ratio) : C.moveCrop(start, dx, dy);
            paint();
        };
        const onEnd = () => {
            stage.removeEventListener('pointermove', onMove);
            stage.removeEventListener('pointerup', onEnd);
            stage.removeEventListener('pointercancel', onEnd);
        };
        stage.addEventListener('pointermove', onMove);
        stage.addEventListener('pointerup', onEnd);
        stage.addEventListener('pointercancel', onEnd);
    });

    bindRange(timeSlider, timeValue, timeText, (seconds) => {
        if (session) session.media.el.currentTime = seconds;
    });

    document.getElementById('crop-reset').addEventListener('click', () => {
        if (!session) return;
        session.crop = session.defaultCrop;
        paint();
    });
    document.getElementById('crop-cancel').addEventListener('click', () => finish(null));
    document.getElementById('crop-confirm').addEventListener('click', confirmCrop);

    // Esc：系统默认会直接关掉弹框，这里要走自己的收尾
    dialog.addEventListener('cancel', (e) => {
        e.preventDefault();
        finish(null);
    });
    // 焦点在按钮上时回车按按钮自己的，比如"恢复默认"
    dialog.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
            e.preventDefault();
            confirmCrop();
        }
    });
    window.addEventListener('resize', fitStage);

    return {
        async open({ type, url, name, crop }) {
            if (opening || session) return null;
            opening = true;
            let media;
            let screen;
            try {
                [media, screen] = await Promise.all([
                    type === 'video' ? loadVideo(url) : loadImage(url),
                    api.getScreenInfo(),
                ]);
            } finally {
                opening = false;
            }

            const ratio = C.ratioInImage(media.width, media.height, screen.width, screen.height);
            const saved = C.normalizeCrop(crop);
            const defaultCrop = C.defaultCrop(media.width, media.height, screen.width, screen.height);

            stage.prepend(media.el);
            nameEl.textContent = name;
            ratioEl.textContent = `比例已按屏幕锁定 ${C.ratioLabel(screen.width, screen.height)}`;
            timeRow.hidden = !media.duration;
            if (media.duration) {
                timeSlider.max = media.duration;
                setRange(timeSlider, media.el.currentTime);
                timeValue.textContent = timeText(media.el.currentTime);
            }

            return new Promise((resolve) => {
                session = {
                    media,
                    screen,
                    ratio,
                    resolve,
                    defaultCrop,
                    // 换过显示器时，存的区域比例和屏幕不一样，在原来的范围内收成新比例
                    crop: saved ? C.fitCropToRatio(saved, ratio) : defaultCrop,
                };
                dialog.showModal();
                fitStage();
                paint();
            });
        },
    };
}
