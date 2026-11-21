/**
 * paths.js — 配置里用户文件路径的纯逻辑（文件挪走后自动找回 / 手动接上用）
 *
 * 只记路径、会因为用户挪动或改名而失效的字段：
 *   myWallpapers[].path、currentImage、currentImageCrop.path、currentVideo.path、currentVideo.imageAtTime、
 *   vinyl.playlist[].path、vinyl.playlist[].cover（自选封面）、vinyl.current、videoOverlay.customPath
 * 元素和解锁动画导入时复制到了数据目录，不在这里。
 *
 * 设计文档写的是放 shared/，但只有主进程用，还要用 Node 的 path.win32，所以放这里。
 */

'use strict';

const path = require('path').win32;
const { samePath, wallpaperType } = require('../../shared/my-wallpapers');
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

const extOf = (p) => path.extname(String(p || '')).slice(1).toLowerCase();

/**
 * 两个文件是不是同一类，找回 / 接上时用：类型要一样，壁纸能不能用也要一样
 * （「我的壁纸」不支持 gif，壁纸被接到 gif 上的话那一格会被当成坏数据去掉）。
 * 列表外的扩展名（歌单、视频特效的对话框能选任何文件，比如 .opus）扩展名一样就算同一类；没有扩展名的不算。
 */
function sameKind(a, b) {
    const kindOf = (p) => fileKind(p) || (extOf(p) ? 'ext:' + extOf(p) : null);
    const kind = kindOf(a);
    return !!kind && kind === kindOf(b) && wallpaperType(a) === wallpaperType(b);
}

/** 文件夹的 key：小写、斜杠统一，结尾正好一个 \（盘符根目录 F:\ 本来就带） */
function folderKey(dir) {
    const key = String(dir || '').toLowerCase().replace(/\//g, '\\');
    return key.endsWith('\\') ? key : key + '\\';
}

/** 路径在不在这个文件夹（含子文件夹）下面，不分大小写和斜杠方向 */
function inFolder(filePath, dir) {
    return String(filePath || '').toLowerCase().replace(/\//g, '\\').startsWith(folderKey(dir));
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
        ...list(vinyl.playlist).flatMap((t) => (t ? [t.path, t.cover] : [])),
        vinyl.current,
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
            if (!t || (map(t.path) === t.path && map(t.cover) === t.cover)) return t;
            changed = true;
            const to = map(t.path);
            const track = { ...t, path: to, name: t.name === trackName(t.path) ? trackName(to) : t.name };
            if ('cover' in t) track.cover = map(t.cover);
            return track;
        });
        const next = { ...vinyl, playlist, current: map(vinyl.current) };
        if (!Array.isArray(vinyl.playlist)) delete next.playlist;
        if (!('current' in vinyl)) delete next.current;
        if (changed || next.current !== vinyl.current) partial.vinyl = next;
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
    const oldDir = path.dirname(from);
    const prefixLength = folderKey(oldDir).length;
    const newDir = path.dirname(to);
    for (const p of list(missing)) {
        if (samePath(p, from) || moves.some((m) => samePath(m.from, p))) continue;
        if (!inFolder(p, oldDir)) continue;
        const candidate = path.join(newDir, String(p).replace(/\//g, '\\').slice(prefixLength));
        if (sameKind(p, candidate) && exists(candidate)) moves.push({ from: p, to: candidate });
    }
    return moves;
}

module.exports = {
    IMAGE_EXTENSIONS,
    VIDEO_EXTENSIONS,
    AUDIO_EXTENSIONS,
    fileKind,
    sameKind,
    inFolder,
    collectPaths,
    replacePaths,
    relinkMoves,
};
