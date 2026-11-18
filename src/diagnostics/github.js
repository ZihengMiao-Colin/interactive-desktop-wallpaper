/**
 * github.js — 拼"到 GitHub 反馈"要打开的新建 issue 地址（标题、正文预先填好）
 *
 * 地址太长浏览器 / GitHub 会拒绝，中文每个字编码后占 9 个字符，所以错误条数和长度都要控制。
 * 报告文件没法通过地址带过去，正文里提示用户把桌面上的 txt 拖进来。
 */

'use strict';

const REPO_URL = 'https://github.com/ZihengMiao-Colin/interactive-desktop-wallpaper';

/** 整个地址的上限（GitHub 大约 8000 以上会报错，留余量） */
const DEFAULT_MAX_LENGTH = 6000;
/** 最多带几条最近的错误、每条最多多少字 */
const MAX_PROBLEMS = 5;
const MAX_PROBLEM_CHARS = 300;

const clip = (text, max) => (text.length > max ? text.slice(0, max) + '…' : text);

function issueBody({ summary, problems, reportFile }) {
    const lines = [
        '## 遇到了什么问题',
        '',
        '（请写一下：做了什么操作、看到了什么、本来应该是什么样。有截图可以直接粘贴进来）',
        '',
    ];
    if (reportFile) {
        // 不写"桌面上的"：桌面写不进去时报告存在"下载"里。资源管理器已经选中了它
        lines.push('## 诊断报告', '', `请把刚生成的 \`${reportFile}\`（已经在文件夹里选中了）拖到这个输入框里上传。`, '');
    }
    lines.push('## 基本信息（自动填写）', '', ...summary.map((s) => `- ${s}`));
    if (problems.length) lines.push('', '最近的错误：', '```', ...problems, '```');
    return lines.join('\n');
}

/**
 * @param {{version: string, summary: string[], problems: string[], reportFile: string|null, maxLength?: number}} options
 *   problems 旧的在前；reportFile 是报告的文件名（生成失败时传 null）
 * @returns {string}
 */
function buildIssueUrl({ version, summary, problems, reportFile, maxLength = DEFAULT_MAX_LENGTH }) {
    const title = `问题反馈（v${version}）：`;
    const make = (list) => `${REPO_URL}/issues/new?`
        + new URLSearchParams({ title, body: issueBody({ summary, problems: list, reportFile }) }).toString();

    // 太长时先去掉旧的错误，只剩一条还太长就把它截短，再不行就不带错误
    let list = problems.slice(-MAX_PROBLEMS).map((p) => clip(p, MAX_PROBLEM_CHARS));
    let url = make(list);
    while (url.length > maxLength && list.length > 1) {
        list = list.slice(1);
        url = make(list);
    }
    let last = list[0];
    while (url.length > maxLength && last && last.length > 40) {
        last = last.slice(0, Math.floor(last.length * 0.7));
        url = make([last + '…']);
    }
    return url.length > maxLength ? make([]) : url;
}

module.exports = { buildIssueUrl, REPO_URL };
