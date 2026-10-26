/**
 * ============================================================================
 * store.js — 数据持久化与缓存模块
 * ============================================================================
 *
 * 功能：
 *   - 缓存生成的深度图（以 Base64 存储到本地 JSON 文件）
 *   - 持久化应用配置（视差强度、平滑度、开机自启等）
 *   - 图片路径 → 深度图的映射关系
 *
 * 存储结构：
 *   wallpapers/
 *   └── cache.json        # 深度图缓存索引 + 配置
 *   └── depth_maps/       # 深度图图片文件（如果存为文件）
 *
 * 使用 electron-store 做键值存储，对大体积的深度图使用单独的文件。
 * ============================================================================
 */

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

class AppStore {

    constructor() {
        // 用户数据目录: %APPDATA%/interactive-desktop-wallpaper/
        this._userDataPath = app.getPath('userData');
        this._configPath = path.join(this._userDataPath, 'config.json');
        this._cacheIndexPath = path.join(this._userDataPath, 'cache_index.json');

        // 加载配置
        this._config = this._loadJSON(this._configPath, this._defaultConfig());

        // 深度图存放目录：优先使用用户自定义目录，默认保存在 userData/depth_cache
        this._defaultCacheDir = path.join(this._userDataPath, 'depth_cache');
        this._cacheDir = this._config.depthCacheDir || this._defaultCacheDir;

        // 确保目录存在
        if (!fs.existsSync(this._cacheDir)) {
            try {
                fs.mkdirSync(this._cacheDir, { recursive: true });
            } catch (err) {
                console.error('[Store] 创建深度图缓存目录失败，回退到默认目录:', err);
                this._cacheDir = this._defaultCacheDir;
                if (!fs.existsSync(this._cacheDir)) {
                    fs.mkdirSync(this._cacheDir, { recursive: true });
                }
            }
        }

        // 加载缓存索引
        this._cacheIndex = this._loadJSON(this._cacheIndexPath, {});

        console.log('[Store] Data dir:', this._userDataPath);
        console.log('[Store] Depth cache dir:', this._cacheDir);
    }

    // ==================== 深度图存储位置管理 ====================

    /**
     * 获取当前深度图存放文件夹路径。
     * @returns {string}
     */
    getDepthCacheDir() {
        return this._cacheDir;
    }

    /**
     * 更改深度图存放位置，并可选择是否迁移已有深度图文件。
     *
     * @param {string} newDir - 新文件夹路径
     * @param {boolean} [moveExisting=true] - 是否将现有深度图迁移到新目录
     * @returns {{success: boolean, path?: string, movedCount?: number, error?: string}}
     */
    setDepthCacheDir(newDir, moveExisting = true) {
        try {
            if (!newDir || typeof newDir !== 'string') {
                return { success: false, error: '无效的目标文件夹路径' };
            }

            const normalizedNewDir = path.resolve(newDir);
            const oldDir = path.resolve(this._cacheDir);

            if (normalizedNewDir === oldDir) {
                return { success: true, path: normalizedNewDir, movedCount: 0 };
            }

            // 确保新目录存在
            if (!fs.existsSync(normalizedNewDir)) {
                fs.mkdirSync(normalizedNewDir, { recursive: true });
            }

            let movedCount = 0;
            // 迁移已有深度图文件
            if (moveExisting && fs.existsSync(oldDir)) {
                const files = fs.readdirSync(oldDir);
                for (const file of files) {
                    if (file.toLowerCase().endsWith('.png')) {
                        const oldFile = path.join(oldDir, file);
                        const newFile = path.join(normalizedNewDir, file);
                        try {
                            fs.copyFileSync(oldFile, newFile);
                            try { fs.unlinkSync(oldFile); } catch (_) {}
                            movedCount++;
                        } catch (copyErr) {
                            console.warn(`[Store] 迁移文件 ${file} 失败:`, copyErr.message);
                        }
                    }
                }
            }

            // 更新缓存索引里的绝对路径
            for (const key of Object.keys(this._cacheIndex)) {
                const entry = this._cacheIndex[key];
                if (entry && entry.depthFile) {
                    const fileName = path.basename(entry.depthFile);
                    entry.depthFile = path.join(normalizedNewDir, fileName);
                }
            }

            this._cacheDir = normalizedNewDir;
            this.saveConfig({ depthCacheDir: normalizedNewDir });
            this._saveJSON(this._cacheIndexPath, this._cacheIndex);

            console.log(`[Store] 深度图存储位置已更新: ${normalizedNewDir} (迁移了 ${movedCount} 个文件)`);
            return { success: true, path: normalizedNewDir, movedCount };
        } catch (err) {
            console.error('[Store] 变更深度图存放位置失败:', err);
            return { success: false, error: err.message };
        }
    }

