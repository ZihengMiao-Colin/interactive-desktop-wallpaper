/**
 * element-shader.js — 创建自定义元素用的 Pixi Shader
 */

'use strict';

/**
 * @param {PIXI.Texture} texture - 元素素材纹理
 * @param {PIXI.Texture} depthTexture - 背景深度图纹理
 * @returns {PIXI.Shader}
 */
function createElementShader(texture, depthTexture) {
    return PIXI.Shader.from(ELEMENT_VERTEX_SHADER, ELEMENT_FRAGMENT_SHADER, {
        uSampler: texture,
        uDepth: depthTexture,
        uDepthSize: new Float32Array([1, 1]),
        uScreenSize: new Float32Array([1, 1]),
        uCoverScale: new Float32Array([1, 1]),
        uCoverOffset: new Float32Array([0, 0]),
        uMouse: new Float32Array([0, 0]),
        uStrength: 0,
        uFocus: 0.5,
        uElemDepth: 0.5,
        uOpacity: 1,
        uChromaEnabled: 0,
        uChromaStrength: 0.5,
        uFlip: new Float32Array([0, 0]),
        uHue: 0,
        uSaturation: 1,
        uBrightness: 1,
        uTint: new Float32Array([1, 1, 1]),
        uTintAmount: 0,
    });
}
