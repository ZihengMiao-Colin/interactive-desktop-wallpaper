/**
 * library.js — 自定义元素素材库（主进程）
 *
 * - 默认素材：项目 elements/ 目录，由 manifest.json 描述
 * - 用户素材：导入时复制到 userData/custom_elements/，原文件之后挪走或删掉都不影响
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { assetFromManifestEntry } = require('../../shared/elements-model');

/** 文件对话框允许选择的扩展名 */
const IMPORT_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'apng', 'mp4', 'webm', 'mov', 'mkv', 'm4v'];

const STATIC_IMAGE_EXTS = new Set(['jpg', 'jpeg', 'bmp']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'mkv', 'm4v']);

/** 读文件开头一段字节（判断格式用） */
function readHead(filePath, bytes) {
    const fd = fs.openSync(filePath, 'r');
    try {
        const buf = Buffer.alloc(bytes);
        const n = fs.readSync(fd, buf, 0, bytes, 0);
        return buf.subarray(0, n);
    } finally {
        fs.closeSync(fd);
    }
}

/** PNG 在 IDAT 之前出现 acTL 块就是 APNG */
function isAnimatedPng(filePath) {
    const buf = readHead(filePath, 256 * 1024);
    let offset = 8;   // 跳过 8 字节签名
    while (offset + 8 <= buf.length) {
        const len = buf.readUInt32BE(offset);
        const type = buf.toString('ascii', offset + 4, offset + 8);
        if (type === 'acTL') return true;
        if (type === 'IDAT' || type === 'IEND') return false;
        offset += 12 + len;   // 长度 4 + 类型 4 + 数据 + CRC 4
    }
    return false;
}

/** WebP 的 VP8X 扩展头里，标志字节（第 20 字节）的 0x02 位表示动画 */
function isAnimatedWebp(filePath) {
    const buf = readHead(filePath, 32);
    if (buf.length < 21) return false;
    if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return false;
    return buf.toString('ascii', 12, 16) === 'VP8X' && (buf[20] & 0x02) !== 0;
}

/**
 * 判断素材类型。
 * @returns {'image'|'animated'|'video'|null} 不支持时返回 null
 */
function detectAssetType(filePath) {
    const ext = path.extname(filePath).slice(1).toLowerCase();
    if (VIDEO_EXTS.has(ext)) return 'video';
    if (STATIC_IMAGE_EXTS.has(ext)) return 'image';
    if (ext === 'gif') return 'animated';
    if (ext === 'png' || ext === 'apng') return isAnimatedPng(filePath) ? 'animated' : 'image';
    if (ext === 'webp') return isAnimatedWebp(filePath) ? 'animated' : 'image';
    return null;
}

/**
 * 读取默认素材。manifest 不存在时返回空数组；文件缺失的条目跳过。
 * @param {string} elementsDir
 */
function loadBuiltinAssets(elementsDir) {
    const manifestPath = path.join(elementsDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return [];

    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch (err) {
        console.warn('[Elements] manifest.json 解析失败:', err.message);
        return [];
    }

    const assets = [];
    for (const entry of manifest.elements || []) {
        const asset = assetFromManifestEntry(entry, (f) => path.join(elementsDir, f));
        if (!fs.existsSync(asset.file)) {
            console.warn(`[Elements] 默认素材文件缺失，已跳过: ${asset.file}`);
            continue;
        }
        if (asset.thumb && !fs.existsSync(asset.thumb)) asset.thumb = null;
        assets.push(asset);
    }
    return assets;
}

/** 用户素材 id（user:<uuid>）→ 文件名用的部分。Windows 文件名不能含冒号 */
function fileStem(assetId) {
    return assetId.replace(/^user:/, '');
}

/**
 * 导入用户文件：复制到素材库目录。
 * @param {string} srcPath
 * @param {string} libraryDir
 * @param {string} id - 形如 user:<uuid>
 * @returns {import('../../shared/elements-model').Asset}
 */
function importUserAsset(srcPath, libraryDir, id) {
    const type = detectAssetType(srcPath);
    if (!type) throw new Error('UNSUPPORTED_FILE');

    const ext = path.extname(srcPath).toLowerCase();
    fs.mkdirSync(libraryDir, { recursive: true });
    const dest = path.join(libraryDir, fileStem(id) + ext);
    fs.copyFileSync(srcPath, dest);

    return {
        id,
        name: path.basename(srcPath, path.extname(srcPath)),
        type,
        file: dest,
        thumb: null,
        builtin: false,
        importedAt: new Date().toISOString(),
    };
}

/** 删除用户素材的副本和缩略图；文件已不存在时忽略 */
function removeUserAssetFiles(asset) {
    for (const f of [asset.file, asset.thumb]) {
        if (!f) continue;
        try {
            fs.unlinkSync(f);
        } catch (_) {
            // 文件已经不在了
        }
    }
}

/** 保存缩略图（JPEG Data URL），返回文件路径 */
function saveThumbnail(libraryDir, assetId, dataUrl) {
    const base64 = dataUrl.replace(/^data:[^;]+;base64,/, '');
    fs.mkdirSync(libraryDir, { recursive: true });
    const thumbPath = path.join(libraryDir, fileStem(assetId) + '_thumb.jpg');
    fs.writeFileSync(thumbPath, Buffer.from(base64, 'base64'));
    return thumbPath;
}

/** 本地路径 → file:// URL（正确转义中文、空格、#、%） */
function toFileUrl(absPath) {
    return pathToFileURL(absPath).href;
}

module.exports = {
    IMPORT_EXTENSIONS,
    detectAssetType,
    loadBuiltinAssets,
    importUserAsset,
    removeUserAssetFiles,
    saveThumbnail,
    toFileUrl,
};
