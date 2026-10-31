/**
 * elements-layer.js — 自定义元素渲染层
 *
 * 每个实例是框坐标里的一个四边形 PIXI.Mesh（自由变形时四个角各自偏移），
 * 挂元素着色器（透视贴图、翻转、变色、视差位移、深度遮挡、绿幕抠像）。
 * 位置、大小、旋转每帧按 transform + 视差位移重新计算；素材按实例 id 复用，素材文件变了才重新加载。
 * 点击播放的元素由 handleClick 触发：点中元素播放一次，或者在点击的位置出现并播放一次。
 */

'use strict';

/** 框坐标里的四个角（左上、右上、右下、左下） */
const ELEMENT_BOX_CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]];

class ElementsLayer {
    /** @param {typeof Scene} scene */
    constructor(scene) {
        this.scene = scene;
        this.container = new PIXI.Container();
        this.container.sortableChildren = true;
        scene.addLayer(this.container);

        /** 点击位置取深度用（深度图换了才重建） */
        this.depthSampler = null;
        this.depthSamplerImage = null;

        /** @type {Map<string, {instance, asset, source, mesh, geometry, scheduler, aspect, playbackKey, warpKey, shown, clickAt, color}>} */
        this.entries = new Map();
        /** 正在加载素材的实例 id */
        this.loading = new Set();
        this.savedInstances = [];
        this.assets = new Map();
        /** 摆放模式下正在编辑的实例 */
        this.draft = null;
        this.paused = false;
    }

    /**
     * 同步配置里的实例。
     * @returns {Promise<{broken: string[]}>} 找不到素材或加载失败的实例 id
     */
    async setElements(customElements, builtinAssets) {
        this.savedInstances = customElements.instances;
        this.assets = new Map([...builtinAssets, ...customElements.library].map((a) => [a.id, a]));
        if (this.draft) this.assets.set(this.draft.asset.id, this.draft.asset);
        return this._sync();
    }

    /** 设置摆放中的草稿实例；同 id 的已保存实例会被草稿替代。传 null 清除 */
    async setDraft(instance, asset) {
        this.draft = instance ? { instance, asset } : null;
        if (asset) this.assets.set(asset.id, asset);
        await this._sync();
    }

    /** 素材实际宽高比（素材还没加载好时用 manifest 里的值） */
    getAssetAspect(instanceId) {
        const entry = this.entries.get(instanceId);
        if (entry) return entry.aspect;
        const instance = this._desiredInstances().find((i) => i.id === instanceId);
        const asset = instance && this.assets.get(instance.assetId);
        return (asset && asset.aspect) || 1;
    }

    /**
     * 每帧调用。
     * @param {number} nowMs
     * @param {number} mouseX - 与背景 uMouse 相同的值（已取反）
     * @param {number} mouseY
     * @param {number} strength
     * @param {number} focus
     */
    update(nowMs, mouseX, mouseY, strength, focus) {
        if (this.entries.size === 0) return;
        const screenW = window.innerWidth;
        const screenH = window.innerHeight;
        const cover = this.scene.getCover();
        const depthTexture = this.scene.getDepthTexture();
        const depthSize = this.scene.getDepthSize();
        const { elementSize } = Shared.placement;
        const { elementScreenShift } = Shared.parallax;

        for (const entry of this.entries.values()) {
            const { instance, source, mesh, scheduler } = entry;
            let show = instance.visible;

            if (show && scheduler && !this.paused) {
                const action = scheduler.tick(nowMs, source.hasEnded());
                if (action === 'start') {
                    source.restart();
                    source.play();
                } else if (action === 'hide') {
                    source.pause();
                } else if (action === 'end') {
                    // 点击播放播完：停回第一帧待命
                    source.pause();
                    source.restart();
                }
            }
            if (scheduler) show = show && (scheduler.playing || !scheduler.hideWhenIdle);
            mesh.visible = show;
            if (!show) continue;

            source.update(nowMs);

            // "在点击位置出现"的元素用点击时记下的位置和深度
            const transform = Shared.elements.transformOf(instance);
            let depth = instance.depth;
            if (entry.clickAt) {
                transform.x = entry.clickAt.x;
                transform.y = entry.clickAt.y;
                depth = entry.clickAt.depth;
            }
            const size = elementSize(transform, entry.aspect, screenW);
            const [dx, dy] = elementScreenShift(mouseX, mouseY, depth, focus, strength, cover);
            entry.shown = { ...transform, x: transform.x + dx, y: transform.y + dy };
            mesh.position.set(entry.shown.x * screenW, entry.shown.y * screenH);
            mesh.scale.set(size.width, size.height);
            mesh.rotation = (transform.rotation * Math.PI) / 180;
            this._updateGeometry(entry, transform);

            const u = mesh.shader.uniforms;
            u.uDepth = depthTexture;
            u.uDepthSize = depthSize;
            u.uScreenSize = [screenW, screenH];
            u.uCoverScale = [cover.scaleX, cover.scaleY];
            u.uCoverOffset = [cover.offsetX, cover.offsetY];
            u.uMouse = [mouseX, mouseY];
            u.uStrength = strength;
            u.uFocus = focus;
            u.uElemDepth = depth;
            u.uOpacity = instance.opacity;
            u.uChromaEnabled = instance.chroma && instance.chroma.enabled ? 1 : 0;
            u.uChromaStrength = instance.chroma ? instance.chroma.strength : 0.5;
            u.uFlip = [transform.flipX ? 1 : 0, transform.flipY ? 1 : 0];
            const color = entry.color;
            u.uHue = color.hue;
            u.uSaturation = color.saturation;
            u.uBrightness = color.brightness;
            u.uTint = color.tint;
            u.uTintAmount = color.tintAmount;
        }
    }

