/**
 * files.js — 解锁动画的视频文件（主进程）
 *
 * 视频复制一份到 userData/unlock_animation/：解锁时用户没法处理"文件在 U 盘上拔掉了"这种事。
 * 文件名用 ASCII，配置里只存文件名。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { VIDEO_EXTENSIONS } = require('../../shared/my-wallpapers');
const { fitFades } = require('../../shared/unlock-animation');
const { cleanupOrphanFiles } = require('../elements/library');

/**
 * 把视频异步复制进目录（视频可能很大，不能卡住主进程）。
 * @param {string} srcPath
 * @param {string} dir
 * @param {string} id - 文件名（不含扩展名）
 * @returns {Promise<string>} 文件名
 * @throws {Error} 扩展名不支持时 UNSUPPORTED_FILE
 */
async function importVideo(srcPath, dir, id) {
    const ext = path.extname(srcPath).slice(1).toLowerCase();
    if (!VIDEO_EXTENSIONS.includes(ext)) throw new Error('UNSUPPORTED_FILE');
    const file = `${id}.${ext}`;
    await fs.promises.copyFile(srcPath, path.join(dir, file));
    return file;
}

/** 删文件。删不掉（比如正被占用）不报错，下次启动时 cleanupUnlockFiles 再清 */
function removeFiles(dir, names) {
    for (const name of names) {
        if (!name) continue;
        try {
            fs.unlinkSync(path.join(dir, name));
        } catch (_) {
            // 留到下次
        }
    }
}

/**
 * 清掉目录里配置没引用的文件。
 * @returns {string[]} 删除的文件名
 */
function cleanupUnlockFiles(dir, config) {
    const inDir = (name) => (name ? path.join(dir, name) : null);
    return cleanupOrphanFiles(dir, [{ file: inDir(config.file), thumb: inDir(config.thumb) }]);
}

/**
 * 算出这次要放什么。
 * @param {object} config - unlockAnimation 配置
 * @param {string} dir
 * @param {{preview?: boolean}} [options] - 预览不看开关
 * @returns {{filePath: string, sound: boolean, fadeInMs: number, fadeOutMs: number, durationMs: number} | null}
 *   功能关着或文件不在时返回 null
 */
function resolvePlayback(config, dir, { preview = false } = {}) {
    if (!config.file || (!preview && !config.enabled)) return null;
    const filePath = path.join(dir, config.file);
    if (!fs.existsSync(filePath)) return null;
    const durationMs = Math.round(config.duration * 1000);
    return { filePath, sound: config.sound, ...fitFades(config.fadeInMs, config.fadeOutMs, durationMs), durationMs };
}

module.exports = { importVideo, removeFiles, cleanupUnlockFiles, resolvePlayback };
