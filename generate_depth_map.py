"""
===========================================================================
generate_depth_map.py — 使用 Depth Anything V2 模型生成深度图
===========================================================================

功能：输入任意图片，输出对应的黑白灰度深度图（depth_map.png），
      可直接用于互动桌面壁纸项目的 DisplacementFilter 视差效果。

用法：
    # 最简单用法（使用 Small 模型，输出 depth_map.png）
    python generate_depth_map.py 你的图片.jpg

    # 指定输出文件名
    python generate_depth_map.py 你的图片.jpg -o my_depth.png

    # 使用更大的模型（质量更高，但更慢/更耗显存）
    python generate_depth_map.py 你的图片.jpg -m base
    python generate_depth_map.py 你的图片.jpg -m large

    # 反转深度图（远景白/近景黑 —— 通常不需要）
    python generate_depth_map.py 你的图片.jpg --invert

模型说明：
    small (25M)  — 最快，适合 CPU 运行，约 100MB
    base  (98M)  — 平衡质量与速度，约 390MB
    large (335M) — 最高质量，需要 GPU，约 1.3GB

首次运行时会自动从 Hugging Face 下载模型文件，请耐心等待。

依赖安装：
    pip install -r requirements.txt
===========================================================================
"""

import argparse
import sys
import os
from pathlib import Path


def download_model_with_progress(model_id, cache_dir=None):
    """
    从 Hugging Face Hub 下载模型，显示下载进度。

    如果网络环境访问 Hugging Face 有困难，可以设置环境变量：
        HF_ENDPOINT=https://hf-mirror.com
    来使用镜像站点。
    """
    from huggingface_hub import snapshot_download
    from huggingface_hub.utils import HfHubHTTPError

    print(f"正在下载模型 {model_id} ...")
    print("（首次运行需要下载，约 100MB~1.3GB，取决于模型大小）")

    try:
        local_path = snapshot_download(
            repo_id=model_id,
            cache_dir=cache_dir,
            resume_download=True,
        )
        print(f"模型已缓存到: {local_path}")
        return local_path
    except HfHubHTTPError as e:
        print(f"\n[X] 下载失败: {e}")
        print("\n可能的解决方案：")
        print("  1. 检查网络连接")
        print("  2. 使用镜像站点: set HF_ENDPOINT=https://hf-mirror.com")
        print("  3. 手动下载模型文件放到缓存目录")
        sys.exit(1)


