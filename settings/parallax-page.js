/**
 * parallax-page.js — 设置窗口"视差"页：视差强度、跟手程度、对焦深度
 *
 * 页面上方是和壁纸页同一个实时预览，拖滑块时预览立刻跟着变。
 */

'use strict';

/** "恢复推荐值"：边缘平滑也一起恢复 */
const RECOMMENDED_PARALLAX = {
    parallaxMultiplier: 10,
    smoothness: 0.08,
    focusDepth: 0.50,
    blurRadius: 5,
};

/** 当前壁纸是视频时，视差设置哪些起作用 */
const PARALLAX_VIDEO_NOTE = {
    none: '当前视频壁纸设为不动，这些设置不起作用',
    pan: '当前视频壁纸是整体平移：视差强度和跟手程度起作用，对焦深度不起作用',
};

/**
 * @param {{
 *   api: object,
 *   saver: { save: (partial: object) => void },
 *   setStatus: (msg: string, cls?: string) => void,
 *   preview: ReturnType<typeof initDepthPreview>,
 *   wallpaperPage: { setBlur: (value: number) => void },
 * }} deps
 * @returns {{ load: (config: object) => void }}
 */
function initParallaxPage({ api, saver, setStatus, preview, wallpaperPage }) {
    const { setRange, bindRange } = Controls;
    const videoNote = document.getElementById('parallax-video-note');

    /** 当前壁纸是"不动"或"整体平移"的视频时，提示哪些设置不起作用 */
    function showVideoNote(config) {
        const current = Shared.myWallpapers.resolveCurrent(config);
        const text = current && current.type === 'video' ? PARALLAX_VIDEO_NOTE[current.effect] : '';
        videoNote.textContent = text || '';
        videoNote.hidden = !text;
    }
    api.onLoadConfig((config) => { if (config) showVideoNote(config); });
    const strength = document.getElementById('parallax-strength');
    const strengthValue = document.getElementById('parallax-value');
    const smoothness = document.getElementById('smoothness');
    const smoothnessValue = document.getElementById('smoothness-value');
    const focus = document.getElementById('focus-depth');
    const focusValue = document.getElementById('focus-value');

    // 滑块刻度：跟手程度和对焦深度在滑块上是 ×100 的整数
    function show({ parallaxMultiplier, smoothness: s, focusDepth }) {
        if (parallaxMultiplier !== undefined) {
            setRange(strength, parallaxMultiplier);
            strengthValue.textContent = parallaxMultiplier;
        }
        if (s !== undefined) {
            setRange(smoothness, Math.round(s * 100));
            smoothnessValue.textContent = s.toFixed(2);
        }
        if (focusDepth !== undefined) {
            setRange(focus, Math.round(focusDepth * 100));
            focusValue.textContent = Number(focusDepth).toFixed(2);
        }
    }

    function change(partial) {
        saver.save(partial);
        preview.setParams(partial);
    }

    bindRange(strength, strengthValue, (v) => v, (v) => change({ parallaxMultiplier: v }));
    bindRange(smoothness, smoothnessValue, (v) => (v / 100).toFixed(2), (v) => change({ smoothness: v / 100 }));
    bindRange(focus, focusValue, (v) => (v / 100).toFixed(2), (v) => change({ focusDepth: v / 100 }));

    document.getElementById('btn-reset-default').addEventListener('click', () => {
        show(RECOMMENDED_PARALLAX);
        wallpaperPage.setBlur(RECOMMENDED_PARALLAX.blurRadius);
        change(RECOMMENDED_PARALLAX);
        setStatus('已恢复推荐值：强度 10，跟手程度 0.08，对焦深度 0.50，边缘平滑 5px', 'success');
    });

    return {
        load(config) {
            show(config);
            showVideoNote(config);
            preview.setParams({
                parallaxMultiplier: config.parallaxMultiplier ?? RECOMMENDED_PARALLAX.parallaxMultiplier,
                smoothness: config.smoothness ?? RECOMMENDED_PARALLAX.smoothness,
                focusDepth: config.focusDepth ?? RECOMMENDED_PARALLAX.focusDepth,
            });
        },
    };
}
