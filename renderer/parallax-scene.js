/**
 * parallax-scene.js — 背景场景：Pixi 应用、深度视差滤镜与壁纸 / 深度图纹理
 *
 * 原理：全屏精灵挂一个自定义滤镜。深度 t 的内容沿鼠标方向挪 mouse × (t − focus) × strength，
 * 深度等于对焦深度的地方完全不动，离得越远挪得越多，形成伪 3D 视差。
 * 片元着色器用光线步进找出每个像素实际显示的图片位置，近处的内容挪过来会盖住远处的。
 */

'use strict';

/** 渲染帧率上限 */
const MAX_FPS = 60;

/** 背景深度视差滤镜 */
class DepthParallaxFilter extends PIXI.Filter {
    constructor(imageTexture, depthTexture) {
        super(PARALLAX_VERTEX_SHADER, PARALLAX_FRAGMENT_SHADER, {
            uImage: imageTexture,
            uDepth: depthTexture,
            uDepthSize: new Float32Array([1.0, 1.0]),
            uMouse: new Float32Array([0.0, 0.0]),
            uStrength: 0.025,
            uFocus: 0.50,
            uCoverScale: new Float32Array([1.0, 1.0]),
            uCoverOffset: new Float32Array([0.0, 0.0]),
        });
    }
}

