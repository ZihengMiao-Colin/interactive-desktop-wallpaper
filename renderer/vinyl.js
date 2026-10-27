/**
 * vinyl.js — 黑胶唱片机组件与本地音乐播放
 *
 * 播放：抬起唱臂 → 摆到唱片上 → 放下唱针 → 唱片加速到 33⅓ 转、音乐淡入。
 * 暂停：音乐淡出，唱片靠惯性慢慢停下，唱臂留在唱片上；再播放时从原地接着转。
 * 播放中唱臂随进度从最外圈慢慢移向最内圈；循环回到开头时抬臂回到外圈重新放下；
 * 不循环时播完自动抬臂回到停靠位。
 *
 * 唱片旋转用 Web Animations（在合成器线程上跑，不需要壁纸每帧重绘），
 * 唱臂用 CSS transition（中途被打断时会从当前位置接着转）。
 */

'use strict';

/** 唱臂角度（度，顺时针为正）：停靠位、唱片最外圈、最内圈（再往里就碰到中间的标签） */
const ARM_REST = -32;
const ARM_START = 4;
const ARM_END = 26;
/** 唱臂从停靠位摆到唱片上的时间；抬起 / 放下唱针的时间 */
const ARM_SWING_MS = 1100;
const ARM_LIFT_MS = 260;
/** 继续播放时唱臂离进度位置差这么多以内就不抬臂，播放后自己跟上（换歌才会差得多） */
const ARM_RESEAT_DEG = 3;
/** 33⅓ 转 / 分，换算成度 / 毫秒 */
const RECORD_SPEED = (360 * 100) / 3 / 60000;
/** 唱片从静止加速到全速（或从全速停下）的时间 */
const SPIN_RAMP_MS = 1300;
/** 音乐淡入淡出的时间 */
const FADE_MS = 300;
/** 桌面上连着点唱片机，间隔小于这个值的后一下忽略（双击不会播了又停） */
const CLICK_DEBOUNCE_MS = 450;

class VinylPlayerManager {
    constructor() {
        this.widget = document.getElementById('vinyl-widget');
        this.deck = this.widget && this.widget.querySelector('.vinyl-deck');
        this.platter = this.widget && this.widget.querySelector('.vinyl-platter');
        this.infoCard = document.getElementById('vinyl-info-card');
        this.record = document.getElementById('vinyl-record');
        this.tonearm = document.getElementById('vinyl-tonearm');
        this.coverImg = document.getElementById('vinyl-cover-img');
        this.defaultCover = document.getElementById('vinyl-default-cover');
        this.soundWaves = document.getElementById('vinyl-sound-waves');
        this.songNameEl = document.getElementById('vinyl-song-name');
        this.statusEl = document.getElementById('vinyl-play-status');
        this.audio = document.getElementById('bg-audio');

        this.config = null;
        this.currentAudioPath = '';
        this.currentCoverPath = '';
        this.audioBlobUrl = null;

        /** 配置要求的播放状态（开着 playing 且有音乐） */
        this.wantPlaying = false;
        /** 动作序号：新的播放 / 暂停会让还没走完的旧动作作废 */
        this.seq = 0;
        /** 唱臂最后设定的角度；唱针是否已经落在唱片上；唱臂是否跟着进度走 */
        this.armAngle = ARM_REST;
        this.onRecord = false;
        this.tracking = false;
        this.lastProgress = 0;
        /** 唱片当前这段加减速：角速度从 v0 线性变到 v1（度 / 毫秒） */
        this.spin = { v0: 0, v1: 0, start: 0, duration: 0 };
        this.recordAnim = null;
        /** 配置里的音量；淡入淡出用的计时器 */
        this.volume = 0.6;
        this.fadeTimer = null;
        /** 上一次在桌面上点中唱片机的时间 */
        this.lastClickAt = -Infinity;

        if (this.audio) {
            this.audio.addEventListener('timeupdate', () => this.followProgress());
            this.audio.addEventListener('ended', () => this.onEnded());
            this.audio.addEventListener('playing', () => this.showStatus());
            this.audio.addEventListener('pause', () => this.showStatus());
        }
        this.setArm(ARM_REST, 0);
    }

