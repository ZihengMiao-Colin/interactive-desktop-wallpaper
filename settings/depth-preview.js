/**
 * depth-preview.js — 设置窗口的实时视差预览
 *
 * 鼠标在预览上移动时，按当前的视差参数让图片动起来，用的是和壁纸同一个着色器公式
 * （renderer/shaders.js 的 PARALLAX_GLSL）和同一套 cover 映射（Shared.parallax）。
 * 右上角"原图 | 深度图"切换（有深度图才出现）；刚生成完深度图会自动切到深度图。
 * 预览节点只有一份，mount() 把它挪到当前页面的槽位（壁纸页大、视差页小）。
 * 只在鼠标移动或画面收敛前出帧，平时不占 GPU；拿不到 WebGL 时退回普通 <img>。
 */

'use strict';

/** 上传纹理前把图片缩到这个最长边以内 */
const PREVIEW_MAX_TEXTURE = 2048;
/** 平滑系数按 60fps 的帧时间换算，和壁纸一致 */
const PREVIEW_FRAME_MS = 1000 / 60;

const PREVIEW_HINT = {
    live: '把鼠标移到图上，看壁纸动起来的样子',
    noDepth: '生成深度图后可以预览视差',
    still: '这个视频设为不动，画面不跟鼠标移动',
};
/** 读取预览视频的超时 */
const PREVIEW_VIDEO_TIMEOUT_MS = 15000;

const PREVIEW_VERTEX = `
attribute vec2 aPos;
varying vec2 vUV;
void main(void) {
    vUV = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
    gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const PREVIEW_FRAGMENT = `
