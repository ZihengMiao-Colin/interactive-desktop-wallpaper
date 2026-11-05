/**
 * preload.js — 解锁动画全屏窗口的 preload，只暴露上报事件和"开始播放"
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('unlockPlayer', {
    /** 上报 'ready' | 'near-end' | 'skip' | 'error' */
    report: (name) => ipcRenderer.send('unlock:player-event', name),
    /** 主进程通知开始播放 */
    onStart: (callback) => ipcRenderer.on('unlock:start', () => callback()),
    /** 主进程开始淡出窗口，带淡出时长（毫秒） */
    onFadeOut: (callback) => ipcRenderer.on('unlock:fade-out', (_event, ms) => callback(ms)),
});
