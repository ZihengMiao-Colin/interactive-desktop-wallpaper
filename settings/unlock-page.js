/**
 * unlock-page.js — 设置窗口"解锁动画"页：选视频（先弹裁剪框）、重新裁剪、开关、淡入淡出时长、声音、预览
 */

'use strict';

/**
 * @param {{ api: object, saver: { save: (partial: object) => void, flush: () => void }, setStatus: (msg: string, cls?: string) => void, onPageChange: (cb: (name: string) => void) => void, cropDialog: ReturnType<typeof initCropDialog> }} deps
 * @returns {{ load: (config: object) => void }}
 */
function initUnlockPage({ api, saver, setStatus, onPageChange, cropDialog }) {
    const { setRange, bindRange } = Controls;
    const { formatDuration } = Shared.myWallpapers;
    const unlock = api.unlockAnimation;

    const enabled = document.getElementById('unlock-enabled');
    const thumb = document.getElementById('unlock-thumb');
    const videoName = document.getElementById('unlock-video-name');
    const videoDuration = document.getElementById('unlock-video-duration');
    const selectBtn = document.getElementById('btn-unlock-select');
    const cropBtn = document.getElementById('btn-unlock-crop');
    const removeBtn = document.getElementById('btn-unlock-remove');
    const fadeIn = document.getElementById('unlock-fade-in');
    const fadeInValue = document.getElementById('unlock-fade-in-value');
    const fadeOut = document.getElementById('unlock-fade-out');
    const fadeOutValue = document.getElementById('unlock-fade-out-value');
    const sound = document.getElementById('unlock-sound');
    const previewBtn = document.getElementById('btn-unlock-preview');
    const note = document.getElementById('unlock-note');

    let hasVideo = false;
    /** 现在的裁剪和原文件名：重新裁剪时框从这里开始 */
    let currentCrop = null;
    let currentName = '';

    /** 滑块的单位是秒，配置里存毫秒 */
    const fadeText = (seconds) => seconds.toFixed(1) + ' 秒';

    function bindFade(input, valueEl, key) {
        bindRange(input, valueEl, fadeText, (v) => saver.save({ unlockAnimation: { [key]: Math.round(v * 1000) } }));
    }

    function setFade(input, valueEl, ms) {
        setRange(input, ms / 1000);
        valueEl.textContent = fadeText(ms / 1000);
    }

    /** 缩略图和提示：文件可能在外面被删，开机自启可能在别的页面改过，切到这一页时要重新看 */
    async function refreshInfo() {
        try {
            const [info, autoLaunch] = await Promise.all([unlock.getInfo(), api.getAutoLaunch()]);
            thumb.hidden = !info.thumbUrl;
            if (info.thumbUrl) thumb.src = info.thumbUrl;
            previewBtn.disabled = !info.exists;
            cropBtn.disabled = !info.exists;

            let text = '';
            if (hasVideo && !info.exists) text = '视频文件找不到了，请重新选择';
            else if (!autoLaunch) text = '程序要在运行才能播放，建议在「设置」里打开开机自动启动';
            note.textContent = text;
            note.hidden = !text;
        } catch (err) {
            console.error('读取解锁动画信息失败:', err);
        }
    }

    function render(config) {
        hasVideo = !!config.file;
        currentCrop = config.crop;
        currentName = config.name;
        enabled.checked = config.enabled;
        enabled.disabled = !hasVideo;
        removeBtn.disabled = !hasVideo;
        previewBtn.disabled = !hasVideo;
        cropBtn.disabled = !hasVideo;
        videoName.textContent = config.name || '还没有选择视频';
        videoDuration.textContent = hasVideo ? formatDuration(config.duration) : '选一段视频，解锁后全屏播放';
        setFade(fadeIn, fadeInValue, config.fadeInMs);
        setFade(fadeOut, fadeOutValue, config.fadeOutMs);
        sound.checked = config.sound;
        refreshInfo();
    }

    bindFade(fadeIn, fadeInValue, 'fadeInMs');
    bindFade(fadeOut, fadeOutValue, 'fadeOutMs');
    enabled.addEventListener('change', () => saver.save({ unlockAnimation: { enabled: enabled.checked } }));
    sound.addEventListener('change', () => saver.save({ unlockAnimation: { sound: sound.checked } }));

    selectBtn.addEventListener('click', async () => {
        const picked = await unlock.selectVideo();
        if (picked.canceled) return;

        // 裁剪框打开时顺带确认 Chromium 能解，解不了的视频解锁时也放不出来
        let crop;
        try {
            crop = await cropDialog.open({ type: 'video', url: picked.url, name: picked.name });
        } catch (err) {
            setStatus('这个视频打不开，换一个试试', 'error');
            return;
        }
        if (!crop) return;

        selectBtn.disabled = true;
        setStatus('正在导入视频…');
        try {
            const info = await makeThumbnailInfo(picked.url, 'video', crop);
            const res = await unlock.setVideo({ path: picked.path, thumbDataUrl: info.dataUrl, duration: info.duration, crop });
            if (res.error) {
                setStatus(res.error, 'error');
                return;
            }
            render(res.config.unlockAnimation);
            setStatus('解锁动画设置好了，下次解锁时播放', 'success');
        } catch (err) {
            setStatus('导入视频失败：' + err.message, 'error');
        } finally {
            selectBtn.disabled = false;
        }
    });

    cropBtn.addEventListener('click', async () => {
        try {
            const { videoUrl } = await unlock.getInfo();
            if (!videoUrl) {
                setStatus('视频文件找不到了，请重新选择', 'error');
                return;
            }
            const crop = await cropDialog.open({ type: 'video', url: videoUrl, name: currentName, crop: currentCrop });
            if (!crop) return;
            const info = await makeThumbnailInfo(videoUrl, 'video', crop);
            const res = await unlock.setCrop({ crop, thumbDataUrl: info.dataUrl });
            if (res.error) {
                setStatus(res.error, 'error');
                return;
            }
            render(res.config.unlockAnimation);
            setStatus('裁剪好了，下次解锁时按新的画面播放', 'success');
        } catch (err) {
            console.error('裁剪解锁视频失败:', err);
            setStatus('裁剪失败：' + err.message, 'error');
        }
    });

    removeBtn.addEventListener('click', async () => {
        const { config } = await unlock.remove();
        render(config.unlockAnimation);
        setStatus('已移除解锁动画的视频');
    });

    previewBtn.addEventListener('click', async () => {
        saver.flush();
        if (!(await unlock.preview())) setStatus('现在不能预览，稍后再试', 'error');
    });

    onPageChange((page) => {
        if (page === 'unlock') refreshInfo();
    });

    return {
        load(config) {
            render(config.unlockAnimation);
        },
    };
}
