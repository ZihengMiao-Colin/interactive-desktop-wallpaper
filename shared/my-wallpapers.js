/**
 * my-wallpapers.js — 「我的壁纸」列表和当前壁纸的纯逻辑（主进程、壁纸页、设置页共用）
 *
 * 配置里的相关字段：
 *   myWallpapers: [Entry]   用户自己选过的图片和视频，按 lastUsedAt 从新到旧排，path 兼作 id
 *     图片：{ path, type: 'image', addedAt, lastUsedAt, thumb, duration }
 *     视频：再加 effect（'none' 不动 | 'depth' 3D 视差 | 'pan' 整体平移）和 sound
 *     裁过的条目还有 crop（见 shared/crop.js），没裁过的没有这个键
 *   currentImage: 当前的图片壁纸路径（只放图片：旧版本会把它指向的文件整个读成 base64）
 *   currentImageCrop: { path, x, y, w, h } | null 当前图片的裁剪。currentImage 必须是字符串，所以另放；
 *     path 和 currentImage 对不上时不用（旧版本换过图片）。
 *   currentVideo: { path, effect, sound, crop?, imageAtTime } 当前的视频壁纸。
 *     imageAtTime 是应用视频时的 currentImage；之后旧版本换过图片的话两者对不上，以图片为准。
 *   当前壁纸的裁剪在应用时抄一份：壁纸从「我的壁纸」移除后，桌面上的裁剪要保留，重启也一样。
 */