const Scene = (() => {
    const app = new PIXI.Application({
        width: window.innerWidth,
        height: window.innerHeight,
        backgroundColor: 0x000000,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
        resizeTo: window,
    });
    // 壁纸不需要跟着高刷新率屏幕（比如 240Hz）满帧渲染，有动画时最多 60 帧
    app.ticker.maxFPS = MAX_FPS;
    document.body.appendChild(app.view);

    /** 背景全屏精灵（本身是白色贴图，画面完全由滤镜采样得到） */
    let screenSprite = null;
    let filter = null;
    let bgTexture = null;
    let depthTexture = null;
    let depthImage = null;
    let bgWidth = 0;
    let bgHeight = 0;
    let cover = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };

    /**
     * 加载图片。Windows 绝对路径在 Electron 里经 preload 读成 Data URL，
     * 其余（相对路径、data:、blob:、http:）直接交给 <img>。
     * @param {string} url
     * @returns {Promise<HTMLImageElement>}
     */
    function loadImage(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const shortUrl = url.startsWith('data:') ? url.slice(0, 32) + '...' : url;
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error(`无法加载图片: ${shortUrl}`));

            const isLocalAbsolutePath = /^[a-zA-Z]:[\\/]/.test(url) || url.startsWith('\\\\');
            if (isElectron && isLocalAbsolutePath) {
                const dataUrl = window.electronAPI.readFileAsDataURL(url);
                if (dataUrl) {
                    img.src = dataUrl;
                    return;
                }
            }
            img.src = url;
        });
    }

    /**
     * 生成一张近似中性灰的占位深度图（深度图缺失时使用）。
     * 中心略亮，保留一点点视差感。
     */
    function createFallbackDepth(width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = width || 1920;
        canvas.height = height || 1080;
        const ctx = canvas.getContext('2d');
        const gradient = ctx.createRadialGradient(
            canvas.width / 2, canvas.height / 2, 0,
            canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) * 0.6
        );
        gradient.addColorStop(0, 'rgb(140, 140, 140)');
        gradient.addColorStop(1, 'rgb(118, 118, 118)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        console.log(`[Scene] 使用占位深度图 (${canvas.width}×${canvas.height})`);
        return canvas;
    }

    /** 计算原图以 Cover 方式铺满窗口时的 UV 缩放与偏移，并写入滤镜 */
    function updateCover() {
        // 用 window 尺寸而不是 app.screen：Pixi 的 resizeTo 会推迟到下一帧才更新 app.screen，
        // resize 事件里读到的还是旧尺寸（窗口从 0×0 变大时会算出 NaN）
        const screenW = window.innerWidth;
        const screenH = window.innerHeight;
        if (!screenW || !screenH) return;
        cover = Shared.parallax.coverTransform(screenW, screenH, bgWidth || screenW, bgHeight || screenH);

        if (filter) {
            // 必须整体赋值数组，才能触发 Pixi UniformGroup 的脏标记
            filter.uniforms.uCoverScale = [cover.scaleX, cover.scaleY];
            filter.uniforms.uCoverOffset = [cover.offsetX, cover.offsetY];
        }
    }

    function makeTexture(source) {
        const texture = PIXI.Texture.from(source);
        texture.baseTexture.wrapMode = PIXI.WRAP_MODES.CLAMP;
        return texture;
    }

    /**
     * 加载（或更换）壁纸与深度图。首次调用会建好精灵和滤镜，之后只替换纹理并释放旧纹理。
     * @param {string} bgSource - 壁纸路径或 Data URL，加载失败会抛错
     * @param {string|null} depthSource - 深度图路径或 Data URL；为 null 或加载失败时用占位深度图
     */
    async function load(bgSource, depthSource) {
        const bgImg = await loadImage(bgSource);

        let depthSrc = null;
        if (depthSource) {
            try {
                depthSrc = await loadImage(depthSource);
            } catch (err) {
                console.warn('[Scene] 深度图加载失败，改用占位深度图:', err.message);
            }
        }
        if (!depthSrc) depthSrc = createFallbackDepth(bgImg.naturalWidth, bgImg.naturalHeight);

        const oldBg = bgTexture;
        const oldDepth = depthTexture;

        bgTexture = makeTexture(bgImg);
        depthTexture = makeTexture(depthSrc);
        // 光线步进在分支和循环里读深度图，读的时候算不出该用哪级 mipmap，所以深度图不要 mipmap
        depthTexture.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
        depthImage = depthSrc;
        bgWidth = bgImg.naturalWidth;
        bgHeight = bgImg.naturalHeight;

        if (!filter) {
            screenSprite = new PIXI.Sprite(PIXI.Texture.WHITE);
            screenSprite.width = window.innerWidth;
            screenSprite.height = window.innerHeight;
            filter = new DepthParallaxFilter(bgTexture, depthTexture);
            screenSprite.filters = [filter];
            app.stage.addChildAt(screenSprite, 0);
        } else {
            filter.uniforms.uImage = bgTexture;
            filter.uniforms.uDepth = depthTexture;
        }
        filter.uniforms.uDepthSize = getDepthSize();
        updateCover();

        // 新纹理已经挂上滤镜，旧纹理可以连同 GPU 资源一起释放
        if (oldBg) oldBg.destroy(true);
        if (oldDepth) oldDepth.destroy(true);

        // 立刻出一帧：主进程可能紧接着发来暂停信号停掉 ticker，保证画面不留空白
        app.renderer.render(app.stage);
        console.log(`[Scene] 已加载壁纸 ${bgWidth}×${bgHeight}，窗口 ${app.screen.width}×${app.screen.height}`);
    }

    /**
     * 设置视差参数。
     * @param {number} mouseX - 写入 uMouse 的值（已取反：鼠标右移时为负）
     * @param {number} mouseY
     * @param {number} strength - 着色器里的 uStrength
     * @param {number} focus - 对焦深度 0~1
     */
    function setParallax(mouseX, mouseY, strength, focus) {
        if (!filter) return;
        // 整体赋值数组，触发 Proxy setter
        filter.uniforms.uMouse = [mouseX, mouseY];
        filter.uniforms.uStrength = strength;
        filter.uniforms.uFocus = focus;
    }

    /** 深度图的像素尺寸（光线步进按它决定走几步） */
    function getDepthSize() {
        if (!depthImage) return [1, 1];
        return [depthImage.naturalWidth || depthImage.width, depthImage.naturalHeight || depthImage.height];
    }

    /** 在背景之上追加一个显示层 */
    function addLayer(displayObject) {
        app.stage.addChild(displayObject);
    }

    window.addEventListener('resize', () => {
        if (screenSprite) {
            screenSprite.width = window.innerWidth;
            screenSprite.height = window.innerHeight;
        }
        updateCover();
    });

    return {
        app,
        load,
        setParallax,
        addLayer,
        getCover: () => ({ ...cover }),
        getDepthTexture: () => depthTexture,
        getDepthSize,
        getDepthImage: () => depthImage,
    };
})();
