'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readLogTail, recentProblems } = require('../src/diagnostics/logs');

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'wp-diag-logs-'));
}

const line = (n) => `[2026-11-18 10:00:${String(n).padStart(2, '0')}.000] [info]  line ${n}`;

test('readLogTail 只取最后几行，Windows 换行也能拆开', () => {
    const dir = tempDir();
    const file = path.join(dir, 'main.log');
    fs.writeFileSync(file, [1, 2, 3, 4, 5].map(line).join('\r\n') + '\r\n');
    assert.deepEqual(readLogTail([file], 2), [line(4), line(5)]);
});

test('readLogTail 当前日志不够时从旧日志补，旧的在前面', () => {
    const dir = tempDir();
    const oldFile = path.join(dir, 'main.old.log');
    const file = path.join(dir, 'main.log');
    fs.writeFileSync(oldFile, [1, 2, 3].map(line).join('\n') + '\n');
    fs.writeFileSync(file, [4, 5].map(line).join('\n') + '\n');
    assert.deepEqual(readLogTail([oldFile, file], 4), [line(2), line(3), line(4), line(5)]);
});

test('readLogTail 文件不存在时跳过，都不存在时是空数组', () => {
    const dir = tempDir();
    const file = path.join(dir, 'main.log');
    fs.writeFileSync(file, line(1) + '\n');
    assert.deepEqual(readLogTail([path.join(dir, 'main.old.log'), file], 10), [line(1)]);
    assert.deepEqual(readLogTail([path.join(dir, 'nope.log')], 10), []);
});

test('recentProblems 挑出 error 和 warn，带上跟在后面的堆栈', () => {
    const lines = [
        '[2026-11-18 10:00:01.000] [info]  [Main] App starting...',
        '[2026-11-18 10:00:02.000] [error] [Main] 深度图生成失败: Error: boom',
        '    at foo (C:\\app\\a.js:1:1)',
        '[2026-11-18 10:00:03.000] [warn]  [WorkerW] Injection failed',
        '[2026-11-18 10:00:04.000] [info]  [Main] ok',
    ];
    assert.deepEqual(recentProblems(lines, 10), [
        '[2026-11-18 10:00:02.000] [error] [Main] 深度图生成失败: Error: boom\n    at foo (C:\\app\\a.js:1:1)',
        '[2026-11-18 10:00:03.000] [warn]  [WorkerW] Injection failed',
    ]);
});

test('recentProblems 只留最新的几条', () => {
    const lines = [1, 2, 3].map((n) => `[2026-11-18 10:00:0${n}.000] [error] e${n}`);
    assert.deepEqual(recentProblems(lines, 2), [lines[1], lines[2]]);
});

test('recentProblems 去掉 Electron 开发时的安全警告（每次开 DevTools 都有，不是问题）', () => {
    const lines = [
        '[2026-10-30 19:44:22.099] [warn]  %cElectron Security Warning (Disabled webSecurity) font-weight: bold; This renderer',
        '[2026-10-30 19:44:23.000] [error] real problem',
    ];
    assert.deepEqual(recentProblems(lines, 10), ['[2026-10-30 19:44:23.000] [error] real problem']);
});

test('recentProblems 堆栈太长时只留前几行', () => {
    const stack = Array.from({ length: 20 }, (_, i) => `    at f${i} (x.js:${i}:1)`);
    const lines = ['[2026-11-18 10:00:01.000] [error] boom', ...stack];
    const [entry] = recentProblems(lines, 10);
    const entryLines = entry.split('\n');
    assert.equal(entryLines[0], lines[0]);
    assert.ok(entryLines.length <= 9, `应该截短，实际 ${entryLines.length} 行`);
    assert.match(entryLines[entryLines.length - 1], /还有 \d+ 行/);
});

test('recentProblems 日志开头的半截记录（没有时间戳）不算', () => {
    const lines = ['    at orphan (x.js:1:1)', '[2026-11-18 10:00:01.000] [info]  ok'];
    assert.deepEqual(recentProblems(lines, 10), []);
});
