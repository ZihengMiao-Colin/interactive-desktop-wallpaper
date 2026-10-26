/**
 * video-overlay.js — 全屏视频特效覆盖层（滤色混合 / WebGL 绿幕抠图）
 */

'use strict';

class VideoOverlayManager {
    constructor() {
        this.video = document.getElementById('overlay-video');
        this.canvas = document.getElementById('overlay-chroma-canvas');
        this.gl = null;
        this.program = null;
        this.texture = null;
        this.uResolution = null;
        this.uVideoResolution = null;
        this.uOpacity = null;
        this.animFrameId = null;
        this.isRendering = false;
        this.isPaused = false;

        this.config = {
            enabled: false,
            presetId: 'snow2',
            customPath: '',
            customName: '',
            blendMode: 'auto',
            opacity: 0.85,
            speed: 1.0,
        };

        this.presets = {
            'rain1': { mode: 'screen', path: 'overlay/rain1.mp4' },
            'rain2': { mode: 'screen', path: 'overlay/rain2.mp4' },
            'snow1': { mode: 'screen', path: 'overlay/snow1.mp4' },
            'snow2': { mode: 'chroma', path: 'overlay/snow2.mp4' },
            'snow3': { mode: 'screen', path: 'overlay/snow3.mp4' },
            'old1':  { mode: 'screen', path: 'overlay/old1.mp4' },
            'old2':  { mode: 'screen', path: 'overlay/old2.mp4' },
            'old3':  { mode: 'screen', path: 'overlay/old3.mp4' },
        };

        this._initWebGL();
        window.addEventListener('resize', () => this._onResize());
    }

