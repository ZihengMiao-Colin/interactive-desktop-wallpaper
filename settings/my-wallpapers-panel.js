/**
 * my-wallpapers-panel.js — 壁纸页的「我的壁纸」：用户自己选过的图片和视频
 *
 * 一直显示，第一格永远是"从电脑选择…"（图片或视频），后面按最近用过的排。
 * 视频左下角标 ▶ 和时长；原文件找不到的格子显示"找不到文件"；悬停右上角的 × 从列表移除（不删原文件）。
 * 只记路径，不复制文件。没有缩略图的条目（升级迁移、托盘加的图片）在这里补生成。
 */

'use strict';

/**
 * @param {{
 *   api: object,
 *   onSelect: (entry: object) => void,
 *   onPick: () => void,
 *   setStatus: (msg: string, cls?: string) => void,
 * }} deps
 * @returns {{ ready: Promise<void>, setSelected: (path: string) => void, setBusy: (busy: boolean) => void }}
 */
function initMyWallpapersPanel({ api, onSelect, onPick, setStatus }) {
    const { el } = Controls;
    const MW = Shared.myWallpapers;
    const grid = document.getElementById('mine-grid');
    const countEl = document.getElementById('mine-count');
    const hintEl = document.getElementById('mine-hint');

    let list = [];
    let currentPath = '';
    let selectedPath = '';
    let busy = false;
    /** 已经试过补缩略图的文件（失败了也不再试，留空白底） */
    const thumbTried = new Set();

    const fileName = (p) => p.split(/[\\/]/).pop();

    /** 没有缩略图、文件还在：生成一张存起来（存好后配置广播回来会重画） */
    function fillThumb(entry) {
        if (thumbTried.has(entry.path)) return;
        thumbTried.add(entry.path);
        makeThumbnailInfo(api.toFileUrl(entry.path), entry.type)
            .then((info) => api.myWallpapers.setThumb(entry.path, info.dataUrl))
            .catch((err) => console.warn('补生成缩略图失败:', entry.path, err.message));
    }

    function renderAddCard() {
        const card = el('button', 'wp add');
        card.type = 'button';
        card.disabled = busy;
        const box = el('span', 'box');
        const inner = el('span');
        inner.append(Icons.svg('image-plus'), '从电脑选择…', el('small', '', '图片或视频'));
        box.appendChild(inner);
        // 名字那一行放一个不会被折叠的空格，和别的格子一样高（否则按钮会把内容竖直居中，往下错开）
        card.append(box, el('span', 'name', ' '));
        card.addEventListener('click', () => onPick());
        return card;
    }

    function renderCard(entry) {
        const exists = api.fileExists(entry.path);
        const card = el('button', 'wp' + (MW.samePath(entry.path, selectedPath) ? ' sel' : '') + (exists ? '' : ' missing'));
        card.type = 'button';
        card.disabled = busy;
        card.title = entry.path;

        const thumbOk = entry.thumb && api.fileExists(entry.thumb);
        if (thumbOk) {
            const img = el('img');
            img.src = api.toFileUrl(entry.thumb);
            img.alt = '';
            img.loading = 'lazy';
            card.appendChild(img);
        } else {
            card.appendChild(el('span', 'thumb-empty'));
            if (exists) fillThumb(entry);
        }

        if (!exists) {
            const chip = el('span', 'chip warn missing-chip');
            chip.append(Icons.svg('circle-alert'), '找不到文件');
            card.appendChild(chip);
        } else if (MW.samePath(entry.path, currentPath)) {
            const badge = el('span', 'chip using');
            badge.append(Icons.svg('check'), '使用中');
            card.appendChild(badge);
        }
        if (entry.type === 'video') {
            const dur = el('span', 'dur');
            const label = el('span');
            label.append(Icons.svg('play'), MW.formatDuration(entry.duration));
            dur.appendChild(label);
            card.appendChild(dur);
        }

        // 移除：按钮里不能再套按钮，用带 role 的 span
        const remove = el('span', 'rm');
        remove.setAttribute('role', 'button');
        remove.tabIndex = 0;
        remove.title = '从列表里移除（不删原文件）';
        remove.setAttribute('aria-label', '从列表里移除');
        remove.appendChild(Icons.svg('x'));
        const doRemove = (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (busy) return;
            api.myWallpapers.remove(entry.path).catch((err) => setStatus('移除失败：' + err.message, 'error'));
        };
        remove.addEventListener('click', doRemove);
        remove.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') doRemove(e);
        });
        card.appendChild(remove);

        card.appendChild(el('span', 'name', fileName(entry.path)));
        card.addEventListener('click', () => {
            if (!api.fileExists(entry.path)) {
                setStatus('找不到这个文件，可能被移动或删除了', 'error');
                return;
            }
            onSelect(entry);
        });
        return card;
    }

    function render() {
        grid.replaceChildren(renderAddCard(), ...list.map(renderCard));
        countEl.textContent = list.length || '';
        hintEl.textContent = list.length ? '只记住位置，原文件挪走后会失效' : '你自己的图片和视频';
    }

    /** 上一次画的时候的列表和当前壁纸（拖滑块时每秒广播好几次配置，没变就不重画，免得反复查文件在不在） */
    let renderedKey = '';

    function refresh(config) {
        if (!config) return;
        const nextList = MW.normalizeList(config.myWallpapers);
        const current = MW.resolveCurrent(config);
        const nextPath = current ? current.path : '';
        const key = JSON.stringify([nextList, nextPath]);
        if (key === renderedKey) return;
        renderedKey = key;
        list = nextList;
        currentPath = nextPath;
        render();
    }

    api.onLoadConfig(refresh);
    const ready = api.getConfig().then(refresh);

    return {
        ready,
        setSelected(filePath) {
            selectedPath = filePath || '';
            render();
        },
        /** 生成深度图期间不让换 */
        setBusy(value) {
            busy = value;
            render();
        },
    };
}
