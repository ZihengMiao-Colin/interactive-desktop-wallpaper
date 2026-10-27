"""
prepare_wallpapers.py — 生成默认壁纸图库的素材

按 wallpapers/manifest.json 里的条目，从原图目录读取原图（字段 origin），生成：
  - wallpapers/<id>.jpg         宽度超过 3840 的缩到 3840，其余原样复制
  - wallpapers/thumbs/<id>.jpg  320×200 的缩略图（居中裁切）
  - wallpapers/depth/<id>.png   深度图（small 模型；宽度超过 1920 的缩到 1920，够用且省空间）

原图目录里的文件不会被修改。改进深度图算法后重新跑一遍即可更新所有深度图。

用法：
    venv/Scripts/python.exe tools/prepare_wallpapers.py --source "default wallpaper"
    venv/Scripts/python.exe tools/prepare_wallpapers.py --source "default wallpaper" --only cat lake-forest

依赖：Pillow、numpy、onnxruntime（与 generate_depth_map.py 相同）。
"""

import argparse
import json
import os
import shutil
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GALLERY_DIR = os.path.join(ROOT, 'wallpapers')

# 壁纸最大宽度（4K 屏够用）
MAX_IMAGE_WIDTH = 3840
# 深度图最大宽度：深度图本身很平滑，再大也看不出区别
MAX_DEPTH_WIDTH = 1920
# 缩略图尺寸（设置页网格是 16:10）
THUMB_SIZE = (320, 200)
# 深度图边缘平滑半径，和设置页默认值一致
DEPTH_BLUR = 8.0


def fit_width(width, height, max_width):
    """宽度超过 max_width 时等比缩小，返回新尺寸"""
    if width <= max_width:
        return width, height
    return max_width, round(height * max_width / width)


def cover_crop_box(width, height, ratio_w, ratio_h):
    """按目标宽高比居中裁切的区域 (left, top, right, bottom)"""
    target = ratio_w / ratio_h
    if width / height > target:
        new_w = round(height * target)
        left = (width - new_w) // 2
        return left, 0, left + new_w, height
    new_h = round(width / target)
    top = (height - new_h) // 2
    return 0, top, width, top + new_h


def prepare_image(src, dst):
    from PIL import Image, ImageOps
    with Image.open(src) as img:
        if img.width <= MAX_IMAGE_WIDTH:
            shutil.copyfile(src, dst)
            return img.width, img.height
        img = ImageOps.exif_transpose(img).convert('RGB')
        size = fit_width(img.width, img.height, MAX_IMAGE_WIDTH)
        img.resize(size, Image.LANCZOS).save(dst, 'JPEG', quality=90, optimize=True, progressive=True)
        return size


def prepare_thumb(src, dst):
    from PIL import Image, ImageOps
    with Image.open(src) as img:
        img = ImageOps.exif_transpose(img).convert('RGB')
        img = img.crop(cover_crop_box(img.width, img.height, *THUMB_SIZE)).resize(THUMB_SIZE, Image.LANCZOS)
        img.save(dst, 'JPEG', quality=85, optimize=True)


def prepare_depth(image_path, dst):
    from PIL import Image
    sys.path.insert(0, ROOT)
    from generate_depth_map import generate_depth_map

    with tempfile.TemporaryDirectory() as tmp:
        raw = os.path.join(tmp, 'depth.png')
        generate_depth_map(image_path, raw, model_size='small', blur_radius=DEPTH_BLUR)
        with Image.open(raw) as depth:
            size = fit_width(depth.width, depth.height, MAX_DEPTH_WIDTH)
            depth.resize(size, Image.LANCZOS).save(dst, 'PNG', optimize=True)


def main():
    parser = argparse.ArgumentParser(description='生成默认壁纸图库的图片、缩略图和深度图')
    parser.add_argument('--source', required=True, help='原图所在目录（不会被修改）')
    parser.add_argument('--only', nargs='*', help='只处理这些 id')
    args = parser.parse_args()

    with open(os.path.join(GALLERY_DIR, 'manifest.json'), encoding='utf-8') as f:
        manifest = json.load(f)

    for entry in manifest['wallpapers']:
        if args.only and entry['id'] not in args.only:
            continue
        src = os.path.join(args.source, entry['origin'])
        image = os.path.join(GALLERY_DIR, entry['file'])
        thumb = os.path.join(GALLERY_DIR, entry['thumb'])
        depth = os.path.join(GALLERY_DIR, entry['depth'])
        for p in (image, thumb, depth):
            os.makedirs(os.path.dirname(p), exist_ok=True)

        size = prepare_image(src, image)
        prepare_thumb(image, thumb)
        prepare_depth(image, depth)
        print(f"[OK] {entry['id']:<20} {entry['name']}  {size[0]}x{size[1]}", file=sys.stderr)


if __name__ == '__main__':
    main()
