/**
 * gallery-panel.js — 壁纸页下方的默认壁纸图库
 *
 * 平铺显示（"从电脑选择…"在上面的「我的壁纸」里）。点某张壁纸只是选中（预览跟着变），
 * 和自己的图片一样要点"应用壁纸"才会换上。正在用的那张标"使用中"。
 */

'use strict';

/** 桌面上正在用的壁纸路径（可能是视频，这时默认壁纸都不标"使用中"） */
const currentPathOf = (config) => {
    const current = Shared.myWallpapers.resolveCurrent(config);
    return current ? current.path : '';
};

/** Windows 路径比较：不区分大小写和分隔符写法 */
const normalizePath = (p) => (p || '').toLowerCase().replace(/\//g, '\\');
const samePath = (a, b) => !!a && !!b && normalizePath(a) === normalizePath(b);

/**
 * @param {{ api: object, onSelect: (entry: object) => void }} deps
 * @returns {{
 *   ready: Promise<void>,
 *   find: (imagePath: string) => object|null,
 *   setSelected: (imagePath: string) => void,
 *   setBusy: (busy: boolean) => void,
 * }}
 */
function initGalleryPanel({ api, onSelect }) {
    const { el } = Controls;
    const grid = document.getElementById('gallery-grid');
    const countEl = document.getElementById('gallery-count');

    let entries = [];
    let currentPath = '';
    let selectedPath = '';
    let busy = false;

    const find = (imagePath) => entries.find((e) => samePath(e.file, imagePath)) || null;

    function renderCard(entry) {
        const card = el('button', 'wp' + (samePath(entry.file, selectedPath) ? ' sel' : ''));
        card.type = 'button';
        card.disabled = busy;
        card.title = entry.credit ? `${entry.name}（${entry.credit}）` : entry.name;

        const img = el('img');
        img.src = api.toFileUrl(entry.thumb);
        img.alt = '';
        img.loading = 'lazy';
        card.appendChild(img);
        if (samePath(entry.file, currentPath)) {
            const badge = el('span', 'chip using');
            badge.append(Icons.svg('check'), '使用中');
            card.appendChild(badge);
        }
        card.appendChild(el('span', 'name', entry.name));
        card.addEventListener('click', () => onSelect(entry));
        return card;
    }

    function render() {
        grid.replaceChildren(...entries.map(renderCard));
    }

    // 应用了别的壁纸后，"使用中"标记跟着走
    api.onLoadConfig((config) => {
        const next = currentPathOf(config);
        if (next === currentPath) return;
        currentPath = next;
        render();
    });

    const ready = Promise.all([api.getGallery(), api.getConfig()]).then(([list, config]) => {
        entries = list || [];
        currentPath = currentPathOf(config);
        // 没有图库素材时整组不显示（"从电脑选择"在「我的壁纸」里）
        grid.closest('.group').hidden = entries.length === 0;
        countEl.textContent = entries.length || '';
        render();
    });

    return {
        ready,
        find,
        setSelected(imagePath) {
            selectedPath = imagePath || '';
            render();
        },
        /** 生成深度图期间不让换图 */
        setBusy(value) {
            busy = value;
            render();
        },
    };
}
