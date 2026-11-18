/**
 * error-prompt.js — 主进程出错时的中文提示框（替换 electron-log 默认的英文框）
 *
 * 不能一直弹：同一个错误可能在定时器里反复出现。规则：
 *   - 同一时间只有一个框
 *   - 关掉后 10 分钟内不再弹
 *   - 勾了"本次运行不再提示"就不再弹
 *   - 启动失败（fatal）不受上面两条限制，按钮只有"生成诊断报告" / "退出程序"，生成完也退出
 */

'use strict';

const REPORT = '生成诊断报告';
const IGNORE = '忽略';
const QUIT = '退出程序';

const HINT = '可以生成一份诊断报告（会放在桌面上），发给开发者帮忙找原因。';

const messageOf = (error) => {
    const text = error && error.message ? error.message : String(error);
    return text.length > 500 ? text.slice(0, 500) + '…' : text;
};

/**
 * @param {object} deps
 * @param {(options: object) => Promise<{response: number, checkboxChecked: boolean}>} deps.showDialog - dialog.showMessageBox
 * @param {() => Promise<void>} deps.onReport - 生成诊断报告
 * @param {() => void} deps.onQuit - 退出程序
 * @param {() => number} [deps.now]
 * @param {number} [deps.minIntervalMs]
 */
function createErrorPrompt({ showDialog, onReport, onQuit, now = Date.now, minIntervalMs = 10 * 60 * 1000 }) {
    let open = false;
    let muted = false;
    let closedAt = -Infinity;

    function dialogOptions(error, fatal) {
        if (fatal) {
            return {
                type: 'error',
                title: '互动3D壁纸',
                message: '程序启动失败',
                detail: `${messageOf(error)}\n\n${HINT}`,
                buttons: [REPORT, QUIT],
                defaultId: 0,
                cancelId: 1,
                noLink: true,
            };
        }
        return {
            type: 'error',
            title: '互动3D壁纸',
            message: '程序出错了',
            detail: `${messageOf(error)}\n\n${HINT}点"${IGNORE}"可以接着用，之后不正常的话重新打开程序就好。`,
            buttons: [REPORT, IGNORE, QUIT],
            defaultId: 0,
            cancelId: 1,
            noLink: true,
            checkboxLabel: '本次运行不再提示',
        };
    }

    /**
     * @param {unknown} error
     * @param {{fatal?: boolean}} [options]
     * @returns {Promise<void>} 不会 reject
     */
    async function notify(error, { fatal = false } = {}) {
        if (open) return;
        if (!fatal && (muted || now() - closedAt < minIntervalMs)) return;

        open = true;
        const options = dialogOptions(error, fatal);
        let result;
        try {
            result = await showDialog(options);
        } catch (err) {
            console.error('[ErrorPrompt] 弹不出提示框:', err && err.message);
            open = false;
            return;
        }
        open = false;
        closedAt = now();
        if (result.checkboxChecked) muted = true;

        const choice = options.buttons[result.response];
        if (choice === REPORT) {
            try {
                await onReport();
            } catch (err) {
                console.error('[ErrorPrompt] 生成诊断报告失败:', err && err.message);
            }
            if (fatal) onQuit();
        } else if (choice === QUIT) {
            onQuit();
        }
    }

    return { notify };
}

module.exports = { createErrorPrompt };
