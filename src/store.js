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
        this._cacheDir = path.join(this._userDataPath, 'depth_cache');
        this._configPath = path.join(this._userDataPath, 'config.json');
        this._cacheIndexPath = path.join(this._userDataPath, 'cache_index.json');

        // 确保目录存在
        if (!fs.existsSync(this._cacheDir)) {
            fs.mkdirSync(this._cacheDir, { recursive: true });
        }

        // 加载缓存索引
        this._cacheIndex = this._loadJSON(this._cacheIndexPath, {});

        // 加载配置
        this._config = this._loadJSON(this._configPath, this._defaultConfig());

        console.log('[Store] Data dir:', this._userDataPath);
    }

    // ==================== 配置管理 ====================

    /**
     * 获取当前完整配置。
     */
    getConfig() {
        return { ...this._config };
    }

    /**
     * 保存配置（部分更新）。
     * @param {Object} partial - 要更新的配置字段
     */
    saveConfig(partial) {
        this._config = { ...this._config, ...partial };
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
            parallaxMultiplier: 30,
            smoothness: 0.08,
            autoLaunch: false,
            currentImage: '',
            hideDebugPanel: true,      // 打包后默认隐藏调试面板
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
