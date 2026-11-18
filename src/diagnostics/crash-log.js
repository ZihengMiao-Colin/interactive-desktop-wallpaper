/**
 * crash-log.js — 把窗口进程、GPU 等子进程的退出和窗口卡住写进日志
 *
 * 这些以前都没记：别人电脑上显卡驱动不同，WebGL / GPU 进程最容易在这里出事，
 * 日志里却什么都看不到。正常退出、程序自己结束的、退出程序过程中结束的只记 info。
 */

'use strict';

/**
 * @param {object} deps
 * @param {import('events').EventEmitter} deps.app - Electron app
 * @param {{error: Function, info: Function}} deps.logger
 * @param {(webContents: object) => string} deps.nameOf - 窗口叫什么（壁纸窗口 / 设置窗口…）
 */
function watchProcessCrashes({ app, logger, nameOf }) {
    let quitting = false;
    app.on('before-quit', () => { quitting = true; });

    app.on('render-process-gone', (_event, webContents, details) => {
        const message = `[Crash] ${nameOf(webContents)}的进程退出了：reason=${details.reason} exitCode=${details.exitCode}`;
        if (quitting || details.reason === 'clean-exit') logger.info(message);
        else logger.error(message);
    });

    app.on('child-process-gone', (_event, details) => {
        const service = details.serviceName ? ` service=${details.serviceName}` : '';
        const name = details.name ? ` name=${details.name}` : '';
        const message = `[Crash] 子进程退出了：type=${details.type}${service}${name} reason=${details.reason} exitCode=${details.exitCode}`;
        // 辅助进程（深度图生成）是程序自己用完 kill 掉的
        const expected = quitting || details.reason === 'clean-exit' || (details.type === 'Utility' && details.reason === 'killed');
        if (expected) logger.info(message);
        else logger.error(message);
    });
}

/**
 * 窗口卡住（页面里的脚本长时间不返回）时记 warn，恢复时记 info。
 * @param {import('events').EventEmitter} win - BrowserWindow
 * @param {string} name
 * @param {{warn: Function, info: Function}} logger
 */
function watchWindowHealth(win, name, logger) {
    win.on('unresponsive', () => logger.warn(`[Crash] ${name}没有响应`));
    win.on('responsive', () => logger.info(`[Crash] ${name}恢复响应了`));
}

/** console-message 的 level：0 verbose、1 info、2 warning、3 error */
const CONSOLE_LEVELS = ['debug', 'info', 'warn', 'error'];

/** "file:///C:/…/%E5%A3%81%E7%BA%B8/settings/a.js" → "a.js" */
function sourceName(sourceId) {
    let name = String(sourceId).split(/[\\/]/).pop();
    try {
        name = decodeURIComponent(name);
    } catch (_) { /* 编码不完整就用原样 */ }
    return name;
}

/**
 * 各窗口页面的控制台输出写进日志（替代 electron-log 的 spyRendererConsole）。
 * 错误和警告后面带上"（文件名:行号）"：electron-log 自带的只记消息，别人电脑上出的错看不出是哪一行。
 * @param {{app: import('events').EventEmitter, logger: object}} deps
 */
function watchRendererConsole({ app, logger }) {
    app.on('web-contents-created', (_event, contents) => {
        contents.on('console-message', (_e, level, message, line, sourceId) => {
            const name = CONSOLE_LEVELS[level] || 'info';
            const where = level >= 2 && sourceId ? `（${sourceName(sourceId)}:${line}）` : '';
            logger[name](message + where);
        });
    });
}

module.exports = { watchProcessCrashes, watchWindowHealth, watchRendererConsole };
