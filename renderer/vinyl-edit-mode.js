/**
 * vinyl-edit-mode.js — 摆放窗口里摆放唱片机
 *
 * 和摆放元素共用 #placement-ui：选框只留四个角点，工具条只留大小、复原、取消、确认。
 * 拖框移动，拖角点以唱盘中心为原点缩放；Enter 确认，Esc 取消。
 * 位置记成唱盘中心在屏幕上的比例，换分辨率后还在差不多的地方；"复原"回到右下角、100%。
 */

'use strict';

/** 选框比唱片机外缘大一圈 */
const VINYL_BOX_PAD = 10;

/**
 * @param {{ vinyl: VinylPlayerManager, host: typeof Host, draft: { kind: 'vinyl', vinyl: object } }} deps
 */
function startVinylEditMode({ vinyl, host, draft }) {
    const ui = document.getElementById('placement-ui');
    const box = document.getElementById('placement-box');
    const toolbar = document.getElementById('placement-toolbar');
    const scaleValue = document.getElementById('placement-scale');
    const resetBtn = document.getElementById('placement-reset');

    ui.classList.add('vinyl-mode');
    document.getElementById('placement-title').textContent = '摆放唱片机';
    document.getElementById('placement-tips').textContent = '拖动移动，拖角点缩放';
    resetBtn.title = '回到右下角，大小 100%';

    // 拖动时要跟手，不要壁纸里那 0.1 秒的平滑
    vinyl.widget.style.transition = 'none';
    vinyl.showPreview(draft.vinyl || {});
    let layout = vinyl.layout;

    /** 停在角上时先换成唱盘中心的坐标，之后才能拖 */
    function toCustom() {
        if (layout.position === 'custom') return;
        const c = vinyl.deckCenter();
        layout = { position: 'custom', x: c.x / window.innerWidth, y: c.y / window.innerHeight, scale: layout.scale };
    }

    function render() {
        // 拿回实际用上的位置：拖出屏幕的部分已经被挪回来，接着拖不会"空走"
        layout = vinyl.setLayout(layout);
        const r = vinyl.bounds();
        const b = { left: r.left - VINYL_BOX_PAD, top: r.top - VINYL_BOX_PAD, right: r.right + VINYL_BOX_PAD, bottom: r.bottom + VINYL_BOX_PAD };
        box.style.left = `${b.left}px`;
        box.style.top = `${b.top}px`;
        box.style.width = `${b.right - b.left}px`;
        box.style.height = `${b.bottom - b.top}px`;
        scaleValue.textContent = `${Math.round(layout.scale * 100)}%`;
        placeToolbar(toolbar, b);
    }

    let finished = false;
    async function finish(commit) {
        if (finished) return;
        finished = true;
        if (commit) await host.placement.commit(layout);
        else await host.placement.cancel();
    }

    // ---- 拖动：移动 / 角点缩放 ----
    let drag = null;
    box.addEventListener('pointerdown', (e) => {
        toCustom();
        if (e.target.dataset && e.target.dataset.corner) {
            const c = vinyl.deckCenter();
            const d0 = Math.max(1, Math.hypot(e.clientX - c.x, e.clientY - c.y));
            drag = { center: c, d0, s0: layout.scale };
        } else {
            drag = { lastX: e.clientX, lastY: e.clientY };
        }
        box.setPointerCapture(e.pointerId);
        e.preventDefault();
    });
    box.addEventListener('pointermove', (e) => {
        if (!drag) return;
        if (drag.center) {
            const d = Math.hypot(e.clientX - drag.center.x, e.clientY - drag.center.y);
            layout = { ...layout, scale: (drag.s0 * d) / drag.d0 };
        } else {
            layout = {
                ...layout,
                x: layout.x + (e.clientX - drag.lastX) / window.innerWidth,
                y: layout.y + (e.clientY - drag.lastY) / window.innerHeight,
            };
            drag.lastX = e.clientX;
            drag.lastY = e.clientY;
        }
        render();
    });
    const endDrag = () => { drag = null; };
    box.addEventListener('pointerup', endDrag);
    box.addEventListener('pointercancel', endDrag);

    // ---- 工具条 ----
    resetBtn.addEventListener('click', () => {
        layout = { position: 'bottom-right', scale: 1 };
        render();
    });
    document.getElementById('placement-confirm').addEventListener('click', () => finish(true));
    document.getElementById('placement-cancel').addEventListener('click', () => finish(false));
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') finish(false);
    });
    window.addEventListener('resize', render);

    ui.hidden = false;
    render();
}
