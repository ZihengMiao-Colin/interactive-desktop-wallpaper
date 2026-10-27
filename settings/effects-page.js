/**
 * effects-page.js — 设置窗口"特效"页：天气粒子 + 全屏视频特效
 */

'use strict';

const WEATHER_NAMES = { none: '无', rain: '细雨', snow: '落雪', sakura: '落樱', leaves: '枫叶', sunlight: '光斑' };
const BLEND_NAMES = { auto: '自动', screen: '滤色', chroma: '绿幕' };

/**
 * @param {{ api: object, saver: { save: (partial: object) => void }, setStatus: (msg: string, cls?: string) => void }} deps
 * @returns {{ load: (config: object) => Promise<void> }}
 */
function initEffectsPage({ api, saver, setStatus }) {
    const { el, setRange, bindRange, segmented } = Controls;
    const speedText = (v) => (v / 10).toFixed(1) + '×';

    // ==================== 天气 ====================
    const weatherButtons = [...document.querySelectorAll('#weather-grid .wt')];
    const weatherSpeed = document.getElementById('weather-speed');
    const weatherSpeedVal = document.getElementById('weather-speed-val');
    const weatherParallax = document.getElementById('weather-parallax-toggle');

    function showWeather(type) {
        for (const b of weatherButtons) {
            const on = b.dataset.weather === type;
            b.classList.toggle('on', on);
            b.setAttribute('aria-pressed', String(on));
        }
    }

    for (const b of weatherButtons) {
        b.addEventListener('click', () => {
            const type = b.dataset.weather;
            showWeather(type);
            saver.save({ weather: { type } });
            setStatus(type === 'none' ? '已关闭天气特效' : `已切换天气：${WEATHER_NAMES[type] || type}`, 'success');
        });
    }
    const density = segmented(document.getElementById('weather-density'), (value) => saver.save({ weather: { density: value } }));
    bindRange(weatherSpeed, weatherSpeedVal, speedText, (v) => saver.save({ weather: { speed: v / 10 } }));
    weatherParallax.addEventListener('change', () => saver.save({ weather: { parallax: weatherParallax.checked } }));

    // ==================== 视频特效 ====================
    const enabled = document.getElementById('video-overlay-enabled');
    const area = document.getElementById('video-area');
    const presetsGrid = document.getElementById('video-presets-grid');
    const customName = document.getElementById('video-custom-name');
    const btnImportVideo = document.getElementById('btn-import-video');
    const btnUseCustom = document.getElementById('btn-select-custom-preset');
    const opacity = document.getElementById('video-opacity');
    const opacityVal = document.getElementById('video-opacity-val');
    const speed = document.getElementById('video-speed');
    const speedVal = document.getElementById('video-speed-val');

    let presets = [];
    let currentPresetId = 'snow2';
    let customVideoPath = '';
    let customVideoName = '';

    function showEnabled(on) {
        enabled.checked = on;
        area.classList.toggle('off', !on);
    }

    function renderPresets() {
        presetsGrid.replaceChildren(...presets.map((preset) => {
            const card = el('button', 'preset' + (preset.id === currentPresetId ? ' on' : ''));
            card.type = 'button';
            card.title = preset.desc;
            const th = el('span', 'th');
            th.style.backgroundImage = `url("${api.toFileUrl(preset.thumb)}")`;
            th.appendChild(el('span', 'chip', preset.mode === 'chroma' ? '绿幕' : '滤色'));
            card.append(th, el('b', '', preset.title), el('small', '', preset.desc));
            card.addEventListener('click', () => {
                currentPresetId = preset.id;
                renderSelection();
                showEnabled(true);
                saver.save({ videoOverlay: { enabled: true, presetId: preset.id } });
                setStatus(`已切换视频特效：${preset.title}`, 'success');
            });
            return card;
        }));
    }

    /** 预设卡片和"自己的视频"那一行的选中状态 */
    function renderSelection() {
        const cards = presetsGrid.querySelectorAll('.preset');
        presets.forEach((p, i) => cards[i] && cards[i].classList.toggle('on', p.id === currentPresetId));
        const usingCustom = currentPresetId === 'custom';
        btnUseCustom.hidden = !customVideoPath;
        btnUseCustom.disabled = usingCustom;
        btnUseCustom.textContent = usingCustom ? '使用中' : '使用这个视频';
        customName.textContent = customVideoPath ? customVideoName : '还没有导入，支持 MP4 / WebM';
    }

    enabled.addEventListener('change', () => {
        showEnabled(enabled.checked);
        saver.save({ videoOverlay: { enabled: enabled.checked } });
        setStatus(enabled.checked ? '已开启视频特效' : '已关闭视频特效');
    });

    function useCustom() {
        currentPresetId = 'custom';
        renderSelection();
        showEnabled(true);
        saver.save({
            videoOverlay: { enabled: true, presetId: 'custom', customPath: customVideoPath, customName: customVideoName },
        });
    }

    btnImportVideo.addEventListener('click', async () => {
        try {
            const res = await api.selectOverlayVideo();
            if (!res || !res.path) return;
            customVideoPath = res.path;
            customVideoName = res.name;
            useCustom();
            setStatus(`已导入并使用视频：${res.name}`, 'success');
        } catch (err) {
            setStatus('导入视频失败：' + err.message, 'error');
        }
    });

    btnUseCustom.addEventListener('click', () => {
        if (!customVideoPath) return;
        useCustom();
        setStatus(`已切换为自己的视频：${customVideoName}`, 'success');
    });

    const blend = segmented(document.getElementById('video-blend-mode'), (value) => {
        saver.save({ videoOverlay: { blendMode: value } });
        setStatus(`混合方式：${BLEND_NAMES[value]}`, 'success');
    });
    bindRange(opacity, opacityVal, (v) => v + '%', (v) => saver.save({ videoOverlay: { opacity: v / 100 } }));
    bindRange(speed, speedVal, speedText, (v) => saver.save({ videoOverlay: { speed: v / 10 } }));

    return {
        async load(config) {
            const weather = config.weather || {};
            showWeather(weather.type || 'none');
            if (weather.density) density.set(weather.density);
            const ws = Math.round((weather.speed !== undefined ? weather.speed : 1) * 10);
            setRange(weatherSpeed, ws);
            weatherSpeedVal.textContent = speedText(ws);
            weatherParallax.checked = weather.parallax !== false;

            const video = config.videoOverlay || {};
            showEnabled(!!video.enabled);
            if (video.presetId) currentPresetId = video.presetId;
            if (video.customPath) {
                customVideoPath = video.customPath;
                customVideoName = video.customName || video.customPath.split('\\').pop();
            }
            if (video.blendMode) blend.set(video.blendMode);
            if (video.opacity !== undefined) {
                const op = Math.round(video.opacity * 100);
                setRange(opacity, op);
                opacityVal.textContent = op + '%';
            }
            if (video.speed !== undefined) {
                const vs = Math.round(video.speed * 10);
                setRange(speed, vs);
                speedVal.textContent = speedText(vs);
            }

            try {
                presets = await api.getOverlayPresets();
            } catch (err) {
                console.error('加载视频特效预设失败:', err);
                presets = [];
            }
            renderPresets();
            renderSelection();
        },
    };
}
