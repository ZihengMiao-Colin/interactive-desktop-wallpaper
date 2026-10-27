/**
 * depth-preview.js — 设置窗口的壁纸预览区，可以在原图和深度图之间切换
 *
 * 选中的图片有深度图时，右上角出现"原图 | 深度图"切换；
 * 刚生成完深度图会自动切到深度图，方便马上检查效果。
 */

'use strict';

/**
 * @returns {{
 *   showImage: (dataUrl: string, label: string) => void,
 *   setDepth: (depthUrl: string|null, options?: { show?: boolean }) => void,
 * }}
 */
function initDepthPreview() {
    const placeholder = document.getElementById('preview-placeholder');
    const image = document.getElementById('preview-image');
    const info = document.getElementById('preview-info');
    const modeBar = document.getElementById('preview-mode');
    const buttons = [...modeBar.querySelectorAll('button')];

    let imageUrl = '';
    let depthUrl = '';
    let label = '';
    let sizeText = '';
    let mode = 'image';

    function render() {
        const showDepth = mode === 'depth' && !!depthUrl;
        image.src = showDepth ? depthUrl : imageUrl;
        info.textContent = showDepth ? `${label} · 深度图（白=近，黑=远）` : label + sizeText;
        modeBar.hidden = !depthUrl;
        for (const b of buttons) b.classList.toggle('active', b.dataset.mode === (showDepth ? 'depth' : 'image'));
    }

    for (const b of buttons) {
        b.addEventListener('click', () => {
            mode = b.dataset.mode;
            render();
        });
    }

    return {
        /** 换一张图片：回到原图，旧的深度图清掉 */
        showImage(dataUrl, name) {
            imageUrl = dataUrl;
            depthUrl = '';
            label = name;
            sizeText = '';
            mode = 'image';
            placeholder.style.display = 'none';
            image.style.display = 'block';
            info.classList.add('visible');
            render();

            const probe = new Image();
            probe.onload = () => {
                if (imageUrl !== dataUrl) return;
                sizeText = `  (${probe.naturalWidth}×${probe.naturalHeight})`;
                render();
            };
            probe.src = dataUrl;
        },

        /** 设置当前图片的深度图；show 为 true 时直接切到深度图 */
        setDepth(url, { show = false } = {}) {
            depthUrl = url || '';
            if (show) mode = 'depth';
            render();
        },
    };
}
