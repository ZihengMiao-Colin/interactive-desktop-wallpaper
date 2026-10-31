"""
generate_depth_map.py — 用 Depth Anything V2 从任意图片生成灰度深度图（白=近，黑=远）

用法：
    python generate_depth_map.py image.jpg
    python generate_depth_map.py image.jpg -o depth.png --blur 12
    python generate_depth_map.py image.jpg --invert

模型加载：
    1. 优先用脚本目录里的本地 ONNX 模型（depth_anything_v2_small*.onnx，不需要联网）
    2. 找不到时回退到 HuggingFace 在线下载（需要 transformers + torch）

后处理（壁纸是按深度挪像素做视差的，深度图边缘越锐利，移动时越容易撕开）：
    1. 模型输出用浮点数放大到输出尺寸，最后才量化成 8 位
    2. 近处轮廓先向外扩一圈，再高斯平滑：过渡带整个落在背景一侧，
       鼠标移动时主体轮廓保持完整，拉伸只发生在背景上

依赖：
    ONNX 模式：pip install onnxruntime pillow numpy
    HuggingFace 模式：pip install transformers torch pillow numpy
"""

import argparse
import glob
import io
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image

# 模型固定输入 518×518（位置编码定死了，不能保持原图比例）
MODEL_INPUT_SIZE = 518
IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

# 输出深度图的最长边。深度图本身很平滑，再大看不出差别，只会让后处理变慢、缓存变大
DEPTH_MAX_SIDE = 1920

DEFAULT_BLUR = 5.0


# ==================== 深度图后处理 ====================

def depth_output_size(width, height, max_side=DEPTH_MAX_SIDE):
    """输出深度图尺寸：保持原图比例，最长边不超过 max_side"""
    scale = min(1.0, max_side / max(width, height))
    return max(1, round(width * scale)), max(1, round(height * scale))


def _box_sizes(sigma, passes=3):
    """用 passes 次均值滤波逼近标准差为 sigma 的高斯，返回每次的窗口宽度（奇数）"""
    ideal = np.sqrt(12 * sigma * sigma / passes + 1)
    lower = int(np.floor(ideal))
    if lower % 2 == 0:
        lower -= 1
    upper = lower + 2
    m = round((12 * sigma * sigma - passes * lower * lower - 4 * passes * lower - 3 * passes)
              / (-4 * lower - 4))
    return [lower if i < m else upper for i in range(passes)]


