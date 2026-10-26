/**
 * vinyl.js — 黑胶唱片机组件与本地音乐播放
 */

'use strict';

class VinylPlayerManager {
    constructor() {
        this.widget = document.getElementById('vinyl-widget');
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
    }

    setConfig(config) {
        this.config = config;
        if (!this.widget || !this.audio) return;

        if (!config || !config.enabled) {
            this.widget.style.display = 'none';
            if (!this.audio.paused) {
                this.audio.pause();
            }
            return;
        }

        this.widget.style.display = 'flex';

        // 停靠方位
        const posClass = `pos-${config.position || 'bottom-right'}`;
        this.widget.className = `vinyl-widget ${posClass}`;

        // 音频加载
        if (config.audioPath && this.currentAudioPath !== config.audioPath) {
            this.currentAudioPath = config.audioPath;
            this.loadAudioFile(config.audioPath);
        } else if (!config.audioPath && this.currentAudioPath) {
            this.currentAudioPath = '';
            this.audio.pause();
            this.audio.src = '';
            if (this.songNameEl) this.songNameEl.textContent = '未选择音乐';
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

        // 音量
        const vol = config.volume !== undefined ? Math.max(0, Math.min(1, config.volume)) : 0.6;
        this.audio.volume = vol;
        this.audio.loop = config.loop !== false;

        // 播放状态控制
        if (config.playing && config.audioPath) {
            if (this.audio.paused) {
                this.audio.play().catch(err => {
                    console.warn('[Vinyl] 播放音频未启动:', err);
                });
            }
            if (this.record) {
                this.record.classList.add('spinning');
                this.record.classList.remove('paused');
            }
            if (this.tonearm) this.tonearm.classList.add('playing');
            if (this.soundWaves) this.soundWaves.classList.add('active');
            if (this.statusEl) this.statusEl.textContent = '正在播放';
        } else {
            if (!this.audio.paused) {
                this.audio.pause();
            }
            if (this.record) {
                this.record.classList.add('paused');
            }
            if (this.tonearm) this.tonearm.classList.remove('playing');
            if (this.soundWaves) this.soundWaves.classList.remove('active');
            if (this.statusEl) this.statusEl.textContent = config.audioPath ? '已暂停' : '请导入音乐';
        }
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
