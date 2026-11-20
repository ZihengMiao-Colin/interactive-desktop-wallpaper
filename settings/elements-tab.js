/**
 * elements-tab.js — 设置窗口"元素"页
 *
 * 上面是素材库（默认元素 + 自己添加的 + "添加素材"格），点素材进入摆放模式；
 * 下面左右两栏：左边是壁纸上的元素列表（可直接显示 / 隐藏），右边是选中元素的调整面板，
 * 分成"位置 / 颜色 / 播放 / 抠像"几个标签，一次只显示一组；标题栏里是重新摆放、显示 / 隐藏和删除。
 * 位置、大小、旋转、翻转、变形都在摆放模式里直接在壁纸上调。
 */

'use strict';

/** 滑块改动后等多久再保存 */
const ELEMENTS_SAVE_DEBOUNCE_MS = 150;
/** 用户正在操作控件时，推迟这么久再重绘，避免拖到一半控件被替换 */
const ELEMENTS_RENDER_HOLD_MS = 800;

const TYPE_LABEL = { image: '图片', animated: 'GIF', video: '视频' };
const MODE_LABEL = { static: '静止', loop: '循环', interval: '间隔播放', click: '点击播放' };
/** 点击播放两种待命方式的说明 */
const CLICK_HINT = {
    follow: '平时隐藏，点击桌面空白处就在那里播放一次',
    element: '平时停在第一帧，点中它时播放一次',
};
/** 调整面板的标签 */
const TAB_LABEL = { position: '位置', color: '颜色', playback: '播放', chroma: '抠像' };
/** 标签带小点时的提示 */
const TAB_MARK_TITLE = { color: '颜色调过', chroma: '绿幕抠像已打开' };

/**
 * @param {{ api: object, setStatus: (msg: string, cls?: string) => void, setBadge: (page: string, text: string) => void }} deps
 */