def blur_support(sigma):
    """gaussian_blur 的影响半径（像素）：离得更远的像素互不影响"""
    if sigma <= 0:
        return 0
    return sum((w - 1) // 2 for w in _box_sizes(sigma))


def _box_rows(a, r):
    """沿列方向（每一行内）做宽 2r+1 的均值滤波，边缘按最近像素延伸"""
    if r <= 0:
        return a
    padded = np.pad(a, ((0, 0), (r + 1, r)), mode='edge')
    c = np.cumsum(padded, axis=1, dtype=np.float64)
    return ((c[:, 2 * r + 1:] - c[:, :-2 * r - 1]) / (2 * r + 1)).astype(np.float32)


def gaussian_blur(depth, sigma):
    """高斯模糊（三次均值滤波逼近，任意半径都很快）"""
    if sigma <= 0:
        return depth
    out = depth.astype(np.float32)
    for w in _box_sizes(sigma):
        r = (w - 1) // 2
        out = _box_rows(_box_rows(out, r).T, r).T
    return out


def _max_rows(a, r):
    """每一行内宽 2r+1 的最大值滤波：窗口每轮最多扩大到 3 倍，log 次完成"""
    reach = 0
    while reach < r:
        s = min(2 * reach + 1, r - reach)
        padded = np.pad(a, ((0, 0), (s, s)), mode='edge')
        a = np.maximum(a, np.maximum(padded[:, :-2 * s], padded[:, 2 * s:]))
        reach += s
    return a


def dilate_max(depth, radius):
    """方形窗口最大值滤波：近处（亮）区域向外扩 radius 像素"""
    return _max_rows(_max_rows(depth, radius).T, radius).T


def postprocess_depth(raw, size, smooth_radius, invert=False):
    """
    模型原始输出 → 最终深度图。

    :param raw: 模型输出的二维数组，值越大越近，量纲任意
    :param size: 输出尺寸 (宽, 高)
    :param smooth_radius: 边缘平滑半径（像素，按输出尺寸计），0 表示不处理边缘
    :param invert: 反转成黑=近（在平滑之后做，外扩的始终是近处）
    :returns: uint8 二维数组
    """
    raw = np.asarray(raw, dtype=np.float32)
    lo, hi = float(raw.min()), float(raw.max())
    if hi - lo < 1e-8:
        print('[警告] 深度几乎没有变化，图片可能是纯色的')
        return np.zeros((size[1], size[0]), np.uint8)

    depth = (raw - lo) / (hi - lo)
    if depth.shape != (size[1], size[0]):
        depth = np.asarray(Image.fromarray(depth, 'F').resize(size, Image.BICUBIC), np.float32)
    depth = np.clip(depth, 0, 1)

    if smooth_radius and smooth_radius > 0:
        # 外扩距离等于模糊的影响半径：原来的主体像素一个都不会被模糊到
        depth = gaussian_blur(dilate_max(depth, blur_support(smooth_radius)), smooth_radius)

    if invert:
        depth = 1 - depth
    return np.round(np.clip(depth, 0, 1) * 255).astype(np.uint8)


# ==================== ONNX 模式 ====================

def find_onnx_models(script_dir=None):
    """扫描目录里的 ONNX 模型，返回 { "small": 路径, ... }；同一档有多个文件时取最大的（通常是 FP32）"""
    if script_dir is None:
        script_dir = os.path.dirname(os.path.abspath(__file__))

    models = {}
    for model_size in ('small', 'base', 'large'):
        matches = glob.glob(os.path.join(script_dir, f'depth_anything_v2_{model_size}*.onnx'))
        if matches:
            matches.sort(key=os.path.getsize, reverse=True)
            models[model_size] = matches[0]
    return models


def open_image(input_path):
    try:
        return Image.open(input_path).convert('RGB')
    except FileNotFoundError:
        print(f'[错误] 找不到文件：{input_path}')
        sys.exit(1)
    except Exception as e:
        print(f'[错误] 无法打开图片：{e}')
        sys.exit(1)


def infer_onnx(image, onnx_path):
    """跑 ONNX 模型，返回 518×518 的原始深度（值越大越近）"""
    try:
        import onnxruntime as ort
    except ImportError:
        print('[错误] 没有安装 onnxruntime，请运行：pip install onnxruntime')
        sys.exit(1)

    resized = image.resize((MODEL_INPUT_SIZE, MODEL_INPUT_SIZE), Image.BICUBIC)
    x = (np.asarray(resized, np.float32) / 255.0 - IMAGENET_MEAN) / IMAGENET_STD
    x = x.transpose(2, 0, 1)[np.newaxis].astype(np.float32)

    try:
        session = ort.InferenceSession(onnx_path, providers=['CPUExecutionProvider'])
    except Exception as e:
        print(f'[错误] 加载 ONNX 模型失败：{e}')
        sys.exit(1)

    output = session.run(None, {session.get_inputs()[0].name: x})[0]
    return np.squeeze(output)


def infer_hf(image, model_size, device=None):
    """跑 HuggingFace 模型（回退方案），返回模型分辨率的原始深度"""
    import torch
    from transformers import AutoImageProcessor, AutoModelForDepthEstimation

    model_id = {
        'small': 'depth-anything/Depth-Anything-V2-Small-hf',
        'base': 'depth-anything/Depth-Anything-V2-Base-hf',
        'large': 'depth-anything/Depth-Anything-V2-Large-hf',
    }[model_size]

    if device is None:
        if torch.cuda.is_available():
            device = 'cuda'
        elif hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
            device = 'mps'
        else:
            device = 'cpu'
    print(f'[加载模型] {model_id}（{device}），首次运行需要下载，网络不通时可设置 HF_ENDPOINT=https://hf-mirror.com')

    try:
        processor = AutoImageProcessor.from_pretrained(model_id)
        model = AutoModelForDepthEstimation.from_pretrained(model_id).to(device).eval()
    except Exception as e:
        print(f'[错误] 模型加载失败：{e}')
        sys.exit(1)

    inputs = {k: v.to(device) for k, v in processor(images=image, return_tensors='pt').items()}
    with torch.no_grad():
        return model(**inputs).predicted_depth[0].cpu().numpy()


# ==================== 统一入口 ====================

def generate_depth_map(
    input_path,
    output_path,
    model_size='small',
    invert=False,
    blur_radius=DEFAULT_BLUR,
    device=None,
    onnx_path=None,
):
    """
    生成深度图并保存为灰度 PNG。

    模型选择顺序：显式指定的 onnx_path → 脚本目录里对应档位的 ONNX → 本地 small ONNX → HuggingFace 在线模型。
    """
    available = find_onnx_models()
    if onnx_path and not os.path.exists(onnx_path):
        print(f'[错误] 找不到 ONNX 文件：{onnx_path}')
        sys.exit(1)
    selected = onnx_path or available.get(model_size) or available.get('small')

    image = open_image(input_path)
    size = depth_output_size(*image.size)
    print(f'[准备] {os.path.basename(input_path)}（{image.width}×{image.height}）→ 深度图 {size[0]}×{size[1]}')

    print('[推理] 正在分析深度...')
    if selected:
        raw = infer_onnx(image, selected)
    else:
        print('[提示] 本地没有 ONNX 模型，改用 HuggingFace 在线模型')
        raw = infer_hf(image, model_size, device)

    print(f'[平滑] 处理边缘（半径 {blur_radius:g}px）...' if blur_radius > 0 else '[平滑] 已关闭边缘平滑')
    depth = postprocess_depth(raw, size, blur_radius, invert=invert)

    Image.fromarray(depth, 'L').save(output_path)
    print(f'[OK] 深度图已生成：{os.path.abspath(output_path)}（{os.path.getsize(output_path) / 1024:.0f} KB）')


def main():
    # 直接在 Windows 中文控制台运行时，避免 GBK 编码报错
    if hasattr(sys.stdout, 'buffer'):
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    if hasattr(sys.stderr, 'buffer'):
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

    parser = argparse.ArgumentParser(description='用 Depth Anything V2 生成灰度深度图（白=近，黑=远）')
    parser.add_argument('input', help='输入图片（jpg / png / webp）')
    parser.add_argument('-o', '--output', default='depth_map.png', help='输出路径（默认 depth_map.png）')
    parser.add_argument('-m', '--model', choices=['small', 'base', 'large'], default='small',
                        help='模型档位，本地只有 small 时自动用 small（默认 small）')
    parser.add_argument('--blur', type=float, default=DEFAULT_BLUR,
                        help='边缘平滑半径（像素，按输出深度图尺寸计）：近处轮廓先外扩再平滑，0 关闭（默认 5）')
    parser.add_argument('--invert', action='store_true', help='反转深度图（黑=近）')
    parser.add_argument('--device', choices=['cuda', 'cpu', 'mps'], default=None, help='HuggingFace 模式下强制指定设备')
    parser.add_argument('--onnx-path', default=None, help='手动指定 ONNX 模型文件')
    args = parser.parse_args()

    if not Path(args.input).exists():
        print(f'[错误] 找不到输入文件：{args.input}')
        sys.exit(1)
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)

    generate_depth_map(
        input_path=args.input,
        output_path=args.output,
        model_size=args.model,
        invert=args.invert,
        blur_radius=args.blur,
        device=args.device,
        onnx_path=args.onnx_path,
    )


if __name__ == '__main__':
    main()
