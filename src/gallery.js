/**
 * gallery.js — 默认壁纸图库（主进程）
 *
 * 图库在项目的 wallpapers/ 目录，由 manifest.json 描述，每张壁纸都带提前生成好的深度图和缩略图。
 * 素材由 tools/prepare_wallpapers.py 生成。
 */

const fs = require('fs');
const path = require('path');

/**
 * @typedef {{ id: string, name: string, file: string, depth: string, thumb: string|null,
 *             credit: string, origin: string }} GalleryEntry
 */

/**
 * 读取图库。缺图片或缺深度图的条目跳过；缩略图缺失时 thumb 为 null。
 * @param {string} galleryDir
 * @returns {GalleryEntry[]} 路径都是绝对路径，顺序与 manifest 一致
 */
function loadGallery(galleryDir) {
    const manifestPath = path.join(galleryDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return [];

    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch (err) {
        console.warn('[Gallery] manifest.json 解析失败:', err.message);
        return [];
    }

    const entries = [];
    for (const item of manifest.wallpapers || []) {
        const file = path.join(galleryDir, item.file);
        const depth = path.join(galleryDir, item.depth);
        if (!fs.existsSync(file) || !fs.existsSync(depth)) {
            console.warn('[Gallery] 默认壁纸文件缺失，已跳过:', item.id);
            continue;
        }
        const thumb = item.thumb ? path.join(galleryDir, item.thumb) : null;
        entries.push({
            id: item.id,
            name: item.name,
            file,
            depth,
            thumb: thumb && fs.existsSync(thumb) ? thumb : null,
            credit: item.credit || '',
            origin: item.origin || '',
        });
    }
    return entries;
}

/** 统一路径写法后比较（Windows 路径不区分大小写） */
function samePath(a, b) {
    return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

/**
 * 某张图片是不是图库里的默认壁纸。
 * @returns {GalleryEntry|null}
 */
function findGalleryEntry(gallery, imagePath) {
    if (!imagePath) return null;
    return gallery.find((e) => samePath(e.file, imagePath)) || null;
}

/** 图片所在目录是不是一份图库：有 manifest.json，并且列了这张图 */
function listedInGalleryManifest(imagePath) {
    try {
        const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(imagePath), 'manifest.json'), 'utf-8'));
        const name = path.basename(imagePath).toLowerCase();
        return (manifest.wallpapers || []).some((w) => String(w.file).toLowerCase() === name);
    } catch (_) {
        return false;
    }
}

/**
 * 配置里记着的壁纸路径如果指向别处的同一张默认壁纸，换成当前图库里的：
 *   - 另一份图库里的图：开发目录和安装目录各有一份图库、共用同一份配置。
 *     那份图库还在时看它的 manifest.json；已经删了就按 wallpapers 目录名和文件名认。
 *   - 旧版本直接用 `default wallpaper/` 里的原图当壁纸，那个文件不在了的话按原文件名认。
 * @param {string} imagePath - 配置里记着的壁纸路径
 * @param {GalleryEntry[]} gallery
 * @param {(p: string) => boolean} [exists]
 * @returns {string} 新路径；不需要迁移时原样返回
 */
function migrateLegacyImagePath(imagePath, gallery, exists = fs.existsSync) {
    if (!imagePath || findGalleryEntry(gallery, imagePath)) return imagePath;
    const base = path.basename(imagePath).toLowerCase();
    const found = exists(imagePath);

    const fromOtherGallery = found
        ? listedInGalleryManifest(imagePath)
        : path.basename(path.dirname(imagePath)).toLowerCase() === 'wallpapers';
    if (fromOtherGallery) {
        const entry = gallery.find((e) => path.basename(e.file).toLowerCase() === base);
        if (entry) return entry.file;
    }

    if (found) return imagePath;
    const entry = gallery.find((e) => e.origin && e.origin.toLowerCase() === base);
    return entry ? entry.file : imagePath;
}

module.exports = { loadGallery, findGalleryEntry, migrateLegacyImagePath };