    /**
     * 桌面被点击（屏幕像素坐标）：触发点击播放的元素。
     * "在点击位置出现"的元素移到点击处播放；其余的要点中元素本身才播放。
     * @returns {boolean} 是否触发了元素（需要叫醒渲染）
     */
    handleClick(px, py) {
        if (this.paused) return false;
        const screenW = window.innerWidth;
        const screenH = window.innerHeight;
        let triggered = false;
        for (const entry of this.entries.values()) {
            const { instance, scheduler } = entry;
            if (!instance.visible || !(scheduler instanceof Shared.playback.ClickTrigger)) continue;
            if (scheduler.hideWhenIdle) {
                const x = px / screenW;
                const y = py / screenH;
                entry.clickAt = { x, y, depth: instance.depthAuto ? this._depthAt(x, y) : instance.depth };
            } else if (!entry.shown || !Shared.placement.pointInElement(entry.shown, entry.aspect, px, py, screenW, screenH)) {
                continue;
            }
            scheduler.trigger();
            triggered = true;
        }
        return triggered;
    }

    pause(nowMs) {
        this.paused = true;
        for (const entry of this.entries.values()) {
            entry.source.pause();
            if (entry.scheduler) entry.scheduler.pause(nowMs);
        }
    }

    resume(nowMs) {
        this.paused = false;
        for (const entry of this.entries.values()) {
            if (entry.scheduler) entry.scheduler.resume(nowMs);
            if (this._shouldPlay(entry)) entry.source.play();
        }
    }

    /**
     * 是否需要继续每帧渲染：有循环播放的视频 / 动图、间隔播放正在播（或还没开始第一次），
     * 或者还有素材在加载。都没有时壁纸可以停帧。
     */
    needsFrames() {
        if (this.paused) return false;
        if (this.loading.size > 0) return true;
        for (const { instance, source, scheduler } of this.entries.values()) {
            if (!instance.visible || !source.animated) continue;
            if (scheduler ? scheduler.needsFrames : instance.playback && instance.playback.mode === 'loop') return true;
        }
        return false;
    }

    /** 最早一个"间隔播放"元素下一次开始播放的时间（performance.now 时间轴）；没有则为 null */
    nextWakeMs() {
        let next = null;
        for (const { instance, scheduler } of this.entries.values()) {
            const at = instance.visible && scheduler ? scheduler.nextEventMs : null;
            if (at !== null && (next === null || at < next)) next = at;
        }
        return next;
    }

    // ==================== 内部 ====================

    /** 当前应该显示的实例：已保存的（草稿替代同 id 的那个）+ 草稿 */
    _desiredInstances() {
        if (!this.draft) return this.savedInstances;
        const draftId = this.draft.instance.id;
        return [...this.savedInstances.filter((i) => i.id !== draftId), this.draft.instance];
    }

    _resolve() {
        return Shared.elements.resolveInstances(this._desiredInstances(), this.assets);
    }

    async _sync() {
        const { ok, broken } = this._resolve();
        const wanted = new Map(ok.map((x) => [x.instance.id, x]));

        // 不再需要的、或者换了素材文件的，先销毁
        for (const [id, entry] of this.entries) {
            const w = wanted.get(id);
            if (!w || w.asset.file !== entry.asset.file) this._destroyEntry(id);
        }

        const failed = [];
        await Promise.all(ok.map(async ({ instance, asset }) => {
            const existing = this.entries.get(instance.id);
            if (existing) {
                existing.instance = instance;
                this._configure(existing);
                return;
            }
            // 正在加载的不重复加载；加载完成时会读取最新的实例数据
            if (this.loading.has(instance.id)) return;

            this.loading.add(instance.id);
            try {
                const source = await createElementSource(asset);
                const latest = this._resolve().ok.find((x) => x.instance.id === instance.id);
                if (!latest || latest.asset.file !== asset.file) {
                    source.destroy();
                    return;
                }
                this._createEntry(latest.instance, latest.asset, source);
            } catch (err) {
                console.warn('[Elements] 素材加载失败，已跳过:', asset.file, err.message);
                failed.push(instance.id);
            } finally {
                this.loading.delete(instance.id);
            }
        }));

        this._reorder();
        if (broken.length) console.warn('[Elements] 找不到素材的元素:', broken);
        return { broken: [...broken, ...failed] };
    }