(function (root, factory) {
    const crop = (typeof module === 'object' && module.exports)
        ? require('./crop')
        : root.Shared.crop;
    const mod = factory(crop);
    if (typeof module === 'object' && module.exports) module.exports = mod;
    else (root.Shared = root.Shared || {}).myWallpapers = mod;
})(typeof self !== 'undefined' ? self : this, function (cropLib) {
    'use strict';

    const { normalizeCrop } = cropLib;

    const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'bmp'];
    const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'm4v', 'mkv'];
    const MOTIONS = ['none', 'depth', 'pan'];

    /** 按扩展名判断是图片还是视频，都不是返回 null */
    function wallpaperType(filePath) {
        const base = String(filePath || '').split(/[\\/]/).pop();
        const dot = base.lastIndexOf('.');
        if (dot < 0) return null;
        const ext = base.slice(dot + 1).toLowerCase();
        if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
        if (VIDEO_EXTENSIONS.includes(ext)) return 'video';
        return null;
    }

    /** Windows 路径比较：不区分大小写和斜杠方向 */
    const normalizePath = (p) => String(p || '').toLowerCase().replace(/\//g, '\\');
    function samePath(a, b) {
        return !!a && !!b && normalizePath(a) === normalizePath(b);
    }

    const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);

    /** 整理成合法的条目：扩展名不支持的去掉；type 无效时按扩展名补 */
    function normalizeEntry(raw) {
        if (!raw || typeof raw.path !== 'string' || !raw.path) return null;
        const detected = wallpaperType(raw.path);
        if (!detected) return null;
        const type = raw.type === 'image' || raw.type === 'video' ? raw.type : detected;
        const addedAt = num(raw.addedAt, 0);
        const entry = {
            path: raw.path,
            type,
            addedAt,
            lastUsedAt: num(raw.lastUsedAt, addedAt),
            thumb: typeof raw.thumb === 'string' ? raw.thumb : '',
            duration: num(raw.duration, 0),
        };
        if (type === 'video') {
            entry.effect = MOTIONS.includes(raw.effect) ? raw.effect : 'none';
            entry.sound = raw.sound === true;
        }
        const crop = normalizeCrop(raw.crop);
        if (crop) entry.crop = crop;
        return entry;
    }

    /** 去掉坏数据、按路径去重（保留先出现的）、按最近用过从新到旧排 */
    function normalizeList(list) {
        if (!Array.isArray(list)) return [];
        const out = [];
        for (const raw of list) {
            const entry = normalizeEntry(raw);
            if (!entry || out.some((e) => samePath(e.path, entry.path))) continue;
            out.push(entry);
        }
        // Array.prototype.sort 是稳定排序，同一时间的保持原来的顺序
        return out.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
    }

    function findEntry(list, filePath) {
        return normalizeList(list).find((e) => samePath(e.path, filePath)) || null;
    }

    /** 加入一条：已有的只更新 lastUsedAt（缩略图、时长和裁剪给了才换），没有的加在最前 */
    function addEntry(list, { path, type, thumb, duration, crop }, now) {
        const current = normalizeList(list);
        const existing = current.find((e) => samePath(e.path, path));
        if (existing) {
            return normalizeList(current.map((e) => (e !== existing ? e : {
                ...e,
                lastUsedAt: now,
                ...(thumb ? { thumb } : {}),
                ...(duration ? { duration } : {}),
                ...(crop ? { crop } : {}),
            })));
        }
        return normalizeList([{ path, type, addedAt: now, lastUsedAt: now, thumb, duration, crop }, ...current]);
    }

    /** 标记为刚用过（应用壁纸时） */
    function touchEntry(list, filePath, now) {
        const current = normalizeList(list);
        if (!current.some((e) => samePath(e.path, filePath))) return current;
        return normalizeList(current.map((e) => (samePath(e.path, filePath) ? { ...e, lastUsedAt: now } : e)));
    }

    /** 改效果、声音、缩略图、时长、裁剪（null 清掉）；不改排序。不认识的效果、图片的效果和声音都忽略 */
    function updateEntry(list, filePath, patch) {
        return normalizeList(normalizeList(list).map((e) => {
            if (!samePath(e.path, filePath)) return e;
            const next = { ...e };
            if (typeof patch.thumb === 'string') next.thumb = patch.thumb;
            if (Number.isFinite(patch.duration)) next.duration = patch.duration;
            if (patch.crop !== undefined) next.crop = patch.crop;
            if (e.type === 'video') {
                if (MOTIONS.includes(patch.effect)) next.effect = patch.effect;
                if (typeof patch.sound === 'boolean') next.sound = patch.sound;
            }
            return next;
        }));
    }

    function removeEntry(list, filePath) {
        const current = normalizeList(list);
        const removed = current.find((e) => samePath(e.path, filePath)) || null;
        return { list: removed ? current.filter((e) => e !== removed) : current, removed };
    }

    /** 升级迁移：当前壁纸是用户自己的图片、文件还在时，放进「我的壁纸」 */
    function migrateFromCurrentImage(list, currentImage, { isGallery, exists }, now) {
        if (!currentImage || wallpaperType(currentImage) !== 'image') return normalizeList(list);
        if (isGallery(currentImage) || !exists(currentImage)) return normalizeList(list);
        return addEntry(list, { path: currentImage, type: 'image' }, now);
    }

    /** 两个路径都为空，或者指向同一个文件 */
    const sameOrBothEmpty = (a, b) => (!a && !b) || samePath(a, b);

    /** 有裁剪时才写这个键：没裁过的壁纸和以前的数据长得一样 */
    const cropField = (crop) => (crop ? { crop } : {});

    /**
     * 当前桌面上的壁纸：{ type: 'image', path, crop? } | { type: 'video', path, effect, sound, crop? } | null
     */
    function resolveCurrent(config) {
        const c = config || {};
        const video = c.currentVideo;
        if (video && typeof video.path === 'string' && video.path && sameOrBothEmpty(video.imageAtTime, c.currentImage)) {
            return {
                type: 'video',
                path: video.path,
                effect: MOTIONS.includes(video.effect) ? video.effect : 'none',
                sound: video.sound === true,
                ...cropField(normalizeCrop(video.crop)),
            };
        }
        if (!c.currentImage) return null;
        const saved = c.currentImageCrop;
        const crop = saved && samePath(saved.path, c.currentImage) ? normalizeCrop(saved) : null;
        return { type: 'image', path: c.currentImage, ...cropField(crop) };
    }

    /** 应用一张壁纸时要写进配置的部分 */
    function applyPartial(config, descriptor, now) {
        const c = config || {};
        const myWallpapers = touchEntry(c.myWallpapers, descriptor.path, now);
        const crop = normalizeCrop(descriptor.crop);
        if (descriptor.type === 'video') {
            return {
                currentVideo: {
                    path: descriptor.path,
                    effect: MOTIONS.includes(descriptor.effect) ? descriptor.effect : 'none',
                    sound: descriptor.sound === true,
                    ...cropField(crop),
                    imageAtTime: c.currentImage || '',
                },
                myWallpapers,
            };
        }
        return {
            currentImage: descriptor.path,
            currentImageCrop: crop ? { path: descriptor.path, ...crop } : null,
            currentVideo: null,
            myWallpapers,
        };
    }

    /**
     * 给要应用的壁纸带上它的裁剪：先看「我的壁纸」里的记录。
     * 列表里没有时，它可能是刚被移除的当前壁纸（还选中着，可以再点"应用壁纸"），这时按桌面上的裁剪，
     * 否则水印会回来；别的情况（比如默认壁纸）没有裁剪。
     * @param {object} descriptor
     * @param {object} config - 完整配置
     */
    function withCrop(descriptor, config) {
        const { crop: _ignored, ...rest } = descriptor;
        const entry = findEntry(config.myWallpapers, descriptor.path);
        if (entry) return { ...rest, ...cropField(entry.crop) };
        const current = resolveCurrent(config);
        return { ...rest, ...cropField(current && samePath(current.path, descriptor.path) ? current.crop : null) };
    }

    /** 秒 → "分:秒"，未知时为空 */
    function formatDuration(seconds) {
        if (!Number.isFinite(seconds) || seconds <= 0) return '';
        const total = Math.floor(seconds);
        return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
    }

    return {
        IMAGE_EXTENSIONS,
        VIDEO_EXTENSIONS,
        MOTIONS,
        wallpaperType,
        samePath,
        normalizeList,
        findEntry,
        addEntry,
        touchEntry,
        updateEntry,
        removeEntry,
        migrateFromCurrentImage,
        resolveCurrent,
        applyPartial,
        withCrop,
        formatDuration,
    };
});