    setConfig(config) {
        this.config = config;
        if (!this.widget || !this.audio) return;

        if (!config || !config.enabled) {
            this.widget.style.display = 'none';
            this.wantPlaying = false;
            this.reset();
            return;
        }

        this.widget.style.display = 'flex';

        // 停靠方位
        const posClass = `pos-${config.position || 'bottom-right'}`;
        this.widget.className = `vinyl-widget ${posClass}`;

        // 音频加载
        let songChanged = false;
        if (config.audioPath && this.currentAudioPath !== config.audioPath) {
            this.currentAudioPath = config.audioPath;
            this.loadAudioFile(config.audioPath);
            songChanged = true;
        } else if (!config.audioPath && this.currentAudioPath) {
            this.currentAudioPath = '';
            this.audio.pause();
            this.audio.src = '';
        }

        // 歌曲名称显示
        if (this.songNameEl) {
            if (config.audioName) {
                this.songNameEl.textContent = config.audioName;
            } else if (config.audioPath) {
                const name = config.audioPath.split('\\').pop().split('/').pop().replace(/\.[^/.]+$/, '');
                this.songNameEl.textContent = name;
            } else {
                this.songNameEl.textContent = '未选择音乐';
            }
        }

        // 唱片中心封面图片
        if (config.coverPath && this.currentCoverPath !== config.coverPath) {
            this.currentCoverPath = config.coverPath;
            if (isElectron && window.electronAPI) {
                const dataUrl = window.electronAPI.readFileAsDataURL(config.coverPath);
                if (dataUrl && this.coverImg) {
                    this.coverImg.src = dataUrl;
                    this.coverImg.style.display = 'block';
                    if (this.defaultCover) this.defaultCover.style.display = 'none';
                }
            }
        } else if (!config.coverPath) {
            this.currentCoverPath = '';
            if (this.coverImg) this.coverImg.style.display = 'none';
            if (this.defaultCover) this.defaultCover.style.display = 'flex';
        }

        // 音量（淡入淡出进行中就让它淡到新音量）
        this.volume = config.volume !== undefined ? Math.max(0, Math.min(1, config.volume)) : 0.6;
        if (!this.fadeTimer) this.audio.volume = this.volume;
        this.audio.loop = config.loop !== false;

        // 播放状态：只有真的变了（或者换了歌）才走一遍唱臂动作
        const want = !!(config.playing && config.audioPath);
        if (want !== this.wantPlaying || (want && songChanged)) {
            this.wantPlaying = want;
            if (want) this.play();
            else if (config.audioPath) this.pause();
            else this.returnToRest();
        }
        this.showStatus();
    }

    // ==================== 播放流程 ====================

    /** 等 ms 毫秒；期间有新动作就返回 false，调用方就此打住 */
    async after(ms, seq) {
        await new Promise((resolve) => setTimeout(resolve, ms));
        return seq === this.seq;
    }

    /** 抬臂 → 摆到当前进度对应的位置 → 放下唱针 → 唱片加速、音乐淡入；唱针已经在唱片上就直接转 */
    async play() {
        const seq = ++this.seq;
        this.tracking = false;
        if (this.audio.ended) this.audio.currentTime = 0;
        const target = this.progressAngle();
        if (!this.onRecord || Math.abs(target - this.armAngle) > ARM_RESEAT_DEG) {
            if (!await this.raise(seq)) return;
            const ms = this.onRecord ? ARM_SWING_MS * 0.6 : ARM_SWING_MS;
            this.setArm(target, ms);
            if (!await this.after(ms, seq)) return;
            this.onRecord = true;
        }
        if (this.isLifted()) {
            this.lift(false);
            if (!await this.after(ARM_LIFT_MS, seq)) return;
        }

        this.spinTo(RECORD_SPEED);
        this.startAudio();
        this.lastProgress = this.progress();
        this.tracking = true;
    }

    /** 音乐淡出，唱片靠惯性停下；唱针已经在唱片上就留在原处，还在半路就回停靠位 */
    pause() {
        const seq = ++this.seq;
        this.tracking = false;
        this.stopAudio();
        this.spinTo(0);
        if (this.onRecord) this.lift(false);
        else this.toRest(seq);
    }

    /** 播完或音乐被移除：唱片停下，唱臂抬起回到停靠位 */
    returnToRest() {
        const seq = ++this.seq;
        this.tracking = false;
        this.stopAudio();
        this.spinTo(0);
        this.toRest(seq);
    }

    async toRest(seq) {
        this.onRecord = false;
        if (Math.abs(this.armAngle - ARM_REST) < 0.5) {
            this.lift(false);
            return;
        }
        if (!await this.raise(seq)) return;
        const ms = ARM_SWING_MS * 0.8;
        this.setArm(ARM_REST, ms);
        if (!await this.after(ms, seq)) return;
        this.lift(false);
    }

    /** 隐藏唱片机：立刻停下，唱臂直接回到停靠位（看不见，不用播动画） */
    reset() {
        this.seq++;
        this.tracking = false;
        this.onRecord = false;
        clearInterval(this.fadeTimer);
        this.fadeTimer = null;
        if (this.audio) this.audio.pause();
        if (this.record) this.cancelSpin(this.recordAngle());
        this.spin = { v0: 0, v1: 0, start: 0, duration: 0 };
        this.lift(false);
        this.setArm(ARM_REST, 0);
    }

