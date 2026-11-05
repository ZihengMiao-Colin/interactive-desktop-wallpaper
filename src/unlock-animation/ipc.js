/**
 * ipc.js — 解锁动画的 IPC（主进程）
 *
 * 淡入淡出、声音、开关这些普通字段走现有的 config:save，这里只管要动文件的操作、预览和播放页面的事件。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { VIDEO_EXTENSIONS } = require('../../shared/my-wallpapers');
const { saveThumbnail, toFileUrl } = require('../elements/library');
const { importVideo, removeFiles } = require('./files');

/**
 * @param {object} deps
 * @param {import('electron').IpcMain} deps.ipcMain
 * @param {import('electron').Dialog} deps.dialog
 * @param {import('../store').AppStore} deps.store
 * @param {() => import('electron').BrowserWindow} deps.getDialogParent
 * @param {() => void} deps.broadcastConfig
 * @param {import('./controller').UnlockAnimationController} deps.controller
 */
function registerUnlockIpc({ ipcMain, dialog, store, getDialogParent, broadcastConfig, controller }) {
    const current = () => store.getConfig().unlockAnimation;

    ipcMain.handle('unlock:selectVideo', async () => {
        const result = await dialog.showOpenDialog(getDialogParent(), {
            title: '选择解锁动画的视频',
            filters: [{ name: '视频', extensions: VIDEO_EXTENSIONS }],
            properties: ['openFile'],
        });
        if (result.canceled || result.filePaths.length === 0) return { canceled: true };
        const [filePath] = result.filePaths;
        return { path: filePath, url: toFileUrl(filePath), name: path.basename(filePath) };
    });

    ipcMain.handle('unlock:setVideo', async (_event, { path: srcPath, thumbDataUrl, duration }) => {
        const dir = store.getUnlockAnimationDir();
        const previous = current();
        const id = 'video_' + randomUUID();
        try {
            const file = await importVideo(srcPath, dir, id);
            const thumb = path.basename(saveThumbnail(dir, id, thumbDataUrl));
            store.saveConfig({
                unlockAnimation: { enabled: true, file, name: path.basename(srcPath), thumb, duration },
            });
        } catch (err) {
            console.error('[UnlockAnimation] 导入视频失败:', err);
            if (err.message === 'UNSUPPORTED_FILE') return { error: '不支持这种文件格式，请选择视频' };
            return { error: '导入视频失败：' + err.message };
        }
        removeFiles(dir, [previous.file, previous.thumb]);
        broadcastConfig();
        return { config: store.getConfig() };
    });

    ipcMain.handle('unlock:remove', () => {
        const previous = current();
        store.saveConfig({ unlockAnimation: { enabled: false, file: '', name: '', thumb: '', duration: 0 } });
        removeFiles(store.getUnlockAnimationDir(), [previous.file, previous.thumb]);
        broadcastConfig();
        return { config: store.getConfig() };
    });

    ipcMain.handle('unlock:getInfo', () => {
        const { file, thumb } = current();
        const dir = store.getUnlockAnimationDir();
        const inDir = (name) => path.join(dir, name);
        return {
            exists: !!file && fs.existsSync(inDir(file)),
            thumbUrl: thumb && fs.existsSync(inDir(thumb)) ? toFileUrl(inDir(thumb)) : null,
        };
    });

    ipcMain.handle('unlock:preview', () => controller.preview());

    ipcMain.on('unlock:player-event', (event, name) => controller.handlePlayerEvent(event.sender, name));
}

module.exports = { registerUnlockIpc };
