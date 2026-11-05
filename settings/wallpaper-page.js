/**
 * wallpaper-page.js — 设置窗口"壁纸"页：选图片或视频、生成深度图、应用壁纸
 *
 * 选中（图库或自己的图片 / 视频）只是预览，要点"应用壁纸"才会换到桌面上。
 * 默认壁纸自带深度图；自己的图片先找缓存，没有就要"生成深度图"。
 * 视频有三种效果（不动 / 3D 视差 / 整体平移）和声音开关，改了立刻存进「我的壁纸」里这个视频的记录，
 * 同样要点"应用壁纸"才影响桌面；3D 视差和图片一样要先有深度图。
 * 导入时先弹裁剪框（点取消等于没导入），之后可以在「我的壁纸」里重新裁。
 * 裁剪是例外：改的是桌面上正在用的壁纸时马上更新，不用再点"应用壁纸"，否则用户看到水印还在，会以为没成功。
 * 托盘"更换壁纸"选的图片没有深度图时，主进程会把它转到这里：生成完直接应用。
 */

'use strict';

/** 选的视频读不出来时的提示 */
const VIDEO_UNSUPPORTED_MSG = '这个视频格式不支持，换成 MP4 或 WebM 试试';
/** 选的图片读不出来时的提示 */
const IMAGE_UNREADABLE_MSG = '这张图片读不出来';

/**
 * @param {{
 *   api: object,
 *   saver: { save: (partial: object) => void },
 *   setStatus: (msg: string, cls?: string) => void,
 *   setNowUsing: (info: { name: string, thumbUrl: string } | null) => void,
 *   preview: ReturnType<typeof initDepthPreview>,
 *   cropDialog: ReturnType<typeof initCropDialog>,
 * }} deps
 * @returns {{ load: (config: object) => Promise<void>, setBlur: (value: number) => void, markDepthStale: () => void }}
 */