    // ==================== 桌面点击 ====================

    /** 桌面上的点击（屏幕像素）是否落在唱片或歌名胶囊上；没导入音乐时不响应 */
    hitTest(x, y) {
        if (!this.platter || !Shared.vinylPlayer.isClickable(this.config)) return false;
        const p = this.platter.getBoundingClientRect();
        const disc = { cx: p.left + p.width / 2, cy: p.top + p.height / 2, r: p.width / 2 };
        const card = this.infoCard ? this.infoCard.getBoundingClientRect() : null;
        return Shared.vinylPlayer.hitTest(x, y, disc, card);
    }

    /**
     * 桌面上点中了唱片机：唱盘轻轻按下一下，然后切换播放 / 暂停。
     * 播完了（不循环）就从头再放。
     * @returns {boolean | null} 要保存到配置里的 playing；不需要保存（比如双击的第二下）时返回 null
     */
    clickToggle(now = performance.now()) {
        if (now - this.lastClickAt < CLICK_DEBOUNCE_MS) return null;
        this.lastClickAt = now;
        if (this.deck) {
            this.deck.animate(
                [{ transform: 'scale(1)' }, { transform: 'scale(0.95)' }, { transform: 'scale(1)' }],
                { duration: 220, easing: 'ease-out' });
        }
        if (this.wantPlaying && this.audio.ended) {
            this.play();
            return null;
        }
        return !this.wantPlaying;
    }

    /** 不循环时播完：唱臂自动回到停靠位 */
    onEnded() {
        if (this.audio.loop) return;
        this.returnToRest();
        this.showStatus();
    }

    // ==================== 唱臂 ====================

    progress() {
        return Shared.vinylPlayer.progressOf(this.audio.currentTime, this.audio.duration);
    }

    progressAngle() {
        return Shared.vinylPlayer.armAngle(this.progress(), ARM_START, ARM_END);
    }

    /** 播放中唱臂随进度往里走；循环回到开头时抬臂回到外圈重新放下 */
    followProgress() {
        if (!this.tracking) return;
        const p = this.progress();
        const wrapped = p < this.lastProgress - 0.2;
        this.lastProgress = p;
        if (wrapped) this.recue();
        else this.setArm(this.progressAngle(), 1000, 'linear');
    }

    async recue() {
        const seq = ++this.seq;
        this.tracking = false;
        if (!await this.raise(seq)) return;
        const ms = ARM_SWING_MS * 0.6;
        this.setArm(this.progressAngle(), ms);
        if (!await this.after(ms, seq)) return;
        this.lift(false);
        if (!await this.after(ARM_LIFT_MS, seq)) return;
        this.lastProgress = this.progress();
        this.tracking = true;
    }

    /** 唱臂转到 angle 度；ms 为 0 时直接到位 */
    setArm(angle, ms, easing = 'ease-in-out') {
        this.armAngle = angle;
        if (!this.tonearm) return;
        this.tonearm.style.transition = ms ? `transform ${ms}ms ${easing}` : 'none';
        this.tonearm.style.transform = `rotate(${angle}deg)`;
    }

    /** 抬起 / 放下唱针（唱头阴影变化） */
    lift(up) {
        if (this.tonearm) this.tonearm.classList.toggle('lifted', up);
    }

    isLifted() {
        return !!this.tonearm && this.tonearm.classList.contains('lifted');
    }

    /** 抬起唱针并等它抬好；本来就是抬着的（比如摆到一半被打断）就不用等，直接掉头 */
    async raise(seq) {
        if (this.isLifted()) return seq === this.seq;
        this.lift(true);
        return this.after(ARM_LIFT_MS, seq);
    }

    // ==================== 唱片旋转 ====================

    /** 唱片现在转到的角度（读动画后的实际值） */
    recordAngle() {
        const t = getComputedStyle(this.record).transform;
        if (!t || t === 'none') return 0;
        const m = new DOMMatrixReadOnly(t);
        return (Math.atan2(m.b, m.a) * 180) / Math.PI;
    }

