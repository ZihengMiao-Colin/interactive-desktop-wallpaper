/**
 * logs.js — 读 electron-log 的日志文件：取最后一段、挑出最近的错误和警告
 *
 * 日志一行的格式：[2026-11-18 10:00:01.000] [error] 内容
 * 多行内容（比如堆栈）从第二行起没有时间戳，算在上一条里。
 */

'use strict';

const fs = require('fs');

/** 一条记录的开头：时间戳 + 级别 */
const ENTRY_HEAD = /^\[\d{4}-\d{2}-\d{2} [\d:.]+\] \[(\w+)\]/;

/** 一条错误最多带几行堆栈 */
const MAX_STACK_LINES = 6;

/** 不算问题的警告：开 DevTools 时 Electron 的安全提示（本项目故意关了 webSecurity） */
const IGNORED = [/Electron Security Warning/];

/**
 * 按顺序读几个日志文件（旧的在前），返回合起来的最后 maxLines 行。不存在的文件跳过。
 * @param {string[]} files
 * @param {number} maxLines
 * @returns {string[]}
 */
function readLogTail(files, maxLines) {
    const lines = [];
    for (const file of files) {
        let text;
        try {
            text = fs.readFileSync(file, 'utf8');
        } catch (_) {
            continue;
        }
        const fileLines = text.split(/\r?\n/);
        if (fileLines[fileLines.length - 1] === '') fileLines.pop();
        lines.push(...fileLines);
    }
    return lines.slice(-maxLines);
}

/** 把日志行拆成一条条记录：{ level, lines }。开头没有时间戳的半截记录丢掉 */
function splitEntries(lines) {
    const entries = [];
    for (const text of lines) {
        const head = ENTRY_HEAD.exec(text);
        if (head) entries.push({ level: head[1], lines: [text] });
        else if (entries.length) entries[entries.length - 1].lines.push(text);
    }
    return entries;
}

function formatEntry(entry) {
    const [first, ...rest] = entry.lines;
    const kept = rest.slice(0, MAX_STACK_LINES);
    if (rest.length > kept.length) kept.push(`    （还有 ${rest.length - kept.length} 行）`);
    return [first, ...kept].join('\n');
}

/**
 * 最近的 error / warn 记录，最新的在最后。
 * @param {string[]} lines
 * @param {number} max
 * @returns {string[]}
 */
function recentProblems(lines, max) {
    return splitEntries(lines)
        .filter((e) => (e.level === 'error' || e.level === 'warn') && !IGNORED.some((re) => re.test(e.lines[0])))
        .slice(-max)
        .map(formatEntry);
}

module.exports = { readLogTail, recentProblems };
