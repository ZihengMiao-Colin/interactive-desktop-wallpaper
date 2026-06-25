/**
 * ============================================================================
 * preload.js — Electron 预加载脚本（IPC 桥接层）
 * ============================================================================
 *
 * 在渲染进程加载前执行，安全地暴露有限的 Node.js/Electron API 给前端。
 *
 * 安全原则：
 *   - contextIsolation: true → 渲染进程无法直接访问 Node.js
 *   - 通过 contextBridge.exposeInMainWorld 暴露白名单 API
 *   - 所有通信走 ipcRenderer.invoke / ipcRenderer.on
 * ============================================================================
 */

const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');

/**
 * 暴露到渲染进程 window.electronAPI 的安全 API。
 */
contextBridge.exposeInMainWorld('electronAPI', {

    // ==================== 图片选择 ====================

    /** 打开系统文件对话框，选择壁纸图片 */
    selectImage: () => ipcRenderer.invoke('dialog:selectImage'),

    // ==================== 深度图缓存 ====================

    /** 保存生成的深度图到本地缓存 */
    saveDepthCache: (imagePath, depthDataUrl) =>
        ipcRenderer.invoke('cache:saveDepthMap', { imagePath, depthDataUrl }),

    /** 读取缓存的深度图 */
    getDepthCache: (imagePath) =>
        ipcRenderer.invoke('cache:getDepthMap', imagePath),

    // ==================== 应用配置 ====================

    /** 保存配置到本地 */
    saveConfig: (config) => ipcRenderer.invoke('config:save', config),

    /** 读取本地配置 */
    getConfig: () => ipcRenderer.invoke('config:get'),

    /** 切换开机自启 */
    toggleAutoLaunch: (enabled) => ipcRenderer.invoke('app:toggleAutoLaunch', enabled),

    /** 获取开机自启状态 */
    getAutoLaunch: () => ipcRenderer.invoke('app:getAutoLaunch'),

    // ==================== 应用控制 ====================

    /** 打开设置窗口 */
    openSettings: () => ipcRenderer.invoke('app:openSettings'),

    /** 退出应用 */
    quitApp: () => ipcRenderer.send('app:quit'),

    // ==================== 渲染控制事件（主进程 → 渲染进程） ====================

    /**
     * 监听来自主进程的控制信号。
     *
     * 用法：
     *   window.electronAPI.onPauseRender(callback)
     *   window.electronAPI.onResumeRender(callback)
     *   window.electronAPI.onNewImage(callback)
     *   window.electronAPI.onLoadConfig(callback)
     *
     * 返回 unsubscribe 函数用于取消监听。
     */
    onPauseRender: (callback) => {
        const handler = () => callback();
        ipcRenderer.on('renderer:pause', handler);
        return () => ipcRenderer.removeListener('renderer:pause', handler);
    },

    onResumeRender: (callback) => {
        const handler = () => callback();
        ipcRenderer.on('renderer:resume', handler);
        return () => ipcRenderer.removeListener('renderer:resume', handler);
    },

    onNewImage: (callback) => {
        const handler = (_event, imagePath) => callback(imagePath);
        ipcRenderer.on('image:new', handler);
        return () => ipcRenderer.removeListener('image:new', handler);
    },

    onLoadConfig: (callback) => {
        const handler = (_event, config) => callback(config);
        ipcRenderer.on('config:load', handler);
        return () => ipcRenderer.removeListener('config:load', handler);
    },

    /**
     * 监听全局鼠标位置（主进程轮询 → 渲染进程）。
     * 回调参数: { x: number, y: number } — 相对于主显示器的坐标
     */
    onMouseMove: (callback) => {
        const handler = (_event, pos) => callback(pos);
        ipcRenderer.on('mouse:move', handler);
        return () => ipcRenderer.removeListener('mouse:move', handler);
    },

    /** 通知主进程渲染器已就绪 */
    notifyReady: () => ipcRenderer.send('renderer:ready'),

    /** 通知主进程深度图已生成 */
    notifyDepthGenerated: (imagePath, depthDataUrl) =>
        ipcRenderer.send('renderer:depthGenerated', { imagePath, depthDataUrl }),

    // ==================== 工具函数 ====================

    /** 读取文件为 Base64 Data URL */
    readFileAsDataURL: (filePath) => {
        try {
            const ext = path.extname(filePath).toLowerCase().slice(1);
            const mimeMap = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp' };
            const mime = mimeMap[ext] || 'image/png';
            const data = fs.readFileSync(filePath);
            const base64 = data.toString('base64');
            return `data:${mime};base64,${base64}`;
        } catch (err) {
            console.error('[Preload] 读取文件失败:', err);
            return null;
        }
    },

    /** 保存 Base64 Data URL 为本地文件 */
    saveDataURLAsFile: (dataUrl, filePath) => {
        try {
            const matches = dataUrl.match(/^data:.+;base64,(.+)$/);
            if (!matches) throw new Error('Invalid data URL');
            const buffer = Buffer.from(matches[1], 'base64');
            fs.writeFileSync(filePath, buffer);
            return true;
        } catch (err) {
            console.error('[Preload] 保存文件失败:', err);
            return false;
        }
    },

    /** 获取用户数据目录 */
    getUserDataPath: () => {
        const { app } = require('electron');
        return app.getPath('userData');
    },

    /** 检查文件是否存在 */
    fileExists: (filePath) => {
        try {
            return fs.existsSync(filePath);
        } catch {
            return false;
        }
    },

    /** 获取当前平台信息 */
    platform: process.platform,
    isWindows: process.platform === 'win32',
});