precision highp float;
varying vec2 vUV;
uniform sampler2D uImage;
uniform sampler2D uDepth;
uniform vec2 uDepthSize;
uniform vec2 uMouse;
uniform vec2 uCoverScale;
uniform vec2 uCoverOffset;
uniform float uStrength;
uniform float uFocus;
uniform float uShowDepth;
${PARALLAX_GLSL}
void main(void) {
    vec2 baseUV = vUV * uCoverScale + uCoverOffset;
    vec2 finalUV = clamp(rayMarchUV(uDepth, uDepthSize, baseUV, uMouse, uFocus, uStrength), vec2(0.001), vec2(0.999));
    gl_FragColor = uShowDepth > 0.5 ? texture2D(uDepth, finalUV) : texture2D(uImage, finalUV);
}
`;

/**
 * @returns {{
 *   showImage: (dataUrl: string, info: { name: string, tag: string }) => void,
 *   showVideo: (fileUrl: string, info: { name: string, tag: string }) => Promise<{ width: number, height: number, duration: number }>,
 *   setMotion: (motion: 'depth'|'none'|'pan') => void,
 *   setActive: (active: boolean) => void,
 *   setUsing: (using: boolean) => void,
 *   setDepth: (depthUrl: string|null, options?: { show?: boolean }) => void,
 *   setParams: (params: { parallaxMultiplier?: number, smoothness?: number, focusDepth?: number }) => void,
 *   mount: (slot: HTMLElement) => void,
 * }}
 */
function initDepthPreview() {
    const root = document.getElementById('preview');
    const canvas = document.getElementById('preview-canvas');
    const fallbackImg = document.getElementById('preview-image');
    const placeholder = document.getElementById('preview-placeholder');
    const shade = document.getElementById('preview-shade');
    const hint = document.getElementById('preview-hint');
    const hintText = document.getElementById('preview-hint-text');
    const modeBar = document.getElementById('preview-mode');
    const modeButtons = [...modeBar.querySelectorAll('button')];
    const meta = document.getElementById('preview-meta');
    const nameEl = document.getElementById('preview-name');
    const tagEl = document.getElementById('preview-tag');
    const usingEl = document.getElementById('preview-using');
    const sizeEl = document.getElementById('preview-size');

    const params = { parallaxMultiplier: 10, smoothness: 0.08, focusDepth: 0.5 };
    let imageUrl = '';
    let depthUrl = '';
    let mode = 'image';
    /** 每次换图 +1，旧图片晚到的加载结果直接丢掉 */
    let loadToken = 0;
    /** 视频壁纸的效果：'depth' 3D 视差（图片总是这个）| 'none' 不动 | 'pan' 整体平移 */
    let motion = 'depth';
    /** 预览的是视频时的 <video>（放在预览里、隐藏，每出一帧上传一次纹理） */
    let videoEl = null;
    /** 设置窗口隐藏、或者切到没有预览的页面时为 false：视频暂停、不重画 */
    let active = true;

    const gl = createRenderer();

    // ---------- WebGL ----------

    function createRenderer() {
        const ctx = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false });
        if (!ctx) return null;
        const program = ctx.createProgram();
        for (const [type, src] of [[ctx.VERTEX_SHADER, PREVIEW_VERTEX], [ctx.FRAGMENT_SHADER, PREVIEW_FRAGMENT]]) {
            const shader = ctx.createShader(type);
            ctx.shaderSource(shader, src);
            ctx.compileShader(shader);
            if (!ctx.getShaderParameter(shader, ctx.COMPILE_STATUS)) {
                console.error('[Preview] 着色器编译失败:', ctx.getShaderInfoLog(shader));
                return null;
            }
            ctx.attachShader(program, shader);
        }
        ctx.linkProgram(program);
        if (!ctx.getProgramParameter(program, ctx.LINK_STATUS)) {
            console.error('[Preview] 着色器链接失败:', ctx.getProgramInfoLog(program));
            return null;
        }
        ctx.useProgram(program);

        ctx.bindBuffer(ctx.ARRAY_BUFFER, ctx.createBuffer());
        ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), ctx.STATIC_DRAW);
        const aPos = ctx.getAttribLocation(program, 'aPos');
        ctx.enableVertexAttribArray(aPos);
        ctx.vertexAttribPointer(aPos, 2, ctx.FLOAT, false, 0, 0);

        const uniforms = {};
        for (const name of ['uImage', 'uDepth', 'uDepthSize', 'uMouse', 'uCoverScale', 'uCoverOffset', 'uStrength', 'uFocus', 'uShowDepth']) {
            uniforms[name] = ctx.getUniformLocation(program, name);
        }
        ctx.uniform1i(uniforms.uImage, 0);
        ctx.uniform1i(uniforms.uDepth, 1);

        // 1×1 全白深度图：视频"不动""整体平移"时用（整张画面都在深度 1，见 Shared.parallax.motionParams）
        const flatTexture = ctx.createTexture();
        ctx.activeTexture(ctx.TEXTURE1);
        ctx.bindTexture(ctx.TEXTURE_2D, flatTexture);
        ctx.texImage2D(ctx.TEXTURE_2D, 0, ctx.RGBA, 1, 1, 0, ctx.RGBA, ctx.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
        ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MIN_FILTER, ctx.NEAREST);
        ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MAG_FILTER, ctx.NEAREST);

        return {
            ctx,
            uniforms,
            image: null,        // { texture, width, height }
            depth: null,
            flat: { texture: flatTexture, width: 1, height: 1 },
        };
    }

    /** 把视频当前这一帧上传到图片纹理（第一次时建纹理） */
    function uploadVideoFrame() {
        if (!gl || !videoEl || !videoEl.videoWidth) return;
        const { ctx } = gl;
        if (!gl.image) {
            const texture = ctx.createTexture();
            gl.image = { texture, width: videoEl.videoWidth, height: videoEl.videoHeight };
            ctx.activeTexture(ctx.TEXTURE0);
            ctx.bindTexture(ctx.TEXTURE_2D, texture);
            ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MIN_FILTER, ctx.LINEAR);
            ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MAG_FILTER, ctx.LINEAR);
            ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_S, ctx.CLAMP_TO_EDGE);
            ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_T, ctx.CLAMP_TO_EDGE);
        }
        ctx.activeTexture(ctx.TEXTURE0);
        ctx.bindTexture(ctx.TEXTURE_2D, gl.image.texture);
        ctx.texImage2D(ctx.TEXTURE_2D, 0, ctx.RGBA, ctx.RGBA, ctx.UNSIGNED_BYTE, videoEl);
    }

    /** 停掉并移除预览视频 */
    function releaseVideo() {
        if (!videoEl) return;
        videoEl.pause();
        videoEl.removeAttribute('src');
        videoEl.load();
        videoEl.remove();
        videoEl = null;
    }

    /** 图片地址 → 缩小后的 ImageBitmap（大图直接上传太占显存，也可能超过纹理上限） */
    async function loadBitmap(url) {
        const img = new Image();
        img.src = url;
        await img.decode();
        const scale = Math.min(1, PREVIEW_MAX_TEXTURE / Math.max(img.naturalWidth, img.naturalHeight));
        const bitmap = await createImageBitmap(img, {
            resizeWidth: Math.max(1, Math.round(img.naturalWidth * scale)),
            resizeHeight: Math.max(1, Math.round(img.naturalHeight * scale)),
            resizeQuality: 'high',
        });
        return { bitmap, width: img.naturalWidth, height: img.naturalHeight };
    }

    function upload(unit, slot, loaded) {
        const { ctx } = gl;
        if (gl[slot]) ctx.deleteTexture(gl[slot].texture);
        const texture = ctx.createTexture();
        ctx.activeTexture(ctx.TEXTURE0 + unit);
        ctx.bindTexture(ctx.TEXTURE_2D, texture);
        ctx.texImage2D(ctx.TEXTURE_2D, 0, ctx.RGBA, ctx.RGBA, ctx.UNSIGNED_BYTE, loaded.bitmap);
        ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MIN_FILTER, ctx.LINEAR);
        ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MAG_FILTER, ctx.LINEAR);
        ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_S, ctx.CLAMP_TO_EDGE);
        ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_T, ctx.CLAMP_TO_EDGE);
        loaded.bitmap.close();
        gl[slot] = { texture, width: loaded.width, height: loaded.height };
    }

    function clearTexture(slot) {
        if (!gl || !gl[slot]) return;
        gl.ctx.deleteTexture(gl[slot].texture);
        gl[slot] = null;
    }

    // ---------- 鼠标与动画 ----------

    const target = [0, 0];
    const current = [0, 0];
    let rafId = 0;
    let lastTime = 0;

    /** 鼠标移动时画面会不会动：整体平移总会，3D 视差要有深度图，不动不会 */
    const isLive = () => !!(gl && gl.image && (motion === 'pan' || (motion === 'depth' && gl.depth)));

    function draw() {
        if (!gl || !gl.image) return;
        const { ctx, uniforms } = gl;
        const w = Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio));
        const h = Math.max(1, Math.round(canvas.clientHeight * devicePixelRatio));
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }
        ctx.viewport(0, 0, w, h);

        // 强度、对焦按效果换算（和壁纸一致）；整体平移时画面放大一点，移到最边上也不露出拉伸的边缘
        const base = isLive() ? Shared.parallax.strengthFromMultiplier(params.parallaxMultiplier) : 0;
        const m = Shared.parallax.motionParams(motion, base, params.focusDepth);
        let cover = Shared.parallax.coverTransform(w, h, gl.image.width, gl.image.height);
        if (motion === 'pan') cover = Shared.parallax.panCover(cover, m.strength);
        ctx.uniform2f(uniforms.uCoverScale, cover.scaleX, cover.scaleY);
        ctx.uniform2f(uniforms.uCoverOffset, cover.offsetX, cover.offsetY);
        // 鼠标右移时近景向左偏，所以传入取反后的值（和壁纸一致）
        ctx.uniform2f(uniforms.uMouse, -current[0], -current[1]);
        ctx.uniform1f(uniforms.uStrength, m.strength);
        ctx.uniform1f(uniforms.uFocus, m.focus);
        ctx.uniform1f(uniforms.uShowDepth, mode === 'depth' && gl.depth && motion === 'depth' ? 1 : 0);
        // 不动 / 整体平移用全白深度图；没有深度图时深度纹理位绑原图，反正强度是 0，不会偏移
        const depth = motion !== 'depth' ? gl.flat : (gl.depth || gl.image);
        ctx.uniform2f(uniforms.uDepthSize, depth.width, depth.height);
        ctx.activeTexture(ctx.TEXTURE1);
        ctx.bindTexture(ctx.TEXTURE_2D, depth.texture);
        ctx.drawArrays(ctx.TRIANGLE_STRIP, 0, 4);
    }

    function frame(now) {
        const dt = lastTime ? Math.min(now - lastTime, 100) : PREVIEW_FRAME_MS;
        lastTime = now;
        const k = 1 - Math.pow(1 - params.smoothness, dt / PREVIEW_FRAME_MS);
        current[0] += (target[0] - current[0]) * k;
        current[1] += (target[1] - current[1]) * k;
        draw();

        const { isSettled } = Shared.framePacing;
        if (isSettled(target[0], current[0]) && isSettled(target[1], current[1])) {
            rafId = 0;
            lastTime = 0;
            return;
        }
        rafId = requestAnimationFrame(frame);
    }

    /** 让画面动起来，收敛后自动停 */
    function animate() {
        if (!rafId && isLive()) rafId = requestAnimationFrame(frame);
    }

    /** 只重画一帧（换参数、换尺寸、换模式时） */
    function redraw() {
        if (!rafId) draw();
    }

    root.addEventListener('pointermove', (e) => {
        if (!isLive()) return;
        const r = root.getBoundingClientRect();
        target[0] = ((e.clientX - r.left) / r.width) * 2 - 1;
        target[1] = ((e.clientY - r.top) / r.height) * 2 - 1;
        animate();
    });
    root.addEventListener('pointerleave', () => {
        target[0] = 0;
        target[1] = 0;
        animate();
    });
    new ResizeObserver(redraw).observe(root);

    // ---------- 界面状态 ----------

    function render() {
        const hasImage = !!imageUrl;
        // 深度图只在 3D 视差时有用；视频的"不动""整体平移"不看深度图
        const hasDepth = !!depthUrl && motion === 'depth';
        const showDepth = mode === 'depth' && hasDepth;
        const liveMode = motion === 'pan' || hasDepth;

        placeholder.hidden = hasImage;
        shade.hidden = !hasImage;
        meta.hidden = !hasImage;
        modeBar.hidden = !hasDepth;
        for (const b of modeButtons) b.classList.toggle('on', b.dataset.mode === (showDepth ? 'depth' : 'image'));

        hint.hidden = !hasImage || !gl;
        hintText.textContent = motion === 'none' ? PREVIEW_HINT.still : (liveMode ? PREVIEW_HINT.live : PREVIEW_HINT.noDepth);
        root.classList.toggle('live', liveMode && !!gl);

        if (gl) {
            canvas.hidden = !hasImage;
            fallbackImg.hidden = true;
            redraw();
        } else if (videoEl) {
            // 没有 WebGL：直接显示视频本身（没有视差）
            canvas.hidden = true;
            fallbackImg.hidden = true;
            videoEl.hidden = false;
        } else {
            canvas.hidden = true;
            fallbackImg.hidden = !hasImage;
            if (hasImage) fallbackImg.src = showDepth ? depthUrl : imageUrl;
        }
    }

    for (const b of modeButtons) {
        b.addEventListener('click', () => {
            mode = b.dataset.mode;
            render();
        });
    }

    async function loadInto(slot, unit, url, token) {
        try {
            const loaded = await loadBitmap(url);
            if (token !== loadToken) {
                loaded.bitmap.close();
                return null;
            }
            if (gl) upload(unit, slot, loaded);
            else loaded.bitmap.close();
            return loaded;
        } catch (err) {
            console.error('[Preview] 读取图片失败:', err);
            return null;
        }
    }

    return {
        /** 换一张图片：回到原图模式，旧的深度图清掉 */
        showImage(dataUrl, info) {
            const token = ++loadToken;
            releaseVideo();
            imageUrl = dataUrl;
            depthUrl = '';
            mode = 'image';
            motion = 'depth';
            target[0] = target[1] = current[0] = current[1] = 0;
            nameEl.textContent = info.name;
            tagEl.textContent = info.tag;
            sizeEl.textContent = '';
            clearTexture('image');
            clearTexture('depth');
            if (gl) {
                // 新图加载完之前不要一直显示上一张
                gl.ctx.clearColor(0, 0, 0, 0);
                gl.ctx.clear(gl.ctx.COLOR_BUFFER_BIT);
            }
            render();
            loadInto('image', 0, dataUrl, token).then((loaded) => {
                if (!loaded) return;
                sizeEl.textContent = `${loaded.width} × ${loaded.height}`;
                render();
            });
        },

        /**
         * 换成一个视频（循环播放、一直静音）：回到原图模式，旧的深度图清掉，效果先按"不动"。
         * 读不出来（格式不支持、没有画面）时 reject。
         */
        showVideo(fileUrl, info) {
            const token = ++loadToken;
            releaseVideo();
            imageUrl = fileUrl;
            depthUrl = '';
            mode = 'image';
            motion = 'none';
            target[0] = target[1] = current[0] = current[1] = 0;
            nameEl.textContent = info.name;
            tagEl.textContent = info.tag;
            sizeEl.textContent = '';
            clearTexture('image');
            clearTexture('depth');
            if (gl) {
                gl.ctx.clearColor(0, 0, 0, 0);
                gl.ctx.clear(gl.ctx.COLOR_BUFFER_BIT);
            }

            const video = document.createElement('video');
            video.muted = true;
            video.loop = true;
            video.playsInline = true;
            video.preload = 'auto';
            video.hidden = true;
            Object.assign(video.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover' });
            root.appendChild(video);
            videoEl = video;
            render();

            return new Promise((resolve, reject) => {
                const fail = (message) => {
                    clearTimeout(timer);
                    if (videoEl === video) releaseVideo();
                    reject(new Error(message));
                };
                const timer = setTimeout(() => fail('视频读取超时'), PREVIEW_VIDEO_TIMEOUT_MS);
                video.addEventListener('error', () => fail('视频无法播放'), { once: true });
                video.addEventListener('loadeddata', () => {
                    clearTimeout(timer);
                    // 加载期间又换了别的：这个视频不用了
                    if (token !== loadToken) {
                        resolve({ width: 0, height: 0, duration: 0 });
                        return;
                    }
                    if (!video.videoWidth || !video.videoHeight) {
                        fail('无法读取画面尺寸');
                        return;
                    }
                    const duration = Number.isFinite(video.duration) ? video.duration : 0;
                    const time = Shared.myWallpapers.formatDuration(duration);
                    sizeEl.textContent = `${video.videoWidth} × ${video.videoHeight}` + (time ? ` · ${time}` : '');
                    uploadVideoFrame();
                    const onFrame = () => {
                        if (videoEl !== video) return;
                        if (active) {
                            uploadVideoFrame();
                            redraw();
                        }
                        video.requestVideoFrameCallback(onFrame);
                    };
                    video.requestVideoFrameCallback(onFrame);
                    if (active) video.play().catch((err) => console.warn('[Preview] 视频播放失败:', err.message));
                    render();
                    resolve({ width: video.videoWidth, height: video.videoHeight, duration });
                }, { once: true });
                video.src = fileUrl;
            });
        },

        /** 视频的效果：'depth' 3D 视差 | 'none' 不动 | 'pan' 整体平移 */
        setMotion(next) {
            motion = next === 'depth' || next === 'pan' ? next : 'none';
            if (motion === 'none') {
                target[0] = target[1] = current[0] = current[1] = 0;
            }
            render();
        },

        /** 设置窗口隐藏、切到没有预览的页面时传 false：视频暂停，回来接着播 */
        setActive(next) {
            active = !!next;
            if (!videoEl) return;
            if (active) videoEl.play().catch(() => {});
            else videoEl.pause();
        },

        setUsing(using) {
            usingEl.hidden = !using;
        },

        /** 设置当前图片的深度图；show 为 true 时直接切到深度图 */
        setDepth(url, { show = false } = {}) {
            const token = loadToken;
            depthUrl = url || '';
            if (show && depthUrl) mode = 'depth';
            clearTexture('depth');
            render();
            if (depthUrl) loadInto('depth', 1, depthUrl, token).then((loaded) => { if (loaded) render(); });
        },

        setParams(next) {
            Object.assign(params, next);
            redraw();
        },

        mount(slot) {
            if (root.parentElement !== slot) slot.appendChild(root);
            redraw();
        },
    };
}
