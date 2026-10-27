/**
 * host.js — 渲染进程访问外部环境的统一入口
 *
 * Electron 里走 preload 暴露的 window.electronAPI；
 * 浏览器直接打开 index.html 时（开发预览）读 dev/dev-config.json 和 elements/manifest.json，
 * 摆放模式的确认 / 取消只打印日志，结果存到 window.__lastPlacement。
 */

'use strict';

const Host = (() => {
    const params = new URLSearchParams(location.search);
    /** 'wallpaper'：桌面壁纸；'edit'：摆放窗口 */
    const mode = params.get('mode') === 'edit' ? 'edit' : 'wallpaper';
    const api = window.electronAPI;

    if (api) {
        return {
            isElectron: true,
            mode,
            getConfig: () => api.getConfig(),
            onConfig: (callback) => api.onLoadConfig(callback),
            getBuiltinAssets: () => api.elements.getBuiltin(),
            /** 全屏视频特效预设（绝对路径：打包后素材在 resources/overlay，不在页面旁边） */
            getOverlayPresets: () => api.getOverlayPresets(),
            fileUrl: (filePath) => api.toFileUrl(filePath),
            readBytes: async (filePath) => {
                const bytes = api.readFileBuffer(filePath);
                if (!bytes) throw new Error('无法读取文件: ' + filePath);
                return new Uint8Array(bytes);
            },
            placement: api.placement,
        };
    }

    // ---- 浏览器开发预览 ----
    let devConfig = null;
    function loadDevConfig() {
        if (!devConfig) {
            devConfig = fetch('dev/dev-config.json')
                .then((r) => (r.ok ? r.json() : {}))
                .catch(() => ({}));
        }
        return devConfig;
    }

    return {
        isElectron: false,
        mode,
        getConfig: async () => {
            const c = await loadDevConfig();
            return { customElements: Shared.elements.normalizeCustomElements(c.customElements) };
        },
        onConfig: () => {},
        getBuiltinAssets: async () => {
            try {
                const manifest = await fetch('elements/manifest.json').then((r) => r.json());
                return (manifest.elements || []).map((e) => Shared.elements.assetFromManifestEntry(e, (f) => 'elements/' + f));
            } catch (_) {
                return [];
            }
        },
        /** 浏览器预览直接用页面旁边的 overlay/ 目录（VideoOverlayManager 里的默认表） */
        getOverlayPresets: async () => null,
        fileUrl: (filePath) => filePath,
        readBytes: async (filePath) => {
            const r = await fetch(filePath);
            if (!r.ok) throw new Error(`无法读取文件: ${filePath} (${r.status})`);
            return new Uint8Array(await r.arrayBuffer());
        },
        placement: {
            getDraft: async () => (await loadDevConfig()).draft || null,
            commit: async (instance) => {
                console.info('[DevHost] commit', instance);
                window.__lastPlacement = { action: 'commit', instance };
                return true;
            },
            cancel: async () => {
                console.info('[DevHost] cancel');
                window.__lastPlacement = { action: 'cancel' };
            },
        },
    };
})();
