"""
===========================================================================
generate_depth_map.py — Depth map generation using Depth Anything V2
===========================================================================

Generates a grayscale depth map from any input image, used by the
interactive wallpaper project for DisplacementFilter parallax effects.

Usage:
    python generate_depth_map.py image.jpg
    python generate_depth_map.py image.jpg -o depth.png -m base
    python generate_depth_map.py image.jpg --invert

Model loading strategy (auto-detection):
    1. Scan script directory for local ONNX model files (no network needed)
    2. Fall back to HuggingFace online download if no ONNX found

Supported ONNX filenames (place in same directory as this script):
    depth_anything_v2_small*.onnx    -> matches -m small
    depth_anything_v2_base*.onnx     -> matches -m base
    depth_anything_v2_large*.onnx    -> matches -m large

Dependencies:
    # ONNX mode (recommended, no network):
    pip install onnxruntime pillow numpy

    # HuggingFace mode (needs network):
    pip install transformers torch pillow numpy
===========================================================================
"""

import argparse
import sys
import os
import io
import glob as glob_module
from pathlib import Path

# ---- Force UTF-8 on stdout/stderr (Windows GBK fix) ----
if hasattr(sys.stdout, 'buffer'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'buffer'):
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')


# ==================== ONNX Mode ====================

def find_onnx_models(script_dir=None):
    """Scan directory for available ONNX model files.

    Returns: { "small": "path/to/model.onnx", "base": "...", "large": "..." }
    """
    if script_dir is None:
        script_dir = os.path.dirname(os.path.abspath(__file__))

    models = {}

    for model_size in ("small", "base", "large"):
        pattern = os.path.join(script_dir, f"depth_anything_v2_{model_size}*.onnx")
        matches = glob_module.glob(pattern)

        if matches:
            # Prefer largest file (usually FP32, highest quality)
            matches.sort(key=lambda f: os.path.getsize(f), reverse=True)
            models[model_size] = matches[0]

    return models


def generate_depth_map_onnx(
    input_path,
    output_path,
    onnx_path,
    invert=False,
    blur_radius=8.0,
):
    """Generate depth map using ONNX Runtime (no network needed)."""
    import numpy as np
    from PIL import Image, ImageFilter

    # ---- Load image ----
    try:
        image = Image.open(input_path).convert("RGB")
    except FileNotFoundError:
        print(f"[ERROR] File not found: {input_path}")
        sys.exit(1)
    except Exception as e:
        print(f"[ERROR] Cannot open image: {e}")
        sys.exit(1)

    original_size = image.size  # (width, height)
    model_size_mb = os.path.getsize(onnx_path) / (1024 * 1024)

    print("=" * 60)
    print(f"  Mode: ONNX Runtime (local model)")
    print(f"  Model: {os.path.basename(onnx_path)} ({model_size_mb:.1f} MB)")
    print(f"  Input: {input_path} ({original_size[0]}x{original_size[1]})")
    print(f"  Output: {output_path}")
    print("=" * 60)

    # ---- Preprocess: bicubic resize to 518x518 + ImageNet normalize ----
    print("\n[Preprocess] Resizing to 518x518 + ImageNet normalization...")

    input_size = (518, 518)
    img_resized = image.resize(input_size, Image.BICUBIC)

    # Convert to numpy (H, W, 3) -> normalize
    img_np = np.array(img_resized).astype(np.float32) / 255.0

    # ImageNet normalization
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    img_np = (img_np - mean) / std

    # (H, W, 3) -> (1, 3, H, W)
    img_np = img_np.transpose(2, 0, 1)
    img_np = np.expand_dims(img_np, axis=0)

    print(f"  Input tensor shape: {img_np.shape}")

    # ---- ONNX Runtime inference ----
    print("\n[Inference] Analyzing depth information...")

    try:
        import onnxruntime as ort
    except ImportError:
        print("[ERROR] onnxruntime not installed. Run: pip install onnxruntime")
        sys.exit(1)

    providers = ['CPUExecutionProvider']
    try:
        session = ort.InferenceSession(onnx_path, providers=providers)
    except Exception as e:
        print(f"[ERROR] Failed to load ONNX model: {e}")
        sys.exit(1)

    input_name = session.get_inputs()[0].name
    outputs = session.run(None, {input_name: img_np})
    predicted_depth = outputs[0]

    print(f"  Raw output shape: {predicted_depth.shape}")

    # ---- Postprocess: bicubic interpolate back to original size ----
    print("[Postprocess] Upscaling to original resolution...")

    # Ensure 4D (1, 1, H, W)
    if predicted_depth.ndim == 3:
        predicted_depth = predicted_depth[np.newaxis, ...]
    elif predicted_depth.ndim == 2:
        predicted_depth = predicted_depth[np.newaxis, np.newaxis, ...]

    depth_2d = predicted_depth[0, 0]

    # Normalize to 0-1
    d_min, d_max = depth_2d.min(), depth_2d.max()
    if d_max - d_min < 1e-8:
        print("[WARN] Depth variation is negligible; image may be monochrome")
        depth_normalized = np.zeros_like(depth_2d)
    else:
        depth_normalized = (depth_2d - d_min) / (d_max - d_min)

    depth_uint8 = (depth_normalized * 255).astype(np.uint8)
    depth_pil = Image.fromarray(depth_uint8, mode="L")

    # Bicubic upscale to original size
    depth_pil = depth_pil.resize(original_size, Image.BICUBIC)

    # ---- Optional invert ----
    if invert:
        depth_pil = Image.fromarray(255 - np.array(depth_pil), mode="L")
        print("[Invert] Depth map inverted (black=near, white=far)")

    # ---- Optional Gaussian blur for edge smoothing ----
    if blur_radius and blur_radius > 0:
        print(f"[Smooth] Applying edge smoothing (Gaussian blur radius: {blur_radius})...")
        depth_pil = depth_pil.filter(ImageFilter.GaussianBlur(radius=float(blur_radius)))

    # ---- Save ----
    depth_pil.save(output_path)

    file_size = os.path.getsize(output_path)
    print(f"\n[OK] Depth map generated!")
    print(f"  File: {os.path.abspath(output_path)}")
    print(f"  Size: {depth_pil.size[0]} x {depth_pil.size[1]}")
    print(f"  Disk: {file_size / 1024:.1f} KB")


