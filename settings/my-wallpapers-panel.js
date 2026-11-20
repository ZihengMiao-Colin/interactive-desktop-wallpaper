/**
 * my-wallpapers-panel.js — 壁纸页的「我的壁纸」：用户自己选过的图片和视频
 *
 * 一直显示，第一格永远是"从电脑选择…"（图片或视频），后面按最近用过的排。
 * 视频左下角标 ▶ 和时长；原文件找不到的格子显示"找不到文件"，点它选文件现在的位置（同一个旧文件夹里别的顺带接上）；
 * 悬停右上角有裁剪按钮和 ×（从列表移除，不删原文件）。
 * 只记路径，不复制文件；同一个盘里挪动、改名由主进程自动找回（src/file-tracking）。
 * 没有缩略图的条目（升级迁移、托盘加的图片）在这里补生成。
 */

'use strict';

/**
 * @param {{
 *   api: object,
 *   onSelect: (entry: object) => void,
 *   onPick: () => void,
 *   onCrop: (entry: object) => void,
 *   setStatus: (msg: string, cls?: string) => void,
 * }} deps
 * @returns {{ ready: Promise<void>, setSelected: (path: string) => void, setBusy: (busy: boolean) => void }}
 */
function initMyWallpapersPanel({ api, onSelect, onPick, onCrop, setStatus }) {
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
        makeThumbnailInfo(api.toFileUrl(entry.path), entry.type, entry.crop)
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
        card.title = exists ? entry.path : `找不到文件，点一下选它现在的位置\n原来在：${entry.path}`;

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

        // 悬停出现的小按钮：按钮里不能再套按钮，用带 role 的 span
        const cornerButton = (className, icon, title, label, action) => {
            const node = el('span', className);
            node.setAttribute('role', 'button');
            node.tabIndex = 0;
            node.title = title;
            node.setAttribute('aria-label', label);
            node.appendChild(Icons.svg(icon));
            const run = (e) => {
                e.stopPropagation();
                e.preventDefault();
                if (!busy) action();
            };
            node.addEventListener('click', run);
            node.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') run(e);
            });
            return node;
        };
        if (exists) card.appendChild(cornerButton('cr', 'crop', '裁剪', '裁剪', () => onCrop(entry)));
        card.appendChild(cornerButton('rm', 'x', '从列表里移除（不删原文件）', '从列表里移除', () => {
            api.myWallpapers.remove(entry.path).catch((err) => setStatus('移除失败：' + err.message, 'error'));
        }));

        card.appendChild(el('span', 'name', fileName(entry.path)));
        card.addEventListener('click', () => {
            if (!api.fileExists(entry.path)) {
                relink(entry);
                return;
            }
            onSelect(entry);
        });
        return card;
    }

    /** 找不到的格子：让用户选它现在的位置，接上后按新文件重新生成缩略图（选的可能不是原来那个文件） */
    async function relink(entry) {
        try {
            const result = await api.files.relink(entry.path);
            if (!result || result.canceled) return;
            if (result.error) {
                setStatus(result.error, 'error');
                return;
            }
            setStatus(Controls.relinkMessage(result), 'success');
            thumbTried.add(result.to);
            makeThumbnailInfo(api.toFileUrl(result.to), entry.type, entry.crop)
                .then((info) => api.myWallpapers.setThumb(result.to, info.dataUrl))
                .catch((err) => console.warn('重新生成缩略图失败:', result.to, err.message));
        } catch (err) {
            setStatus('重新找文件失败：' + err.message, 'error');
        }
    }

    /** 哪些格子的文件找不到（主进程检查完文件后和上次画的比，变了才重画） */
    const missingKey = () => list.map((e) => (api.fileExists(e.path) ? '1' : '0')).join('');
    let renderedMissing = '';

    function render() {
        renderedMissing = missingKey();
        grid.replaceChildren(renderAddCard(), ...list.map(renderCard));
        countEl.textContent = list.length || '';
        hintEl.textContent = list.length ? '同一个盘里挪动、改名会自动找回' : '你自己的图片和视频';
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
    // 设置页开着时文件被挪走、又没自动找回来：配置没变，靠这个把"找不到文件"显示出来
    api.files.onChecked(() => {
        if (missingKey() !== renderedMissing) render();
    });

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
