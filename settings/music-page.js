/**
 * music-page.js — 设置窗口"唱片机"页：开关、导入音乐、播放 / 暂停、音量、位置、大小、封面
 */

'use strict';

/**
 * @param {{ api: object, saver: { save: (partial: object) => void }, setStatus: (msg: string, cls?: string) => void }} deps
 * @returns {{ load: (config: object) => void }}
 */
function initMusicPage({ api, saver, setStatus }) {
    const { setRange, bindRange, segmented } = Controls;
    const enabled = document.getElementById('vinyl-enabled');
    const musicName = document.getElementById('vinyl-current-music-name');
    const playState = document.getElementById('vinyl-play-state');
    const disc = document.querySelector('#page-music .disc');
    const discCover = document.getElementById('vinyl-disc-cover');
    const btnImportAudio = document.getElementById('btn-import-audio');
    const btnPlayPause = document.getElementById('btn-play-pause-toggle');
    const playIcon = btnPlayPause.querySelector('use');
    const volume = document.getElementById('vinyl-volume');
    const volumeVal = document.getElementById('vinyl-volume-val');
    const scale = document.getElementById('vinyl-scale');
    const scaleVal = document.getElementById('vinyl-scale-val');
    const coverThumb = document.getElementById('vinyl-cover-thumb');

    let isPlaying = false;
    let hasAudio = false;
    let coverPath = '';

    /** 曲名、播放状态、唱片转不转、按钮图标 */
    function renderPlayer(name) {
        if (name !== undefined) musicName.textContent = name || '还没有导入音乐';
        playState.textContent = !hasAudio ? '导入一首本地音乐就会开始播放' : (isPlaying ? '正在播放' : '已暂停');
        disc.classList.toggle('spinning', hasAudio && isPlaying);
        playIcon.setAttribute('href', isPlaying ? '#i-pause' : '#i-play');
        btnPlayPause.title = isPlaying ? '暂停' : '播放';
        btnPlayPause.setAttribute('aria-label', btnPlayPause.title);
    }

    function renderCover() {
        const url = coverPath && api.fileExists(coverPath) ? `url("${api.toFileUrl(coverPath)}")` : '';
        coverThumb.style.backgroundImage = url;
        discCover.style.backgroundImage = url;
    }

    enabled.addEventListener('change', () => {
        saver.save({ vinyl: { enabled: enabled.checked } });
        setStatus(enabled.checked ? '已显示唱片机' : '已隐藏唱片机');
    });

    btnImportAudio.addEventListener('click', async () => {
        try {
            const res = await api.selectAudio();
            if (!res || !res.path) return;
            isPlaying = true;
            hasAudio = true;
            enabled.checked = true;
            renderPlayer(res.name);
            saver.save({ vinyl: { enabled: true, audioPath: res.path, audioName: res.name, playing: true } });
            setStatus(`已导入 ${res.name}，开始播放`, 'success');
        } catch (err) {
            setStatus('导入音乐失败：' + err.message, 'error');
        }
    });

    btnPlayPause.addEventListener('click', () => {
        isPlaying = !isPlaying;
        renderPlayer();
        saver.save({ vinyl: { playing: isPlaying } });
        setStatus(isPlaying ? '开始播放' : '已暂停');
    });

    // 在桌面上点唱片机也会改播放状态：跟着配置广播更新播放按钮（其他控件不动，免得和正在拖的滑块打架）
    api.onLoadConfig((config) => {
        const playing = !!(config && config.vinyl && config.vinyl.playing);
        if (playing === isPlaying) return;
        isPlaying = playing;
        renderPlayer();
    });

    bindRange(volume, volumeVal, (v) => v + '%', (v) => saver.save({ vinyl: { volume: v / 100 } }));
    bindRange(scale, scaleVal, (v) => v + '%', (v) => saver.save({ vinyl: { scale: v / 100 } }));
    const position = segmented(document.getElementById('vinyl-position'), (value) => saver.save({ vinyl: { position: value } }));

    document.getElementById('btn-import-cover').addEventListener('click', async () => {
        try {
            const path = await api.selectCover();
            if (!path) return;
            coverPath = path;
            renderCover();
            saver.save({ vinyl: { coverPath: path } });
            setStatus('已更换唱片封面', 'success');
        } catch (err) {
            setStatus('更换封面失败：' + err.message, 'error');
        }
    });

    document.getElementById('btn-reset-cover').addEventListener('click', () => {
        coverPath = '';
        renderCover();
        saver.save({ vinyl: { coverPath: '' } });
        setStatus('封面已换回默认');
    });

    return {
        load(config) {
            const vinyl = config.vinyl || {};
            enabled.checked = !!vinyl.enabled;
            isPlaying = !!vinyl.playing;
            hasAudio = !!vinyl.audioPath;
            renderPlayer(vinyl.audioName || (vinyl.audioPath ? vinyl.audioPath.split('\\').pop() : ''));

            const vol = Math.round((vinyl.volume !== undefined ? vinyl.volume : 0.6) * 100);
            setRange(volume, vol);
            volumeVal.textContent = vol + '%';
            const sc = Math.round((vinyl.scale !== undefined ? vinyl.scale : 1) * 100);
            setRange(scale, sc);
            scaleVal.textContent = sc + '%';
            position.set(vinyl.position || 'bottom-right');

            coverPath = vinyl.coverPath || '';
            renderCover();
        },
    };
}