# ==================== HuggingFace Mode (fallback) ====================

def download_model_with_progress(model_id, cache_dir=None):
    """Download model from Hugging Face Hub with progress."""
    from huggingface_hub import snapshot_download
    from huggingface_hub.utils import HfHubHTTPError

    print(f"Downloading model {model_id} ...")
    print("(First run downloads ~100MB-1.3GB depending on model size)")

    try:
        local_path = snapshot_download(
            repo_id=model_id,
            cache_dir=cache_dir,
            resume_download=True,
        )
        print(f"Model cached at: {local_path}")
        return local_path
    except HfHubHTTPError as e:
        print(f"\n[ERROR] Download failed: {e}")
        print("\nPossible solutions:")
        print("  1. Check your network connection")
        print("  2. Use mirror: set HF_ENDPOINT=https://hf-mirror.com")
        print("  3. Download model files manually")
        sys.exit(1)


def generate_depth_map_hf(
    input_path,
    output_path,
    model_size="small",
    invert=False,
    blur_radius=8.0,
    device=None,
):
    """Generate depth map using HuggingFace Transformers."""
    from PIL import Image, ImageFilter
    import numpy as np
    import torch
    from transformers import AutoImageProcessor, AutoModelForDepthEstimation

    MODEL_IDS = {
        "small": "depth-anything/Depth-Anything-V2-Small-hf",
        "base":  "depth-anything/Depth-Anything-V2-Base-hf",
        "large": "depth-anything/Depth-Anything-V2-Large-hf",
    }

    model_id = MODEL_IDS[model_size]

    print("=" * 60)
    print(f"  Mode: HuggingFace Transformers")
    print(f"  Model: {model_id}")
    print(f"  Input: {input_path}")
    print(f"  Output: {output_path}")
    print("=" * 60)

    # ---- Load image ----
    try:
        image = Image.open(input_path).convert("RGB")
    except FileNotFoundError:
        print(f"[ERROR] File not found: {input_path}")
        sys.exit(1)
    except Exception as e:
        print(f"[ERROR] Cannot open image: {e}")
        sys.exit(1)

    original_size = image.size
    print(f"\n[Image] Size: {original_size[0]} x {original_size[1]}")

    # ---- Select device ----
    if device is None:
        if torch.cuda.is_available():
            device = "cuda"
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            device = "mps"
        else:
            device = "cpu"
    print(f"[Device] Using: {device}")

    # ---- Download model ----
    try:
        download_model_with_progress(model_id)
    except Exception:
        pass

    # ---- Load model and processor ----
    print("\n[...] Loading model...")
    try:
        image_processor = AutoImageProcessor.from_pretrained(model_id)
        model = AutoModelForDepthEstimation.from_pretrained(model_id)
    except Exception as e:
        print(f"[ERROR] Model loading failed: {e}")
        print("\nTip: If Hugging Face is unreachable, try:")
        print('  set HF_ENDPOINT=https://hf-mirror.com')
        print("  Or use local ONNX models instead.")
        sys.exit(1)

    model = model.to(device)
    model.eval()

    # ---- Inference ----
    print("[Inference] Analyzing depth information...")
    inputs = image_processor(images=image, return_tensors="pt")
    inputs = {k: v.to(device) for k, v in inputs.items()}

    with torch.no_grad():
        outputs = model(**inputs)

    predicted_depth = outputs.predicted_depth

    prediction = torch.nn.functional.interpolate(
        predicted_depth.unsqueeze(1),
        size=(original_size[1], original_size[0]),
        mode="bicubic",
        align_corners=False,
    ).squeeze()

    # ---- Normalize ----
    depth_np = prediction.cpu().numpy()
    depth_min = depth_np.min()
    depth_max = depth_np.max()

    if depth_max - depth_min < 1e-8:
        print("[WARN] Depth variation is negligible; image may be monochrome")
        depth_normalized = np.zeros_like(depth_np)
    else:
        depth_normalized = (depth_np - depth_min) / (depth_max - depth_min)

    if invert:
        depth_normalized = 1.0 - depth_normalized
        print("[Invert] Depth map inverted (black=near, white=far)")

    depth_uint8 = (depth_normalized * 255).astype(np.uint8)

    # ---- Save ----
    depth_image = Image.fromarray(depth_uint8, mode="L")

    # ---- Optional Gaussian blur for edge smoothing ----
    if blur_radius and blur_radius > 0:
        print(f"[Smooth] Applying edge smoothing (Gaussian blur radius: {blur_radius})...")
        depth_image = depth_image.filter(ImageFilter.GaussianBlur(radius=float(blur_radius)))

    depth_image.save(output_path)

    file_size = os.path.getsize(output_path)
    print(f"\n[OK] Depth map generated!")
    print(f"  File: {os.path.abspath(output_path)}")
    print(f"  Size: {depth_image.size[0]} x {depth_image.size[1]}")
    print(f"  Disk: {file_size / 1024:.1f} KB")


