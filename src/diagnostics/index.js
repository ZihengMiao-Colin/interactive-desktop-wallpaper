/**
 * diagnostics/index.js — 诊断报告和问题反馈（设置页、托盘、报错提示框共用）
 *
 *   generateReport()      收集 → 拼成 txt → 去掉用户名 → 存到桌面 → 在资源管理器里选中
 *   openGitHubFeedback()  先生成报告，再打开 GitHub 新建 issue 页面（标题、基本信息填好）
 *
 * 用户把 txt 用微信 / QQ 发给开发者，或者拖进 GitHub 的反馈页。设计见
 * docs/superpowers/specs/2026-11-18-diagnostics-design.md。
 */

'use strict';

const path = require('path');
const { redactUserName } = require('./redact');
const { formatReport, issueSummary, reportFileName, saveReport } = require('./report');
const { buildIssueUrl } = require('./github');

/**
 * @param {object} deps
 * @param {() => Promise<object>} deps.collect - 收集信息（collect.js 的 collectDiagnostics，参数由调用方绑好）
 * @param {string} deps.username - os.userInfo().username，报告里要去掉
 * @param {() => string[]} deps.getSaveDirs - 依次尝试的保存位置：桌面、下载、数据目录
 * @param {{showItemInFolder: Function, openExternal: Function}} deps.shell - Electron shell
 * @param {{info: Function, error: Function}} deps.logger
 */
function createDiagnostics({ collect, username, getSaveDirs, shell, logger }) {
    const redact = (text) => redactUserName(text, username);

    /** 生成并保存报告。info 留给 GitHub 反馈用，不返回给设置页 */
    async function build() {
        let info = null;
        try {
            info = await collect();
            const file = saveReport(redact(formatReport(info)), getSaveDirs(), reportFileName(info.generatedAt));
            shell.showItemInFolder(file);
            logger.info('[Diagnostics] 已生成诊断报告:', redact(file));
            return { result: { success: true, path: file, fileName: path.basename(file) }, info };
        } catch (err) {
            logger.error('[Diagnostics] 生成诊断报告失败:', err);
            return { result: { success: false, error: err.message }, info };
        }
    }

    return {
        /** @returns {Promise<{success: boolean, path?: string, fileName?: string, error?: string}>} */
        async generateReport() {
            return (await build()).result;
        },

        /** 报告存不下来也打开反馈页，只是正文里不提拖文件 */
        async openGitHubFeedback() {
            const { result, info } = await build();
            const url = buildIssueUrl({
                version: info && info.app && info.app.version ? info.app.version : '未知',
                summary: info ? issueSummary(info).map(redact) : ['（诊断信息收集失败）'],
                problems: info && Array.isArray(info.problems) ? info.problems.map(redact) : [],
                reportFile: result.success ? result.fileName : null,
            });
            await shell.openExternal(url);
            return result;
        },
    };
}

module.exports = { createDiagnostics };