    // ==================== 配置管理 ====================

    /**
     * 获取当前完整配置（自动补齐默认值）。
     */
    getConfig() {
        const defaults = this._defaultConfig();
        return {
            ...defaults,
            ...this._config,
            vinyl: { ...defaults.vinyl, ...(this._config.vinyl || {}) },
            weather: { ...defaults.weather, ...(this._config.weather || {}) },
            sticker: { ...defaults.sticker, ...(this._config.sticker || {}) },
            videoOverlay: { ...defaults.videoOverlay, ...(this._config.videoOverlay || {}) },
        };
    }

    /**
     * 保存配置（支持部分深度更新）。
     * @param {Object} partial - 要更新的配置字段
     */
    saveConfig(partial) {
        if (!partial) return;
        const current = this.getConfig();
        this._config = {
            ...current,
            ...partial,
            vinyl: partial.vinyl ? { ...current.vinyl, ...partial.vinyl } : current.vinyl,
            weather: partial.weather ? { ...current.weather, ...partial.weather } : current.weather,
            sticker: partial.sticker ? { ...current.sticker, ...partial.sticker } : current.sticker,
            videoOverlay: partial.videoOverlay ? { ...current.videoOverlay, ...partial.videoOverlay } : current.videoOverlay,
        };
        this._saveJSON(this._configPath, this._config);
    }

    // ==================== 深度图缓存 ====================