    _createEntry(instance, asset, source) {
        const shader = createElementShader(source.texture, this.scene.getDepthTexture());
        // 每个实例自己一份几何体：自由变形时四个角的位置各不相同
        const geometry = new PIXI.Geometry()
            .addAttribute('aVertexPosition', new Float32Array(8), 2)
            .addAttribute('aUvs', new Float32Array(12), 3)
            .addIndex([0, 1, 2, 0, 2, 3]);
        const mesh = new PIXI.Mesh(geometry, shader);
        mesh.pivot.set(0.5, 0.5);   // 绕框中心旋转
        mesh.visible = false;   // 第一次 update 时再决定是否显示
        this.container.addChild(mesh);
        const entry = {
            instance,
            asset,
            source,
            mesh,
            geometry,
            scheduler: null,
            aspect: source.width / source.height || asset.aspect || 1,
            playbackKey: null,
            warpKey: null,
            shown: null,
            clickAt: null,
            color: null,
        };
        this.entries.set(instance.id, entry);
        this._configure(entry);
    }

    /** 四个角变了才重写顶点：位置是框坐标，贴图坐标带透视权重 */
    _updateGeometry(entry, transform) {
        const key = JSON.stringify(transform.warp);
        if (key === entry.warpKey) return;
        entry.warpKey = key;
        const points = Shared.placement.quadCorners(transform);
        const q = Shared.placement.projectiveWeights(points);
        entry.geometry.getBuffer('aVertexPosition').update(new Float32Array(points.flat()));
        entry.geometry.getBuffer('aUvs').update(new Float32Array(
            ELEMENT_BOX_CORNERS.flatMap(([u, v], i) => [u * q[i], v * q[i], q[i]])));
    }

    /** 点击位置（屏幕归一化）处的壁纸深度 */
    _depthAt(x, y) {
        const image = this.scene.getDepthImage();
        if (!image) return 0.5;
        if (this.depthSamplerImage !== image) {
            this.depthSampler = createDepthSampler(image);
            this.depthSamplerImage = image;
        }
        const [u, v] = Shared.parallax.screenToImageUV(x, y, this.scene.getCover());
        return this.depthSampler.sample(u, v);
    }

    /** 按实例的设置配置素材源和颜色；播放设置没变时不重置调度器 */
    _configure(entry) {
        const { instance, source } = entry;
        entry.color = Shared.elements.colorUniforms(Shared.elements.effectsOf(instance));
        const playback = instance.playback || { mode: 'static' };
        const key = JSON.stringify([playback, instance.visible]);
        if (key === entry.playbackKey) return;
        entry.playbackKey = key;

        if (!source.animated) {
            entry.scheduler = null;
            return;
        }
        entry.clickAt = null;
        if (playback.mode === 'interval') {
            source.setLoop(false);
            source.pause();
            entry.scheduler = new Shared.playback.IntervalScheduler(playback);
        } else if (playback.mode === 'click') {
            source.setLoop(false);
            source.pause();
            source.restart();
            entry.scheduler = new Shared.playback.ClickTrigger({ hideWhenIdle: !!playback.followClick });
        } else {
            entry.scheduler = null;
            source.setLoop(true);
            if (playback.mode === 'static') {
                source.pause();
                source.restart();
            }
        }
        if (this._shouldPlay(entry)) source.play();
        else if (!entry.scheduler) source.pause();
    }

    _shouldPlay(entry) {
        const { instance, source, scheduler } = entry;
        if (this.paused || !instance.visible || !source.animated) return false;
        if (scheduler) return scheduler.playing;
        return instance.playback && instance.playback.mode === 'loop';
    }

    /** 按深度排序：远的先画 */
    _reorder() {
        const order = Shared.elements.sortForRender([...this.entries.values()].map((e) => e.instance));
        order.forEach((instance, index) => {
            this.entries.get(instance.id).mesh.zIndex = index;
        });
    }

    _destroyEntry(id) {
        const entry = this.entries.get(id);
        if (!entry) return;
        this.container.removeChild(entry.mesh);
        entry.mesh.destroy();
        entry.geometry.destroy();
        entry.source.destroy();
        this.entries.delete(id);
    }
}
