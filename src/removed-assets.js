/**
 * removed-assets.js — 删掉的自带视频素材（主进程启动时清理旧配置里的引用）
 *
 * 2026-11-13 自带的视频特效（overlay/）和爆炸元素（elements/）都删掉了：来源没有记录，
 * 说不清能不能随软件分发，见 PROJECT_NOTES §9"公开分发相关"。删掉的默认壁纸另见 gallery.js 的 REMOVED_FILES。
 */

'use strict';

/** v1.3.1 及更早版本自带的视频特效预设 id */
const REMOVED_OVERLAY_PRESETS = new Set(['rain1', 'rain2', 'snow1', 'snow2', 'snow3', 'old1', 'old2', 'old3']);

/** v1.3.1 及更早版本自带的元素素材 id */
const REMOVED_ELEMENT_ASSETS = new Set(['builtin:bomb1', 'builtin:bomb2']);

/**
 * 旧配置里还引用着删掉的素材时，算出要写回配置的改动：
 *   - 视频特效用的是删掉的预设：导入过自己的视频就换成它；没有的话关掉视频特效。
 *   - 壁纸上用删掉的元素素材摆的实例：去掉，不然元素列表里会留着"素材已丢失"。
 * @param {object} config - store.getConfig() 的结果
 * @returns {object|null} 交给 store.saveConfig 的部分配置；不用改时返回 null
 */
function cleanupRemovedBuiltins(config) {
    const patch = {};

    const overlay = config.videoOverlay;
    if (overlay && REMOVED_OVERLAY_PRESETS.has(overlay.presetId)) {
        patch.videoOverlay = overlay.customPath
            ? { presetId: 'custom' }
            : { presetId: 'custom', enabled: false };
    }

    const instances = (config.customElements && config.customElements.instances) || [];
    const kept = instances.filter((i) => !REMOVED_ELEMENT_ASSETS.has(i.assetId));
    if (kept.length !== instances.length) {
        patch.customElements = { instances: kept };
    }

    return Object.keys(patch).length ? patch : null;
}

module.exports = { cleanupRemovedBuiltins, REMOVED_OVERLAY_PRESETS, REMOVED_ELEMENT_ASSETS };