# ==================== Unified Entry Point ====================

def generate_depth_map(
    input_path,
    output_path,
    model_size="small",
    invert=False,
    blur_radius=8.0,
    device=None,
    onnx_path=None,
):
    """Auto-select ONNX or HuggingFace mode.

    Priority:
        1. Explicit --onnx-path
        2. Matching ONNX model found in script directory
        3. Fall back to HuggingFace online download
    """
    script_dir = os.path.dirname(os.path.abspath(__file__))
    available_onnx = find_onnx_models(script_dir)

    selected_onnx = None

    if onnx_path:
        if not os.path.exists(onnx_path):
            print(f"[ERROR] ONNX file not found: {onnx_path}")
            sys.exit(1)
        selected_onnx = onnx_path
    elif model_size in available_onnx:
        selected_onnx = available_onnx[model_size]
    elif "small" in available_onnx:
        print(f"[Info] Local '{model_size}' model not found, using high-performance local 'small' ONNX model instead")
        selected_onnx = available_onnx["small"]

    if selected_onnx:
        generate_depth_map_onnx(
            input_path=input_path,
            output_path=output_path,
            onnx_path=selected_onnx,
            invert=invert,
            blur_radius=blur_radius,
        )
    else:
        if available_onnx:
            print(f"[Info] ONNX models found but none matching '{model_size}': {list(available_onnx.keys())}")
            print(f"[Info] Requested '{model_size}', falling back to HuggingFace")
        else:
            print("[Info] No local ONNX model found, using HuggingFace")
        generate_depth_map_hf(
            input_path=input_path,
            output_path=output_path,
            model_size=model_size,
            invert=invert,
            blur_radius=blur_radius,
            device=device,
        )


def main():
    parser = argparse.ArgumentParser(
        description="Generate grayscale depth map using Depth Anything V2",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python generate_depth_map.py wallpaper.jpg
  python generate_depth_map.py photo.png -o depth_map.png -m base
  python generate_depth_map.py image.jpg --blur 12
  python generate_depth_map.py image.jpg --invert
  python generate_depth_map.py image.jpg --onnx-path model.onnx
        """,
    )

    parser.add_argument(
        "input",
        help="Input image path (jpg/png/webp supported)",
    )
    parser.add_argument(
        "-o", "--output",
        default="depth_map.png",
        help="Output depth map path (default: depth_map.png)",
    )
    parser.add_argument(
        "-m", "--model",
        choices=["small", "base", "large"],
        default="small",
        help="Model size: small(fast) / base(balanced) / large(best) [default: small]",
    )
    parser.add_argument(
        "--blur",
        type=float,
        default=8.0,
        help="Gaussian blur radius for edge smoothing to reduce tearing (default: 8.0, set 0 to disable)",
    )
    parser.add_argument(
        "--invert",
        action="store_true",
        help="Invert depth map colors",
    )
    parser.add_argument(
        "--device",
        choices=["cuda", "cpu", "mps"],
        default=None,
        help="Force device (HuggingFace mode only)",
    )
    parser.add_argument(
        "--onnx-path",
        default=None,
        help="Manually specify ONNX model file path",
    )

    args = parser.parse_args()

    # Validate input
    if not Path(args.input).exists():
        print(f"[ERROR] Input file not found: {args.input}")
        sys.exit(1)

    # Ensure output directory exists
    output_dir = Path(args.output).parent
    if output_dir and not output_dir.exists():
        output_dir.mkdir(parents=True, exist_ok=True)

    generate_depth_map(
        input_path=args.input,
        output_path=args.output,
        model_size=args.model,
        invert=args.invert,
        blur_radius=args.blur,
        device=args.device,
        onnx_path=args.onnx_path,
    )


if __name__ == "__main__":
    main()