function initWallpaperPage({ api, saver, setStatus, setNowUsing, preview, cropDialog }) {
    const { el, setRange, bindRange, segmented } = Controls;
    const MW = Shared.myWallpapers;
    const depthBar = document.querySelector('.depth-bar');
    const depthState = document.getElementById('depth-state');
    const blurSlider = document.getElementById('depth-blur');
    const blurValue = document.getElementById('blur-value');
    const btnGenerate = document.getElementById('btn-generate-depth');
    const btnApply = document.getElementById('btn-apply-wallpaper');
    const videoCtrl = document.getElementById('video-ctrl');
    const soundToggle = document.getElementById('video-sound');

    /** 选中的图片或视频的路径 */
    let selectedPath = null;
    /** 选中的是视频时，它在「我的壁纸」里的记录（效果、声音） */
    let selectedVideo = null;
    /** 桌面上正在用的壁纸 { type, path, ... }（Shared.myWallpapers.resolveCurrent） */
    let current = null;
    /** 最近一次的配置（正在使用卡片要找视频的缩略图） */
    let latestConfig = {};
    let depthGenerated = false;
    let isGenerating = false;

    const fileName = (p) => p.split(/[\\/]/).pop();
    const blurText = (v) => (v === 0 ? '关闭' : v + 'px');
    const currentPath = () => (current ? current.path : '');

    // ---------- 深度图状态（操作栏左侧） ----------

    function chip(cls, iconName, text) {
        const node = el('span', 'chip ' + cls);
        node.append(Icons.svg(iconName), text);
        return node;
    }

    /** @param {'none'|'ready'|'missing'|'stale'|'failed'} kind */
    function showDepthState(kind) {
        if (kind === 'ready') depthState.replaceChildren(chip('ok', 'check', '深度图已就绪'));
        else if (kind === 'missing') depthState.replaceChildren(chip('warn', 'info', '还没有深度图'));
        else if (kind === 'stale') depthState.replaceChildren(chip('warn', 'info', '平滑改了，需要重新生成'));
        else if (kind === 'failed') depthState.replaceChildren(chip('error', 'circle-alert', '生成失败'));
        else depthState.replaceChildren(el('span', 'chip', '先在下面选一张壁纸'));
    }

    let progressBar = null;
    let progressText = null;
    function showProgress(text) {
        if (!progressBar) {
            const bar = el('span', 'progress indeterminate');
            progressBar = el('i');
            bar.appendChild(progressBar);
            progressText = el('span', 'progress-text');
            depthState.replaceChildren(bar, progressText);
        }
        progressText.textContent = text;
    }
    function setProgress(percent) {
        if (!progressBar) return;
        progressBar.parentElement.classList.remove('indeterminate');
        progressBar.style.width = percent + '%';
    }
    function endProgress() {
        progressBar = null;
        progressText = null;
    }

    // ---------- 正在使用 ----------

    function refreshNowUsing() {
        preview.setUsing(!!selectedPath && samePath(selectedPath, currentPath()));
        if (!current || !api.fileExists(current.path)) {
            setNowUsing(null);
            return;
        }
        const entry = gallery.find(current.path);
        if (entry) {
            setNowUsing({ name: entry.name, thumbUrl: api.toFileUrl(entry.thumb) });
            return;
        }
        // 自己的图片 / 视频：有缩略图用缩略图，图片没有就用原图
        const mine = MW.findEntry(latestConfig.myWallpapers, current.path);
        const thumb = mine && mine.thumb && api.fileExists(mine.thumb) ? mine.thumb : (current.type === 'image' ? current.path : '');
        setNowUsing({ name: fileName(current.path), thumbUrl: thumb ? api.toFileUrl(thumb) : '' });
    }

    // ---------- 视频的效果和声音 ----------

    const motionSeg = segmented(document.getElementById('video-motion'), (effect) => {
        if (!selectedVideo) return;
        selectedVideo.effect = effect;
        api.myWallpapers.update(selectedVideo.path, { effect });
        refreshVideoMotion({ quiet: false });
    });

    soundToggle.addEventListener('change', () => {
        if (!selectedVideo) return;
        selectedVideo.sound = soundToggle.checked;
        api.myWallpapers.update(selectedVideo.path, { sound: selectedVideo.sound });
    });

    /** 切换图片 / 视频时操作栏的样子：视频显示效果和声音；不动、整体平移时收起深度图那一套 */
    function showVideoControls(video) {
        videoCtrl.hidden = !video;
        depthBar.classList.toggle('no-depth', !!video && video.effect !== 'depth');
        depthBar.classList.toggle('video-depth', !!video && video.effect === 'depth');
        if (!video) return;
        motionSeg.set(video.effect);
        soundToggle.checked = video.sound;
    }

    /**
     * 按选中视频的效果更新预览、深度图状态和"应用壁纸"按钮。
     * 不动、整体平移不需要深度图，直接能应用；3D 视差要先有深度图。
     */
    async function refreshVideoMotion({ quiet = true } = {}) {
        const video = selectedVideo;
        if (!video) return;
        showVideoControls(video);
        preview.setMotion(video.effect);
        if (video.effect !== 'depth') {
            depthGenerated = false;
            btnGenerate.disabled = true;
            btnApply.disabled = false;
            return;
        }
        btnGenerate.disabled = isGenerating;
        btnApply.disabled = true;
        showDepthState('none');
        const depth = await api.getDepthCache(video.path);
        // 等深度图期间换了别的视频或效果，这次的结果就不用了
        if (selectedVideo !== video || video.effect !== 'depth') return;
        preview.setDepth(depth);
        depthGenerated = !!depth;
        btnApply.disabled = !depth;
        showDepthState(depth ? 'ready' : 'missing');
        if (!quiet && !depth) setStatus('3D 视差要先点"生成深度图"');
    }

    // ---------- 选择壁纸 ----------

    /**
     * 选中一张图片：显示预览并检查深度图（只选中，不应用到桌面）。
     * 默认壁纸自带深度图，"生成深度图"按钮保持灰色。
     * @param {string} imagePath
     * @param {{quiet?: boolean, crop?: object}} [options] - quiet 为 true 时不弹提示（打开设置窗口时恢复当前壁纸用）；
     *   crop 不传时按「我的壁纸」里记的
     * @returns {Promise<boolean>} 是否已有可用的深度图
     */
    async function selectImagePath(imagePath, { quiet = false, crop } = {}) {
        const galleryEntry = gallery.find(imagePath);
        selectedPath = imagePath;
        selectedVideo = null;
        showVideoControls(null);
        depthGenerated = false;
        btnGenerate.disabled = !!galleryEntry;
        btnApply.disabled = true;
        markSelected(imagePath);

        const name = galleryEntry ? galleryEntry.name : fileName(imagePath);
        const dataUrl = api.readFileAsDataURL(imagePath);
        const entry = MW.findEntry(latestConfig.myWallpapers, imagePath);
        if (dataUrl) {
            preview.showImage(dataUrl, {
                name,
                tag: galleryEntry ? '默认壁纸' : '你的图片',
                crop: crop || (entry && entry.crop),
            });
        }
        refreshNowUsing();
        showDepthState('none');

        const depth = await api.getDepthCache(imagePath);
        // 等深度图期间又选了别的图片，这次的结果就不用了
        if (selectedPath !== imagePath) return !!depth;
        preview.setDepth(depth);
        if (depth) {
            depthGenerated = true;
            btnApply.disabled = false;
            showDepthState('ready');
            if (!quiet) {
                setStatus(galleryEntry
                    ? '默认壁纸已经带好深度图，点"应用壁纸"就能用'
                    : '找到了这张图的深度图，点"应用壁纸"就能用', 'success');
            }
        } else {
            showDepthState('missing');
            if (!quiet) setStatus(`已选择 ${name}，先点"生成深度图"`);
        }
        return !!depth;
    }

    /**
     * 选中一个视频（「我的壁纸」里的记录）：预览开始播放，操作栏换成效果和声音。
     * @param {{path: string, effect: string, sound: boolean, crop?: object}} entry
     * @param {{quiet?: boolean}} [options]
     * @returns {Promise<boolean>} 视频能不能放
     */
    async function selectVideo(entry, { quiet = false } = {}) {
        const video = { path: entry.path, effect: entry.effect || 'none', sound: entry.sound === true };
        selectedPath = video.path;
        selectedVideo = video;
        depthGenerated = false;
        btnApply.disabled = true;
        markSelected(video.path);
        showVideoControls(video);
        showDepthState('none');
        refreshNowUsing();
        try {
            await preview.showVideo(api.toFileUrl(video.path), { name: fileName(video.path), tag: '你的视频', crop: entry.crop });
        } catch (err) {
            console.error('预览视频失败:', err);
            if (selectedVideo === video) setStatus(VIDEO_UNSUPPORTED_MSG, 'error');
            return false;
        }
        if (selectedVideo !== video) return false;
        await refreshVideoMotion();
        if (!quiet && selectedVideo === video) setStatus(`已选择 ${fileName(video.path)}，点"应用壁纸"换上`);
        return true;
    }

    /** 选中「我的壁纸」里的一条（图片或视频） */
    function selectEntry(entry, options) {
        return entry.type === 'video' ? selectVideo(entry, options) : selectImagePath(entry.path, { ...options, crop: entry.crop });
    }

    /** 改的是桌面上正在用的壁纸时马上更新（视频会从头放）。返回有没有更新 */
    async function refreshDesktop(filePath) {
        if (!current || !samePath(current.path, filePath)) return false;
        await api.applyWallpaper(current);
        return true;
    }

    /**
     * "从电脑选择…"：选一张图片或一个视频，弹裁剪框（顺便确认能读），
     * 点确定就放进「我的壁纸」并选中；点取消等于没选；读不了只报错，不加进列表。
     */
    async function pickFromComputer() {
        try {
            const picked = await api.selectWallpaperFile();
            if (!picked) return;
            const url = api.toFileUrl(picked.path);
            const existing = MW.findEntry(latestConfig.myWallpapers, picked.path);
            let crop;
            try {
                crop = await cropDialog.open({
                    type: picked.type, url, name: fileName(picked.path), crop: existing && existing.crop,
                });
            } catch (err) {
                console.error('读取所选文件失败:', err);
                setStatus(picked.type === 'video' ? VIDEO_UNSUPPORTED_MSG : IMAGE_UNREADABLE_MSG, 'error');
                return;
            }
            if (!crop) return;
            const info = await makeThumbnailInfo(url, picked.type, crop);
            const entry = await api.myWallpapers.add({
                path: picked.path, type: picked.type, thumbDataUrl: info.dataUrl, duration: info.duration, crop,
            });
            await selectEntry(entry);
            await refreshDesktop(entry.path);
        } catch (err) {
            console.error('选择壁纸失败:', err);
            setStatus('选择壁纸失败：' + err.message, 'error');
        }
    }

    /** 「我的壁纸」格子上的裁剪按钮：重新裁一个已经导入的壁纸 */
    async function recropEntry(entry) {
        try {
            const url = api.toFileUrl(entry.path);
            const crop = await cropDialog.open({ type: entry.type, url, name: fileName(entry.path), crop: entry.crop });
            if (!crop) return;
            const info = await makeThumbnailInfo(url, entry.type, crop);
            await api.myWallpapers.setCrop(entry.path, crop, info.dataUrl);
            if (samePath(entry.path, selectedPath)) preview.setCrop(crop);
            const updated = await refreshDesktop(entry.path);
            setStatus(updated ? '裁剪好了，桌面上的壁纸已更新' : '裁剪好了', 'success');
        } catch (err) {
            console.error('裁剪失败:', err);
            setStatus('裁剪失败：' + err.message, 'error');
        }
    }

    const gallery = initGalleryPanel({
        api,
        onSelect: (entry) => selectImagePath(entry.file),
    });
    const mine = initMyWallpapersPanel({
        api,
        setStatus,
        onSelect: (entry) => selectEntry(entry),
        onPick: () => pickFromComputer(),
        onCrop: (entry) => recropEntry(entry),
    });

    /** 选中标记：默认壁纸和我的壁纸里同一时间只有一个选中 */
    function markSelected(filePath) {
        gallery.setSelected(filePath);
        mine.setSelected(filePath);
    }

    /** 生成深度图期间两边的格子都不能点（换了图，结果会记到别的图上） */
    function setPanelsBusy(value) {
        gallery.setBusy(value);
        mine.setBusy(value);
    }

    // ---------- 边缘平滑 ----------

    bindRange(blurSlider, blurValue, blurText, (v) => {
        saver.save({ blurRadius: v });
        const needsOwnDepth = selectedVideo ? selectedVideo.effect === 'depth' : (selectedPath && !gallery.find(selectedPath));
        if (needsOwnDepth && !isGenerating) {
            depthGenerated = false;
            btnApply.disabled = true;
            showDepthState('stale');
        }
    });

    // ---------- 生成深度图 ----------

    /**
     * 为当前选中的图片（或 3D 视差的视频，取其中一帧）生成深度图。
     * @returns {Promise<boolean>} 是否生成成功
     */
    async function generateDepth() {
        if (!selectedPath || isGenerating) return false;
        const forPath = selectedPath;

        isGenerating = true;
        depthBar.classList.add('generating');
        btnGenerate.disabled = true;
        btnApply.disabled = true;
        setPanelsBusy(true);
        depthGenerated = false;
        showProgress(selectedVideo ? '正在读取视频画面…' : '正在读取图片…');

        const blurRadius = parseInt(blurSlider.value, 10);
        try {
            const result = await api.generateDepthMap(forPath, blurRadius);
            endProgress();
            if (result.success) {
                // 生成期间不能换图（图库、我的壁纸都是灰的），这里一定还是同一个
                depthGenerated = true;
                preview.setDepth(result.depthDataUrl, { show: true });
                btnApply.disabled = false;
                showDepthState('ready');
                setStatus('深度图生成好了，点"应用壁纸"换上', 'success');
                return true;
            }
            showDepthState('failed');
            setStatus('深度图生成失败：' + (result.error || '未知错误'), 'error');
            return false;
        } catch (err) {
            console.error('生成深度图失败:', err);
            endProgress();
            showDepthState('failed');
            setStatus('深度图生成失败：' + err.message, 'error');
            return false;
        } finally {
            isGenerating = false;
            depthBar.classList.remove('generating');
            btnGenerate.disabled = false;
            setPanelsBusy(false);
        }
    }

    btnGenerate.addEventListener('click', () => generateDepth());

    // 主进程发来的进度：按关键字推进度条
    api.onDepthProgress((data) => {
        if (!isGenerating) return;
        const msg = data.message;
        showProgress(msg);
        if (msg.includes('[OK]') || msg.includes('完成')) setProgress(100);
        else if (msg.includes('[Smooth]') || msg.includes('平滑') || msg.includes('smoothing')) setProgress(85);
        else if (msg.includes('分析') || msg.includes('推理')) setProgress(50);
    });

    // ---------- 应用壁纸 ----------

    /** 把当前选中的图片或视频应用到桌面（图片和 3D 视差的视频需要已有深度图） */
    async function applySelectedWallpaper() {
        if (!selectedPath) return;
        const video = selectedVideo;
        if (video ? video.effect === 'depth' && !depthGenerated : !depthGenerated) return;
        try {
            if (video) {
                await api.applyWallpaper({ type: 'video', path: video.path, effect: video.effect, sound: video.sound });
                setStatus('视频壁纸已应用', 'success');
            } else {
                await api.applyWallpaper({ type: 'image', path: selectedPath });
                setStatus('壁纸已应用，移动鼠标看看效果', 'success');
            }
        } catch (err) {
            setStatus('应用壁纸失败：' + err.message, 'error');
        }
    }

    btnApply.addEventListener('click', () => applySelectedWallpaper());

    // ---------- 托盘"更换壁纸"转过来的图片 ----------
    // 托盘选的图片还没有深度图时，主进程会打开设置窗口并转到这里：
    // 选中 → 生成深度图 → 生成成功后直接应用，进度显示在设置窗口里。
    api.onPrepareImage(async ({ imagePath }) => {
        if (isGenerating) {
            setStatus('正在为另一张图片生成深度图，完成后再换', 'error');
            return;
        }
        try {
            const ready = (await selectImagePath(imagePath)) || (await generateDepth());
            if (ready) await applySelectedWallpaper();
        } catch (err) {
            console.error('更换壁纸失败:', err);
            setStatus('更换壁纸失败：' + err.message, 'error');
        }
    });

    api.onLoadConfig((config) => {
        latestConfig = config || {};
        const next = MW.resolveCurrent(latestConfig);
        if (JSON.stringify(next) === JSON.stringify(current)) return;
        current = next;
        refreshNowUsing();
    });

    showDepthState('none');

    return {
        async load(config) {
            latestConfig = config || {};
            if (config.blurRadius !== undefined) {
                setRange(blurSlider, config.blurRadius);
                blurValue.textContent = blurText(config.blurRadius);
            }
            current = MW.resolveCurrent(config);
            await Promise.all([gallery.ready, mine.ready]);
            refreshNowUsing();
            // 恢复当前壁纸（和手动选中走同一套逻辑，只是不弹提示）
            if (!current || !api.fileExists(current.path)) return;
            if (current.type === 'video') {
                // 显示「我的壁纸」里记的效果和声音（改了没应用的也算）；列表里没有就用桌面上的
                const entry = MW.findEntry(config.myWallpapers, current.path) || { ...current };
                await selectVideo(entry, { quiet: true });
            } else {
                await selectImagePath(current.path, { quiet: true, crop: current.crop });
            }
        },

        /** "恢复推荐值"同步边缘平滑 */
        setBlur(value) {
            setRange(blurSlider, value);
            blurValue.textContent = blurText(value);
        },

        /** 清除缓存后：自己的图片、3D 视差的视频的深度图没了，不能直接应用 */
        markDepthStale() {
            if (!selectedPath) return;
            if (selectedVideo ? selectedVideo.effect !== 'depth' : gallery.find(selectedPath)) return;
            depthGenerated = false;
            btnApply.disabled = true;
            preview.setDepth(null);
            showDepthState('missing');
        },
    };
}
