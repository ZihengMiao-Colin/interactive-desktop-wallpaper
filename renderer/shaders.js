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

/**
 * 自定义元素的顶点着色器：元素是一个单位方形 Mesh，按屏幕像素缩放平移。
 * 额外输出屏幕归一化坐标 vScreenUV，片元着色器用它去查背景深度。
 */
const ELEMENT_VERTEX_SHADER = `
precision highp float;

attribute vec2 aVertexPosition;
attribute vec2 aUvs;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
uniform vec2 uScreenSize;

varying vec2 vUvs;
varying vec2 vScreenUV;

void main(void) {
    vec3 world = translationMatrix * vec3(aVertexPosition, 1.0);
    vScreenUV = world.xy / uScreenSize;
    vUvs = aUvs;
    gl_Position = vec4((projectionMatrix * world).xy, 0.0, 1.0);
}
`;

/**
 * 自定义元素的片元着色器：绿幕抠像 + 深度遮挡 + 不透明度。
 *
 * 遮挡：比较元素深度和"这个像素上实际显示的背景内容"的深度。
 * 背景在屏幕点 p 显示的是图片 baseUV + parallax 处的颜色，所以要在同一位置取深度，
 * 否则鼠标移动时前景物体动了、遮挡边缘却还停在原地。
 */
const ELEMENT_FRAGMENT_SHADER = `
precision highp float;

varying vec2 vUvs;
varying vec2 vScreenUV;

uniform sampler2D uSampler;
uniform sampler2D uDepth;
uniform vec2 uCoverScale;
uniform vec2 uCoverOffset;
uniform vec2 uMouse;
uniform float uStrength;
uniform float uFocus;
uniform float uElemDepth;
uniform float uOpacity;
uniform float uChromaEnabled;
uniform float uChromaStrength;
${PARALLAX_GLSL}
void main(void) {
    // 深度遮挡：场景比元素近的地方把元素挡住，边缘柔和过渡；+0.02 避免贴地时底边自己挡自己
    vec2 baseUV = vScreenUV * uCoverScale + uCoverOffset;
    float d0 = texture2D(uDepth, baseUV).r;
    vec2 shownUV = clamp(baseUV + parallaxUV(uMouse, d0, uFocus, uStrength), vec2(0.001), vec2(0.999));
    float sceneDepth = texture2D(uDepth, shownUV).r;
    float vis = smoothstep(-0.03, 0.03, (uElemDepth + 0.02) - sceneDepth);

    vec4 c = texture2D(uSampler, vUvs);
    float k = 1.0;
    if (uChromaEnabled > 0.5) {
        // 绿幕：绿色分量超出红蓝越多越透明；强度越大，阈值越低、抠得越狠
        float lo = mix(0.20, 0.02, uChromaStrength);
        float g = c.g - max(c.r, c.b);
        k = 1.0 - smoothstep(lo, lo + 0.10, g);
        c.g = min(c.g, max(c.r, c.b));   // 去溢色：消除边缘反射的绿光
    }
    gl_FragColor = c * (k * vis * uOpacity);   // 预乘 alpha 输出
}
`;