function initElementsTab({ api, setStatus, setBadge }) {
    if (!api) return;
    const { el, button, segmented, switchEl, setRange } = Controls;

    const importBtn = document.getElementById('btn-import-element');
    const assetGrid = document.getElementById('elements-assets');
    const instanceList = document.getElementById('elements-instance-list');
    const detail = document.getElementById('elements-detail');
    const countEl = document.getElementById('elements-count');

    let builtinAssets = [];
    let elements = { library: [], instances: [] };
    /** 右栏正在显示的元素 */
    let selectedId = null;
    /** 右栏当前标签：切换元素、重绘时沿用 */
    let activeTab = 'position';
    let holdUntil = 0;
    let pendingRender = null;
    const saveTimers = new Map();

    // ---------- 小工具 ----------

    function findAsset(assetId) {
        return builtinAssets.find((a) => a.id === assetId) || elements.library.find((a) => a.id === assetId) || null;
    }

    function thumbNode(asset) {
        const wrap = el('span', 'thumb');
        if (asset && asset.thumb && api.fileExists(asset.thumb)) {
            const img = el('img');
            img.src = api.toFileUrl(asset.thumb);
            img.alt = '';
            wrap.appendChild(img);
        } else {
            wrap.appendChild(Icons.svg(asset && asset.type === 'video' ? 'play' : 'image'));
        }
        return wrap;
    }

    /** 记录"用户刚操作过控件"，期间收到的配置广播延后重绘 */
    function hold() {
        holdUntil = Date.now() + ELEMENTS_RENDER_HOLD_MS;
    }

    function saveInstance(instanceId, patch, immediate) {
        hold();
        clearTimeout(saveTimers.get(instanceId));
        const run = () => api.elements.updateInstance(instanceId, patch);
        if (immediate) run();
        else saveTimers.set(instanceId, setTimeout(run, ELEMENTS_SAVE_DEBOUNCE_MS));
    }

    function startPlacement(target, name) {
        return api.elements.startPlacement(target).then((started) => {
            setStatus(started ? `正在摆放「${name}」：拖动移动，角点缩放，上方圆点旋转，Enter 确认` : '摆放窗口已经打开', started ? '' : 'error');
        });
    }

    // ---------- 素材库 ----------

    function renderAssetCard(asset) {
        const missing = !api.fileExists(asset.file);
        const card = el('div', 'asset panel' + (missing ? ' missing' : ''));
        card.tabIndex = 0;
        card.setAttribute('role', 'button');
        card.title = missing ? '文件丢失：' + asset.file : '放到壁纸上';
        card.appendChild(thumbNode(asset));
        const place = el('span', 'place');
        const pill = el('span');
        pill.append(Icons.svg('move'), '放到壁纸上');
        place.appendChild(pill);
        if (!missing) card.appendChild(place);
        const name = el('span', 'name');
        name.append(el('b', '', asset.name), el('span', 'type', missing ? '文件丢失' : (TYPE_LABEL[asset.type] || asset.type)));
        card.appendChild(name);

        const activate = () => {
            if (missing) {
                setStatus('素材文件丢失，用不了：' + asset.name, 'error');
                return;
            }
            startPlacement({ assetId: asset.id }, asset.name);
        };
        card.addEventListener('click', activate);
        card.addEventListener('keydown', (e) => {
            if (e.target !== card || (e.key !== 'Enter' && e.key !== ' ')) return;
            e.preventDefault();
            activate();
        });

        if (!asset.builtin) {
            const remove = button('remove', 'x', '', '从素材库移除');
            remove.addEventListener('click', async (e) => {
                e.stopPropagation();
                const count = elements.instances.filter((i) => i.assetId === asset.id).length;
                if (count > 0 && !confirm(`壁纸上有 ${count} 个这个元素，会一起删除，确定吗？`)) return;
                await api.elements.removeAsset(asset.id);
                setStatus('已移除：' + asset.name);
            });
            card.appendChild(remove);
        }
        return card;
    }

    function renderAddCard() {
        const card = el('button', 'asset add panel');
        card.type = 'button';
        const inner = el('span');
        inner.append(Icons.svg('image-plus'), '添加素材');
        card.appendChild(inner);
        card.addEventListener('click', importAsset);
        return card;
    }

    function renderAssets() {
        assetGrid.replaceChildren(...builtinAssets.map(renderAssetCard), ...elements.library.map(renderAssetCard), renderAddCard());
    }

    // ---------- 壁纸上的元素：左栏列表 ----------

    function playbackSummary(instance, asset) {
        if (!asset) return '素材已丢失';
        const mode = asset.type === 'image' ? 'static' : instance.playback.mode;
        let text = MODE_LABEL[mode] || mode;
        if (mode === 'interval') text = `间隔播放，每 ${instance.playback.intervalSec} 秒`;
        else if (mode === 'click') text = instance.playback.followClick ? '点击播放，在点击处出现' : '点击播放';
        return instance.visible ? text : text + '，已隐藏';
    }

    function renderListItem(instance) {
        const asset = findAsset(instance.assetId);
        // 列表项里还有一个"显示 / 隐藏"按钮，所以列表项本身不用 <button>
        const item = el('div', 'inst');
        item.tabIndex = 0;
        item.setAttribute('role', 'button');
        item.classList.toggle('on', instance.id === selectedId);
        item.classList.toggle('off', !instance.visible);
        item.classList.toggle('missing', !asset);
        item.appendChild(thumbNode(asset));
        const tx = el('span', 'tx');
        tx.append(el('b', '', asset ? asset.name : '素材已丢失'), el('small', '', playbackSummary(instance, asset)));
        item.appendChild(tx);

        const eye = button('eye', instance.visible ? 'eye' : 'eye-off', '', instance.visible ? '隐藏' : '显示');
        eye.addEventListener('click', (e) => {
            e.stopPropagation();
            api.elements.updateInstance(instance.id, { visible: !instance.visible });
        });
        item.appendChild(eye);

        const select = () => {
            if (selectedId === instance.id) return;
            selectedId = instance.id;
            renderInstances();
        };
        item.addEventListener('click', select);
        item.addEventListener('keydown', (e) => {
            if (e.target !== item || (e.key !== 'Enter' && e.key !== ' ')) return;
            e.preventDefault();
            select();
        });
        return item;
    }

    // ---------- 壁纸上的元素：右栏调整面板（分页：一次只显示一组） ----------

    /** 一行：标签 + 控件 + 数值 */
    function drow(label, control, valueEl) {
        const row = el('div', 'drow');
        row.append(el('label', '', label), control, valueEl || el('span'));
        return row;
    }

    function rangeRow(label, min, max, value, format, onInput, className) {
        const input = el('input', className || '');
        input.type = 'range';
        input.min = min;
        input.max = max;
        setRange(input, value);
        const valueEl = el('span', 'value', format(value));
        input.addEventListener('input', () => {
            const v = parseInt(input.value, 10);
            valueEl.textContent = format(v);
            onInput(v);
        });
        let control = input;
        if (className === 'depth') {
            control = el('div', 'depth-range');
            control.append('远', input, '近');
        }
        return drow(label, control, valueEl);
    }

    /** 位置：深度、不透明度 */
    function renderPositionPane(instance) {
        const id = instance.id;
        return [
            rangeRow('深度', 0, 100, Math.round(instance.depth * 100),
                (v) => (v / 100).toFixed(2), (v) => saveInstance(id, { depth: v / 100 }), 'depth'),
            rangeRow('不透明度', 10, 100, Math.round(instance.opacity * 100),
                (v) => v + '%', (v) => saveInstance(id, { opacity: v / 100 })),
            el('div', 'note', '大小、旋转、翻转和变形在摆放模式里直接拖。'),
        ];
    }

    /** 颜色：色相、饱和度、亮度、染色（"恢复原色"在标签栏右端） */
    function renderColorPane(instance) {
        const id = instance.id;
        const fx = Shared.elements.effectsOf(instance);
        const rows = [
            rangeRow('色相', -180, 180, Math.round(fx.hue),
                (v) => (v > 0 ? '+' : '') + v + '°', (v) => saveInstance(id, { effects: { hue: v } }), 'hue'),
            rangeRow('饱和度', 0, 200, Math.round(fx.saturation * 100),
                (v) => v + '%', (v) => saveInstance(id, { effects: { saturation: v / 100 } })),
            rangeRow('亮度', 20, 200, Math.round(fx.brightness * 100),
                (v) => v + '%', (v) => saveInstance(id, { effects: { brightness: v / 100 } })),
        ];

        // 染色：色块（点开选颜色）+ 强度滑块
        const swatch = el('label', 'swatch');
        swatch.title = '染色颜色';
        swatch.style.background = fx.tint;
        const color = el('input');
        color.type = 'color';
        color.value = fx.tint;
        color.addEventListener('input', () => {
            swatch.style.background = color.value;
            saveInstance(id, { effects: { tint: color.value } });
        });
        swatch.appendChild(color);
        const amount = el('input');
        amount.type = 'range';
        amount.min = 0;
        amount.max = 100;
        setRange(amount, Math.round(fx.tintAmount * 100));
        const amountVal = el('span', 'value', amount.value + '%');
        amount.addEventListener('input', () => {
            amountVal.textContent = amount.value + '%';
            saveInstance(id, { effects: { tintAmount: parseInt(amount.value, 10) / 100 } });
        });
        const tint = el('div', 'tint');
        tint.append(swatch, amount);
        rows.push(drow('染色', tint, amountVal));
        return rows;
    }

    /** 播放：方式（循环 / 间隔播放 / 点击播放）和对应的选项 */
    function renderPlaybackPane(instance) {
        const id = instance.id;

        const seg = el('div', 'seg');
        for (const mode of ['loop', 'interval', 'click']) {
            const b = el('button', '', MODE_LABEL[mode]);
            b.type = 'button';
            b.dataset.value = mode;
            seg.appendChild(b);
        }
        const segWrap = el('div');
        segWrap.appendChild(seg);
        const modeRow = drow('方式', segWrap);

        const intervalRow = rangeRow('播完等待', 1, 120, instance.playback.intervalSec,
            (v) => v + ' 秒', (v) => saveInstance(id, { playback: { intervalSec: v } }));

        // 点击播放：在点击位置出现，或者点中元素时播放
        const clickHint = el('div', 'note');
        const follow = switchEl(!!instance.playback.followClick, (on) => {
            clickHint.textContent = on ? CLICK_HINT.follow : CLICK_HINT.element;
            saveInstance(id, { playback: { followClick: on } }, true);
        });
        clickHint.textContent = follow.input.checked ? CLICK_HINT.follow : CLICK_HINT.element;
        const followWrap = el('div');
        followWrap.appendChild(follow.root);
        const followRow = drow('点击处出现', followWrap);

        let mode = ['interval', 'click'].includes(instance.playback.mode) ? instance.playback.mode : 'loop';
        const showModeRows = () => {
            intervalRow.hidden = mode !== 'interval';
            followRow.hidden = mode !== 'click';
            clickHint.hidden = mode !== 'click';
        };
        const control = segmented(seg, (value) => {
            mode = value;
            showModeRows();
            saveInstance(id, { playback: { mode: value } }, true);
        });
        control.set(mode);
        showModeRows();
        return [modeRow, intervalRow, followRow, clickHint];
    }

    /** 抠像：绿幕抠像开关，打开后才显示强度 */
    function renderChromaPane(instance, setMark) {
        const id = instance.id;
        const strengthRow = rangeRow('抠像强度', 0, 100, Math.round(instance.chroma.strength * 100),
            (v) => v + '%', (v) => saveInstance(id, { chroma: { strength: v / 100 } }));
        strengthRow.hidden = !instance.chroma.enabled;
        const toggle = switchEl(instance.chroma.enabled, (on) => {
            strengthRow.hidden = !on;
            setMark('chroma', on);
            saveInstance(id, { chroma: { enabled: on } }, true);
        }, '绿幕抠像');
        const toggleWrap = el('div');
        toggleWrap.appendChild(toggle.root);
        return [drow('绿幕抠像', toggleWrap), strengthRow];
    }

    const PANES = {
        position: renderPositionPane,
        color: renderColorPane,
        playback: renderPlaybackPane,
        chroma: renderChromaPane,
    };

    /** 标签栏 + 一个标签内容区。切标签只换内容区；当前标签记在 activeTab，重绘时沿用 */
    function renderTabs(instance, asset) {
        // 图片没有播放和抠像（和以前一致）
        const tabs = asset.type === 'image' ? ['position', 'color'] : ['position', 'color', 'playback', 'chroma'];
        if (!tabs.includes(activeTab)) activeTab = 'position';

        const bar = el('div', 'dtabs');
        const list = el('div', 'dtab-list');
        list.setAttribute('role', 'tablist');
        list.setAttribute('aria-label', '调整项');
        const pane = el('div', 'dpane');
        pane.id = 'elements-pane';
        pane.setAttribute('role', 'tabpanel');

        const tabButtons = tabs.map((tab) => {
            const b = el('button', 'dtab');
            b.type = 'button';
            b.id = 'elements-tab-' + tab;
            b.dataset.tab = tab;
            b.setAttribute('role', 'tab');
            b.setAttribute('aria-controls', pane.id);
            b.append(el('span', '', TAB_LABEL[tab]), el('i', 'dot'));
            b.addEventListener('click', () => show(tab));
            return b;
        });
        list.append(...tabButtons);

        // 藏在别的标签里、和默认不一样的设置：标签上带一个小点
        function setMark(tab, on) {
            const b = tabButtons.find((x) => x.dataset.tab === tab);
            if (!b) return;
            b.classList.toggle('marked', on);
            b.title = on ? TAB_MARK_TITLE[tab] : '';
        }
        setMark('color', Shared.elements.effectsAdjusted(instance));
        setMark('chroma', !!(instance.chroma && instance.chroma.enabled));

        const reset = button('btn sm ghost', null, '恢复原色');
        reset.addEventListener('click', () => {
            // 不走 hold：希望收到新配置后立刻重绘，滑块回到默认位置
            clearTimeout(saveTimers.get(instance.id));
            holdUntil = 0;
            api.elements.updateInstance(instance.id, { effects: { ...Shared.elements.DEFAULT_EFFECTS } });
        });
        const end = el('span', 'end');
        end.appendChild(reset);
        bar.append(list, end);

        function show(tab, focus) {
            activeTab = tab;
            for (const b of tabButtons) {
                const on = b.dataset.tab === tab;
                b.classList.toggle('on', on);
                b.setAttribute('aria-selected', String(on));
                b.tabIndex = on ? 0 : -1;
                if (on && focus) b.focus();
            }
            pane.setAttribute('aria-labelledby', 'elements-tab-' + tab);
            pane.replaceChildren(...PANES[tab](instance, setMark));
            reset.hidden = tab !== 'color';
        }

        // 左右方向键、Home / End 在标签间切换
        list.addEventListener('keydown', (e) => {
            const i = tabs.indexOf(activeTab);
            let next = null;
            if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
            else if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
            else if (e.key === 'Home') next = tabs[0];
            else if (e.key === 'End') next = tabs[tabs.length - 1];
            if (!next) return;
            e.preventDefault();
            show(next, true);
        });

        show(activeTab);
        return [bar, pane];
    }

    function renderDetail(instance) {
        if (!instance) {
            detail.replaceChildren(el('div', 'empty', '壁纸上还没有元素。点上面的素材，把它放到壁纸上。'));
            return;
        }
        const asset = findAsset(instance.assetId);
        const head = el('div', 'detail-head');
        head.appendChild(el('b', '', asset ? asset.name : '素材已丢失'));
        if (asset) head.appendChild(el('span', 'chip', TYPE_LABEL[asset.type] || asset.type));
        const end = el('div', 'end');
        if (asset) {
            const replace = button('btn sm', 'move', '重新摆放');
            replace.addEventListener('click', () => startPlacement({ instanceId: instance.id }, asset.name));
            const eye = button('btn sm icon ghost', instance.visible ? 'eye' : 'eye-off', '', instance.visible ? '隐藏' : '显示');
            eye.addEventListener('click', () => api.elements.updateInstance(instance.id, { visible: !instance.visible }));
            end.append(replace, eye);
        }
        const del = button('btn sm icon ghost danger', 'trash-2', '', '从壁纸上删除');
        del.addEventListener('click', async () => {
            await api.elements.removeInstance(instance.id);
            setStatus('已从壁纸上删除');
        });
        end.appendChild(del);
        head.appendChild(end);

        if (!asset) {
            detail.replaceChildren(head, el('div', 'empty', '素材文件找不到了，只能删除。'));
            return;
        }
        detail.replaceChildren(head, ...renderTabs(instance, asset));
    }

    function renderInstances() {
        const { instances } = elements;
        if (!instances.some((i) => i.id === selectedId)) selectedId = instances.length ? instances[0].id : null;
        instanceList.replaceChildren(...instances.map(renderListItem));
        instanceList.parentElement.classList.toggle('none', instances.length === 0);
        renderDetail(instances.find((i) => i.id === selectedId) || null);
        countEl.textContent = instances.length || '';
        setBadge('elements', instances.length ? String(instances.length) : '');
    }

    function render() {
        renderAssets();
        renderInstances();
    }

    /** 收到新配置：用户正在拖控件时延后重绘 */
    function onConfig(config) {
        if (!config || !config.customElements) return;
        elements = config.customElements;
        clearTimeout(pendingRender);
        const wait = holdUntil - Date.now();
        if (wait > 0) pendingRender = setTimeout(render, wait);
        else render();
    }

    // ---------- 添加素材 ----------

    async function importAsset() {
        const result = await api.elements.importFile();
        if (result.canceled) return;
        if (result.error) {
            setStatus(result.error, 'error');
            return;
        }
        const { asset } = result;
        try {
            const dataUrl = await makeThumbnail(api.toFileUrl(asset.file), asset.type);
            await api.elements.saveThumb(asset.id, dataUrl);
            setStatus(`已添加「${asset.name}」，点它放到壁纸上`, 'success');
        } catch (err) {
            // 缩略图都生成不了，说明 Chromium 读不了这个文件，壁纸上也播放不了
            await api.elements.removeAsset(asset.id);
            setStatus('读不了这个文件（格式不支持或文件已损坏）', 'error');
        }
    }

    importBtn.addEventListener('click', importAsset);

    // ---------- 启动 ----------

    api.onLoadConfig(onConfig);
    Promise.all([api.elements.getBuiltin(), api.getConfig()]).then(([builtin, config]) => {
        builtinAssets = builtin;
        onConfig(config);
    });
}
