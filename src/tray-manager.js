/**
 * ============================================================================
 * tray-manager.js — 系统托盘管理模块
 * ============================================================================
 *
 * 功能：
 *   - 在任务栏右下角创建托盘图标
 *   - 提供右键菜单：更换壁纸、调整参数、开机自启、退出
 *   - 左键单击打开设置窗口
 * ============================================================================
 */

const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');
const fs = require('fs');

/**
 * 创建系统托盘图标并返回 Tray 实例。
 *
 * @param {Object} callbacks - 菜单回调函数
 * @param {Function} callbacks.onOpenSettings - 打开设置窗口
 * @param {Function} callbacks.onSelectImage - 选择新图片
 * @param {Function} callbacks.onQuit - 退出应用
 * @param {Function} callbacks.getAutoLaunch - 获取开机自启状态
 * @param {Function} callbacks.setAutoLaunch - 设置开机自启状态
 * @returns {Tray}
 */
function createTray(callbacks) {
    const {
        onOpenSettings,
        onSelectImage,
        onQuit,
        getAutoLaunch,
        setAutoLaunch,
    } = callbacks;

    // 创建托盘图标（使用内置简单图标或自定义图标）
    let trayIcon;
    const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');

    if (fs.existsSync(iconPath)) {
        trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    } else {
        // 如果没有自定义图标，创建一个简单的 16x16 图标
        trayIcon = createSimpleIcon();
    }

    const tray = new Tray(trayIcon);
    tray.setToolTip('互动3D壁纸');

    // 左键单击打开设置
    tray.on('click', () => {
        onOpenSettings();
    });

    // 构建托盘菜单
    updateTrayMenu(tray, {
        onOpenSettings,
        onSelectImage,
        onQuit,
        getAutoLaunch,
        setAutoLaunch,
    });

    return tray;
}

/**
 * 更新托盘右键菜单（当开机自启状态改变时调用）。
 */
function updateTrayMenu(tray, callbacks) {
    const {
        onOpenSettings,
        onSelectImage,
        onOpenDepthDir,
        onQuit,
        getAutoLaunch,
        setAutoLaunch,
    } = callbacks;

    const isAutoLaunch = getAutoLaunch();

    const contextMenu = Menu.buildFromTemplate([
        {
            label: '打开设置',
            click: () => onOpenSettings(),
        },
        {
            label: '更换壁纸...',
            click: () => onSelectImage(),
        },
        {
            label: '打开深度图文件夹...',
            click: () => onOpenDepthDir && onOpenDepthDir(),
        },
        { type: 'separator' },
        {
            label: '开机自启',
            type: 'checkbox',
            checked: isAutoLaunch,
            click: (menuItem) => {
                setAutoLaunch(menuItem.checked);
            },
        },
        { type: 'separator' },
        {
            label: '关于',
            click: () => {
                const { dialog } = require('electron');
                dialog.showMessageBox({
                    type: 'info',
                    title: '关于 互动3D壁纸',
                    message: '互动3D壁纸 v1.0.0',
                    detail: '基于 Pixi.js + Electron 的伪3D深度视差桌面壁纸。\n使用 Depth Anything V2 生成深度图。',
                });
            },
        },
        { type: 'separator' },
        {
            label: '退出',
            click: () => onQuit(),
        },
    ]);

    tray.setContextMenu(contextMenu);
}

/**
 * 创建简单的 16x16 托盘图标（没有自定义图标时的 fallback）。
 * 生成一个带渐变色的圆形图标。
 */
function createSimpleIcon() {
    // 创建一个 16x16 的 RGBA 图像数据
    const size = 16;
    const buffer = Buffer.alloc(size * size * 4);

    const cx = size / 2;
    const cy = size / 2;
    const radius = size / 2 - 1;

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i = (y * size + x) * 4;
            const dx = x - cx;
            const dy = y - cy;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist <= radius) {
                // 蓝紫渐变色
                const ratio = dist / radius;
                buffer[i] = Math.round(100 + 100 * ratio);     // R
                buffer[i + 1] = Math.round(80 + 120 * ratio);  // G
                buffer[i + 2] = Math.round(200 + 55 * (1 - ratio)); // B
                buffer[i + 3] = 255;                            // A
            } else {
                buffer[i] = 0;
                buffer[i + 1] = 0;
                buffer[i + 2] = 0;
                buffer[i + 3] = 0;
            }
        }
    }

    return nativeImage.createFromBuffer(buffer, {
        width: size,
        height: size,
    });
}

module.exports = { createTray, updateTrayMenu };