    _initWebGL() {
        if (!this.canvas) return;
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;

        try {
            this.gl = this.canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false });
        } catch (e) {
            console.warn('[VideoOverlay] WebGL 初始化失败:', e);
            return;
        }

        const gl = this.gl;
        if (!gl) return;

        const vsSource = `
            attribute vec2 a_position;
            varying vec2 v_texCoord;
            void main() {
                v_texCoord = vec2((a_position.x + 1.0) * 0.5, (1.0 - a_position.y) * 0.5);
                gl_Position = vec4(a_position, 0.0, 1.0);
            }
        `;

        const fsSource = `
            precision mediump float;
            uniform sampler2D u_texture;
            uniform float u_opacity;
            uniform vec2 u_resolution;
            uniform vec2 u_videoResolution;
            varying vec2 v_texCoord;

            void main() {
                vec2 uv = v_texCoord;
                float screenRatio = u_resolution.x / u_resolution.y;
                float videoRatio = u_videoResolution.x / u_videoResolution.y;

                if (screenRatio > videoRatio) {
                    uv.y = (uv.y - 0.5) * (videoRatio / screenRatio) + 0.5;
                } else {
                    uv.x = (uv.x - 0.5) * (screenRatio / videoRatio) + 0.5;
                }

                if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
                    discard;
                }

                vec4 color = texture2D(u_texture, uv);

                // 绿幕色度键 (Chroma Key) 计算: greenness = G - max(R, B)
                float maxRB = max(color.r, color.b);
                float greenness = color.g - maxRB;

                // 边缘羽化 (0.04 ~ 0.14)
                float alpha = 1.0 - smoothstep(0.04, 0.14, greenness);

                // 去溢色处理 (Despill): 消除主体边缘被绿幕反射出的绿色
                if (color.g > maxRB) {
                    color.g = maxRB;
                }

                gl_FragColor = vec4(color.rgb, color.a * alpha * u_opacity);
            }
        `;

        function createShader(gl, type, source) {
            const shader = gl.createShader(type);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                console.error('[VideoOverlay] Shader compile error:', gl.getShaderInfoLog(shader));
                gl.deleteShader(shader);
                return null;
            }
            return shader;
        }

        const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
        const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error('[VideoOverlay] Program link error:', gl.getProgramInfoLog(program));
            return;
        }

        this.program = program;
        gl.useProgram(program);

        // 创建屏幕 Quad 顶点缓冲区 (2个三角形构成的矩形)
        const positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        const positions = new Float32Array([
            -1.0, -1.0,
             1.0, -1.0,
            -1.0,  1.0,
            -1.0,  1.0,
             1.0, -1.0,
             1.0,  1.0,
        ]);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

        const aPosition = gl.getAttribLocation(program, 'a_position');
        gl.enableVertexAttribArray(aPosition);
        gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

        // 获取 Uniform 位置
        this.uResolution = gl.getUniformLocation(program, 'u_resolution');
        this.uVideoResolution = gl.getUniformLocation(program, 'u_videoResolution');
        this.uOpacity = gl.getUniformLocation(program, 'u_opacity');

        // 创建视频纹理
        this.texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        // 开启透明度混合
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }

    _onResize() {
        if (this.canvas) {
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
            if (this.gl) {
                this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
            }
        }
    }

    setConfig(newConfig) {
        if (!newConfig) return;
        const prev = { ...this.config };
        this.config = { ...this.config, ...newConfig };

        const srcChanged = (prev.presetId !== this.config.presetId) ||
                           (prev.customPath !== this.config.customPath) ||
                           (prev.enabled !== this.config.enabled);

        const modeChanged = (prev.blendMode !== this.config.blendMode);

        if (!this.config.enabled) {
            this._stop();
            return;
        }

        if (srcChanged || modeChanged) {
            this._applySource();
        } else {
            this._applyPlaybackProps();
        }
    }

    _resolveCurrentVideo() {
        if (this.config.presetId === 'custom' && this.config.customPath) {
            let mode = this.config.blendMode;
            if (mode === 'auto') mode = 'screen';
            return { path: this.config.customPath, mode: mode };
        }
        const preset = this.presets[this.config.presetId] || this.presets['snow2'];
        let mode = this.config.blendMode;
        if (mode === 'auto') mode = preset.mode;
        return { path: preset.path, mode: mode };
    }

    _applySource() {
        if (!this.video) return;

        const info = this._resolveCurrentVideo();
        if (!info || !info.path) {
            this._stop();
            return;
        }

        let videoUrl = info.path;
        if (!videoUrl.startsWith('http') && !videoUrl.startsWith('data:') && !videoUrl.startsWith('file://')) {
            if (/^[a-zA-Z]:[\\\/]/.test(videoUrl)) {
                videoUrl = encodeURI('file:///' + videoUrl.replace(/\\/g, '/'));
            }
        } else if (videoUrl.startsWith('file://')) {
            videoUrl = encodeURI(videoUrl);
        }

        const isChroma = (info.mode === 'chroma');
        const isSameSrc = (this.video.dataset.currentPath === info.path);

        if (!isSameSrc) {
            this.video.src = videoUrl;
            this.video.dataset.currentPath = info.path;
            this.video.load();
        }

        this.video.playbackRate = this.config.speed || 1.0;
        this.video.muted = true;
        this.video.loop = true;

        if (isChroma) {
            // WebGL 绿幕抠图模式：隐藏原生 video，激活 Canvas
            this.video.style.display = 'none';
            if (this.canvas) {
                this.canvas.style.display = 'block';
                this.canvas.style.opacity = (this.config.opacity !== undefined) ? this.config.opacity : 0.85;
            }
            this._startChromaLoop();
        } else {
            // Screen 滤色模式：直接显示原生 video（GPU 硬件解码混合，0额外开销）
            this._stopChromaLoop();
            if (this.canvas) this.canvas.style.display = 'none';
            this.video.style.display = 'block';
            this.video.style.mixBlendMode = 'screen';
            this.video.style.opacity = (this.config.opacity !== undefined) ? this.config.opacity : 0.85;
        }

        if (!this.isPaused) {
            this.video.play().catch(err => console.warn('[VideoOverlay] 自动播放受阻:', err));
        }
    }

    _applyPlaybackProps() {
        if (!this.video) return;
        this.video.playbackRate = this.config.speed || 1.0;

        const opacity = (this.config.opacity !== undefined) ? this.config.opacity : 0.85;
        const info = this._resolveCurrentVideo();
        if (info.mode === 'chroma' && this.canvas) {
            this.canvas.style.opacity = opacity;
        } else {
            this.video.style.opacity = opacity;
        }
    }

    _startChromaLoop() {
        if (this.isRendering) return;
        this.isRendering = true;

        const renderFrame = () => {
            if (!this.isRendering) return;

            if (this.gl && this.program && this.video && this.video.readyState >= 2 && !this.video.paused) {
                const gl = this.gl;
                gl.useProgram(this.program);

                // 更新视频纹理
                gl.bindTexture(gl.TEXTURE_2D, this.texture);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.video);

                // 传递 Uniform 尺寸
                gl.uniform2f(this.uResolution, this.canvas.width, this.canvas.height);
                gl.uniform2f(this.uVideoResolution, this.video.videoWidth || 1920, this.video.videoHeight || 1080);
                gl.uniform1f(this.uOpacity, 1.0);

                gl.clearColor(0, 0, 0, 0);
                gl.clear(gl.COLOR_BUFFER_BIT);

                gl.drawArrays(gl.TRIANGLES, 0, 6);
            }

            this.animFrameId = requestAnimationFrame(renderFrame);
        };

        this.animFrameId = requestAnimationFrame(renderFrame);
    }

    _stopChromaLoop() {
        this.isRendering = false;
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
    }

    _stop() {
        this._stopChromaLoop();
        if (this.video) {
            this.video.pause();
            this.video.style.display = 'none';
            this.video.dataset.currentPath = '';
        }
        if (this.canvas) {
            this.canvas.style.display = 'none';
        }
    }

    pause() {
        this.isPaused = true;
        if (this.video) this.video.pause();
        this._stopChromaLoop();
    }

    resume() {
        this.isPaused = false;
        if (this.config.enabled && this.video) {
            const info = this._resolveCurrentVideo();
            this.video.play().catch(() => {});
            if (info.mode === 'chroma') {
                this._startChromaLoop();
            }
        }
    }
}
