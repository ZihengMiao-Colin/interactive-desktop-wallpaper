/**
 * report.js — 把收集到的诊断信息拼成 txt 报告，以及 GitHub 反馈用的摘要
 *
 * 收集结果的样子见 collect.js 的 collectDiagnostics。每一部分都可能是 { error }（读取失败），
 * 这里照样拼，只写一行原因。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { PLACEHOLDER } = require('./redact');

const pad = (n) => String(n).padStart(2, '0');

/** 本地时间 2026-11-18 14:03:22 */
function formatTime(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
        + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** 互动3D壁纸-诊断报告-20261118-140322.txt */
function reportFileName(date) {
    const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
        + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
    return `互动3D壁纸-诊断报告-${stamp}.txt`;
}

const failed = (part) => part && typeof part === 'object' && !Array.isArray(part) && 'error' in part;
const failLine = (part) => `读取失败：${part.error}`;

function formatDuration(sec) {
    const minutes = Math.floor(sec / 60);
    if (minutes < 60) return `${minutes} 分钟`;
    return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
}

const percent = (scale) => `${Math.round(scale * 100)}%`;

function physicalSize(d) {
    const w = d.physicalWidth || Math.round(d.width * d.scaleFactor);
    const h = d.physicalHeight || Math.round(d.height * d.scaleFactor);
    return `${w}×${h}`;
}

// ==================== 各部分 ====================

function appLines(app) {
    if (failed(app)) return [failLine(app)];
    return [
        `软件版本：${app.version}（${app.packaged ? '安装版' : '开发版'}）`,
        `Electron ${app.electron} / Chrome ${app.chrome} / Node ${app.node}`,
        `系统：${app.os} ${app.osRelease} ${app.arch}`,
        `处理器：${app.cpu} ×${app.cpuCount}，内存 ${app.memoryGB} GB`,
        `语言：${app.locale}`,
        `已运行：${formatDuration(app.uptimeSec)}（${app.launchedAtLogin ? '开机自动启动的' : '手动打开的'}）`,
        `开机自启：${app.autoLaunch ? '开' : '关'}`,
        `安装位置：${app.exePath}`,
        `数据目录：${app.dataDir}`,
        `深度图目录：${app.depthDir}`,
    ];
}

function displayLines(displays) {
    if (failed(displays)) return [failLine(displays)];
    let other = 1;
    return displays.map((d) => {
        const name = d.primary ? '主显示器' : `显示器 ${++other}`;
        const hz = d.refreshRate ? `，${Math.round(d.refreshRate)}Hz` : '';
        return `${name}：${physicalSize(d)}（缩放 ${percent(d.scaleFactor)}${hz}），位置 (${d.x}, ${d.y})`;
    });
}

const VENDORS = { 0x10de: 'NVIDIA', 0x1002: 'AMD', 0x8086: 'Intel', 0x1414: 'Microsoft', 0x5143: 'Qualcomm' };
const hex4 = (n) => '0x' + Number(n).toString(16).padStart(4, '0');

function gpuLines(gpu) {
    if (failed(gpu)) return [failLine(gpu)];
    const lines = [`渲染器：${gpu.glRenderer || '未知'}`];
    (gpu.devices || []).forEach((d, i) => {
        const vendor = VENDORS[d.vendorId] || '未知厂商';
        const basic = d.active && d.vendorId === 0x1414 ? '（微软基本显示驱动：没有正常的显卡驱动）' : '';
        lines.push(`显卡 ${i + 1}${d.active ? '（正在用）' : ''}：${vendor} ${hex4(d.vendorId)}:${hex4(d.deviceId)}`
            + `，驱动 ${d.driverVersion || '未知'}${basic}`);
    });
    const status = Object.entries(gpu.featureStatus || {}).map(([k, v]) => `${k}=${v}`).join(', ');
    lines.push(`硬件加速：${status || '未知'}`);
    return lines;
}

function desktopLayerText(state) {
    if (state === true) return '已挂上';
    if (state === false) return '没挂上（兜底模式：壁纸放在所有程序后面）';
    return '还没有结果（正在挂）';
}

const TYPE_NAMES = { image: '图片', video: '视频' };

function wallpaperLines(w) {
    if (failed(w)) return [failLine(w)];
    const lines = [`桌面层：${desktopLayerText(w.desktopLayer)}`];
    if (w.windowLines && w.windowLines.length) {
        lines.push('窗口：', ...w.windowLines.map((l) => '  ' + l));
    } else if (failed(w.windowLines)) {
        lines.push(`窗口：${failLine(w.windowLines)}`);
    }
    lines.push(`暂停：${w.paused && w.paused.length ? w.paused.join('、') : '没有'}`);
    if (w.current) {
        const missing = w.current.exists ? '' : '（文件找不到了）';
        lines.push(`当前壁纸：${TYPE_NAMES[w.current.type] || w.current.type} ${w.current.path}${missing}`);
    } else {
        lines.push('当前壁纸：没有');
    }
    return lines;
}

const CATEGORY_NAMES = { security: '安全软件', desktop: '壁纸 / 桌面美化' };

function softwareLines(software) {
    if (failed(software)) return [failLine(software)];
    if (!software.length) return ['没有发现'];
    return software.map((s) => `${CATEGORY_NAMES[s.category]}：${s.name}（${s.exe}）`);
}

function problemLines(problems) {
    if (failed(problems)) return [failLine(problems)];
    return problems.length ? problems : ['没有'];
}

function configLines(config) {
    if (failed(config)) return [failLine(config)];
    return JSON.stringify(config, null, 2).split('\n');
}

function logLines(log) {
    if (failed(log)) return [failLine(log)];
    return log.lines.length ? log.lines : ['（日志是空的）'];
}

function section(title, lines) {
    return ['', `==================== ${title} ====================`, ...lines];
}

/**
 * @param {object} info - collectDiagnostics 的结果
 * @returns {string} 用 \n 换行，存文件时再转成 \r\n
 */
function formatReport(info) {
    const problemCount = Array.isArray(info.problems) && info.problems.length ? `（最近 ${info.problems.length} 条）` : '';
    const logTitle = failed(info.log) ? '日志' : `日志（${path.basename(info.log.file)} 最后 ${info.log.lines.length} 行）`;
    return [
        '互动3D壁纸 诊断报告',
        `生成时间：${formatTime(info.generatedAt)}`,
        `路径里的 Windows 用户名已换成 ${PLACEHOLDER}。壁纸、音乐的文件名没有去掉，介意的话可以先删掉再发。`,
        ...section('基本信息', appLines(info.app)),
        ...section('显示器', displayLines(info.displays)),
        ...section('显卡', gpuLines(info.gpu)),
        ...section('壁纸状态', wallpaperLines(info.wallpaper)),
        ...section('可能有关的其他软件', softwareLines(info.software)),
        ...section(`最近的错误和警告${problemCount}`, problemLines(info.problems)),
        ...section('配置（config.json）', configLines(info.config)),
        ...section(logTitle, logLines(info.log)),
        '',
    ].join('\n');
}

/**
 * GitHub 反馈正文里自动填的基本信息，一行一项。
 * @returns {string[]}
 */
function issueSummary(info) {
    const { app, displays, gpu, wallpaper, software } = info;
    const primary = !failed(displays) && (displays.find((d) => d.primary) || displays[0]);
    const activeGpu = !failed(gpu) && (gpu.devices || []).find((d) => d.active);
    let gpuText = '读取失败';
    if (!failed(gpu)) {
        gpuText = gpu.glRenderer || (activeGpu ? `${VENDORS[activeGpu.vendorId] || '未知厂商'} ${hex4(activeGpu.deviceId)}` : '未知');
    }
    return [
        failed(app) ? '软件版本：读取失败' : `软件版本：${app.version}（${app.packaged ? '安装版' : '开发版'}）`,
        failed(app) ? '系统：读取失败' : `系统：${app.os} ${app.osRelease} ${app.arch}`,
        !primary ? '显示器：读取失败'
            : `显示器：${physicalSize(primary)}，缩放 ${percent(primary.scaleFactor)}${displays.length > 1 ? `，共 ${displays.length} 块` : ''}`,
        `显卡：${gpuText}`,
        failed(wallpaper) ? '桌面层：读取失败' : `桌面层：${desktopLayerText(wallpaper.desktopLayer)}`,
        failed(software) ? '可能有关的软件：读取失败'
            : `可能有关的软件：${software.length ? software.map((s) => s.name).join('、') : '没有发现'}`,
    ];
}

/**
 * 存报告：依次试每个文件夹（桌面、下载、数据目录），存进第一个能写的。
 * UTF-8 带 BOM、\r\n 换行：老版本记事本也能正常显示中文。
 * @returns {string} 存好的完整路径
 * @throws 所有文件夹都写不进去时
 */
function saveReport(text, dirs, fileName) {
    const content = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text.replace(/\r?\n/g, '\r\n'), 'utf8')]);
    let lastError = new Error('没有可以保存的文件夹');
    for (const dir of dirs) {
        if (!dir || !fs.existsSync(dir)) continue;
        const file = path.join(dir, fileName);
        try {
            fs.writeFileSync(file, content);
            return file;
        } catch (err) {
            lastError = err;
        }
    }
    throw lastError;
}

module.exports = { formatReport, issueSummary, reportFileName, saveReport, formatTime };
