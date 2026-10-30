/**
 * gallery-panel.js — 壁纸页下方的默认壁纸图库
 *
 * 平铺显示，第一格是"从电脑选择…"（放在最后的话不往下翻就看不到）。点某张壁纸只是选中（预览跟着变），
 * 和自己的图片一样要点"应用壁纸"才会换上。正在用的那张标"使用中"。
 */

'use strict';

/** Windows 路径比较：不区分大小写和分隔符写法 */
const normalizePath = (p) => (p || '').toLowerCase().replace(/\//g, '\\');
const samePath = (a, b) => !!a && !!b && normalizePath(a) === normalizePath(b);

/**
 * @param {{ api: object, onSelect: (entry: object) => void, onPickFile: () => void }} deps
 * @returns {{
 *   ready: Promise<void>,
 *   find: (imagePath: string) => object|null,
 *   setSelected: (imagePath: string) => void,
 *   setBusy: (busy: boolean) => void,
 * }}
 */
function initGalleryPanel({ api, onSelect, onPickFile }) {
    const { el } = Controls;
    const grid = document.getElementById('gallery-grid');
    const titleEl = document.getElementById('gallery-title');
    const countEl = document.getElementById('gallery-count');
    const hintEl = document.getElementById('gallery-hint');

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

    function renderAddCard() {
        const card = el('button', 'wp add');
        card.type = 'button';
        card.disabled = busy;
        const box = el('span', 'box');
        const inner = el('span');
        inner.append(Icons.svg('image-plus'), '从电脑选择…');
        box.appendChild(inner);
        card.append(box, el('span', 'name', ' '));
        card.addEventListener('click', () => onPickFile());
        return card;
    }

    function render() {
        grid.replaceChildren(renderAddCard(), ...entries.map(renderCard));
    }

    // 应用了别的壁纸后，"使用中"标记跟着走
    api.onLoadConfig((config) => {
        const next = (config && config.currentImage) || '';
        if (next === currentPath) return;
        currentPath = next;
        render();
    });

    const ready = Promise.all([api.getGallery(), api.getConfig()]).then(([list, config]) => {
        entries = list || [];
        currentPath = (config && config.currentImage) || '';
        // 没有图库素材时只剩"从电脑选择"
        titleEl.textContent = entries.length ? '默认壁纸' : '选择壁纸';
        countEl.textContent = entries.length || '';
        hintEl.hidden = entries.length === 0;
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
