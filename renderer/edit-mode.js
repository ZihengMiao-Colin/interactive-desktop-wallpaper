/**
 * edit-mode.js — 摆放模式（全屏摆放窗口里运行）
 *
 * 画面和真实壁纸一致（背景视差冻结在中心），草稿元素外面套一个虚线框：
 * 拖框移动、拖角点等比缩放、拖边中点单向拉伸、拖上方圆点旋转（Shift 吸附 15°）；
 * 工具条调深度、翻转、切换自由变形（单独拖四个角）、复原；Enter 确认，Esc 取消。
 * 新元素默认"自动贴地"：深度跟随元素底边中点处的壁纸深度，手动拖过深度滑块后改为固定值。
 * 草稿是唱片机（kind: 'vinyl'）时交给 renderer/vinyl-edit-mode.js。
 */

'use strict';

/** 工具条和元素之间的间距 */
const TOOLBAR_GAP = 10;
/** 旋转按住 Shift 时的吸附角度 */
const ROTATE_SNAP_DEG = 15;

/**
 * 工具条默认放在选框下方，放不下就放到上方（多空 40px 给旋转圆点）。
 * @param {HTMLElement} toolbar
 * @param {{ left: number, top: number, right: number, bottom: number }} b - 选框外接矩形（屏幕像素）
 */
function placeToolbar(toolbar, b) {
    const sw = window.innerWidth;
    const sh = window.innerHeight;
    const barH = toolbar.offsetHeight;
    const barW = toolbar.offsetWidth;
    const below = b.bottom + TOOLBAR_GAP;
    const top = below + barH > sh ? b.top - TOOLBAR_GAP - barH - 40 : below;
    const left = Math.min(sw - barW - 8, Math.max(8, (b.left + b.right) / 2 - barW / 2));
    toolbar.style.top = `${Math.min(sh - barH - 8, Math.max(8, top))}px`;
    toolbar.style.left = `${left}px`;
}

/**
 * @param {{ scene: typeof Scene, layer: ElementsLayer, host: typeof Host, vinyl: VinylPlayerManager }} deps
 */
