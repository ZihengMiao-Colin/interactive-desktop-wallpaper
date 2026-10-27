/**
 * icons.js — 界面图标（设置窗口和壁纸页共用）+ 滑块填充
 *
 * 图标来自 Lucide v0.460.0（lucide-static），ISC License：
 * Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT).
 * All other copyright (c) for Lucide are held by Lucide Contributors 2022.
 *
 * 加载时把 <symbol id="i-<名字>"> 雪碧图插到页面里，HTML 直接写
 * <svg class="i"><use href="#i-check"/></svg>，JS 里用 Icons.svg('check')。
 * 新增图标：从 lucide-static@0.460.0 的 icons/<名字>.svg 复制里面的元素，包成一条 <symbol>。
 */

'use strict';

const Icons = (() => {
    const SYMBOLS = [
        "<symbol id=\"i-image\" viewBox=\"0 0 24 24\"><rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" ry=\"2\" /><circle cx=\"9\" cy=\"9\" r=\"2\" /><path d=\"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21\" /></symbol>",
        "<symbol id=\"i-image-plus\" viewBox=\"0 0 24 24\"><path d=\"M16 5h6\" /><path d=\"M19 2v6\" /><path d=\"M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5\" /><path d=\"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21\" /><circle cx=\"9\" cy=\"9\" r=\"2\" /></symbol>",
        "<symbol id=\"i-layers\" viewBox=\"0 0 24 24\"><path d=\"m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z\" /><path d=\"m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65\" /><path d=\"m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65\" /></symbol>",
        "<symbol id=\"i-shapes\" viewBox=\"0 0 24 24\"><path d=\"M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z\" /><rect x=\"3\" y=\"14\" width=\"7\" height=\"7\" rx=\"1\" /><circle cx=\"17.5\" cy=\"17.5\" r=\"3.5\" /></symbol>",
        "<symbol id=\"i-sparkles\" viewBox=\"0 0 24 24\"><path d=\"M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z\" /><path d=\"M20 3v4\" /><path d=\"M22 5h-4\" /><path d=\"M4 17v2\" /><path d=\"M5 18H3\" /></symbol>",
        "<symbol id=\"i-disc-3\" viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"10\" /><path d=\"M6 12c0-1.7.7-3.2 1.8-4.2\" /><circle cx=\"12\" cy=\"12\" r=\"2\" /><path d=\"M18 12c0 1.7-.7 3.2-1.8 4.2\" /></symbol>",
        "<symbol id=\"i-settings\" viewBox=\"0 0 24 24\"><path d=\"M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z\" /><circle cx=\"12\" cy=\"12\" r=\"3\" /></symbol>",
        "<symbol id=\"i-plus\" viewBox=\"0 0 24 24\"><path d=\"M5 12h14\" /><path d=\"M12 5v14\" /></symbol>",
        "<symbol id=\"i-folder-open\" viewBox=\"0 0 24 24\"><path d=\"m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2\" /></symbol>",
        "<symbol id=\"i-wand-sparkles\" viewBox=\"0 0 24 24\"><path d=\"m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72\" /><path d=\"m14 7 3 3\" /><path d=\"M5 6v4\" /><path d=\"M19 14v4\" /><path d=\"M10 2v2\" /><path d=\"M7 8H3\" /><path d=\"M21 16h-4\" /><path d=\"M11 3H9\" /></symbol>",
        "<symbol id=\"i-check\" viewBox=\"0 0 24 24\"><path d=\"M20 6 9 17l-5-5\" /></symbol>",
        "<symbol id=\"i-x\" viewBox=\"0 0 24 24\"><path d=\"M18 6 6 18\" /><path d=\"m6 6 12 12\" /></symbol>",
        "<symbol id=\"i-eye\" viewBox=\"0 0 24 24\"><path d=\"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0\" /><circle cx=\"12\" cy=\"12\" r=\"3\" /></symbol>",
        "<symbol id=\"i-eye-off\" viewBox=\"0 0 24 24\"><path d=\"M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49\" /><path d=\"M14.084 14.158a3 3 0 0 1-4.242-4.242\" /><path d=\"M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143\" /><path d=\"m2 2 20 20\" /></symbol>",
        "<symbol id=\"i-trash-2\" viewBox=\"0 0 24 24\"><path d=\"M3 6h18\" /><path d=\"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6\" /><path d=\"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2\" /><line x1=\"10\" x2=\"10\" y1=\"11\" y2=\"17\" /><line x1=\"14\" x2=\"14\" y1=\"11\" y2=\"17\" /></symbol>",
        "<symbol id=\"i-move\" viewBox=\"0 0 24 24\"><path d=\"M12 2v20\" /><path d=\"m15 19-3 3-3-3\" /><path d=\"m19 9 3 3-3 3\" /><path d=\"M2 12h20\" /><path d=\"m5 9-3 3 3 3\" /><path d=\"m9 5 3-3 3 3\" /></symbol>",
        "<symbol id=\"i-rotate-ccw\" viewBox=\"0 0 24 24\"><path d=\"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8\" /><path d=\"M3 3v5h5\" /></symbol>",
        "<symbol id=\"i-flip-horizontal-2\" viewBox=\"0 0 24 24\"><path d=\"m3 7 5 5-5 5V7\" /><path d=\"m21 7-5 5 5 5V7\" /><path d=\"M12 20v2\" /><path d=\"M12 14v2\" /><path d=\"M12 8v2\" /><path d=\"M12 2v2\" /></symbol>",
        "<symbol id=\"i-flip-vertical-2\" viewBox=\"0 0 24 24\"><path d=\"m17 3-5 5-5-5h10\" /><path d=\"m17 21-5-5-5 5h10\" /><path d=\"M4 12H2\" /><path d=\"M10 12H8\" /><path d=\"M16 12h-2\" /><path d=\"M22 12h-2\" /></symbol>",
        "<symbol id=\"i-square-dashed\" viewBox=\"0 0 24 24\"><path d=\"M5 3a2 2 0 0 0-2 2\" /><path d=\"M19 3a2 2 0 0 1 2 2\" /><path d=\"M21 19a2 2 0 0 1-2 2\" /><path d=\"M5 21a2 2 0 0 1-2-2\" /><path d=\"M9 3h1\" /><path d=\"M9 21h1\" /><path d=\"M14 3h1\" /><path d=\"M14 21h1\" /><path d=\"M3 9v1\" /><path d=\"M21 9v1\" /><path d=\"M3 14v1\" /><path d=\"M21 14v1\" /></symbol>",
        "<symbol id=\"i-play\" viewBox=\"0 0 24 24\"><polygon points=\"6 3 20 12 6 21 6 3\" /></symbol>",
        "<symbol id=\"i-pause\" viewBox=\"0 0 24 24\"><rect x=\"14\" y=\"4\" width=\"4\" height=\"16\" rx=\"1\" /><rect x=\"6\" y=\"4\" width=\"4\" height=\"16\" rx=\"1\" /></symbol>",
        "<symbol id=\"i-music\" viewBox=\"0 0 24 24\"><path d=\"M9 18V5l12-2v13\" /><circle cx=\"6\" cy=\"18\" r=\"3\" /><circle cx=\"18\" cy=\"16\" r=\"3\" /></symbol>",
        "<symbol id=\"i-cloud-rain\" viewBox=\"0 0 24 24\"><path d=\"M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242\" /><path d=\"M16 14v6\" /><path d=\"M8 14v6\" /><path d=\"M12 16v6\" /></symbol>",
        "<symbol id=\"i-snowflake\" viewBox=\"0 0 24 24\"><line x1=\"2\" x2=\"22\" y1=\"12\" y2=\"12\" /><line x1=\"12\" x2=\"12\" y1=\"2\" y2=\"22\" /><path d=\"m20 16-4-4 4-4\" /><path d=\"m4 8 4 4-4 4\" /><path d=\"m16 4-4 4-4-4\" /><path d=\"m8 20 4-4 4 4\" /></symbol>",
        "<symbol id=\"i-flower-2\" viewBox=\"0 0 24 24\"><path d=\"M12 5a3 3 0 1 1 3 3m-3-3a3 3 0 1 0-3 3m3-3v1M9 8a3 3 0 1 0 3 3M9 8h1m5 0a3 3 0 1 1-3 3m3-3h-1m-2 3v-1\" /><circle cx=\"12\" cy=\"8\" r=\"2\" /><path d=\"M12 10v12\" /><path d=\"M12 22c4.2 0 7-1.667 7-5-4.2 0-7 1.667-7 5Z\" /><path d=\"M12 22c-4.2 0-7-1.667-7-5 4.2 0 7 1.667 7 5Z\" /></symbol>",
        "<symbol id=\"i-leaf\" viewBox=\"0 0 24 24\"><path d=\"M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z\" /><path d=\"M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12\" /></symbol>",
        "<symbol id=\"i-sun\" viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"4\" /><path d=\"M12 2v2\" /><path d=\"M12 20v2\" /><path d=\"m4.93 4.93 1.41 1.41\" /><path d=\"m17.66 17.66 1.41 1.41\" /><path d=\"M2 12h2\" /><path d=\"M20 12h2\" /><path d=\"m6.34 17.66-1.41 1.41\" /><path d=\"m19.07 4.93-1.41 1.41\" /></symbol>",
        "<symbol id=\"i-ban\" viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"10\" /><path d=\"m4.9 4.9 14.2 14.2\" /></symbol>",
        "<symbol id=\"i-circle-check\" viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"10\" /><path d=\"m9 12 2 2 4-4\" /></symbol>",
        "<symbol id=\"i-circle-alert\" viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"10\" /><line x1=\"12\" x2=\"12\" y1=\"8\" y2=\"12\" /><line x1=\"12\" x2=\"12.01\" y1=\"16\" y2=\"16\" /></symbol>",
        "<symbol id=\"i-info\" viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"10\" /><path d=\"M12 16v-4\" /><path d=\"M12 8h.01\" /></symbol>",
        "<symbol id=\"i-loader-circle\" viewBox=\"0 0 24 24\"><path d=\"M21 12a9 9 0 1 1-6.219-8.56\" /></symbol>",
        "<symbol id=\"i-chevron-down\" viewBox=\"0 0 24 24\"><path d=\"m6 9 6 6 6-6\" /></symbol>",
        "<symbol id=\"i-mouse-pointer-click\" viewBox=\"0 0 24 24\"><path d=\"M14 4.1 12 6\" /><path d=\"m5.1 8-2.9-.8\" /><path d=\"m6 12-1.9 2\" /><path d=\"M7.2 2.2 8 5.1\" /><path d=\"M9.037 9.69a.498.498 0 0 1 .653-.653l11 4.5a.5.5 0 0 1-.074.949l-4.349 1.041a1 1 0 0 0-.74.739l-1.04 4.35a.5.5 0 0 1-.95.074z\" /></symbol>",
    ];
    const NS = 'http://www.w3.org/2000/svg';

    function inject() {
        if (document.getElementById('ui-icon-sprite')) return;
        const holder = document.createElement('div');
        holder.innerHTML = `<svg id="ui-icon-sprite" xmlns="${NS}" width="0" height="0" style="position:absolute" aria-hidden="true">${SYMBOLS.join('')}</svg>`;
        document.body.prepend(holder.firstChild);
    }

    /** 生成一个图标节点 */
    function svg(name, className = 'i') {
        const node = document.createElementNS(NS, 'svg');
        node.setAttribute('class', className);
        node.setAttribute('aria-hidden', 'true');
        const use = document.createElementNS(NS, 'use');
        use.setAttribute('href', '#i-' + name);
        node.appendChild(use);
        return node;
    }

    if (document.body) inject();
    else document.addEventListener('DOMContentLoaded', inject);

    return { svg };
})();

/** 滑块已走过的部分用强调色：CSS 读 --p。用户拖动时自动更新，代码里赋值后要手动调用 paintRange */
const UIControls = (() => {
    function paintRange(input) {
        const min = Number(input.min || 0);
        const max = Number(input.max || 100);
        const p = max > min ? ((Number(input.value) - min) / (max - min)) * 100 : 0;
        input.style.setProperty('--p', p + '%');
    }

    document.addEventListener('input', (e) => {
        if (e.target instanceof HTMLInputElement && e.target.type === 'range') paintRange(e.target);
    });

    return { paintRange };
})();
