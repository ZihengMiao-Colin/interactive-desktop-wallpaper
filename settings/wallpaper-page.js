/**
 * wallpaper-page.js — 设置窗口"壁纸"页：选图、生成深度图、应用壁纸
 *
 * 选中（图库或自己的图片）只是预览，要点"应用壁纸"才会换到桌面上。
 * 默认壁纸自带深度图；自己的图片先找缓存，没有就要"生成深度图"。
 * 托盘"更换壁纸"选的图片没有深度图时，主进程会把它转到这里：生成完直接应用。
 */

'use strict';

/**
 * @param {{
 *   api: object,
 *   saver: { save: (partial: object) => void },
 *   setStatus: (msg: string, cls?: string) => void,
 *   setNowUsing: (info: { name: string, thumbUrl: string } | null) => void,
 *   preview: ReturnType<typeof initDepthPreview>,
 * }} deps
 * @returns {{ load: (config: object) => Promise<void>, setBlur: (value: number) => void, markDepthStale: () => void }}
 */
function initWallpaperPage({ api, saver, setStatus, setNowUsing, preview }) {
    const { el, setRange, bindRange } = Controls;
    const depthState = document.getElementById('depth-state');
    const blurSlider = document.getElementById('depth-blur');
    const blurValue = document.getElementById('blur-value');
    const btnGenerate = document.getElementById('btn-generate-depth');
    const btnApply = document.getElementById('btn-apply-wallpaper');

    let selectedImagePath = null;
    let currentImage = '';
    let depthGenerated = false;
    let isGenerating = false;

    const fileName = (p) => p.split('\\').pop();
    const blurText = (v) => (v === 0 ? '关闭' : v + 'px');

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
        preview.setUsing(!!selectedImagePath && samePath(selectedImagePath, currentImage));
        if (!currentImage || !api.fileExists(currentImage)) {
            setNowUsing(null);
            return;
        }
        const entry = gallery.find(currentImage);
        setNowUsing(entry
            ? { name: entry.name, thumbUrl: api.toFileUrl(entry.thumb) }
            : { name: fileName(currentImage), thumbUrl: api.toFileUrl(currentImage) });
    }

    // ---------- 选择壁纸 ----------

    /**
     * 选中一张图片：显示预览并检查深度图（只选中，不应用到桌面）。
     * 默认壁纸自带深度图，"生成深度图"按钮保持灰色。
     * @param {string} imagePath
     * @param {{quiet?: boolean}} [options] - quiet 为 true 时不弹提示（打开设置窗口时恢复当前壁纸用）
     * @returns {Promise<boolean>} 是否已有可用的深度图
     */
    async function selectImagePath(imagePath, { quiet = false } = {}) {
        const galleryEntry = gallery.find(imagePath);
        selectedImagePath = imagePath;
        depthGenerated = false;
        btnGenerate.disabled = !!galleryEntry;
        btnApply.disabled = true;
        gallery.setSelected(imagePath);

        const name = galleryEntry ? galleryEntry.name : fileName(imagePath);
        const dataUrl = api.readFileAsDataURL(imagePath);
        if (dataUrl) preview.showImage(dataUrl, { name, tag: galleryEntry ? '默认壁纸' : '你的图片' });
        refreshNowUsing();
        showDepthState('none');

        const depth = await api.getDepthCache(imagePath);
        // 等深度图期间又选了别的图片，这次的结果就不用了
        if (selectedImagePath !== imagePath) return !!depth;
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

    const gallery = initGalleryPanel({
        api,
        onSelect: (entry) => selectImagePath(entry.file),
        onPickFile: async () => {
            try {
                const imagePath = await api.selectImage();
                if (imagePath) await selectImagePath(imagePath);
            } catch (err) {
                console.error('选择图片失败:', err);
                setStatus('选择图片失败：' + err.message, 'error');
            }
        },
    });

    // ---------- 边缘平滑 ----------

    bindRange(blurSlider, blurValue, blurText, (v) => {
        saver.save({ blurRadius: v });
        if (selectedImagePath && !gallery.find(selectedImagePath) && !isGenerating) {
            depthGenerated = false;
            btnApply.disabled = true;
            showDepthState('stale');
        }
    });

    // ---------- 生成深度图 ----------

    /**
     * 为当前选中的图片生成深度图。
     * @returns {Promise<boolean>} 是否生成成功
     */
    async function generateDepth() {
        if (!selectedImagePath || isGenerating) return false;

        isGenerating = true;
        depthState.parentElement.classList.add('generating');
        btnGenerate.disabled = true;
        btnApply.disabled = true;
        gallery.setBusy(true);
        depthGenerated = false;
        showProgress('正在读取图片…');

        const blurRadius = parseInt(blurSlider.value, 10);
        try {
            const result = await api.generateDepthMap(selectedImagePath, blurRadius);
            endProgress();
            if (result.success) {
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
            depthState.parentElement.classList.remove('generating');
            btnGenerate.disabled = false;
            gallery.setBusy(false);
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

    /** 把当前选中的图片应用到桌面（需要已有深度图） */
    async function applySelectedWallpaper() {
        if (!selectedImagePath || !depthGenerated) return;
        try {
            await api.applyWallpaper(selectedImagePath);
            setStatus('壁纸已应用，移动鼠标看看效果', 'success');
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
        const next = (config && config.currentImage) || '';
        if (next === currentImage) return;
        currentImage = next;
        refreshNowUsing();
    });

    showDepthState('none');

    return {
        async load(config) {
            if (config.blurRadius !== undefined) {
                setRange(blurSlider, config.blurRadius);
                blurValue.textContent = blurText(config.blurRadius);
            }
            currentImage = config.currentImage || '';
            await gallery.ready;
            refreshNowUsing();
            // 恢复当前壁纸（和手动选中走同一套逻辑，只是不弹提示）
            if (currentImage && api.fileExists(currentImage)) {
                await selectImagePath(currentImage, { quiet: true });
            }
        },

        /** "恢复推荐值"同步边缘平滑 */
        setBlur(value) {
            setRange(blurSlider, value);
            blurValue.textContent = blurText(value);
        },

        /** 清除缓存后：自己的图片的深度图没了，不能直接应用 */
        markDepthStale() {
            if (!selectedImagePath || gallery.find(selectedImagePath)) return;
            depthGenerated = false;
            btnApply.disabled = true;
            preview.setDepth(null);
            showDepthState('missing');
        },
    };
}
