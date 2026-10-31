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
 * 视差位移公式和光线步进（GLSL 版），背景、自定义元素和设置页预览的着色器共用。
 * 与 shared/parallax-math.js 的 parallaxUV / rayMarchUV 是同一算法，改一边必须同步另一边。
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

// 光线步进参数，和 shared/parallax-math.js 的 RAY_* 一致
#define RAY_STEP_PX 2.5
#define RAY_MAX_STEPS 48
#define RAY_REFINE_STEPS 5

// 屏幕上这一点实际显示的是图片的哪个位置（图片 UV）。算法见 shared/parallax-math.js 的 rayMarchUV：
// 从最近一层往最远一层试，第一个碰到的表面就是挡在最前面的，前景挪动时能盖住背景、不会被拉扯变形。
// depthSize 是深度图的像素尺寸，用来决定走几步。
vec2 rayMarchUV(sampler2D depthMap, vec2 depthSize, vec2 baseUV, vec2 mouse, float focus, float strength) {
    vec2 spanPx = (parallaxUV(mouse, 1.0, focus, strength) - parallaxUV(mouse, 0.0, focus, strength)) * depthSize;
    float n = clamp(ceil(length(spanPx) / RAY_STEP_PX), 1.0, float(RAY_MAX_STEPS));
    float lo = 1.0;
    float hi = 0.0;
    for (int i = 0; i <= RAY_MAX_STEPS; i++) {
        // i 走到 n 时 t = 0，深度一定 >= 0，循环在这里结束
        float t = max(1.0 - float(i) / n, 0.0);
        if (texture2D(depthMap, baseUV + parallaxUV(mouse, t, focus, strength)).r >= t) {
            hi = t;
            break;
        }
        lo = t;
    }
    for (int k = 0; k < RAY_REFINE_STEPS; k++) {
        float mid = 0.5 * (lo + hi);
        if (texture2D(depthMap, baseUV + parallaxUV(mouse, mid, focus, strength)).r >= mid) hi = mid;
        else lo = mid;
    }
    return baseUV + parallaxUV(mouse, hi, focus, strength);
}
`;

/**
 * 背景片元着色器：屏幕 UV 先按 Cover 映射到图片 UV，再用光线步进找出这里显示的图片位置。
 */
const PARALLAX_FRAGMENT_SHADER = `
precision highp float;

varying vec2 vTextureCoord;

uniform sampler2D uImage;
uniform sampler2D uDepth;
uniform vec2 uDepthSize;
uniform vec2 uMouse;
uniform float uStrength;
uniform float uFocus;
uniform vec2 uCoverScale;
uniform vec2 uCoverOffset;
${PARALLAX_GLSL}
void main(void) {
    vec2 baseUV = vTextureCoord * uCoverScale + uCoverOffset;
    vec2 shownUV = clamp(rayMarchUV(uDepth, uDepthSize, baseUV, uMouse, uFocus, uStrength), vec2(0.001), vec2(0.999));
    gl_FragColor = texture2D(uImage, shownUV);
}
`;

/**
 * 自定义元素的顶点着色器：元素是框坐标里的一个四边形 Mesh，按屏幕像素缩放、旋转、平移。
 * aUvs 是齐次贴图坐标 (u·q, v·q, q)，自由变形时贴图按透视铺开（见 placement-math 的 projectiveWeights）。
 * 额外输出屏幕归一化坐标 vScreenUV，片元着色器用它去查背景深度。
 */
const ELEMENT_VERTEX_SHADER = `
precision highp float;

attribute vec2 aVertexPosition;
attribute vec3 aUvs;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
uniform vec2 uScreenSize;

varying vec3 vUvs;
varying vec2 vScreenUV;

void main(void) {
    vec3 world = translationMatrix * vec3(aVertexPosition, 1.0);
    vScreenUV = world.xy / uScreenSize;
    vUvs = aUvs;
    gl_Position = vec4((projectionMatrix * world).xy, 0.0, 1.0);
}
`;

/**
 * 自定义元素的片元着色器：透视贴图 + 翻转 + 绿幕抠像 + 变色 + 深度遮挡 + 不透明度。
 *
 * 遮挡：比较元素深度和"这个像素上实际显示的背景内容"的深度。
 * 背景在屏幕点 p 显示的是光线步进找到的那个图片位置，所以要在同一位置取深度，
 * 否则鼠标移动时前景物体动了、遮挡边缘却还停在原地。
 */
const ELEMENT_FRAGMENT_SHADER = `
precision highp float;

varying vec3 vUvs;
varying vec2 vScreenUV;

uniform sampler2D uSampler;
uniform sampler2D uDepth;
uniform vec2 uDepthSize;
uniform vec2 uCoverScale;
uniform vec2 uCoverOffset;
uniform vec2 uMouse;
uniform float uStrength;
uniform float uFocus;
uniform float uElemDepth;
uniform float uOpacity;
uniform float uChromaEnabled;
uniform float uChromaStrength;
uniform vec2 uFlip;
uniform float uHue;
uniform float uSaturation;
uniform float uBrightness;
uniform vec3 uTint;
uniform float uTintAmount;
${PARALLAX_GLSL}
vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}

vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

// 变色：色相偏移 → 饱和度 → 染色（按亮度乘上染色颜色）→ 亮度
vec3 adjustColor(vec3 rgb) {
    vec3 hsv = rgb2hsv(rgb);
    rgb = hsv2rgb(vec3(fract(hsv.x + uHue), hsv.yz));
    float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
    rgb = mix(vec3(lum), rgb, uSaturation);
    rgb = mix(rgb, lum * uTint, uTintAmount);
    return clamp(rgb * uBrightness, 0.0, 1.0);
}

void main(void) {
    // 深度遮挡：场景比元素近的地方把元素挡住，边缘柔和过渡；+0.02 避免贴地时底边自己挡自己
    vec2 baseUV = vScreenUV * uCoverScale + uCoverOffset;
    vec2 shownUV = clamp(rayMarchUV(uDepth, uDepthSize, baseUV, uMouse, uFocus, uStrength), vec2(0.001), vec2(0.999));
    float sceneDepth = texture2D(uDepth, shownUV).r;
    float vis = smoothstep(-0.03, 0.03, (uElemDepth + 0.02) - sceneDepth);

    vec2 uv = vUvs.xy / vUvs.z;
    uv = mix(uv, 1.0 - uv, uFlip);
    vec4 c = texture2D(uSampler, uv);
    float k = 1.0;
    if (uChromaEnabled > 0.5) {
        // 绿幕：绿色分量超出红蓝越多越透明；强度越大，阈值越低、抠得越狠
        float lo = mix(0.20, 0.02, uChromaStrength);
        float g = c.g - max(c.r, c.b);
        k = 1.0 - smoothstep(lo, lo + 0.10, g);
        c.g = min(c.g, max(c.r, c.b));   // 去溢色：消除边缘反射的绿光
    }
    // 变色放在抠像之后（抠像要看原本的绿色）；c 是预乘 alpha，先还原再调色
    if (c.a > 0.0) c.rgb = adjustColor(c.rgb / c.a) * c.a;
    gl_FragColor = c * (k * vis * uOpacity);   // 预乘 alpha 输出
}
`;