async function startEditMode({ scene, layer, host, vinyl }) {
    const ui = document.getElementById('placement-ui');
    const box = document.getElementById('placement-box');
    const outline = document.getElementById('placement-warp-outline');
    const warpHandles = [...box.querySelectorAll('[data-warp]')];
    const toolbar = document.getElementById('placement-toolbar');
    const depthSlider = document.getElementById('placement-depth');
    const depthValue = document.getElementById('placement-depth-value');
    const depthAuto = document.getElementById('placement-depth-auto');
    const title = document.getElementById('placement-title');
    const rotationValue = document.getElementById('placement-rotation');
    const flipXBtn = document.getElementById('placement-flip-x');
    const flipYBtn = document.getElementById('placement-flip-y');
    const warpBtn = document.getElementById('placement-warp');
    const resetBtn = document.getElementById('placement-reset');
    const confirmBtn = document.getElementById('placement-confirm');
    const cancelBtn = document.getElementById('placement-cancel');

    const draft = await host.placement.getDraft();
    if (!draft) {
        console.warn('[EditMode] 没有待摆放的元素，退出摆放模式');
        await host.placement.cancel();
        return;
    }
    if (draft.kind === 'vinyl') {
        startVinylEditMode({ vinyl, host, draft });
        return;
    }

    const asset = draft.asset;
    title.textContent = `摆放「${asset.name}」`;
    let instance = { ...draft.instance, transform: Shared.elements.transformOf(draft.instance) };
    const sampler = createDepthSampler(scene.getDepthImage());
    const P = Shared.placement;
    const screen = () => [window.innerWidth, window.innerHeight];
    let warpMode = false;

    const aspect = () => layer.getAssetAspect(instance.id);

    /** 自动贴地：深度取元素底边中点处的壁纸深度 */
    function applyAutoDepth() {
        if (!instance.depthAuto) return;
        const [u, v] = P.bottomCenter(instance.transform, aspect(), ...screen());
        const [iu, iv] = Shared.parallax.screenToImageUV(u, v, scene.getCover());
        instance.depth = sampler.sample(iu, iv);
    }

    /**
     * 渲染层里用的预览实例：间隔播放、点击播放都改成循环播放，否则摆放时元素会消失或不动，没法对位置。
     * 确认时提交的仍是原来的播放设置。
     */
    function previewInstance() {
        const playback = instance.playback || {};
        return playback.mode === 'interval' || playback.mode === 'click'
            ? { ...instance, playback: { ...playback, mode: 'loop' } }
            : instance;
    }

    /** 把草稿同步到渲染层、摆放框和工具条 */
    function render() {
        layer.setDraft(previewInstance(), asset);
        const t = instance.transform;
        const [sw, sh] = screen();

        const r = P.rectFromTransform(t, aspect(), sw, sh);
        box.style.left = `${r.left}px`;
        box.style.top = `${r.top}px`;
        box.style.width = `${r.width}px`;
        box.style.height = `${r.height}px`;
        box.style.transform = `rotate(${t.rotation}deg)`;
        box.classList.toggle('warp-mode', warpMode);
        box.classList.toggle('warped', !!t.warp);

        const corners = P.quadCorners(t);
        outline.setAttribute('points', corners.map(([u, v]) => `${u * 100},${v * 100}`).join(' '));
        warpHandles.forEach((h, i) => {
            h.style.left = `${corners[i][0] * 100}%`;
            h.style.top = `${corners[i][1] * 100}%`;
        });

        placeToolbar(toolbar, P.boundingRect(t, aspect(), sw, sh));

        depthSlider.value = Math.round(instance.depth * 100);
        UIControls.paintRange(depthSlider);
        depthValue.textContent = instance.depth.toFixed(2);
        depthAuto.hidden = !instance.depthAuto;
        rotationValue.textContent = `${Math.round(t.rotation)}°`;
        flipXBtn.classList.toggle('active', t.flipX);
        flipYBtn.classList.toggle('active', t.flipY);
        warpBtn.classList.toggle('active', warpMode);
    }

    function setTransform(transform) {
        instance.transform = transform;
        applyAutoDepth();
        render();
    }

    let finished = false;
    async function finish(commit) {
        if (finished) return;
        finished = true;
        if (commit) await host.placement.commit(instance);
        else await host.placement.cancel();
    }

    // ---- 拖动：移动 / 缩放 / 拉伸 / 旋转 / 自由变形 ----
    let drag = null;
    box.addEventListener('pointerdown', (e) => {
        const d = e.target.dataset || {};
        if (d.corner) drag = { corner: d.corner };
        else if (d.edge) drag = { edge: d.edge };
        else if (d.rotate) drag = { rotate: true };
        else if (d.warp !== undefined) drag = { warp: Number(d.warp) };
        else drag = { lastX: e.clientX, lastY: e.clientY };
        box.setPointerCapture(e.pointerId);
        e.preventDefault();
    });
    box.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const t = instance.transform;
        const [sw, sh] = screen();
        const x = e.clientX;
        const y = e.clientY;
        if (drag.corner) {
            setTransform(P.resizeFromCorner(t, drag.corner, x, y, aspect(), sw, sh));
        } else if (drag.edge) {
            setTransform(P.stretchFromEdge(t, drag.edge, x, y, aspect(), sw, sh));
        } else if (drag.rotate) {
            setTransform({ ...t, rotation: P.rotateToPointer(t, x, y, sw, sh, e.shiftKey ? ROTATE_SNAP_DEG : 0) });
        } else if (drag.warp !== undefined) {
            setTransform(P.moveWarpCorner(t, drag.warp, x, y, aspect(), sw, sh));
        } else {
            setTransform(P.moveTransform(t, x - drag.lastX, y - drag.lastY, sw, sh));
            drag.lastX = x;
            drag.lastY = y;
        }
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
    flipXBtn.addEventListener('click', () => setTransform({ ...instance.transform, flipX: !instance.transform.flipX }));
    flipYBtn.addEventListener('click', () => setTransform({ ...instance.transform, flipY: !instance.transform.flipY }));
    warpBtn.addEventListener('click', () => {
        warpMode = !warpMode;
        render();
    });
    resetBtn.addEventListener('click', () => {
        warpMode = false;
        setTransform({ ...instance.transform, rotation: 0, stretch: 1, flipX: false, flipY: false, warp: null });
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
