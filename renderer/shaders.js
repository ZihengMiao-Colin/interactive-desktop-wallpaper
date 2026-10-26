/**
 * shaders.js — 背景 2.5D 深度视差着色器源码
 */

'use strict';

/**
 * 自定义顶点着色器
 * 核心关键：直接将 aVertexPosition (归一化 0.0 ~ 1.0 的全屏 Quad 坐标) 传给片元着色器。
 * Pixi.js 默认 Filter 顶点着色器会乘以 outputFrame.zw * inputSize.zw，导致由于
 * 内部分配的 Framebuffer 尺寸比例与屏幕不一致而严重横向拉长图片！
 */
const PARALLAX_VERTEX_SHADER = `
attribute vec2 aVertexPosition;
uniform mat3 projectionMatrix;
uniform vec4 outputFrame;

varying vec2 vTextureCoord;

vec4 filterVertexPosition(void) {
    vec2 position = aVertexPosition * max(outputFrame.zw, vec2(0.0)) + outputFrame.xy;
    return vec4((projectionMatrix * vec3(position, 1.0)).xy, 0.0, 1.0);
}

void main(void) {
    gl_Position = filterVertexPosition();
    // 强制传递 0.0 ~ 1.0 的绝对归一化屏幕坐标
    vTextureCoord = aVertexPosition;
}
`;

/**
 * 视差位移公式（GLSL 版），背景和自定义元素的着色器共用。
 * 与 shared/parallax-math.js 的 parallaxUV 是同一公式，改一边必须同步另一边。
 *
 * - 对焦平面：depth == focus 时位移为 0，主体不撕裂
 * - 软截断：位移超过 maxDist 后只按 20% 继续增长，避免大幅移动拉出缝隙
 */
const PARALLAX_GLSL = `
vec2 parallaxUV(vec2 mouse, float depth, float focus, float strength) {
    vec2 p = mouse * (depth - focus) * strength;
    float maxDist = max(0.035, strength * 1.6);
    float len = length(p);
    if (len > maxDist) {
        p = (p / len) * (maxDist + (len - maxDist) * 0.2);
    }
    return p;
}
`;

/**
 * 背景片元着色器：屏幕 UV 先按 Cover 映射到图片 UV，
 * 再按该处深度偏移采样坐标。
 */
const PARALLAX_FRAGMENT_SHADER = `
precision highp float;

varying vec2 vTextureCoord;

uniform sampler2D uImage;
uniform sampler2D uDepth;
uniform vec2 uMouse;
uniform float uStrength;
uniform float uFocus;
uniform vec2 uCoverScale;
uniform vec2 uCoverOffset;
${PARALLAX_GLSL}
void main(void) {
    vec2 baseUV = vTextureCoord * uCoverScale + uCoverOffset;
    float depth = texture2D(uDepth, baseUV).r;
    vec2 finalUV = clamp(baseUV + parallaxUV(uMouse, depth, uFocus, uStrength), vec2(0.001), vec2(0.999));
    gl_FragColor = texture2D(uImage, finalUV);
}
`;
