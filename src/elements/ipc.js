/**
 * ipc.js — 自定义元素相关的 IPC 处理（主进程）
 *
 * 数据改动都走 shared/elements-model.js 的纯函数，保存后统一 broadcastConfig()，
 * 让壁纸窗口和设置窗口同时刷新。
 */

const { randomUUID } = require('crypto');
const {
    IMPORT_EXTENSIONS,
    loadBuiltinAssets,
    importUserAsset,
    removeUserAssetFiles,
    saveThumbnail,
} = require('./library');
const { createInstance, patchInstance, removeInstance, removeAsset } = require('../../shared/elements-model');

/**
 * @param {object} deps
 * @param {import('electron').IpcMain} deps.ipcMain
 * @param {import('electron').Dialog} deps.dialog
 * @param {import('../store').AppStore} deps.store
 * @param {string} deps.elementsDir - 默认素材目录（项目 elements/）
 * @param {() => import('electron').BrowserWindow | null} deps.getDialogParent
 * @param {() => void} deps.broadcastConfig
 * @param {import('./placement-controller').PlacementController} deps.placement
 */
function registerElementsIpc({ ipcMain, dialog, store, elementsDir, getDialogParent, broadcastConfig, placement }) {
    const getElements = () => store.getConfig().customElements;
    const saveElements = (customElements) => {
        store.saveConfig({ customElements });
        broadcastConfig();
    };
    const findAsset = (assetId) =>
        loadBuiltinAssets(elementsDir).find((a) => a.id === assetId)
        || getElements().library.find((a) => a.id === assetId)
        || null;

    ipcMain.handle('elements:getBuiltin', () => loadBuiltinAssets(elementsDir));

    ipcMain.handle('elements:import', async () => {
        const result = await dialog.showOpenDialog(getDialogParent(), {
            title: '添加自定义元素',
            filters: [{ name: '图片 / GIF / 视频', extensions: IMPORT_EXTENSIONS }],
            properties: ['openFile'],
        });
        if (result.canceled || result.filePaths.length === 0) return { canceled: true };

        try {
            const asset = importUserAsset(result.filePaths[0], store.getElementsDir(), 'user:' + randomUUID());
            const ce = getElements();
            saveElements({ ...ce, library: [...ce.library, asset] });
            return { asset };
        } catch (err) {
            if (err.message === 'UNSUPPORTED_FILE') {
                return { error: '不支持这种文件格式，请选择图片、GIF 或视频' };
            }
            console.error('[Elements] 导入失败:', err);
            return { error: '导入失败：' + err.message };
        }
    });

    ipcMain.handle('elements:removeAsset', (_event, assetId) => {
        const ce = getElements();
        const asset = ce.library.find((a) => a.id === assetId);
        if (!asset) return false;
        removeUserAssetFiles(asset);
        saveElements(removeAsset(ce, assetId).ce);
        return true;
    });

    ipcMain.handle('elements:saveThumb', (_event, assetId, dataUrl) => {
        const ce = getElements();
        if (!ce.library.some((a) => a.id === assetId)) return null;
        const thumb = saveThumbnail(store.getElementsDir(), assetId, dataUrl);
        saveElements({ ...ce, library: ce.library.map((a) => (a.id === assetId ? { ...a, thumb } : a)) });
        return thumb;
    });

    ipcMain.handle('elements:updateInstance', (_event, instanceId, patch) => {
        const ce = getElements();
        if (!ce.instances.some((i) => i.id === instanceId)) return false;
        saveElements(patchInstance(ce, instanceId, patch));
        return true;
    });

    ipcMain.handle('elements:removeInstance', (_event, instanceId) => {
        const ce = getElements();
        if (!ce.instances.some((i) => i.id === instanceId)) return false;
        saveElements(removeInstance(ce, instanceId));
        return true;
    });

    // 开始摆放：{ assetId } 新建一个实例，{ instanceId } 重新摆放已有实例
    ipcMain.handle('elements:startPlacement', (_event, target) => {
        let draft = null;
        if (target && target.instanceId) {
            const instance = getElements().instances.find((i) => i.id === target.instanceId);
            const asset = instance && findAsset(instance.assetId);
            if (asset) draft = { instance: { ...instance }, asset, isNew: false };
        } else if (target && target.assetId) {
            const asset = findAsset(target.assetId);
            if (asset) draft = { instance: createInstance(asset, randomUUID()), asset, isNew: true };
        }
        return draft ? placement.start(draft) : false;
    });

    ipcMain.handle('placement:getDraft', () => {
        const draft = placement.getDraft();
        return draft ? { instance: draft.instance, asset: draft.asset } : null;
    });

    ipcMain.handle('placement:commit', (_event, instance) => placement.commit(instance));

    ipcMain.handle('placement:cancel', () => {
        placement.cancel();
    });
}

module.exports = { registerElementsIpc };
