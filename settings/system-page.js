/**
 * system-page.js — 设置窗口"设置"页：开机自启、深度图缓存位置和清除、卸载软件
 */

'use strict';

/**
 * @param {{ api: object, setStatus: (msg: string, cls?: string) => void, onCacheCleared: () => void }} deps
 * @returns {{ load: () => Promise<void> }}
 */
function initSystemPage({ api, setStatus, onCacheCleared }) {
    const autoLaunch = document.getElementById('auto-launch-toggle');
    const dirPath = document.getElementById('depth-dir-path');

    autoLaunch.addEventListener('change', async () => {
        const result = await api.toggleAutoLaunch(autoLaunch.checked);
        setStatus(result ? '已开启开机自动启动' : '已关闭开机自动启动');
    });

    async function refreshDir() {
        try {
            const dir = await api.getDepthCacheDir();
            if (!dir) return;
            dirPath.textContent = dir;
            dirPath.title = dir + '\n点击在文件资源管理器中打开';
        } catch (err) {
            console.error('获取深度图存放路径失败:', err);
        }
    }

    async function openDir() {
        try {
            await api.openDepthCacheDir();
            setStatus('已打开深度图文件夹', 'success');
        } catch (err) {
            setStatus('打开文件夹失败：' + err.message, 'error');
        }
    }

    dirPath.addEventListener('click', openDir);
    document.getElementById('btn-open-depth-dir').addEventListener('click', openDir);

    document.getElementById('btn-change-depth-dir').addEventListener('click', async () => {
        try {
            const res = await api.selectDepthCacheDir();
            if (!res) return; // 用户取消
            if (res.success) {
                await refreshDir();
                const moved = res.movedCount > 0 ? `，已搬过去 ${res.movedCount} 个深度图` : '';
                setStatus(`深度图存放位置已改为 ${res.path}${moved}`, 'success');
            } else {
                setStatus('更改位置失败：' + (res.error || '未知错误'), 'error');
            }
        } catch (err) {
            setStatus('更改位置失败：' + err.message, 'error');
        }
    });

    document.getElementById('btn-clear-cache').addEventListener('click', async () => {
        if (!confirm('确定要清除所有深度图缓存吗？\n\n下次换成自己的图片时要重新生成深度图。默认壁纸不受影响。')) return;
        await api.clearAllCache();
        onCacheCleared();
        setStatus('深度图缓存已清除');
    });

    // ---- 卸载：确认框里选要不要删数据，然后打开卸载程序（软件随即退出） ----
    const uninstallBtn = document.getElementById('btn-uninstall');
    const uninstallDesc = document.getElementById('uninstall-desc');
    const dialog = document.getElementById('uninstall-dialog');
    const deleteData = document.getElementById('uninstall-delete-data');
    const confirmBtn = document.getElementById('uninstall-confirm');

    uninstallBtn.addEventListener('click', () => {
        deleteData.checked = false;
        confirmBtn.disabled = false;
        dialog.showModal();
    });
    document.getElementById('uninstall-cancel').addEventListener('click', () => dialog.close());

    confirmBtn.addEventListener('click', async () => {
        confirmBtn.disabled = true;
        try {
            const res = await api.uninstall(deleteData.checked);
            if (res && res.success) {
                setStatus('正在打开卸载程序，软件马上退出…');
                return;
            }
            setStatus('打开卸载程序失败：' + ((res && res.error) || '未知错误'), 'error');
        } catch (err) {
            setStatus('打开卸载程序失败：' + err.message, 'error');
        }
        dialog.close();
    });

    async function refreshUninstall() {
        try {
            const info = await api.getUninstallInfo();
            uninstallBtn.disabled = !info.available;
            if (!info.available) uninstallDesc.textContent = info.reason;
        } catch (err) {
            console.error('检查卸载程序失败:', err);
        }
    }

    return {
        async load() {
            await refreshDir();
            autoLaunch.checked = await api.getAutoLaunch();
            await refreshUninstall();
        },
    };
}
