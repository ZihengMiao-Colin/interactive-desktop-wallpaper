/**
 * paths.js — 配置里用户文件路径的纯逻辑（文件挪走后自动找回 / 手动接上用）
 *
 * 只记路径、会因为用户挪动或改名而失效的字段：
 *   myWallpapers[].path、currentImage、currentImageCrop.path、currentVideo.path、currentVideo.imageAtTime、
 *   vinyl.playlist[].path、vinyl.current、vinyl.coverPath、videoOverlay.customPath
 * 元素和解锁动画导入时复制到了数据目录，不在这里。
 *
 * 设计文档写的是放 shared/，但只有主进程用，还要用 Node 的 path.win32，所以放这里。
 */

'use strict';

const path = require('path').win32;
const { samePath } = require('../../shared/my-wallpapers');
const { trackName } = require('../../shared/playlist');

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'];
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'm4v', 'mkv'];
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac'];

/** 按扩展名分成图片 / 视频 / 音频，都不是返回 null（找回时用来确认还是同一类文件） */
function fileKind(filePath) {
    const ext = path.extname(String(filePath || '')).slice(1).toLowerCase();
    if (!ext) return null;
    if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
    if (VIDEO_EXTENSIONS.includes(ext)) return 'video';
    if (AUDIO_EXTENSIONS.includes(ext)) return 'audio';
    return null;
}

const isPath = (p) => typeof p === 'string' && p !== '';
const list = (v) => (Array.isArray(v) ? v : []);

/** 配置里所有用户文件的路径，同一个文件只出现一次 */
function collectPaths(config) {
    const c = config || {};
    const vinyl = c.vinyl || {};
    const all = [
        ...list(c.myWallpapers).map((e) => e && e.path),
        c.currentImage,
        c.currentImageCrop && c.currentImageCrop.path,
        c.currentVideo && c.currentVideo.path,
        c.currentVideo && c.currentVideo.imageAtTime,
        ...list(vinyl.playlist).map((t) => t && t.path),
        vinyl.current,
        vinyl.coverPath,
        c.videoOverlay && c.videoOverlay.customPath,
    ];
    const out = [];
    for (const p of all) {
        if (isPath(p) && !out.some((q) => samePath(q, p))) out.push(p);
    }
    return out;
}

/**
 * 把配置里的旧路径换成新路径。
 * 歌名等于旧文件名（去掉扩展名）、视频特效名等于旧文件名时跟着换成新的；用户改过的名字不动。
 * @param {object} config - 完整配置
 * @param {Array<{from: string, to: string}>} moves
 * @returns {object|null} 交给 store.saveConfig 的部分配置，只含变了的顶层键；什么都没变时为 null
 */
function replacePaths(config, moves) {
    const c = config || {};
    const map = (p) => {
        if (!isPath(p)) return p;
        const move = (moves || []).find((m) => samePath(m.from, p));
        return move ? move.to : p;
    };
    const partial = {};

    const wallpapers = list(c.myWallpapers).map((e) => (e && map(e.path) !== e.path ? { ...e, path: map(e.path) } : e));
    if (wallpapers.some((e, i) => e !== c.myWallpapers[i])) partial.myWallpapers = wallpapers;

    if (map(c.currentImage) !== c.currentImage) partial.currentImage = map(c.currentImage);

    const crop = c.currentImageCrop;
    if (crop && map(crop.path) !== crop.path) partial.currentImageCrop = { ...crop, path: map(crop.path) };

    const video = c.currentVideo;
    if (video && (map(video.path) !== video.path || map(video.imageAtTime) !== video.imageAtTime)) {
        partial.currentVideo = { ...video, path: map(video.path), imageAtTime: map(video.imageAtTime) };
    }

    const vinyl = c.vinyl;
    if (vinyl) {
        let changed = false;
        const playlist = list(vinyl.playlist).map((t) => {
            if (!t || map(t.path) === t.path) return t;
            changed = true;
            const to = map(t.path);
            return { ...t, path: to, name: t.name === trackName(t.path) ? trackName(to) : t.name };
        });
        const next = { ...vinyl, playlist, current: map(vinyl.current), coverPath: map(vinyl.coverPath) };
        if (!Array.isArray(vinyl.playlist)) delete next.playlist;
        if (!('current' in vinyl)) delete next.current;
        if (!('coverPath' in vinyl)) delete next.coverPath;
        if (changed || next.current !== vinyl.current || next.coverPath !== vinyl.coverPath) partial.vinyl = next;
    }

    const overlay = c.videoOverlay;
    if (overlay && map(overlay.customPath) !== overlay.customPath) {
        const to = map(overlay.customPath);
        const renamed = overlay.customName === path.basename(overlay.customPath);
        partial.videoOverlay = { ...overlay, customPath: to, customName: renamed ? path.basename(to) : overlay.customName };
    }

    return Object.keys(partial).length ? partial : null;
}

/**
 * 手动接上一个文件后，同一个旧文件夹里其它找不到的文件按相对位置到新文件夹里找。
 * @param {{from: string, to: string, missing: string[], exists: (p: string) => boolean}} args
 * @returns {Array<{from: string, to: string}>} 第一项永远是用户选的那个
 */
function relinkMoves({ from, to, missing, exists }) {
    const moves = [{ from, to }];
    const oldDir = path.dirname(from).toLowerCase().replace(/\//g, '\\');
    const newDir = path.dirname(to);
    for (const p of list(missing)) {
        if (samePath(p, from) || moves.some((m) => samePath(m.from, p))) continue;
        const normalized = String(p).replace(/\//g, '\\');
        if (!normalized.toLowerCase().startsWith(oldDir + '\\')) continue;
        const candidate = path.join(newDir, normalized.slice(oldDir.length + 1));
        if (fileKind(candidate) && fileKind(candidate) === fileKind(p) && exists(candidate)) moves.push({ from: p, to: candidate });
    }
    return moves;
}

module.exports = {
    IMAGE_EXTENSIONS,
    VIDEO_EXTENSIONS,
    AUDIO_EXTENSIONS,
    fileKind,
    collectPaths,
    replacePaths,
    relinkMoves,
};