    /**
     * 保存深度图缓存。
     *
     * @param {string} imagePath - 原始壁纸图片路径
     * @param {string} depthDataUrl - 深度图 Base64 Data URL
     * @returns {boolean} 是否保存成功
     */
    saveDepthCache(imagePath, depthDataUrl) {
        try {
            // 用原图路径的 hash 作为缓存 key（避免路径中的特殊字符问题）
            const cacheKey = this._hashPath(imagePath);

            // 将 Base64 Data URL 转为 PNG 文件存储
            const depthFile = path.join(this._cacheDir, `${cacheKey}.png`);

            // 解析 Data URL
            const matches = depthDataUrl.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/);
            if (matches) {
                const buffer = Buffer.from(matches[2], 'base64');
                fs.writeFileSync(depthFile, buffer);
            } else {
                // 可能已经是纯 Base64
                const buffer = Buffer.from(depthDataUrl, 'base64');
                fs.writeFileSync(depthFile, buffer);
            }

            // 更新缓存索引
            this._cacheIndex[cacheKey] = {
                imagePath: imagePath,
                depthFile: depthFile,
                cachedAt: new Date().toISOString(),
                imageSize: fs.statSync(imagePath).size,
            };

            this._saveJSON(this._cacheIndexPath, this._cacheIndex);
            console.log('[Store] Depth cached:', cacheKey);
            return true;
        } catch (err) {
            console.error('[Store] Save depth cache failed:', err.message);
            return false;
        }
    }

    /**
     * 读取缓存的深度图。
     *
     * @param {string} imagePath - 原始壁纸图片路径
     * @returns {string|null} 深度图 Data URL，未命中则返回 null
     */
    getDepthCache(imagePath) {
        try {
            const cacheKey = this._hashPath(imagePath);
            const entry = this._cacheIndex[cacheKey];

            if (!entry || !fs.existsSync(entry.depthFile)) {
                return null;
            }

            // 验证原图是否被修改（通过文件大小快速判断）
            if (fs.existsSync(imagePath)) {
                const currentSize = fs.statSync(imagePath).size;
                if (currentSize !== entry.imageSize) {
                    console.log('[Store] Image changed, cache invalidated');
                    this._invalidateCache(cacheKey);
                    return null;
                }
            }

            // 读取深度图文件并转为 Data URL
            const buffer = fs.readFileSync(entry.depthFile);
            const base64 = buffer.toString('base64');
            console.log('[Store] Depth cache hit:', cacheKey);
            return `data:image/png;base64,${base64}`;
        } catch (err) {
            console.error('[Store] Read depth cache failed:', err.message);
            return null;
        }
    }

    /**
     * 检查是否有某个图片的深度图缓存。
     * @param {string} imagePath
     * @returns {boolean}
     */
    hasDepthCache(imagePath) {
        const cacheKey = this._hashPath(imagePath);
        const entry = this._cacheIndex[cacheKey];
        return !!(entry && fs.existsSync(entry.depthFile));
    }

    /**
     * 清理所有深度图缓存。
     */
    clearAllCache() {
        try {
            // 删除所有缓存文件
            const files = fs.readdirSync(this._cacheDir);
            for (const file of files) {
                fs.unlinkSync(path.join(this._cacheDir, file));
            }

            // 清空索引
            this._cacheIndex = {};
            this._saveJSON(this._cacheIndexPath, this._cacheIndex);
            console.log('[Store] All caches cleared');
        } catch (err) {
            console.error('[Store] Clear cache failed:', err.message);
        }
    }

    // ==================== 工具方法 ====================

    getStorePath() {
        return this._userDataPath;
    }

    // ==================== 内部方法 ====================

    _defaultConfig() {
        return {
            parallaxMultiplier: 20,
            smoothness: 0.08,
            focusDepth: 0.50,
            blurRadius: 8,
            autoLaunch: false,
            currentImage: '',
            depthCacheDir: '',
            hideDebugPanel: true,      // 打包后默认隐藏调试面板
            // 1. 黑胶唱片机组件
            vinyl: {
                enabled: false,             // 是否开启唱片机
                position: 'bottom-right',   // 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
                scale: 1.0,                 // 缩放大小 0.7 ~ 1.3
                volume: 0.6,                // 音量 0.0 ~ 1.0
                playing: false,             // 是否正在播放
                loop: true,                 // 循环播放
                audioPath: '',              // 本地音频文件路径
                audioName: '',              // 音频文件名
                coverPath: '',              // 唱片中心封面图片路径
            },
            // 2. 天气粒子特效
            weather: {
                type: 'none',               // 'none' | 'rain' | 'snow' | 'sakura' | 'leaves' | 'sunlight'
                density: 'medium',          // 'low' | 'medium' | 'high'
                speed: 1.0,                 // 速度倍率 0.5 ~ 2.0
                parallax: true,             // 是否随鼠标视差位移
            },
            // 3. 本地贴纸/挂件
            sticker: {
                enabled: false,             // 是否开启自定义贴纸
                imagePath: '',              // 本地贴纸图片路径
                positionX: 85,              // 屏幕 X 百分比 0 ~ 100
                positionY: 20,              // 屏幕 Y 百分比 0 ~ 100
                size: 180,                  // 尺寸像素 60 ~ 500
                opacity: 0.9,               // 透明度 0.1 ~ 1.0
                depth: 0.7,                 // 视差深度层级 0.0 (远景) ~ 1.0 (近景)
            },
            // 4. 视频特效覆盖层（支持滤色/绿幕抠图）
            videoOverlay: {
                enabled: false,             // 是否开启视频覆盖特效
                presetId: 'snow2',          // 预设 ID: 'rain1' | 'rain2' | 'snow1' | 'snow2' | 'snow3' | 'old1' | 'old2' | 'old3' | 'custom'
                customPath: '',             // 本地导入视频文件路径
                customName: '',             // 本地导入视频文件名
                blendMode: 'auto',          // 混合模式: 'auto' | 'screen' | 'chroma'
                opacity: 0.85,              // 不透明度 0.1 ~ 1.0
                speed: 1.0,                 // 播放速度 0.5 ~ 2.0
            },
        };
    }

    _loadJSON(filePath, defaultValue) {
        try {
            if (fs.existsSync(filePath)) {
                const raw = fs.readFileSync(filePath, 'utf-8');
                return JSON.parse(raw);
            }
        } catch (err) {
            console.error(`[Store] Read JSON failed (${filePath}):`, err.message);
        }
        return defaultValue;
    }

    _saveJSON(filePath, data) {
        try {
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
        } catch (err) {
            console.error(`[Store] Write JSON failed (${filePath}):`, err.message);
        }
    }

    /**
     * 将文件路径 hash 为安全的缓存 key。
     */
    _hashPath(filePath) {
        let hash = 0;
        const str = path.resolve(filePath).toLowerCase();
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0; // 32-bit int
        }
        return 'depth_' + Math.abs(hash).toString(16);
    }

    /**
     * 失效某个缓存条目。
     */
    _invalidateCache(cacheKey) {
        const entry = this._cacheIndex[cacheKey];
        if (entry && fs.existsSync(entry.depthFile)) {
            try { fs.unlinkSync(entry.depthFile); } catch {}
        }
        delete this._cacheIndex[cacheKey];
        this._saveJSON(this._cacheIndexPath, this._cacheIndex);
    }
}

module.exports = { AppStore };
