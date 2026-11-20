/**
 * controls.js — 设置窗口各页面共用的小工具：建节点、滑块、分段按钮、开关
 */

'use strict';

const Controls = (() => {
    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    /** 代码里给滑块赋值：同时更新已走过部分的颜色 */
    function setRange(input, value) {
        input.value = value;
        UIControls.paintRange(input);
    }

    /**
     * 滑块拖动时更新数值文字并回调。
     * @param {HTMLInputElement} input
     * @param {HTMLElement} valueEl
     * @param {(v: number) => string} format
     * @param {(v: number) => void} onInput
     */
    function bindRange(input, valueEl, format, onInput) {
        UIControls.paintRange(input);
        input.addEventListener('input', () => {
            const v = Number(input.value);
            valueEl.textContent = format(v);
            onInput(v);
        });
    }

    /**
     * 分段按钮（按钮带 data-value），点一下选中并回调。
     * @returns {{ set: (value: string) => void }}
     */
    function segmented(container, onChange) {
        const buttons = [...container.querySelectorAll('button[data-value]')];
        function set(value) {
            for (const b of buttons) {
                const on = b.dataset.value === value;
                b.classList.toggle('on', on);
                b.setAttribute('aria-pressed', String(on));
            }
        }
        container.addEventListener('click', (e) => {
            const b = e.target.closest('button[data-value]');
            if (!b || !container.contains(b)) return;
            set(b.dataset.value);
            onChange(b.dataset.value);
        });
        return { set };
    }

    /** 开关 */
    function switchEl(checked, onChange, title) {
        const root = el('label', 'switch');
        if (title) root.title = title;
        const input = el('input');
        input.type = 'checkbox';
        input.checked = checked;
        input.addEventListener('change', () => onChange(input.checked));
        root.append(input, el('span'));
        return { root, input };
    }

    /** 带图标的按钮 */
    function button(className, iconName, text, title) {
        const b = el('button', className);
        b.type = 'button';
        if (iconName) b.appendChild(Icons.svg(iconName));
        if (text) b.appendChild(document.createTextNode(text));
        if (title) {
            b.title = title;
            if (!text) b.setAttribute('aria-label', title);
        }
        return b;
    }

    /**
     * 问号说明（.help > .help-pop）：默认往上弹，上面放不下（比如页面往下滚过了）就往下弹。
     * 显示和隐藏由 CSS 的 :hover / :focus 负责，这里只在显示前挑方向。
     */
    function initHelpTips(root = document) {
        for (const help of root.querySelectorAll('.help')) {
            const pop = help.querySelector('.help-pop');
            if (!pop) continue;
            const choose = () => {
                const scroller = help.closest('.content') || document.documentElement;
                const roomAbove = help.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
                help.classList.toggle('below', roomAbove < pop.offsetHeight + 16);
            };
            help.addEventListener('mouseenter', choose);
            help.addEventListener('focus', choose);
        }
    }

    /** 手动接上找不到的文件后的提示（api.files.relink 返回的 { to, count }） */
    function relinkMessage({ to, count }) {
        const name = String(to).split(/[\\/]/).pop();
        return count > 1 ? `已找回「${name}」，另外还找回了 ${count - 1} 个` : `已找回「${name}」`;
    }

    /** 文件的 key：不分大小写和斜杠方向 */
    const fileKey = (p) => String(p || '').toLowerCase().replace(/\//g, '\\');

    /**
     * 主进程检查完文件（files:checked）后要不要重画：只比主进程这次查过的路径。
     * 没查过的（网络路径等）这里也不查：每分钟同步查一次，网络盘断了会卡住窗口。
     * @param {Map<string, boolean>} shown - 上次画的时候每个文件在不在，key 用 fileKey
     * @param {{checked?: string[], missing?: string[]}} status
     */
    function fileStatusChanged(shown, status) {
        const missing = new Set(((status && status.missing) || []).map(fileKey));
        return ((status && status.checked) || []).some((p) => {
            const key = fileKey(p);
            return shown.has(key) && shown.get(key) === missing.has(key);
        });
    }

    return { el, setRange, bindRange, segmented, switchEl, button, initHelpTips, relinkMessage, fileKey, fileStatusChanged };
})();
