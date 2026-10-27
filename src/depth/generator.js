/**
 * depth/generator.js — 深度图生成（主进程入口）
 *
 * 用 onnxruntime-node 跑 Depth Anything V2 Small，取代原来 spawn venv 里的 Python。
 * 图片由设置窗口的 preload 用 Chromium 解码成 RGBA 传过来（jpg / png / webp / bmp 都支持），
 * 缩放、推理、后处理都在单独的子进程里做（见 inference-process.js）。
 */

const fs = require('fs');
const path = require('path');

const MODEL_PATTERN = /^depth_anything_v2_small.*\.onnx$/i;

/**
 * 找目录里的 small 模型；有多个时取最大的（通常是 FP32），和 generate_depth_map.py 的规则一样。
 * @param {string} dir
 * @returns {string|null}
 */
function findDepthModel(dir) {
    let best = null;
    let bestSize = -1;
    let names = [];
    try {
        names = fs.readdirSync(dir);
    } catch (_) {
        return null;
    }
    for (const name of names) {
        if (!MODEL_PATTERN.test(name)) continue;
        const file = path.join(dir, name);
        const size = fs.statSync(file).size;
        if (size > bestSize) {
            best = file;
            bestSize = size;
        }
    }
    return best;
}

/**
 * 生成深度图 PNG（8 位灰度，白=近，最长边不超过 1920）。
 *
 * @param {object} job
 * @param {Uint8Array} job.rgba - 原图像素
 * @param {number} job.width
 * @param {number} job.height
 * @param {string} job.modelPath
 * @param {number} job.blurRadius - 边缘平滑半径（像素，按输出深度图尺寸计），0 关闭
 * @param {(message: string) => void} [job.onProgress]
 * @returns {Promise<Buffer>}
 */
function generateDepthPng({ rgba, width, height, modelPath, blurRadius, onProgress }) {
    // 只在主进程里用到，放在这里 require，测试（纯 Node）加载本文件时不需要 Electron
    const { utilityProcess } = require('electron');

    return new Promise((resolve, reject) => {
        const child = utilityProcess.fork(path.join(__dirname, 'inference-process.js'), [], {
            serviceName: 'Depth Generator',
        });
        let settled = false;
        const finish = (fn, value) => {
            if (settled) return;
            settled = true;
            child.kill();
            fn(value);
        };

        child.on('message', (msg) => {
            if (msg.type === 'progress') {
                if (onProgress) onProgress(msg.message);
            } else if (msg.type === 'done') {
                finish(resolve, Buffer.from(msg.png.buffer, msg.png.byteOffset, msg.png.byteLength));
            } else if (msg.type === 'error') {
                finish(reject, new Error(msg.message));
            }
        });
        child.on('exit', (code) => finish(reject, new Error(`深度图生成进程意外退出（code ${code}），可以试着重新安装`)));
        child.postMessage({ rgba, width, height, modelPath, blurRadius });
    });
}

module.exports = { findDepthModel, generateDepthPng };
