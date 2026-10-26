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
 * 专属 2.5D 深度视差着色器源码
 *
 * 核心设计：
 * 1. 数学级精确 Cover 坐标映射：彻底杜绝深度图与原图因缩放错位产生的直线刀痕
 * 2. 真实 2D 物理透视位移：X/Y 轴与鼠标方向 100% 严密对应
 * 3. 对焦平面锚定 (uFocus)：主体深度处位移为 0，消灭前后两极相反对拉的剪切割裂
 * 4. 软截断阻尼 (Soft Clamping)：限制最大相对位移，防止大幅度运动拉开大缝隙
 */
const PARALLAX_FRAGMENT_SHADER = `
precision mediump float;

varying vec2 vTextureCoord;

uniform sampler2D uImage;
uniform sampler2D uDepth;
uniform vec2 uMouse;
uniform float uStrength;
uniform float uFocus;
uniform vec2 uCoverScale;
uniform vec2 uCoverOffset;

void main(void) {
    // 1. 将全屏 UV 映射为完美的 Cover 模式下的图片 UV 坐标 (0.0 ~ 1.0)
    vec2 baseUV = vTextureCoord * uCoverScale + uCoverOffset;

    // 2. 采样深度信息 (灰度图取 R 通道)
    float depth = texture2D(uDepth, baseUV).r;

    // 3. 计算相对视觉焦点的位移：当 depth == uFocus 时完全静止，主体绝不撕裂
    float diff = depth - uFocus;

    // 4. 2D 真实物理视差：鼠标向右看(uMouse.x>0)，近景(diff>0)向相反方向移动
    vec2 parallax = uMouse * diff * uStrength;

    // 5. 软截断阻尼 (Soft Clamping)：根据视差强度自适应最大位移，强度调大时位移大幅放开
    float maxDist = max(0.035, uStrength * 1.6);
    float pLen = length(parallax);
    if (pLen > maxDist) {
        parallax = (parallax / pLen) * (maxDist + (pLen - maxDist) * 0.2);
    }

    // 6. 最终采样坐标 + 安全微钳制
    vec2 finalUV = clamp(baseUV + parallax, vec2(0.001), vec2(0.999));

    // 7. 采样并输出真实原图色彩
    gl_FragColor = texture2D(uImage, finalUV);
}
`;
