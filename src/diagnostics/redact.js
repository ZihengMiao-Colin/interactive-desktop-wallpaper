/**
 * redact.js — 诊断报告发出去之前，把路径里的 Windows 用户名换成占位符
 *
 * 只换 "Users\<用户名>" 这种路径里的用户名：用户名可能是一串数字（比如 24418），
 * 全文替换会把时间戳、耗时之类的数字也换掉。
 */

'use strict';

const PLACEHOLDER = '<用户名>';

/** 路径分隔符：反斜杠（可能是 JSON 转义后的两个）、正斜杠、URL 编码的两种 */
const SEP = String.raw`(?:\\+|/|%5c|%2f)`;

/** 用户名后面必须是分隔符、引号、空白、常见标点或结尾，避免把 Alicex 当成 Alice */
const END = String.raw`(?=${SEP}|["'\s,;:)\]}]|$)`;

/** 8.3 短路径里的用户目录名（TEMP 变量里常见，比如 ALICEW~1） */
const SHORT_NAME = String.raw`[^\\/\s"'%]{1,6}~\d+`;

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @param {string} text
 * @param {string} [username] - os.userInfo().username
 * @returns {string}
 */
function redactUserName(text, username) {
    if (!username || typeof text !== 'string') return text;
    const names = new Set([username, encodeURIComponent(username)]);
    const alternatives = [...names].map(escapeRegExp).concat(SHORT_NAME).join('|');
    const pattern = new RegExp(`(users${SEP})(?:${alternatives})${END}`, 'gi');
    return text.replace(pattern, `$1${PLACEHOLDER}`);
}

module.exports = { redactUserName, PLACEHOLDER };
