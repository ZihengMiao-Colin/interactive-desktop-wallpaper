/**
 * file-tracking — 用户导入的文件被挪走、改名后自动接上（主进程）
 *
 * 「我的壁纸」、歌单和封面、视频特效里自己的视频只记路径。这里记住每个文件的 NTFS 编号，
 * 启动时、设置窗口获得焦点时、每 60 秒检查一次：文件不在原来的位置就按编号找回，
 * 把配置里所有引用、深度图缓存一起换成新路径，再通知两个窗口（files:relocated）和广播配置。
 * 自动找不回的（挪到别的盘、U 盘、扔进回收站、更新前就丢了的）由用户在设置页手动接上（files:relink），
 * 原来同一个文件夹里其它找不到的按相对位置顺带接上。
 *
 * 设计见 docs/superpowers/specs/2026-11-20-file-relocation-design.md。
 */

'use strict';

const fs = require('fs');
const path = require('path').win32;
const { FileTracker } = require('./tracker');
const { fileKind, sameKind, collectPaths, replacePaths, relinkMoves } = require('./paths');
const { findEntry, resolveCurrent, samePath } = require('../../shared/my-wallpapers');

const SCAN_INTERVAL_MS = 60 * 1000;
/** 配置改动后隔多久给新加的文件记编号（拖滑块时配置一秒存好几次，不用每次都查） */
const RECORD_DELAY_MS = 2000;

const keyOf = (p) => String(p || '').toLowerCase().replace(/\//g, '\\');

async function exists(p) {
    try {
        await fs.promises.access(p);
        return true;
    } catch {
        return false;
    }
}

/**
 * @param {{
 *   store: import('../store').AppStore,
 *   dataFile: string,                                   // userData/file_ids.json
 *   shouldTrack: (p: string) => boolean,                // 网络路径、软件自己的文件返回 false
 *   sendToWindows: (channel: string, payload: any) => void,
 *   broadcastConfig: () => void,
 *   applyWallpaper: (descriptor: object) => void,
 *   showRelinkDialog: (args: {fromPath: string, kind: string}) => Promise<string|null>,
 *   log?: (msg: string) => void,
 *   tracker?: FileTracker,
 * }} deps
 */
function createFileTracking({
    store, dataFile, shouldTrack, sendToWindows, broadcastConfig, applyWallpaper, showRelinkDialog,
    log = console.log, tracker = new FileTracker({ dataFile, shouldTrack }),
}) {
    let scanning = null;
    let interval = null;
    let recordTimer = null;

    /**
     * 把配置里的旧路径换成新路径（对处理这一刻的最新配置做：异步检查期间配置可能被改过），
     * 深度图缓存、编号记录跟着换，先通知窗口换掉自己记着的路径，再广播配置。
     * @returns {boolean} 配置里有这些路径、真的换了
     */
    function applyMoves(moves) {
        const partial = replacePaths(store.getConfig(), moves);
        if (!partial) return false;
        store.saveConfig(partial);
        for (const { from, to } of moves) store.moveDepthCache(from, to);
        tracker.rename(moves);
        // 顺序要紧：窗口先换掉记着的路径，收到新配置时才不会当成换了一首歌 / 一个视频重新加载
        sendToWindows('files:relocated', moves);
        broadcastConfig();
        for (const { from, to } of moves) log(`[FileTracking] 找回: ${from} → ${to}`);
        return true;
    }

    /** 检查配置里的文件：挪走了的按编号找回，还在的补记编号。同一时间只跑一个 */
    function scan() {
        if (scanning) return scanning;
        scanning = (async () => {
            try {
                const moves = await tracker.findMoves(collectPaths(store.getConfig()));
                if (moves.length) applyMoves(moves);
                await tracker.record(collectPaths(store.getConfig()));
            } catch (err) {
                console.error('[FileTracking] 检查文件失败:', err);
            } finally {
                scanning = null;
            }
        })();
        return scanning;
    }

    /**
     * 找一个文件现在在哪（唱片机放一首歌失败时问）：还在原处返回原路径，找回了返回新路径并换掉配置，找不到返回 null。
     */
    async function locate(filePath) {
        try {
            if (typeof filePath !== 'string' || !filePath || !shouldTrack(filePath)) return null;
            if (await exists(filePath)) return filePath;
            const to = tracker.locate(filePath);
            if (!to) return null;
            applyMoves([{ from: filePath, to }]);
            return to;
        } catch (err) {
            console.error('[FileTracking] 找文件失败:', err);
            return null;
        }
    }

    /**
     * 用户手动接上一个找不到的文件：弹对话框选它现在的位置，原来同一个文件夹里其它找不到的顺带接上。
     * @returns {Promise<{to: string, count: number} | {canceled: true} | {error: string}>}
     */
    async function relink(fromPath) {
        const kind = fileKind(fromPath);
        if (!kind) return { error: '不支持的文件类型' };
        const picked = await showRelinkDialog({ fromPath, kind });
        if (!picked) return { canceled: true };
        if (!sameKind(fromPath, picked)) return { error: '要选同一种文件' };

        const config = store.getConfig();
        if (findEntry(config.myWallpapers, fromPath) && !samePath(fromPath, picked) && findEntry(config.myWallpapers, picked)) {
            return { error: '这个文件已经在「我的壁纸」里了' };
        }

        // 只看原来同一个文件夹下面的：别处的路径可能在网络盘上，没必要去碰
        const oldDir = keyOf(path.dirname(fromPath)) + '\\';
        const missing = [];
        for (const p of collectPaths(config)) {
            if (!keyOf(p).startsWith(oldDir)) continue;
            if (samePath(p, fromPath) || !(await exists(p))) missing.push(p);
        }
        const moves = relinkMoves({ from: fromPath, to: picked, missing, exists: (p) => fs.existsSync(p) });

        const current = resolveCurrent(config);
        applyMoves(moves);
        // 桌面上正在用的壁纸找不到时退回了自带的图，接上后马上换回来
        if (current && moves.some((m) => samePath(m.from, current.path))) {
            applyWallpaper(resolveCurrent(store.getConfig()));
        }
        await tracker.record(collectPaths(store.getConfig()));
        return { to: picked, count: moves.length };
    }

    /** 配置改了：过一会儿给新加的文件记编号（导入后马上被挪走也能找回） */
    function noteConfigChanged() {
        if (recordTimer) clearTimeout(recordTimer);
        recordTimer = setTimeout(() => {
            recordTimer = null;
            tracker.record(collectPaths(store.getConfig()))
                .catch((err) => console.error('[FileTracking] 记录文件编号失败:', err));
        }, RECORD_DELAY_MS);
        if (recordTimer.unref) recordTimer.unref();
    }

    function start() {
        if (interval) return;
        interval = setInterval(scan, SCAN_INTERVAL_MS);
        if (interval.unref) interval.unref();
    }

    function stop() {
        if (interval) clearInterval(interval);
        if (recordTimer) clearTimeout(recordTimer);
        interval = null;
        recordTimer = null;
    }

    function registerIpc(ipcMain) {
        ipcMain.handle('files:locate', (_event, filePath) => locate(filePath));
        ipcMain.handle('files:relink', (_event, fromPath) => relink(fromPath));
    }

    return { scan, applyMoves, locate, relink, noteConfigChanged, start, stop, registerIpc };
}

module.exports = { createFileTracking };
