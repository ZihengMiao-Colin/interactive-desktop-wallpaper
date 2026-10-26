/**
 * migrate.js — 旧版"自定义贴纸"配置迁移为自定义元素（启动时执行一次）
 */

const fs = require('fs');
const { randomUUID } = require('crypto');
const { importUserAsset } = require('./library');
const { createInstance, legacyStickerToInstance } = require('../../shared/elements-model');

/**
 * 旧贴纸启用且图片还在时：导入素材库并按原位置生成一个实例。
 * 无论是否迁移成功，最后都删除旧的 sticker 配置。
 *
 * @param {object} deps
 * @param {import('../store').AppStore} deps.store
 * @param {{width: number, height: number}} deps.screenSize - 主显示器尺寸
 * @param {(imagePath: string) => number} deps.getImageAspect - 图片宽高比
 * @returns {boolean} 是否生成了新实例
 */
function migrateLegacySticker({ store, screenSize, getImageAspect }) {
    const config = store.getConfig();
    if (!('sticker' in config)) return false;

    let migrated = false;
    const sticker = config.sticker;
    try {
        if (sticker && sticker.imagePath && fs.existsSync(sticker.imagePath)) {
            const fields = legacyStickerToInstance(sticker, screenSize.width, screenSize.height,
                getImageAspect(sticker.imagePath) || 1);
            if (fields) {
                const asset = importUserAsset(sticker.imagePath, store.getElementsDir(), 'user:' + randomUUID());
                const instance = createInstance(asset, randomUUID());
                instance.transform = { ...instance.transform, x: fields.x, y: fields.y, width: fields.width };
                instance.depth = fields.depth;
                instance.depthAuto = false;
                instance.opacity = fields.opacity;

                const ce = config.customElements;
                store.saveConfig({
                    customElements: { library: [...ce.library, asset], instances: [...ce.instances, instance] },
                });
                migrated = true;
                console.log('[Elements] 旧贴纸已迁移为自定义元素:', asset.name);
            }
        }
    } catch (err) {
        console.warn('[Elements] 旧贴纸迁移失败:', err.message);
    }

    store.deleteConfigKeys(['sticker']);
    return migrated;
}

module.exports = { migrateLegacySticker };
