/**
 * uninstaller.js — 设置页"卸载软件"：找到安装目录里的卸载程序并打开它
 *
 * electron-builder 的 NSIS 安装包会在安装目录放一个 "Uninstall <产品名>.exe"。
 * 用户在设置页勾没勾"同时删除我的数据"，用命令行参数带给卸载程序，
 * 卸载向导里的勾选框按它预先勾好（build/installer.nsh）。
 * 不用 electron-builder 自带的 --delete-app-data：带了它不管向导里怎么勾都会删。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DELETE_DATA_ARG = '--delete-user-data';
const KEEP_DATA_ARG = '--keep-user-data';

/**
 * @param {string} installDir - 安装目录（打包后是 exe 所在的文件夹）
 * @returns {string|null} 卸载程序的完整路径，没有就是 null
 */
function findUninstaller(installDir) {
    try {
        const name = fs.readdirSync(installDir).find(file => /^Uninstall .+\.exe$/i.test(file));
        return name ? path.join(installDir, name) : null;
    } catch (_) {
        return null;
    }
}

/** @param {boolean} deleteData */
function uninstallerArgs(deleteData) {
    return [deleteData ? DELETE_DATA_ARG : KEEP_DATA_ARG];
}

/**
 * 打开卸载程序（独立进程，软件退出后继续运行）。
 * @returns {Promise<void>} 进程起来了就 resolve，起不来就 reject
 */
function launchUninstaller(exePath, deleteData) {
    return new Promise((resolve, reject) => {
        const child = spawn(exePath, uninstallerArgs(deleteData), { detached: true, stdio: 'ignore' });
        child.once('error', reject);
        child.once('spawn', () => {
            child.unref();
            resolve();
        });
    });
}

module.exports = { findUninstaller, uninstallerArgs, launchUninstaller };
