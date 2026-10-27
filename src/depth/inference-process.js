/**
 * depth/inference-process.js — 深度图推理子进程（Electron utilityProcess）
 *
 * 放在单独的进程里：
 *   - 不卡主进程（主进程还要每 33ms 推一次鼠标位置，大图缩放和后处理要算几百毫秒）
 *   - onnxruntime 的原生代码出问题（比如 DLL 缺失时加载到 Windows 自带的旧版 onnxruntime.dll 直接中止）
 *     只会让这个子进程退出，壁纸照常运行。放在 worker 线程里的话会把整个程序带崩。
 * 每次生成开一个新进程，用完就退出，模型占的内存跟着释放。
 *
 * 收到：{ rgba, width, height, modelPath, blurRadius }
 * 发回：{ type: 'progress', message } … → { type: 'done', png, width, height } 或 { type: 'error', message }
 */

const ort = require('onnxruntime-node');
const D = require('./processing');
const { encodeGrayPng } = require('./png');

const port = process.parentPort;

function progress(message) {
    port.postMessage({ type: 'progress', message });
}

async function run({ rgba, width, height, modelPath, blurRadius }) {
    const [outW, outH] = D.depthOutputSize(width, height);
    progress(`[准备] ${width}×${height} → 深度图 ${outW}×${outH}`);

    const size = D.MODEL_INPUT_SIZE;
    const input = D.toModelInput(D.resizeRgb8(rgba, width, height, size, size), size * size);

    progress('[推理] 正在分析深度...');
    const session = await ort.InferenceSession.create(modelPath, { executionProviders: ['cpu'] });
    let raw, rawW, rawH;
    try {
        const feeds = { [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, size, size]) };
        const output = (await session.run(feeds))[session.outputNames[0]];
        raw = output.data;
        rawH = output.dims[output.dims.length - 2];
        rawW = output.dims[output.dims.length - 1];
    } finally {
        await session.release();
    }

    progress(blurRadius > 0 ? `[平滑] 处理边缘（半径 ${blurRadius}px）...` : '[平滑] 已关闭边缘平滑');
    const gray = D.postprocessDepth(raw, rawW, rawH, outW, outH, blurRadius);
    port.postMessage({ type: 'done', png: encodeGrayPng(gray, outW, outH), width: outW, height: outH });
}

// 结果发出去之后由主进程结束这个进程（这里自己退出的话，退出通知可能比最后一条消息先到）
port.once('message', ({ data }) => {
    run(data).catch((err) => port.postMessage({ type: 'error', message: err.message }));
});
