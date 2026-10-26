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
const { toFileUrl } = require('./src/elements/library');

/**
 * 暴露到渲染进程 window.electronAPI 的安全 API。
 */
contextBridge.exposeInMainWorld('electronAPI', {

    // ==================== 图片与文件选择 ====================

    /** 打开系统文件对话框，选择壁纸图片 */
    selectImage: () => ipcRenderer.invoke('dialog:selectImage'),

    /** 打开系统文件对话框，选择本地音乐 */
    selectAudio: () => ipcRenderer.invoke('dialog:selectAudio'),

    /** 打开系统文件对话框，选择唱片中心封面 */
    selectCover: () => ipcRenderer.invoke('dialog:selectCover'),

    /** 打开系统文件对话框，选择本地贴纸图片 */
    selectSticker: () => ipcRenderer.invoke('dialog:selectSticker'),

    /** 打开系统文件对话框，选择本地视频特效 */
    selectOverlayVideo: () => ipcRenderer.invoke('dialog:selectOverlayVideo'),

    /** 获取内置视频特效列表 */
    getOverlayPresets: () => ipcRenderer.invoke('overlay:getPresets'),

    /** 读取本地文件为 Uint8Array 二进制数组 */
    readFileBuffer: (filePath) => {
        try {
            return fs.readFileSync(filePath);
        } catch (err) {
            console.error('[Preload] 读取文件 Buffer 失败:', err);
            return null;
        }
    },

    // ==================== 深度图生成 ====================

    /**
     * 调用 Python 脚本生成深度图。
     * @param {string} imagePath - 原始图片路径
     * @param {string} modelSize - 模型大小: "small" / "base" / "large"
     * @param {number} [blurRadius] - 边缘平滑高斯模糊半径（像素），0为不平滑，默认 8
     * @returns {Promise<{success: boolean, depthDataUrl?: string, error?: string}>}
     */
    generateDepthMap: (imagePath, modelSize, blurRadius) =>
        ipcRenderer.invoke('depth:generate', { imagePath, modelSize, blurRadius }),

    /**
     * 监听深度图生成进度。
     * @param {function} callback - 回调参数: { message: string }
     * @returns {function} 取消监听函数
     */
    onDepthProgress: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('depth:progress', handler);
        return () => ipcRenderer.removeListener('depth:progress', handler);
    },

    // ==================== 深度图缓存 ====================

    /** 保存生成的深度图到本地缓存 */
    saveDepthCache: (imagePath, depthDataUrl) =>
        ipcRenderer.invoke('cache:saveDepthMap', { imagePath, depthDataUrl }),

    /** 读取缓存的深度图 */
    getDepthCache: (imagePath) =>
        ipcRenderer.invoke('cache:getDepthMap', imagePath),

    /** 清除所有深度图缓存 */
    clearAllCache: () => ipcRenderer.invoke('cache:clearAll'),

    /** 获取深度图存放文件夹路径 */
    getDepthCacheDir: () => ipcRenderer.invoke('depth:getCacheDir'),

    /** 打开深度图存放文件夹（在系统文件资源管理器中定位） */
    openDepthCacheDir: () => ipcRenderer.invoke('depth:openCacheDir'),

    /** 更改深度图存放文件夹 */
    selectDepthCacheDir: () => ipcRenderer.invoke('depth:selectCacheDir'),

    // ==================== 壁纸应用 ====================

    /**
     * 通知主进程应用壁纸（发送 image:new 到壁纸窗口）。
     * @param {string} imagePath - 图片路径
     */
    applyWallpaper: (imagePath) => ipcRenderer.invoke('wallpaper:apply', imagePath),

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
        const handler = (_event, info) => callback(info || {});
        ipcRenderer.on('renderer:pause', handler);
        return () => ipcRenderer.removeListener('renderer:pause', handler);
    },

    onResumeRender: (callback) => {
        const handler = (_event, info) => callback(info || {});
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

    // ==================== 自定义元素 ====================

    elements: {
        /** 默认素材列表 */
        getBuiltin: () => ipcRenderer.invoke('elements:getBuiltin'),
        /** 打开文件对话框导入素材 → { asset } | { canceled: true } | { error } */
        importFile: () => ipcRenderer.invoke('elements:import'),
        /** 从素材库移除用户素材（连同壁纸上的实例） */
        removeAsset: (assetId) => ipcRenderer.invoke('elements:removeAsset', assetId),
        /** 保存缩略图（JPEG Data URL） */
        saveThumb: (assetId, dataUrl) => ipcRenderer.invoke('elements:saveThumb', assetId, dataUrl),
        /** 局部修改壁纸上的实例 */
        updateInstance: (instanceId, patch) => ipcRenderer.invoke('elements:updateInstance', instanceId, patch),
        /** 删除壁纸上的实例 */
        removeInstance: (instanceId) => ipcRenderer.invoke('elements:removeInstance', instanceId),
        /** 进入摆放模式：{ assetId } 新建，{ instanceId } 重新摆放 */
        startPlacement: (target) => ipcRenderer.invoke('elements:startPlacement', target),
    },

    /** 摆放窗口专用 */
    placement: {
        getDraft: () => ipcRenderer.invoke('placement:getDraft'),
        commit: (instance) => ipcRenderer.invoke('placement:commit', instance),
        cancel: () => ipcRenderer.invoke('placement:cancel'),
    },

    /** 本地路径 → file:// URL（正确转义中文、空格、#、%） */
    toFileUrl: (filePath) => toFileUrl(filePath),

    // ==================== 工具函数 ====================

    /** 读取文件为 Base64 Data URL */
    readFileAsDataURL: (filePath) => {
        try {
            const ext = path.extname(filePath).toLowerCase().slice(1);
            const mimeMap = {
                png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp', gif: 'image/gif',
                mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac'
            };
            const mime = mimeMap[ext] || 'application/octet-stream';
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