    /** 角速度匀变速到 v（度 / 毫秒），从当前速度接着变，中途改主意也不会顿一下 */
    spinTo(v) {
        if (!this.record || this.spin.v1 === v) return;
        const now = performance.now();
        const v0 = Shared.vinylPlayer.velocityAt(this.spin, now);
        const from = this.recordAngle();
        this.cancelSpin(from);
        const ramp = Shared.vinylPlayer.spinRamp(v0, v, { rampMs: SPIN_RAMP_MS, fullSpeed: RECORD_SPEED });
        this.spin = { v0, v1: v, start: now, duration: ramp.duration };
        if (ramp.duration < 16) {
            if (v > 0) this.spinSteady(from);
            return;
        }
        const anim = this.record.animate(
            [{ transform: `rotate(${from}deg)` }, { transform: `rotate(${from + ramp.delta}deg)` }],
            { duration: ramp.duration, easing: `cubic-bezier(${ramp.easing.join(', ')})`, fill: 'forwards' });
        this.recordAnim = anim;
        anim.onfinish = () => {
            if (this.recordAnim !== anim) return;
            const end = from + ramp.delta;
            this.cancelSpin(end);
            if (v > 0) this.spinSteady(end);
        };
    }

    /** 全速匀速转 */
    spinSteady(from) {
        this.recordAnim = this.record.animate(
            [{ transform: `rotate(${from}deg)` }, { transform: `rotate(${from + 360}deg)` }],
            { duration: 360 / RECORD_SPEED, iterations: Infinity });
    }

    /** 停掉旋转动画，唱片停在 angle 度 */
    cancelSpin(angle) {
        this.record.style.transform = `rotate(${angle % 360}deg)`;
        if (this.recordAnim) {
            this.recordAnim.cancel();
            this.recordAnim = null;
        }
    }

    // ==================== 音乐 ====================

    startAudio() {
        this.audio.volume = 0;
        this.fadeVolume(null);
        this.audio.play().catch((err) => {
            console.warn('[Vinyl] 播放音频未启动:', err);
        });
    }

    stopAudio() {
        if (this.audio.paused) {
            clearInterval(this.fadeTimer);
            this.fadeTimer = null;
            return;
        }
        this.fadeVolume(0, () => this.audio.pause());
    }

    /**
     * 音量线性变到 to（null 表示配置里的音量，淡入时拖音量滑块也能跟上）。
     * 用定时器而不是 requestAnimationFrame：壁纸停帧、窗口被挡住时它不一定跑。
     */
    fadeVolume(to, done) {
        clearInterval(this.fadeTimer);
        const from = this.audio.volume;
        const start = performance.now();
        this.fadeTimer = setInterval(() => {
            const t = Math.min(1, (performance.now() - start) / FADE_MS);
            const target = to === null ? this.volume : to;
            this.audio.volume = from + (target - from) * t;
            if (t < 1) return;
            clearInterval(this.fadeTimer);
            this.fadeTimer = null;
            if (done) done();
        }, 20);
    }

    /** 信息胶囊：状态文字和跳动的波形条，按音乐实际有没有在响来显示 */
    showStatus() {
        const sounding = !this.audio.paused && !this.audio.ended;
        if (this.soundWaves) this.soundWaves.classList.toggle('active', sounding);
        if (!this.statusEl) return;
        if (!this.config || !this.config.audioPath) this.statusEl.textContent = '请导入音乐';
        else if (sounding) this.statusEl.textContent = '正在播放';
        else if (this.audio.ended) this.statusEl.textContent = '播放完毕';
        else this.statusEl.textContent = this.wantPlaying ? '放下唱针…' : '已暂停';
    }

    loadAudioFile(filePath) {
        if (!isElectron || !window.electronAPI) {
            this.audio.src = filePath;
            return;
        }

        try {
            // 优先使用高效 Uint8Array -> Blob -> createObjectURL
            if (window.electronAPI.readFileBuffer) {
                const buffer = window.electronAPI.readFileBuffer(filePath);
                if (buffer) {
                    if (this.audioBlobUrl) {
                        URL.revokeObjectURL(this.audioBlobUrl);
                    }
                    const ext = filePath.split('.').pop().toLowerCase();
                    const mimeMap = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4' };
                    const blob = new Blob([buffer], { type: mimeMap[ext] || 'audio/mpeg' });
                    this.audioBlobUrl = URL.createObjectURL(blob);
                    this.audio.src = this.audioBlobUrl;
                    console.log('[Vinyl] 音频加载成功 (Blob URL)');
                    return;
                }
            }

            // 回退到 Data URL
            const dataUrl = window.electronAPI.readFileAsDataURL(filePath);
            if (dataUrl) {
                this.audio.src = dataUrl;
                console.log('[Vinyl] 音频加载成功 (Data URL)');
            }
        } catch (err) {
            console.error('[Vinyl] 音频加载失败:', err);
        }
    }

    update(mouseX, mouseY) {
        if (!this.widget || !this.config || !this.config.enabled) return;
        const scale = this.config.scale !== undefined ? this.config.scale : 1.0;
        // 微小视差浮动
        const pX = -mouseX * 10;
        const pY = -mouseY * 10;
        this.widget.style.transform = `translate3d(${pX}px, ${pY}px, 0) scale(${scale})`;
    }
}