def generate_depth_map(
    input_path,
    output_path,
    model_size="small",
    invert=False,
    device=None,
):
    """
    使用 Depth Anything V2 从输入图片生成深度图。

    Args:
        input_path:   输入图片的路径
        output_path:  输出深度图的保存路径
        model_size:   模型大小 ("small", "base", "large")
        invert:       是否反转深度图（默认白色=近景；反转后黑色=近景）
        device:       强制指定设备 ("cuda", "cpu", "mps")，None=自动选择
    """
    from PIL import Image
    import numpy as np

    # ---- 延迟导入（给用户时间看到上面的提示） ----
    import torch
    from transformers import AutoImageProcessor, AutoModelForDepthEstimation

    # ---- 模型 ID 映射 ----
    MODEL_IDS = {
        "small": "depth-anything/Depth-Anything-V2-Small-hf",
        "base":  "depth-anything/Depth-Anything-V2-Base-hf",
        "large": "depth-anything/Depth-Anything-V2-Large-hf",
    }

    if model_size not in MODEL_IDS:
        print(f"[X] 未知模型大小: {model_size}，可选: {list(MODEL_IDS.keys())}")
        sys.exit(1)

    model_id = MODEL_IDS[model_size]

    print("=" * 60)
    print(f"  模型: {model_id}")
    print(f"  输入: {input_path}")
    print(f"  输出: {output_path}")
    print("=" * 60)

    # ---- 加载图片 ----
    try:
        image = Image.open(input_path).convert("RGB")
    except FileNotFoundError:
        print(f"[X] 找不到文件: {input_path}")
        sys.exit(1)
    except Exception as e:
        print(f"[X] 无法打开图片: {e}")
        sys.exit(1)

    original_size = image.size  # (width, height)
    print(f"\n[图片] 图片尺寸: {original_size[0]} × {original_size[1]}")

    # ---- 选择设备 ----
    if device is None:
        if torch.cuda.is_available():
            device = "cuda"
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            device = "mps"
        else:
            device = "cpu"
    print(f"[设备]  使用设备: {device}")

    # ---- 下载模型（带进度提示） ----
    try:
        download_model_with_progress(model_id)
    except Exception:
        pass  # snapshot_download 可选，from_pretrained 也会自动下载

    # ---- 加载模型和处理器 ----
    print("\n[...] 正在加载模型...")
    try:
        image_processor = AutoImageProcessor.from_pretrained(model_id)
        model = AutoModelForDepthEstimation.from_pretrained(model_id)
    except Exception as e:
        print(f"[X] 模型加载失败: {e}")
        print("\n提示：如果网络连接 Hugging Face 不稳定，请尝试：")
        print('  设置环境变量: HF_ENDPOINT=https://hf-mirror.com')
        print("  或手动下载模型文件。")
        sys.exit(1)

    model = model.to(device)
    model.eval()

    # ---- 推理 ----
    print("[分析] 正在分析深度信息...")
    inputs = image_processor(images=image, return_tensors="pt")
    inputs = {k: v.to(device) for k, v in inputs.items()}

    with torch.no_grad():
        outputs = model(**inputs)

    # ---- 后处理 ----
    # predicted_depth 是模型输出的原始深度张量，形状约为 (1, H/14, W/14)
    predicted_depth = outputs.predicted_depth

    # 使用双三次插值将深度图放大回原始图片尺寸
    prediction = torch.nn.functional.interpolate(
        predicted_depth.unsqueeze(1),
        size=(original_size[1], original_size[0]),  # (height, width)
        mode="bicubic",
        align_corners=False,
    ).squeeze()

    # ---- 归一化到 0-255 ----
    depth_np = prediction.cpu().numpy()

    # 深度值越大 = 离相机越近 → 白色（255）
    # 深度值越小 = 离相机越远 → 黑色（0）
    depth_min = depth_np.min()
    depth_max = depth_np.max()

    if depth_max - depth_min < 1e-8:
        print("[警告]  警告：深度图变化极小，可能输入为纯色图片")
        depth_normalized = np.zeros_like(depth_np)
    else:
        depth_normalized = (depth_np - depth_min) / (depth_max - depth_min)

    # 可选：反转（使远景变白、近景变黑）
    if invert:
        depth_normalized = 1.0 - depth_normalized
        print("[反转] 已反转深度图（黑色=近景，白色=远景）")

    depth_uint8 = (depth_normalized * 255).astype(np.uint8)

    # ---- 保存 ----
    depth_image = Image.fromarray(depth_uint8, mode="L")  # L = 8-bit 灰度
    depth_image.save(output_path)

    file_size = os.path.getsize(output_path)
    print(f"\n[OK] 深度图已生成!")
    print(f"   文件: {os.path.abspath(output_path)}")
    print(f"   尺寸: {depth_image.size[0]} × {depth_image.size[1]}")
    print(f"   大小: {file_size / 1024:.1f} KB")
    print(f"\n[提示] 将 {os.path.basename(output_path)} 放到 index.html 同级目录下即可使用。")


def main():
    parser = argparse.ArgumentParser(
        description="使用 Depth Anything V2 从图片生成黑白深度图",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python generate_depth_map.py wallpaper.jpg
  python generate_depth_map.py photo.png -o depth_map.png -m base
  python generate_depth_map.py image.jpg --invert
        """,
    )

    parser.add_argument(
        "input",
        help="输入图片的路径（支持 jpg/png/webp 等常见格式）",
    )
    parser.add_argument(
        "-o", "--output",
        default="depth_map.png",
        help="输出深度图的保存路径（默认: depth_map.png）",
    )
    parser.add_argument(
        "-m", "--model",
        choices=["small", "base", "large"],
        default="small",
        help="模型大小: small(快) / base(均衡) / large(最佳质量) [默认: small]",
    )
    parser.add_argument(
        "--invert",
        action="store_true",
        help="反转深度图颜色（默认白色=近景；反转后黑色=近景）",
    )
    parser.add_argument(
        "--device",
        choices=["cuda", "cpu", "mps"],
        default=None,
        help="强制指定运算设备（默认自动选择）",
    )

    args = parser.parse_args()

    # 检查输入文件
    if not Path(args.input).exists():
        print(f"[X] 找不到输入文件: {args.input}")
        sys.exit(1)

    # 确认输出目录存在
    output_dir = Path(args.output).parent
    if output_dir and not output_dir.exists():
        output_dir.mkdir(parents=True, exist_ok=True)

    generate_depth_map(
        input_path=args.input,
        output_path=args.output,
        model_size=args.model,
        invert=args.invert,
        device=args.device,
    )


if __name__ == "__main__":
    main()
