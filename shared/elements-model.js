/**
 * elements-model.js — 自定义元素的数据结构与纯函数（主进程、渲染进程、测试共用）
 *
 * 所有函数都不修改入参，返回新对象。
 *
 * @typedef {{ mode: 'static'|'loop'|'interval', intervalSec: number, jitterSec: number }} Playback
 * @typedef {{ enabled: boolean, strength: number }} Chroma
 * @typedef {{
 *   id: string, name: string, type: 'image'|'animated'|'video', file: string, thumb: string|null,
 *   builtin: boolean, aspect?: number,
 *   defaults?: { width?: number, playback?: Playback, chroma?: Chroma }
 * }} Asset
 * @typedef {{
 *   id: string, assetId: string, visible: boolean,
 *   transform: { x: number, y: number, width: number, rotation: number },
 *   depth: number, depthAuto: boolean, opacity: number,
 *   playback: Playback, chroma: Chroma, effects: object
 * }} Instance
 * @typedef {{ library: Asset[], instances: Instance[] }} CustomElements
 */

(function (root, factory) {
    const mod = factory();
    if (typeof module === 'object' && module.exports) module.exports = mod;
    else (root.Shared = root.Shared || {}).elements = mod;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /** 元素宽度（相对屏幕宽度）的允许范围 */
    const LIMITS = { minWidth: 0.03, maxWidth: 1.5 };
    /** 新元素默认宽度 */
    const DEFAULT_WIDTH = 0.25;
    /** 间隔播放的默认参数 */
    const DEFAULT_INTERVAL_SEC = 10;
    const DEFAULT_JITTER_SEC = 3;

    function emptyCustomElements() {
        return { library: [], instances: [] };
    }

    /** 把读到的配置整理成合法结构：字段缺失或类型不对时回退为空数组 */
    function normalizeCustomElements(raw) {
        if (!raw || typeof raw !== 'object') return emptyCustomElements();
        return {
            library: Array.isArray(raw.library) ? raw.library : [],
            instances: Array.isArray(raw.instances) ? raw.instances : [],
        };
    }

    function clampWidth(width) {
        return Math.min(LIMITS.maxWidth, Math.max(LIMITS.minWidth, width));
    }

    /** 素材的默认播放方式：素材自带配置优先；图片静止，动图和视频循环 */
    function defaultPlayback(asset) {
        const preset = asset.defaults && asset.defaults.playback;
        if (preset) return { ...preset };
        return {
            mode: asset.type === 'image' ? 'static' : 'loop',
            intervalSec: DEFAULT_INTERVAL_SEC,
            jitterSec: DEFAULT_JITTER_SEC,
        };
    }

    /** 从素材生成一个放在屏幕中央的新实例（id 由调用方生成） */
    function createInstance(asset, id) {
        const defaults = asset.defaults || {};
        return {
            id,
            assetId: asset.id,
            visible: true,
            transform: { x: 0.5, y: 0.5, width: clampWidth(defaults.width || DEFAULT_WIDTH), rotation: 0 },
            depth: 0.5,
            depthAuto: true,
            opacity: 1,
            playback: defaultPlayback(asset),
            chroma: { enabled: false, strength: 0.5, ...(defaults.chroma || {}) },
            effects: {},
        };
    }

    /** 渲染顺序：深度升序（远的先画，近的盖在上面），同深度保持原顺序（后添加的在上） */
    function sortForRender(instances) {
        return instances
            .map((instance, index) => ({ instance, index }))
            .sort((a, b) => (a.instance.depth - b.instance.depth) || (a.index - b.index))
            .map((x) => x.instance);
    }

    /**
     * 把实例和素材配对，找不到素材的实例单独列出。
     * @param {Instance[]} instances
     * @param {Map<string, Asset>} assetsById
     */
    function resolveInstances(instances, assetsById) {
        const ok = [];
        const broken = [];
        for (const instance of instances) {
            const asset = assetsById.get(instance.assetId);
            if (asset) ok.push({ instance, asset });
            else broken.push(instance.id);
        }
        return { ok, broken };
    }

    /** 新增实例；id 已存在时原位替换 */
    function upsertInstance(ce, instance) {
        const exists = ce.instances.some((i) => i.id === instance.id);
        return {
            ...ce,
            instances: exists
                ? ce.instances.map((i) => (i.id === instance.id ? instance : i))
                : [...ce.instances, instance],
        };
    }

    function removeInstance(ce, instanceId) {
        return { ...ce, instances: ce.instances.filter((i) => i.id !== instanceId) };
    }

    /**
     * 局部修改实例：transform / playback / chroma / effects 按字段合并，宽度夹紧；
     * 手动给了 depth 时视为用户亲自设定，关闭自动贴地。
     */
    function patchInstance(ce, instanceId, patch) {
        return {
            ...ce,
            instances: ce.instances.map((i) => {
                if (i.id !== instanceId) return i;
                const next = {
                    ...i,
                    ...patch,
                    transform: { ...i.transform, ...(patch.transform || {}) },
                    playback: { ...i.playback, ...(patch.playback || {}) },
                    chroma: { ...i.chroma, ...(patch.chroma || {}) },
                    effects: { ...i.effects, ...(patch.effects || {}) },
                };
                next.transform.width = clampWidth(next.transform.width);
                if ('depth' in patch && !('depthAuto' in patch)) next.depthAuto = false;
                return next;
            }),
        };
    }

    /** 从素材库移除素材，并删掉所有引用它的实例 */
    function removeAsset(ce, assetId) {
        const removedInstanceIds = ce.instances.filter((i) => i.assetId === assetId).map((i) => i.id);
        return {
            ce: {
                library: ce.library.filter((a) => a.id !== assetId),
                instances: ce.instances.filter((i) => i.assetId !== assetId),
            },
            removedInstanceIds,
        };
    }

    /**
     * elements/manifest.json 的一条记录 → Asset。
     * @param {object} entry
     * @param {(file: string) => string} resolvePath - 把 manifest 里的相对文件名转成可用路径
     */
    function assetFromManifestEntry(entry, resolvePath) {
        return {
            id: 'builtin:' + entry.id,
            name: entry.name,
            type: entry.type,
            file: resolvePath(entry.file),
            thumb: entry.thumb ? resolvePath(entry.thumb) : null,
            builtin: true,
            aspect: entry.aspect,
            defaults: { width: entry.width, playback: entry.playback, chroma: entry.chroma },
        };
    }

    /**
     * 旧版"自定义贴纸"配置 → 新实例的位置/大小等字段。
     * 旧贴纸的 positionX/Y 是左上角在屏幕上的百分比，size 是像素宽度。
     * @returns {{x: number, y: number, width: number, depth: number, opacity: number} | null}
     */
    function legacyStickerToInstance(sticker, screenW, screenH, imgAspect) {
        if (!sticker || !sticker.enabled || !sticker.imagePath) return null;
        const sizePx = sticker.size || 180;
        const width = sizePx / screenW;
        const heightNorm = sizePx / imgAspect / screenH;
        const left = (sticker.positionX !== undefined ? sticker.positionX : 85) / 100;
        const top = (sticker.positionY !== undefined ? sticker.positionY : 20) / 100;
        return {
            x: left + width / 2,
            y: top + heightNorm / 2,
            width: clampWidth(width),
            depth: sticker.depth !== undefined ? sticker.depth : 0.7,
            opacity: sticker.opacity !== undefined ? sticker.opacity : 0.9,
        };
    }

    return {
        LIMITS,
        DEFAULT_WIDTH,
        emptyCustomElements,
        normalizeCustomElements,
        clampWidth,
        defaultPlayback,
        createInstance,
        sortForRender,
        resolveInstances,
        upsertInstance,
        removeInstance,
        patchInstance,
        removeAsset,
        assetFromManifestEntry,
        legacyStickerToInstance,
    };
});
