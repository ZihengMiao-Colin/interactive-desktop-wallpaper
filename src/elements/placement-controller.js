/**
 * placement-controller.js — 摆放模式会话管理（主进程）
 *
 * 同一时间最多一个摆放窗口。会话以三种方式之一结束，onEnd 恰好调用一次：
 *   - commit：保存元素 → 关窗
 *   - cancel：直接关窗
 *   - 意外：窗口被关掉、渲染进程崩溃、窗口无响应 → 按取消处理
 * 这样无论发生什么，都不会留下一个全屏置顶窗口挡住桌面。
 */

class PlacementController {
    /**
     * @param {object} options
     * @param {() => import('electron').BrowserWindow} options.createWindow - 创建摆放窗口
     * @param {(instance: object, draft: object) => void} options.onCommit - 用户确认后保存
     * @param {() => void} options.onEnd - 会话结束（确认或取消）后调用一次
     */
    constructor({ createWindow, onCommit, onEnd }) {
        this._createWindow = createWindow;
        this._onCommit = onCommit;
        this._onEnd = onEnd;
        /** @type {{ win: object, draft: object } | null} */
        this._session = null;
    }

    get active() {
        return this._session !== null;
    }

    /**
     * 开始摆放。已有会话时只把现有窗口拉到前面。
     * @param {{instance: object, asset: object, isNew: boolean}} draft
     * @returns {boolean} 是否开启了新会话
     */
    start(draft) {
        if (this._session) {
            this._session.win.focus();
            return false;
        }

        const win = this._createWindow();
        this._session = { win, draft };

        const cancelIfCurrent = () => {
            if (this._session && this._session.win === win) this._finish(null);
        };
        win.on('closed', cancelIfCurrent);
        win.on('unresponsive', cancelIfCurrent);
        win.webContents.on('render-process-gone', cancelIfCurrent);
        return true;
    }

    getDraft() {
        return this._session ? this._session.draft : null;
    }

    /**
     * 用户确认。
     * @returns {boolean} 没有进行中的会话时返回 false
     */
    commit(instance) {
        if (!this._session) return false;
        this._finish(instance);
        return true;
    }

    cancel() {
        if (this._session) this._finish(null);
    }

    /** 结束会话：先清空状态再关窗，关窗触发的 closed 事件就不会再结束一次 */
    _finish(committedInstance) {
        const { win, draft } = this._session;
        this._session = null;
        if (committedInstance) this._onCommit(committedInstance, draft);
        if (!win.isDestroyed()) win.close();
        this._onEnd();
    }
}

module.exports = { PlacementController };
