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
const { emptyCustomElements, normalizeCustomElements } = require('../shared/elements-model');
const { normalizeVinyl } = require('../shared/playlist');

/** 需要按字段合并保存的嵌套配置项 */
const NESTED_KEYS = ['vinyl', 'weather', 'videoOverlay'];

/** 视差强度上限（设置页滑块 5 ~ 30）。旧版本最大能调到 100，读配置时压到上限 */
const PARALLAX_MAX = 30;

/**
 * 边缘平滑的旧默认值。视差改成光线步进后默认值改成 5；旧配置里还是 8 的当成没调过，读成新默认值。
 * 配置里没有 blurRadiusVersion 才这样换：保存时会带上它，之后用户自己调回 8 不会再被改。
 */
const LEGACY_BLUR_DEFAULT = 8;
const BLUR_RADIUS_VERSION = 2;

/**
 * 卸载清单：放在 userData 以外的深度图（用户换过存放位置时）。
 * 卸载时勾了"同时删除我的数据"，卸载程序按这份清单逐个删除（build/installer.nsh）。
 * UTF-16LE 带 BOM、CRLF 分行，方便 NSIS 读中文路径。
 */
const UNINSTALL_LIST_FILE = 'uninstall_extra_files.txt';

/**
 * 软件生成的深度图文件名：depth_<hash>.png（见 _hashPath）。
 * 深度图文件夹可能是用户选的、本来就有别的文件的文件夹，清除和搬家只碰这种文件。
 */
const DEPTH_FILE_RE = /^depth_[0-9a-f]+\.png$/i;

class AppStore {

