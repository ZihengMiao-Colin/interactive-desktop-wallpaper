/**
 * main.js — 设置窗口入口：组装外壳和各页面，读一次配置后分给各页面
 *
 * 渲染进程通过 preload 暴露的 window.electronAPI 和主进程通信；
 * 浏览器里直接打开 settings.html 时没有它，只显示界面。
 */

'use strict';

(function startSettings() {
    const api = window.electronAPI;
    const shell = initShell();
    const preview = initDepthPreview();
    Controls.initHelpTips();
    const previewSlots = {
        wallpaper: document.getElementById('preview-slot-wallpaper'),
        parallax: document.getElementById('preview-slot-parallax'),
    };
    // 预览只有一份：切到哪个有预览的页面就挪到哪里。
    // 当前页没有预览、或者窗口最小化 / 被隐藏时，预览里的视频暂停，不在后台一直解码
    let currentPage = 'wallpaper';
    const syncPreviewActive = () => preview.setActive(!document.hidden && !!previewSlots[currentPage]);
    shell.onPageChange((page) => {
        currentPage = page;
        if (previewSlots[page]) preview.mount(previewSlots[page]);
        syncPreviewActive();
    });
    document.addEventListener('visibilitychange', syncPreviewActive);

    if (!api) {
        shell.setStatus('只能在 Electron 里使用，这里只显示界面', 'error');
        return;
    }

    // 拖滑块时节流保存：第一次立即发送，之后每 100ms 最多一次，最后的值一定会发出去。
    // 否则每个 input 事件都会写一次 config.json 并把完整配置广播给壁纸
    const saver = Shared.configSync.createConfigSaver((partial) => api.saveConfig(partial), 100);
    window.addEventListener('beforeunload', () => saver.flush());

    const { setStatus } = shell;
    const wallpaperPage = initWallpaperPage({ api, saver, setStatus, setNowUsing: shell.setNowUsing, preview });
    const parallaxPage = initParallaxPage({ api, saver, setStatus, preview, wallpaperPage });
    const effectsPage = initEffectsPage({ api, saver, setStatus });
    const musicPage = initMusicPage({ api, saver, setStatus });
    const systemPage = initSystemPage({ api, saver, setStatus, onCacheCleared: () => wallpaperPage.markDepthStale() });
    initElementsTab({ api, setStatus, setBadge: shell.setBadge });

    (async () => {
        try {
            const config = (await api.getConfig()) || {};
            parallaxPage.load(config);
            musicPage.load(config);
            await Promise.all([effectsPage.load(config), systemPage.load(config), wallpaperPage.load(config)]);
        } catch (err) {
            console.error('加载配置失败:', err);
            setStatus('加载配置失败：' + err.message, 'error');
        }
    })();
})();
