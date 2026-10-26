/**
 * elements-tab.js — 设置窗口的"自定义元素"页签
 *
 * 三块内容：添加按钮、素材库（默认元素 / 我添加的）、壁纸上的元素列表。
 * 点素材进入摆放模式；列表里可以调深度、不透明度、播放方式、抠像，以及重新摆放和删除。
 */

'use strict';

/** 滑块改动后等多久再保存 */
const ELEMENTS_SAVE_DEBOUNCE_MS = 150;
/** 用户正在操作控件时，推迟这么久再重绘列表，避免拖到一半控件被替换 */
const ELEMENTS_RENDER_HOLD_MS = 800;

const TYPE_LABEL = { image: '图片', animated: 'GIF', video: '视频' };
const MODE_LABEL = { static: '静止', loop: '循环', interval: '间隔播放' };

/**
 * @param {{ api: object, setStatus: (msg: string, cls?: string) => void }} deps
 */
function initElementsTab({ api, setStatus }) {
    if (!api) return;

    const importBtn = document.getElementById('btn-import-element');
    const builtinGrid = document.getElementById('elements-builtin-grid');
    const userGrid = document.getElementById('elements-user-grid');
    const instanceList = document.getElementById('elements-instance-list');

    let builtinAssets = [];
    let elements = { library: [], instances: [] };
    /** 展开了属性面板的实例 id */
    const expanded = new Set();
    let holdUntil = 0;
    let pendingRender = null;
    const saveTimers = new Map();

    // ---------- 小工具 ----------

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function findAsset(assetId) {
        return builtinAssets.find((a) => a.id === assetId) || elements.library.find((a) => a.id === assetId) || null;
    }

    function thumbNode(asset) {
        const wrap = el('div', 'el-thumb');
        if (asset && asset.thumb && api.fileExists(asset.thumb)) {
            const img = el('img');
            img.src = api.toFileUrl(asset.thumb);
            img.alt = asset.name;
            wrap.appendChild(img);
        } else {
            wrap.appendChild(el('span', 'el-thumb-icon', asset && asset.type === 'video' ? '🎬' : '🖼️'));
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

    // ---------- 素材库 ----------

    function renderAssetCard(asset) {
        const missing = !api.fileExists(asset.file);
        const card = el('div', 'el-card' + (missing ? ' missing' : ''));
        card.title = missing ? '文件丢失：' + asset.file : '点击放到壁纸上';
        card.appendChild(thumbNode(asset));
        card.appendChild(el('span', 'el-badge el-badge-' + asset.type, TYPE_LABEL[asset.type] || asset.type));
        card.appendChild(el('div', 'el-card-name', asset.name));
        if (missing) card.appendChild(el('div', 'el-card-missing', '文件丢失'));

        card.addEventListener('click', async () => {
            if (missing) {
                setStatus('素材文件丢失，无法使用：' + asset.name, 'error');
                return;
            }
            const started = await api.elements.startPlacement({ assetId: asset.id });
            setStatus(started ? `正在摆放「${asset.name}」：拖动移动，拖动角点缩放，Enter 确认` : '摆放窗口已经打开', started ? '' : 'error');
        });

        if (!asset.builtin) {
            const remove = el('button', 'el-card-remove', '×');
            remove.title = '从素材库移除';
            remove.addEventListener('click', async (e) => {
                e.stopPropagation();
                const count = elements.instances.filter((i) => i.assetId === asset.id).length;
                if (count > 0 && !confirm(`壁纸上有 ${count} 个这个元素，会一起删除，确定吗？`)) return;
                await api.elements.removeAsset(asset.id);
                setStatus('已移除：' + asset.name, '');
            });
            card.appendChild(remove);
        }
        return card;
    }

    function renderLibrary() {
        builtinGrid.replaceChildren(...builtinAssets.map(renderAssetCard));
        const userAssets = elements.library;
        if (userAssets.length) userGrid.replaceChildren(...userAssets.map(renderAssetCard));
        else userGrid.replaceChildren(el('div', 'el-empty', '还没有添加过元素'));
    }

    // ---------- 壁纸上的元素 ----------

    function sliderRow(label, min, max, value, format, onInput) {
        const row = el('div', 'row');
        row.appendChild(el('label', '', label));
        const valueEl = el('span', 'value', format(value));
        const input = el('input');
        input.type = 'range';
        input.min = min;
        input.max = max;
        input.value = value;
        input.addEventListener('input', () => {
            const v = parseInt(input.value, 10);
            valueEl.textContent = format(v);
            onInput(v);
        });
        row.append(valueEl, input);
        return row;
    }

    function toggle(checked, onChange) {
        const label = el('label', 'toggle');
        const input = el('input');
        input.type = 'checkbox';
        input.checked = checked;
        input.addEventListener('change', () => onChange(input.checked));
        label.append(input, el('span', 'slider'));
        return label;
    }

    function playbackSummary(instance, asset) {
        if (!asset) return '素材丢失';
        const mode = asset.type === 'image' ? 'static' : instance.playback.mode;
        return mode === 'interval'
            ? `间隔播放 · 每 ${instance.playback.intervalSec} 秒`
            : MODE_LABEL[mode] || mode;
    }

    function renderInstanceDetails(instance, asset) {
        const box = el('div', 'el-instance-details');
        const id = instance.id;

        box.appendChild(sliderRow('深度', 0, 100, Math.round(instance.depth * 100),
            (v) => (v / 100).toFixed(2), (v) => saveInstance(id, { depth: v / 100 })));
        box.appendChild(sliderRow('不透明度', 10, 100, Math.round(instance.opacity * 100),
            (v) => v + '%', (v) => saveInstance(id, { opacity: v / 100 })));

        if (asset.type === 'image') return box;

        // 播放方式
        const modeRow = el('div', 'row');
        modeRow.appendChild(el('label', '', '播放方式'));
        const select = el('select', 'custom-select');
        for (const mode of ['loop', 'interval']) {
            const option = el('option', '', MODE_LABEL[mode]);
            option.value = mode;
            select.appendChild(option);
        }
        select.value = instance.playback.mode === 'interval' ? 'interval' : 'loop';
        modeRow.appendChild(select);
        box.appendChild(modeRow);

        const intervalRow = sliderRow('播放间隔（播完后等待）', 1, 120, instance.playback.intervalSec,
            (v) => v + ' 秒', (v) => saveInstance(id, { playback: { intervalSec: v } }));
        intervalRow.style.display = select.value === 'interval' ? '' : 'none';
        box.appendChild(intervalRow);

        select.addEventListener('change', () => {
            intervalRow.style.display = select.value === 'interval' ? '' : 'none';
            saveInstance(id, { playback: { mode: select.value } }, true);
        });

        // 绿幕抠像
        const chromaRow = el('div', 'toggle-row');
        chromaRow.appendChild(el('span', '', '绿幕抠像'));
        const strengthRow = sliderRow('抠像强度', 0, 100, Math.round(instance.chroma.strength * 100),
            (v) => v + '%', (v) => saveInstance(id, { chroma: { strength: v / 100 } }));
        strengthRow.style.display = instance.chroma.enabled ? '' : 'none';
        chromaRow.appendChild(toggle(instance.chroma.enabled, (on) => {
            strengthRow.style.display = on ? '' : 'none';
            saveInstance(id, { chroma: { enabled: on } }, true);
        }));
        box.append(chromaRow, strengthRow);
        return box;
    }

    function renderInstance(instance) {
        const asset = findAsset(instance.assetId);
        const item = el('div', 'el-instance' + (asset ? '' : ' missing'));

        const head = el('div', 'el-instance-head');
        head.appendChild(thumbNode(asset));
        const text = el('div', 'el-instance-text');
        text.append(el('div', 'el-instance-name', asset ? asset.name : '素材已丢失'),
            el('div', 'el-instance-sub', playbackSummary(instance, asset)));
        head.appendChild(text);

        const visible = toggle(instance.visible, (on) => saveInstance(instance.id, { visible: on }, true));
        visible.title = '显示 / 隐藏';
        head.appendChild(visible);

        const actions = el('div', 'el-instance-actions');
        if (asset) {
            const replace = el('button', 'el-mini-btn', '重新摆放');
            replace.addEventListener('click', () => api.elements.startPlacement({ instanceId: instance.id }));
            const more = el('button', 'el-mini-btn', expanded.has(instance.id) ? '收起' : '调整');
            more.addEventListener('click', () => {
                if (expanded.has(instance.id)) expanded.delete(instance.id);
                else expanded.add(instance.id);
                render();
            });
            actions.append(replace, more);
        }
        const del = el('button', 'el-mini-btn danger', '删除');
        del.addEventListener('click', async () => {
            await api.elements.removeInstance(instance.id);
            setStatus('已从壁纸上删除', '');
        });
        actions.appendChild(del);
        head.appendChild(actions);
        item.appendChild(head);

        if (asset && expanded.has(instance.id)) item.appendChild(renderInstanceDetails(instance, asset));
        return item;
    }

    function renderInstances() {
        if (elements.instances.length) instanceList.replaceChildren(...elements.instances.map(renderInstance));
        else instanceList.replaceChildren(el('div', 'el-empty', '壁纸上还没有元素，点击上面的素材开始摆放'));
    }

    function render() {
        renderLibrary();
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

    // ---------- 添加元素 ----------

    importBtn.addEventListener('click', async () => {
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
            setStatus(`已添加「${asset.name}」，点击它放到壁纸上`, 'success');
        } catch (err) {
            // 缩略图都生成不了，说明 Chromium 读不了这个文件，壁纸上也播放不了
            await api.elements.removeAsset(asset.id);
            setStatus('无法读取这个文件（格式不支持或文件已损坏）', 'error');
        }
    });

    // ---------- 启动 ----------

    api.onLoadConfig(onConfig);
    Promise.all([api.elements.getBuiltin(), api.getConfig()]).then(([builtin, config]) => {
        builtinAssets = builtin;
        onConfig(config);
    });
}
