"""
===========================================================================
export_onnx.py — 将 Depth Anything V2 Small 导出为 ONNX 格式 (INT8 量化)
===========================================================================

用途：导出 ONNX 模型文件 → 复制到 Android 项目的 assets/models/ 目录

用法：
    # 安装依赖 (只需一次)
    pip install torch transformers onnx onnxruntime

    # 导出 FP32 模型 (~95MB)
    python export_onnx.py

    # 导出 INT8 量化模型 (~25MB，推荐手机用)
    python export_onnx.py --quantize

    # 指定输出路径
    python export_onnx.py --quantize -o depth_anything_v2_small_int8.onnx

输出文件:
    depth_anything_v2_small.onnx        FP32，约 95MB
    depth_anything_v2_small_int8.onnx    INT8，约 25MB

首次运行会自动从 Hugging Face 下载模型。
如果网络访问 Hugging Face 有困难，设置环境变量:
    HF_ENDPOINT=https://hf-mirror.com
===========================================================================
"""

import argparse
import sys
import os
import io
from pathlib import Path

# 修复 Windows 中文系统 GBK 编码问题 (PyTorch ONNX 导出会输出 emoji)
if hasattr(sys.stdout, 'buffer'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'buffer'):
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')


def export_onnx(output_path, quantize=False, opset=18):
    import torch
    import numpy as np
    from transformers import AutoModelForDepthEstimation

    model_id = "depth-anything/Depth-Anything-V2-Small-hf"

    print("=" * 60)
    print(f"  导出 Depth Anything V2 Small → ONNX")
    print(f"  模型: {model_id}")
    print(f"  量化: {'INT8 动态量化' if quantize else 'FP32'}")
    print(f"  输出: {output_path}")
    print("=" * 60)

    # ---- 加载模型 ----
    print("\n[1/4] 加载 PyTorch 模型...")
    try:
        model = AutoModelForDepthEstimation.from_pretrained(model_id)
    except Exception as e:
        print(f"\n[X] 模型加载失败: {e}")
        print("\n提示：如果网络连接 Hugging Face 不稳定，请尝试：")
        print('  设置环境变量: HF_ENDPOINT=https://hf-mirror.com')
        sys.exit(1)

    model.eval()

    # ---- 包装模型 (提取 predicted_depth 张量) ----
    class ModelWrapper(torch.nn.Module):
        def __init__(self, model):
            super().__init__()
            self.model = model

        def forward(self, pixel_values):
            outputs = self.model(pixel_values)
            # outputs 是 DepthEstimatorOutput 数据类，提取 predicted_depth 张量
            return outputs.predicted_depth

    wrapped = ModelWrapper(model)
    wrapped.eval()

    # ---- 导出 ----
    print("\n[2/4] 导出 ONNX (opset={})...".format(opset))

    # 虚拟输入: batch=1, channels=3, height=518, width=518
    # 518 = 37*14，是常见输入尺寸
    dummy_input = torch.randn(1, 3, 518, 518)

    # 动态轴: 支持任意尺寸的输入图片 (新版 PyTorch dynamic_shapes 只需输入)
    dynamic_shapes = {
        "pixel_values": {
            0: "batch",
            2: "height",
            3: "width",
        },
    }

    torch.onnx.export(
        wrapped,
        dummy_input,
        output_path + ".tmp",  # 先写临时文件
        input_names=["pixel_values"],
        output_names=["predicted_depth"],
        dynamic_shapes=dynamic_shapes,
        opset_version=opset,
        do_constant_folding=True,
        export_params=True,
    )

    # ---- 验证 ONNX 模型 ----
    print("\n[3/4] 验证 ONNX 模型...")
    import onnx
    onnx_model = onnx.load(output_path + ".tmp")
    onnx.checker.check_model(onnx_model)

    # 量化
    if quantize:
        from onnxruntime.quantization import quantize_dynamic, QuantType
        print("  执行 INT8 动态量化 (这可能需要几分钟)...")
        quantize_dynamic(
            output_path + ".tmp",
            output_path,
            weight_type=QuantType.QInt8,
            extra_options={"ActivationSymmetric": True},
        )
        os.remove(output_path + ".tmp")
    else:
        os.rename(output_path + ".tmp", output_path)

    # ---- 文件大小 ----
    file_size = os.path.getsize(output_path)
    print(f"\n[4/4] ✓ 导出成功!")
    print(f"   文件: {os.path.abspath(output_path)}")
    print(f"   大小: {file_size / (1024*1024):.1f} MB")

    # 测试推理
    print("\n[测试推理]...")
    try:
        import onnxruntime as ort
        session = ort.InferenceSession(output_path, providers=["CPUExecutionProvider"])
        test_input = np.random.randn(1, 3, 518, 518).astype(np.float32)
        outputs = session.run(["predicted_depth"], {"pixel_values": test_input})
        result = outputs[0]
        print(f"  输入: {test_input.shape} → 输出: {result.shape}")
        print("  ✓ ONNX Runtime 推理测试通过")
    except Exception as e:
        print(f"  ! 推理测试失败: {e}")
        print("  (ONNX 文件本身可能正常，只是当前环境下推理出错)")

    print(f"\n[下一步] 将 {os.path.basename(output_path)} 复制到:")
    print(f"   Android 项目: app/src/main/assets/models/")


def main():
    parser = argparse.ArgumentParser(
        description="导出 Depth Anything V2 Small 为 ONNX 格式",
    )
    parser.add_argument(
        "--quantize", "-q",
        action="store_true",
        help="导出 INT8 动态量化模型 (~25MB，推荐手机使用)",
    )
    parser.add_argument(
        "-o", "--output",
        default=None,
        help="输出文件路径",
    )
    parser.add_argument(
        "--opset",
        type=int,
        default=18,
        help="ONNX opset 版本 (默认 18)",
    )

    args = parser.parse_args()

    # 确定输出路径
    if args.output:
        output_path = args.output
    else:
        suffix = "_int8" if args.quantize else ""
        output_path = f"depth_anything_v2_small{suffix}.onnx"

    # 确认输出目录存在
    output_dir = Path(output_path).parent
    if output_dir and not output_dir.exists():
        output_dir.mkdir(parents=True, exist_ok=True)

    export_onnx(output_path, quantize=args.quantize, opset=args.opset)


if __name__ == "__main__":
    main()
