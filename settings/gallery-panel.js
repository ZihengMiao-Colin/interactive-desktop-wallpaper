/**
 * gallery-panel.js — 设置窗口里可折叠的"默认壁纸"面板
 *
 * 默认收起；点标题栏展开 / 收起。点某张壁纸只是选中（预览跟着变），
 * 和自己的图片一样要点"应用壁纸"才会换上。正在用的那张标"当前"。
 */

'use strict';

/**
 * @param {{ api: object, onSelect: (entry: object) => void }} deps
 * @returns {{ ready: Promise<void>, find: (imagePath: string) => object|null, setSelected: (imagePath: string) => void }}
 */
function initGalleryPanel({ api, onSelect }) {
    const panel = document.getElementById('gallery-panel');
    const toggle = document.getElementById('gallery-toggle');
    const grid = document.getElementById('gallery-grid');
    const countEl = document.getElementById('gallery-count');
    const hintEl = document.getElementById('gallery-hint');

    let entries = [];
    let currentPath = '';
    let selectedPath = '';
    let expanded = false;

    /** Windows 路径比较：不区分大小写和分隔符写法 */
    const normalize = (p) => (p || '').toLowerCase().replace(/\//g, '\\');
    const samePath = (a, b) => !!a && !!b && normalize(a) === normalize(b);
    const find = (imagePath) => entries.find((e) => samePath(e.file, imagePath)) || null;

    function renderHint() {
        const current = find(currentPath);
        if (expanded) hintEl.textContent = '点击收起';
        else hintEl.textContent = current ? `当前：${current.name} · 点击展开` : '点击展开';
    }

    function renderCard(entry) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'gallery-card' + (samePath(entry.file, selectedPath) ? ' selected' : '');
        card.title = entry.credit ? `${entry.name}（${entry.credit}）` : entry.name;

        if (entry.thumb) {
            const img = document.createElement('img');
            img.src = api.toFileUrl(entry.thumb);
            img.alt = entry.name;
            img.loading = 'lazy';
            card.appendChild(img);
        }
        if (samePath(entry.file, currentPath)) {
            const badge = document.createElement('span');
            badge.className = 'gallery-current-badge';
            badge.textContent = '当前';
            card.appendChild(badge);
        }
        const name = document.createElement('div');
        name.className = 'gallery-card-name';
        name.textContent = entry.name;
        card.appendChild(name);

        card.addEventListener('click', () => onSelect(entry));
        return card;
    }

    function render() {
        grid.replaceChildren(...entries.map(renderCard));
        renderHint();
    }

    toggle.addEventListener('click', () => {
        expanded = !expanded;
        grid.hidden = !expanded;
        panel.classList.toggle('open', expanded);
        toggle.setAttribute('aria-expanded', String(expanded));
        renderHint();
    });

    // 应用了别的壁纸后，"当前"标记跟着走
    api.onLoadConfig((config) => {
        const next = (config && config.currentImage) || '';
        if (next === currentPath) return;
        currentPath = next;
        render();
    });

    const ready = Promise.all([api.getGallery(), api.getConfig()]).then(([list, config]) => {
        entries = list || [];
        currentPath = (config && config.currentImage) || '';
        countEl.textContent = entries.length;
        panel.hidden = entries.length === 0;
        render();
    });

    return {
        ready,
        find,
        setSelected(imagePath) {
            selectedPath = imagePath || '';
            render();
        },
    };
}
