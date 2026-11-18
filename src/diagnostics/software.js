/**
 * software.js — 从正在运行的进程里认出可能影响壁纸的软件
 *
 * 安全软件会拦本程序挂到桌面层（360，见 PROJECT_NOTES 第 33 项），
 * 别的壁纸 / 桌面美化软件会改桌面窗口结构。报告里只列命中名单的，不列全部进程。
 */

'use strict';

/** @type {{category: 'security'|'desktop', name: string, exes: string[]}[]} */
const KNOWN = [
    { category: 'security', name: '360安全卫士', exes: ['360tray.exe', 'zhudongfangyu.exe', '360safe.exe'] },
    { category: 'security', name: '360杀毒', exes: ['360sd.exe', '360rps.exe'] },
    { category: 'security', name: '腾讯电脑管家', exes: ['qqpctray.exe', 'qqpcrtp.exe', 'qqpcmgr.exe'] },
    { category: 'security', name: '火绒安全', exes: ['hipstray.exe', 'hipsdaemon.exe', 'usysdiag.exe'] },
    { category: 'security', name: '金山毒霸', exes: ['kxetray.exe', 'kxescore.exe', 'kxemain.exe'] },
    { category: 'security', name: '卡巴斯基', exes: ['avp.exe', 'avpui.exe'] },
    { category: 'security', name: 'ESET', exes: ['ekrn.exe', 'egui.exe'] },
    { category: 'security', name: 'Avast', exes: ['avastui.exe', 'avastsvc.exe'] },
    { category: 'security', name: 'AVG', exes: ['avgui.exe', 'avgsvc.exe'] },
    { category: 'desktop', name: 'Wallpaper Engine', exes: ['wallpaper32.exe', 'wallpaper64.exe', 'webwallpaper32.exe', 'wallpaperservice32.exe'] },
    { category: 'desktop', name: 'Lively Wallpaper', exes: ['lively.exe'] },
    { category: 'desktop', name: 'Rainmeter', exes: ['rainmeter.exe'] },
    { category: 'desktop', name: 'TranslucentTB', exes: ['translucenttb.exe'] },
    { category: 'desktop', name: 'Windhawk', exes: ['windhawk.exe'] },
    { category: 'desktop', name: '腾讯桌面整理', exes: ['desktopmgr.exe', 'desktopmgr64.exe'] },
];

/** 名单里没有、但看名字像壁纸 / 桌面美化软件的（显示进程名） */
const LOOKS_LIKE_DESKTOP = /wallpaper|lively|deskscapes|upupoo|fences|startallback|explorerpatcher/i;

const BY_EXE = new Map(KNOWN.flatMap((k) => k.exes.map((exe) => [exe, k])));

/**
 * @param {string[]} processNames - 进程的 exe 文件名
 * @returns {{category: 'security'|'desktop', name: string, exe: string}[]} 安全软件在前，同一个软件只列一次
 */
function matchKnownSoftware(processNames) {
    const found = new Map();
    for (const exe of processNames) {
        const known = BY_EXE.get(String(exe).toLowerCase());
        const hit = known
            ? { category: known.category, name: known.name, exe }
            : LOOKS_LIKE_DESKTOP.test(exe) ? { category: 'desktop', name: exe, exe } : null;
        if (hit && !found.has(hit.name)) found.set(hit.name, hit);
    }
    const order = { security: 0, desktop: 1 };
    return [...found.values()].sort((a, b) => order[a.category] - order[b.category]);
}

module.exports = { matchKnownSoftware };