    /**
     * @param {{userDataPath?: string}} [options] - 测试时传入临时目录；默认 %APPDATA%/interactive-desktop-wallpaper/
     */
    constructor({ userDataPath } = {}) {
        this._userDataPath = userDataPath || app.getPath('userData');
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
        // 旧版本没有卸载清单，打开时补上
        this._writeUninstallList();

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
            // 迁移已有深度图文件（只搬 depth_*.png，旧文件夹里用户自己的图片留在原处）
            if (moveExisting && fs.existsSync(oldDir)) {
                const files = fs.readdirSync(oldDir);
                for (const file of files) {
                    if (DEPTH_FILE_RE.test(file)) {
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
            this._saveCacheIndex();

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
        const config = {
            ...defaults,
            ...this._config,
            // 歌单字段由 normalizeVinyl 补齐（旧版本的单首歌 audioPath 在这里换成歌单）
            vinyl: normalizeVinyl({ ...defaults.vinyl, ...(this._config.vinyl || {}) }),
            weather: { ...defaults.weather, ...(this._config.weather || {}) },
            videoOverlay: { ...defaults.videoOverlay, ...(this._config.videoOverlay || {}) },
            customElements: normalizeCustomElements(this._config.customElements),
        };
        if (config.parallaxMultiplier > PARALLAX_MAX) config.parallaxMultiplier = PARALLAX_MAX;
        if (this._config.blurRadiusVersion !== BLUR_RADIUS_VERSION && config.blurRadius === LEGACY_BLUR_DEFAULT) {
            config.blurRadius = defaults.blurRadius;
        }
        return config;
    }

    /**
     * 保存配置（支持部分深度更新）。
     * @param {Object} partial - 要更新的配置字段
     */
    saveConfig(partial) {
        if (!partial) return;
        const current = this.getConfig();
        const next = { ...current, ...partial };
        for (const key of NESTED_KEYS) {
            if (partial[key]) next[key] = { ...(current[key] || {}), ...partial[key] };
        }
        // customElements 的 library / instances 是数组，给了哪个就整体替换哪个
        if (partial.customElements) {
            next.customElements = normalizeCustomElements({ ...current.customElements, ...partial.customElements });
        }
        this._config = next;
        this._saveJSON(this._configPath, this._config);
    }

    /**
     * 从配置里彻底删除某些键（例如迁移完成后的旧 sticker 配置）。
     * @param {string[]} keys
     */
    deleteConfigKeys(keys) {
        for (const key of keys) delete this._config[key];
        this._saveJSON(this._configPath, this._config);
    }

    /** 用户导入的自定义元素素材存放目录：userData/custom_elements（不存在就创建） */
    getElementsDir() {
        const dir = path.join(this._userDataPath, 'custom_elements');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        return dir;
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

            // 更新缓存索引：记下原图的大小和修改时间，用来判断原图之后有没有被换掉
            const stat = fs.statSync(imagePath);
            this._cacheIndex[cacheKey] = {
                imagePath: imagePath,
                depthFile: depthFile,
                cachedAt: new Date().toISOString(),
                imageSize: stat.size,
                imageMtimeMs: Math.round(stat.mtimeMs),
            };

            this._saveCacheIndex();
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
            const entry = this._validCacheEntry(imagePath);
            if (!entry) return null;
            const base64 = fs.readFileSync(entry.depthFile).toString('base64');
            return `data:image/png;base64,${base64}`;
        } catch (err) {
            console.error('[Store] Read depth cache failed:', err.message);
            return null;
        }
    }

    /**
     * 检查是否有某个图片的有效深度图缓存（规则与 getDepthCache 相同）。
     * @param {string} imagePath
     * @returns {boolean}
     */
    hasDepthCache(imagePath) {
        try {
            return !!this._validCacheEntry(imagePath);
        } catch (_) {
            return false;
        }
    }

    /**
     * 清理所有深度图缓存。只删软件生成的深度图（depth_*.png，包括索引里没有的旧文件），
     * 文件夹里用户自己的文件和子文件夹不动。
     */
    clearAllCache() {
        try {
            for (const file of fs.readdirSync(this._cacheDir)) {
                if (!DEPTH_FILE_RE.test(file)) continue;
                try {
                    fs.unlinkSync(path.join(this._cacheDir, file));
                } catch (err) {
                    console.warn(`[Store] 删除深度图 ${file} 失败:`, err.message);
                }
            }

            // 清空索引
            this._cacheIndex = {};
            this._saveCacheIndex();
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
            parallaxMultiplier: 10,
            smoothness: 0.08,
            focusDepth: 0.50,
            blurRadius: 5,
            blurRadiusVersion: BLUR_RADIUS_VERSION,
            autoLaunch: false,
            currentImage: '',
            depthCacheDir: '',
            hideDebugPanel: true,      // 打包后默认隐藏调试面板
            // 1. 黑胶唱片机组件
            vinyl: {
                enabled: false,             // 是否开启唱片机
                position: 'bottom-right',   // 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'custom'
                // x, y: position 为 'custom' 时唱盘中心在屏幕上的比例位置 0 ~ 1（在摆放窗口里拖出来的）
                scale: 1.0,                 // 缩放大小 0.5 ~ 2.0
                volume: 0.6,                // 音量 0.0 ~ 1.0
                playing: false,             // 是否正在播放
                coverPath: '',              // 唱片中心封面图片路径
                // 歌单 playlist / current / playMode 不写在默认值里：没有 playlist 才说明是旧配置，
                // 要把旧的 audioPath 换成歌单（shared/playlist.js 的 normalizeVinyl）
            },
            // 2. 天气粒子特效
            weather: {
                type: 'none',               // 'none' | 'rain' | 'snow' | 'sakura' | 'leaves' | 'sunlight'
                density: 'medium',          // 'low' | 'medium' | 'high'
                speed: 1.0,                 // 速度倍率 0.5 ~ 2.0
                parallax: true,             // 是否随鼠标视差位移
            },
            // 3. 视频特效覆盖层（支持滤色/绿幕抠图）
            videoOverlay: {
                enabled: false,             // 是否开启视频覆盖特效
                presetId: 'snow2',          // 预设 ID: 'rain1' | 'rain2' | 'snow1' | 'snow2' | 'snow3' | 'old1' | 'old2' | 'old3' | 'custom'
                customPath: '',             // 本地导入视频文件路径
                customName: '',             // 本地导入视频文件名
                blendMode: 'auto',          // 混合模式: 'auto' | 'screen' | 'chroma'
                opacity: 0.85,              // 不透明度 0.1 ~ 1.0
                speed: 1.0,                 // 播放速度 0.5 ~ 2.0
            },
            // 自定义元素（素材库 + 壁纸上的实例），结构见 shared/elements-model.js
            customElements: emptyCustomElements(),
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

    /** 保存缓存索引，同时更新卸载清单 */
    _saveCacheIndex() {
        this._saveJSON(this._cacheIndexPath, this._cacheIndex);
        this._writeUninstallList();
    }

    /**
     * 写卸载清单：列出放在 userData 以外的深度图（userData 整个文件夹卸载时会一起删，不用列）。
     * 一张都没有就删掉清单。
     */
    _writeUninstallList() {
        const listPath = path.join(this._userDataPath, UNINSTALL_LIST_FILE);
        const inside = path.resolve(this._userDataPath).toLowerCase() + path.sep;
        const files = Object.values(this._cacheIndex)
            .map(entry => entry && entry.depthFile)
            .filter(file => file && !path.resolve(file).toLowerCase().startsWith(inside));
        try {
            if (files.length === 0) {
                if (fs.existsSync(listPath)) fs.unlinkSync(listPath);
                return;
            }
            const text = files.map(file => path.resolve(file) + '\r\n').join('');
            fs.writeFileSync(listPath, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]));
        } catch (err) {
            console.error('[Store] Write uninstall list failed:', err.message);
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
     * 找到图片对应的缓存条目，并确认它仍然有效：深度图文件还在、原图还在，
     * 且原图的大小和修改时间都和生成时一致。原图被改过就删掉这条缓存。
     * 旧版索引没有记录修改时间，这种条目只比较大小。
     * @returns {object|null}
     */
    _validCacheEntry(imagePath) {
        const cacheKey = this._hashPath(imagePath);
        const entry = this._cacheIndex[cacheKey];
        if (!entry || !fs.existsSync(entry.depthFile) || !fs.existsSync(imagePath)) return null;

        const stat = fs.statSync(imagePath);
        const sizeChanged = stat.size !== entry.imageSize;
        const mtimeChanged = entry.imageMtimeMs !== undefined && Math.round(stat.mtimeMs) !== entry.imageMtimeMs;
        if (sizeChanged || mtimeChanged) {
            console.log('[Store] Image changed, cache invalidated');
            this._invalidateCache(cacheKey);
            return null;
        }
        return entry;
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
        this._saveCacheIndex();
    }
}

module.exports = { AppStore, UNINSTALL_LIST_FILE };
