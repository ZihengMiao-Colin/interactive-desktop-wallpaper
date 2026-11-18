'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { watchProcessCrashes, watchWindowHealth, watchRendererConsole } = require('../src/diagnostics/crash-log');

function fakeLogger() {
    const lines = { error: [], warn: [], info: [] };
    return {
        lines,
        error: (...a) => lines.error.push(a.join(' ')),
        warn: (...a) => lines.warn.push(a.join(' ')),
        info: (...a) => lines.info.push(a.join(' ')),
    };
}

function setup() {
    const app = new EventEmitter();
    const logger = fakeLogger();
    const wallpaperContents = { id: 1 };
    watchProcessCrashes({ app, logger, nameOf: (wc) => (wc === wallpaperContents ? '壁纸窗口' : '其他窗口') });
    return { app, logger, wallpaperContents };
}

test('窗口进程崩溃记成 error，写明是哪个窗口、原因和退出码', () => {
    const { app, logger, wallpaperContents } = setup();
    app.emit('render-process-gone', {}, wallpaperContents, { reason: 'crashed', exitCode: -1073741819 });
    assert.equal(logger.lines.error.length, 1);
    assert.match(logger.lines.error[0], /壁纸窗口/);
    assert.match(logger.lines.error[0], /crashed/);
    assert.match(logger.lines.error[0], /-1073741819/);
});

test('显卡进程崩溃记成 error', () => {
    const { app, logger } = setup();
    app.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed', exitCode: 3 });
    assert.equal(logger.lines.error.length, 1);
    assert.match(logger.lines.error[0], /GPU/);
    assert.match(logger.lines.error[0], /crashed/);
});

test('正常退出只记 info', () => {
    const { app, logger, wallpaperContents } = setup();
    app.emit('render-process-gone', {}, wallpaperContents, { reason: 'clean-exit', exitCode: 0 });
    app.emit('child-process-gone', {}, { type: 'Utility', reason: 'clean-exit', exitCode: 0, serviceName: 'x' });
    assert.equal(logger.lines.error.length, 0);
    assert.equal(logger.lines.info.length, 2);
});

test('程序自己结束的辅助进程（深度图生成完就 kill）只记 info，带上服务名', () => {
    const { app, logger } = setup();
    app.emit('child-process-gone', {}, { type: 'Utility', reason: 'killed', exitCode: 1, serviceName: 'Depth Generator' });
    assert.equal(logger.lines.error.length, 0);
    assert.match(logger.lines.info[0], /Depth Generator/);
});

test('退出程序过程中进程结束只记 info', () => {
    const { app, logger, wallpaperContents } = setup();
    app.emit('before-quit');
    app.emit('render-process-gone', {}, wallpaperContents, { reason: 'killed', exitCode: 1 });
    app.emit('child-process-gone', {}, { type: 'GPU', reason: 'killed', exitCode: 1 });
    assert.equal(logger.lines.error.length, 0);
    assert.equal(logger.lines.info.length, 2);
});

test('窗口没响应记 warn，恢复后记 info', () => {
    const win = new EventEmitter();
    const logger = fakeLogger();
    watchWindowHealth(win, '设置窗口', logger);
    win.emit('unresponsive');
    win.emit('responsive');
    assert.match(logger.lines.warn[0], /设置窗口.*没有响应/);
    assert.match(logger.lines.info[0], /设置窗口/);
});

// ==================== 页面的控制台输出 ====================

function setupConsole() {
    const app = new EventEmitter();
    const logger = { ...fakeLogger(), debug() {} };
    watchRendererConsole({ app, logger });
    const contents = new EventEmitter();
    app.emit('web-contents-created', {}, contents);
    return { contents, logger };
}

test('页面的错误写进日志时带上文件名和行号', () => {
    const { contents, logger } = setupConsole();
    contents.emit('console-message', {}, 3, 'Uncaught Error: boom', 42,
        'file:///C:/Users/a/Desktop/2/%E5%A3%81%E7%BA%B8/settings/wallpaper-page.js');
    assert.deepEqual(logger.lines.error, ['Uncaught Error: boom（wallpaper-page.js:42）']);
});

test('页面的警告也带位置，普通输出原样记', () => {
    const { contents, logger } = setupConsole();
    contents.emit('console-message', {}, 2, 'careful', 7, 'file:///C:/x/index.html');
    contents.emit('console-message', {}, 1, '[Wallpaper] ready', 9, 'file:///C:/x/renderer/main.js');
    assert.deepEqual(logger.lines.warn, ['careful（index.html:7）']);
    assert.deepEqual(logger.lines.info, ['[Wallpaper] ready']);
});

test('在控制台里直接执行的代码没有文件名，只记消息', () => {
    const { contents, logger } = setupConsole();
    contents.emit('console-message', {}, 3, 'Uncaught Error: x', 1, '');
    assert.deepEqual(logger.lines.error, ['Uncaught Error: x']);
});
