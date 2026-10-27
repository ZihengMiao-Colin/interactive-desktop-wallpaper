/**
 * elements-model.js — 自定义元素的数据结构与纯函数（主进程、渲染进程、测试共用）
 *
 * 所有函数都不修改入参，返回新对象。
 *
 * @typedef {{
 *   mode: 'static'|'loop'|'interval'|'click', intervalSec: number, jitterSec: number,
 *   followClick?: boolean
 * }} Playback - click：点击桌面触发播放一次；followClick 为 true 时平时隐藏、在点击的位置播放
 * @typedef {{ enabled: boolean, strength: number }} Chroma
 * @typedef {{
 *   x: number, y: number, width: number, rotation: number, stretch: number,
 *   flipX: boolean, flipY: boolean, warp: number[][]|null
 * }} Transform - x / y 是中心（屏幕归一化），width 相对屏幕宽度，rotation 为角度（顺时针），
 *   stretch 是高度相对原始比例的倍数，warp 是自由变形时四个角（左上、右上、右下、左下）相对框的偏移
 * @typedef {{ hue: number, saturation: number, brightness: number, tint: string, tintAmount: number }} Effects
 *   hue 为色相偏移角度，saturation / brightness 为倍数，tint 是染色颜色（#rrggbb），tintAmount 0~1
 * @typedef {{
 *   id: string, name: string, type: 'image'|'animated'|'video', file: string, thumb: string|null,
 *   builtin: boolean, aspect?: number,
 *   defaults?: { width?: number, playback?: Playback, chroma?: Chroma }
 * }} Asset
 * @typedef {{
 *   id: string, assetId: string, visible: boolean,
 *   transform: Transform,
 *   depth: number, depthAuto: boolean, opacity: number,
 *   playback: Playback, chroma: Chroma, effects: Effects
 * }} Instance
 * @typedef {{ library: Asset[], instances: Instance[] }} CustomElements
 */

(function (root, factory) {
    const mod = factory();
    if (typeof module === 'object' && module.exports) module.exports = mod;
    else (root.Shared = root.Shared || {}).elements = mod;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /** 元素宽度（相对屏幕宽度）和拉伸倍数的允许范围 */
    const LIMITS = { minWidth: 0.03, maxWidth: 1.5, minStretch: 0.2, maxStretch: 5 };
    /** 新元素默认宽度 */
    const DEFAULT_WIDTH = 0.25;
    /** transform 的完整默认值（旧配置里的实例没有拉伸、翻转、变形字段） */
    const DEFAULT_TRANSFORM = Object.freeze({
        x: 0.5, y: 0.5, width: DEFAULT_WIDTH, rotation: 0, stretch: 1, flipX: false, flipY: false, warp: null,
    });
    /** 颜色效果默认值：不改颜色 */
    const DEFAULT_EFFECTS = Object.freeze({ hue: 0, saturation: 1, brightness: 1, tint: '#ff7a3d', tintAmount: 0 });
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

    function clampStretch(stretch) {
        return Math.min(LIMITS.maxStretch, Math.max(LIMITS.minStretch, stretch));
    }

    /** 角度规整到 (-180, 180] */
    function normalizeRotation(deg) {
        const r = ((((deg + 180) % 360) + 360) % 360) - 180;
        return r === -180 ? 180 : r;
    }

    /** 实例的完整 transform（补齐旧配置缺的字段） */
    function transformOf(instance) {
        return { ...DEFAULT_TRANSFORM, ...(instance.transform || {}) };
    }

    /** 实例的完整颜色效果（补齐旧配置缺的字段） */
    function effectsOf(instance) {
        return { ...DEFAULT_EFFECTS, ...(instance.effects || {}) };
    }

    /** #rrggbb → [r, g, b]（0~1），写错时按白色处理 */
    function parseHexColor(hex) {
        const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
        if (!m) return [1, 1, 1];
        const n = parseInt(m[1], 16);
        return [(n >> 16) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
    }

    /** 颜色效果 → 着色器参数（色相换成圈数） */
    function colorUniforms(effects) {
        const e = { ...DEFAULT_EFFECTS, ...(effects || {}) };
        return {
            hue: e.hue / 360,
            saturation: e.saturation,
            brightness: e.brightness,
            tint: parseHexColor(e.tint),
            tintAmount: e.tintAmount,
        };
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
            transform: { ...DEFAULT_TRANSFORM, width: clampWidth(defaults.width || DEFAULT_WIDTH) },
            depth: 0.5,
            depthAuto: true,
            opacity: 1,
            playback: defaultPlayback(asset),
            chroma: { enabled: false, strength: 0.5, ...(defaults.chroma || {}) },
            effects: { ...DEFAULT_EFFECTS },
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
     * 局部修改实例：transform / playback / chroma / effects 按字段合并，宽度和拉伸夹紧、旋转角规整；
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
                if (next.transform.stretch !== undefined) next.transform.stretch = clampStretch(next.transform.stretch);
                if (next.transform.rotation !== undefined) next.transform.rotation = normalizeRotation(next.transform.rotation);
                if ('depth' in patch && !('depthAuto' in patch)) next.depthAuto = false;
                return next;
            }),
        };
    }

    /** 是否有显示中的"点击播放"元素（有才需要检测桌面点击） */
    function hasClickTriggers(ce) {
        const instances = (ce && Array.isArray(ce.instances)) ? ce.instances : [];
        return instances.some((i) => i.visible && i.playback && i.playback.mode === 'click');
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
        DEFAULT_TRANSFORM,
        DEFAULT_EFFECTS,
        emptyCustomElements,
        normalizeCustomElements,
        clampWidth,
        clampStretch,
        normalizeRotation,
        transformOf,
        effectsOf,
        colorUniforms,
        defaultPlayback,
        createInstance,
        sortForRender,
        resolveInstances,
        upsertInstance,
        removeInstance,
        patchInstance,
        hasClickTriggers,
        removeAsset,
        assetFromManifestEntry,
        legacyStickerToInstance,
    };
});
