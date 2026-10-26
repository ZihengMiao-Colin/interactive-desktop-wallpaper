/**
 * edit-mode.js — 摆放模式（全屏摆放窗口里运行）
 *
 * 画面和真实壁纸一致（背景视差冻结在中心），草稿元素外面套一个虚线框：
 * 拖框移动、拖角点等比缩放、工具条调深度；Enter 确认，Esc 取消。
 * 新元素默认"自动贴地"：深度跟随元素底边中点处的壁纸深度，手动拖过深度滑块后改为固定值。
 */

'use strict';

/** 工具条和元素框之间的间距 */
const TOOLBAR_GAP = 10;

/**
 * @param {{ scene: typeof Scene, layer: ElementsLayer, host: typeof Host }} deps
 */
async function startEditMode({ scene, layer, host }) {
    const ui = document.getElementById('placement-ui');
    const box = document.getElementById('placement-box');
    const toolbar = document.getElementById('placement-toolbar');
    const depthSlider = document.getElementById('placement-depth');
    const depthValue = document.getElementById('placement-depth-value');
    const confirmBtn = document.getElementById('placement-confirm');
    const cancelBtn = document.getElementById('placement-cancel');

    const draft = await host.placement.getDraft();
    if (!draft) {
        console.warn('[EditMode] 没有待摆放的元素，退出摆放模式');
        await host.placement.cancel();
        return;
    }

    const asset = draft.asset;
    let instance = { ...draft.instance, transform: { ...draft.instance.transform } };
    const sampler = createDepthSampler(scene.getDepthImage());
    const { rectFromTransform, moveTransform, resizeFromCorner, bottomCenter } = Shared.placement;

    const aspect = () => layer.getAssetAspect(instance.id);

    /** 自动贴地：深度取元素底边中点处的壁纸深度 */
    function applyAutoDepth() {
        if (!instance.depthAuto) return;
        const [u, v] = bottomCenter(instance.transform, aspect(), window.innerWidth, window.innerHeight);
        const [iu, iv] = Shared.parallax.screenToImageUV(u, v, scene.getCover());
        instance.depth = sampler.sample(iu, iv);
    }

    /**
     * 渲染层里用的预览实例：间隔播放改成循环播放，否则摆放时元素会周期性消失，没法对位置。
     * 确认时提交的仍是原来的播放设置。
     */
    function previewInstance() {
        const playback = instance.playback || {};
        return playback.mode === 'interval'
            ? { ...instance, playback: { ...playback, mode: 'loop' } }
            : instance;
    }

    /** 把草稿同步到渲染层和摆放框 */
    function render() {
        layer.setDraft(previewInstance(), asset);

        const r = rectFromTransform(instance.transform, aspect(), window.innerWidth, window.innerHeight);
        box.style.left = `${r.left}px`;
        box.style.top = `${r.top}px`;
        box.style.width = `${r.width}px`;
        box.style.height = `${r.height}px`;

        // 工具条默认放在框下方，放不下就放到框上方
        const barH = toolbar.offsetHeight;
        const below = r.top + r.height + TOOLBAR_GAP;
        const top = below + barH > window.innerHeight ? r.top - TOOLBAR_GAP - barH : below;
        const barW = toolbar.offsetWidth;
        const left = Math.min(window.innerWidth - barW - 8, Math.max(8, r.left + r.width / 2 - barW / 2));
        toolbar.style.top = `${Math.max(8, top)}px`;
        toolbar.style.left = `${left}px`;

        depthSlider.value = Math.round(instance.depth * 100);
        depthValue.textContent = instance.depth.toFixed(2) + (instance.depthAuto ? '（自动）' : '');
    }

    let finished = false;
    async function finish(commit) {
        if (finished) return;
        finished = true;
        if (commit) await host.placement.commit(instance);
        else await host.placement.cancel();
    }

    // ---- 拖动 / 缩放 ----
    let drag = null;
    box.addEventListener('pointerdown', (e) => {
        const corner = e.target.dataset && e.target.dataset.corner;
        drag = corner ? { corner } : { lastX: e.clientX, lastY: e.clientY };
        box.setPointerCapture(e.pointerId);
        e.preventDefault();
    });
    box.addEventListener('pointermove', (e) => {
        if (!drag) return;
        if (drag.corner) {
            instance.transform = resizeFromCorner(instance.transform, drag.corner, e.clientX, e.clientY,
                aspect(), window.innerWidth, window.innerHeight);
        } else {
            instance.transform = moveTransform(instance.transform, e.clientX - drag.lastX, e.clientY - drag.lastY,
                window.innerWidth, window.innerHeight);
            drag.lastX = e.clientX;
            drag.lastY = e.clientY;
        }
        applyAutoDepth();
        render();
    });
    const endDrag = () => { drag = null; };
    box.addEventListener('pointerup', endDrag);
    box.addEventListener('pointercancel', endDrag);

    // ---- 工具条 ----
    depthSlider.addEventListener('input', () => {
        instance.depth = parseInt(depthSlider.value, 10) / 100;
        instance.depthAuto = false;
        render();
    });
    confirmBtn.addEventListener('click', () => finish(true));
    cancelBtn.addEventListener('click', () => finish(false));
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') finish(false);
    });
    window.addEventListener('resize', render);

    ui.hidden = false;
    await layer.setDraft(previewInstance(), asset);   // 等素材加载完，拿到真实宽高比再画框
    applyAutoDepth();
    render();
}
