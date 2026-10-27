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

    return { el, setRange, bindRange, segmented, switchEl, button };
})();
