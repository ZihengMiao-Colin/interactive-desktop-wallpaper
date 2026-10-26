/**
 * elements-layer.js — 自定义元素渲染层
 *
 * 每个实例是一个单位方形 PIXI.Mesh，挂元素着色器（视差位移、深度遮挡、绿幕抠像）。
 * 位置每帧按 transform + 视差位移重新计算；素材按实例 id 复用，素材文件变了才重新加载。
 */

'use strict';

class ElementsLayer {
    /** @param {typeof Scene} scene */
    constructor(scene) {
        this.scene = scene;
        this.container = new PIXI.Container();
        this.container.sortableChildren = true;
        scene.addLayer(this.container);

        /** 单位方形，所有实例共用 */
        this.geometry = new PIXI.Geometry()
            .addAttribute('aVertexPosition', [0, 0, 1, 0, 1, 1, 0, 1], 2)
            .addAttribute('aUvs', [0, 0, 1, 0, 1, 1, 0, 1], 2)
            .addIndex([0, 1, 2, 0, 2, 3]);

        /** @type {Map<string, {instance, asset, source, mesh, scheduler, aspect, playbackKey}>} */
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
        const { rectFromTransform } = Shared.placement;
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
                }
            }
            if (scheduler) show = show && scheduler.playing;
            mesh.visible = show;
            if (!show) continue;

            source.update(nowMs);

            const rect = rectFromTransform(instance.transform, entry.aspect, screenW, screenH);
            const [dx, dy] = elementScreenShift(mouseX, mouseY, instance.depth, focus, strength, cover);
            mesh.position.set(rect.left + dx * screenW, rect.top + dy * screenH);
            mesh.scale.set(rect.width, rect.height);

            const u = mesh.shader.uniforms;
            u.uDepth = depthTexture;
            u.uScreenSize = [screenW, screenH];
            u.uCoverScale = [cover.scaleX, cover.scaleY];
            u.uCoverOffset = [cover.offsetX, cover.offsetY];
            u.uMouse = [mouseX, mouseY];
            u.uStrength = strength;
            u.uFocus = focus;
            u.uElemDepth = instance.depth;
            u.uOpacity = instance.opacity;
            u.uChromaEnabled = instance.chroma && instance.chroma.enabled ? 1 : 0;
            u.uChromaStrength = instance.chroma ? instance.chroma.strength : 0.5;
        }
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
        const mesh = new PIXI.Mesh(this.geometry, shader);
        mesh.visible = false;   // 第一次 update 时再决定是否显示
        this.container.addChild(mesh);
        const entry = {
            instance,
            asset,
            source,
            mesh,
            scheduler: null,
            aspect: source.width / source.height || asset.aspect || 1,
            playbackKey: null,
        };
        this.entries.set(instance.id, entry);
        this._configure(entry);
    }

    /** 按实例的播放设置配置素材源；播放设置没变时不重置调度器 */
    _configure(entry) {
        const { instance, source } = entry;
        const playback = instance.playback || { mode: 'static' };
        const key = JSON.stringify([playback, instance.visible]);
        if (key === entry.playbackKey) return;
        entry.playbackKey = key;

        if (!source.animated) {
            entry.scheduler = null;
            return;
        }
        if (playback.mode === 'interval') {
            source.setLoop(false);
            source.pause();
            entry.scheduler = new Shared.playback.IntervalScheduler(playback);
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
        entry.source.destroy();
        this.entries.delete(id);
    }
}
