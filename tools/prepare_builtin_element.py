"""
prepare_builtin_element.py — 预处理绿幕默认元素视频

把全画面的绿幕素材裁到主体（爆炸、烟雾等）实际出现过的区域，缩小、转 30fps，
并生成抠掉绿色的缩略图，最后打印一条可以直接放进 elements/manifest.json 的记录。

用法：
    venv/Scripts/python.exe tools/prepare_builtin_element.py elements/bomb1.mp4 --id bomb1 --name "爆炸 1"

依赖：numpy；ffmpeg / ffprobe 需要在 PATH 里。
"""

import argparse
import json
import os
import subprocess
import sys

import numpy as np

# 判定为"绿幕"的阈值：G - max(R, B) 超过它（0~1 计）就算背景
GREEN_THRESHOLD = 0.15
# 一帧里超过这个比例都不是绿色，说明是黑场 / 转场，不参与计算外框
MAX_FOREGROUND_RATIO = 0.9
# 行或列上累计少于这么多前景像素视为噪点
MIN_PIXELS = 3
# 外框四周外扩的比例
PADDING_RATIO = 0.04
# 输出视频的最大宽度和帧率
MAX_OUTPUT_WIDTH = 1024
OUTPUT_FPS = 30
# 缩略图背景色（设置页卡片底色）
THUMB_BG = '0x2b2d38'


def greenness(frame):
    """每个像素的 G - max(R, B)，取值 -1 ~ 1"""
    f = frame.astype(np.float32) / 255.0
    return f[:, :, 1] - np.maximum(f[:, :, 0], f[:, :, 2])


def nongreen_bbox(frames, green_threshold=GREEN_THRESHOLD):
    """
    所有帧里非绿色像素的并集外框，返回 (x0, y0, x1, y1)，x1 / y1 不含。
    几乎整帧都不是绿色的帧（黑场、转场）会被跳过；零星噪点会被忽略。
    """
    acc = None
    for frame in frames:
        mask = greenness(frame) < green_threshold
        if mask.mean() > MAX_FOREGROUND_RATIO:
            continue
        acc = mask.astype(np.int32) if acc is None else acc + mask

    if acc is None:
        raise ValueError('没有可用的帧')
    cols = np.where(acc.sum(axis=0) >= MIN_PIXELS)[0]
    rows = np.where(acc.sum(axis=1) >= MIN_PIXELS)[0]
    if cols.size == 0 or rows.size == 0:
        raise ValueError('画面里没有找到非绿色的主体')
    return int(cols[0]), int(rows[0]), int(cols[-1]) + 1, int(rows[-1]) + 1


def best_thumb_index(frames):
    """挑缩略图用的帧：非绿色像素亮度平方之和最大的一帧（火光最亮、主体最明显）"""
    scores = []
    for frame in frames:
        f = frame.astype(np.float32) / 255.0
        luma = 0.299 * f[:, :, 0] + 0.587 * f[:, :, 1] + 0.114 * f[:, :, 2]
        mask = greenness(frame) < GREEN_THRESHOLD
        scores.append(float((luma[mask] ** 2).sum()))
    return int(np.argmax(scores))


def probe(path):
    """返回 (宽, 高, 时长秒)"""
    out = subprocess.check_output([
        'ffprobe', '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height:format=duration', '-of', 'json', path,
    ])
    info = json.loads(out)
    stream = info['streams'][0]
    return int(stream['width']), int(stream['height']), float(info['format']['duration'])


def sample_frames(path, every_n=5, sample_width=640):
    """每隔 every_n 帧取一帧，缩到 sample_width 宽，返回 (帧列表, 缩放比例)"""
    width, height, _ = probe(path)
    sample_height = round(height * sample_width / width / 2) * 2
    raw = subprocess.check_output([
        'ffmpeg', '-v', 'error', '-i', path,
        '-vf', f'select=not(mod(n\\,{every_n})),scale={sample_width}:{sample_height}',
        '-vsync', '0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
    ])
    frame_bytes = sample_width * sample_height * 3
    count = len(raw) // frame_bytes
    frames = np.frombuffer(raw[:count * frame_bytes], dtype=np.uint8).reshape(count, sample_height, sample_width, 3)
    return list(frames), width / sample_width


def key_color(frames):
    """取样帧里绿色像素的平均颜色，作为缩略图抠像的键色"""
    pixels = np.concatenate([f[greenness(f) >= GREEN_THRESHOLD] for f in frames])
    r, g, b = pixels.mean(axis=0).astype(int)
    return f'0x{r:02x}{g:02x}{b:02x}'


def even(v):
    return int(v) // 2 * 2


def main():
    parser = argparse.ArgumentParser(description='裁剪绿幕默认元素视频并生成缩略图')
    parser.add_argument('input', help='原始绿幕视频')
    parser.add_argument('--id', required=True, help='manifest 里的 id，例如 bomb1')
    parser.add_argument('--name', required=True, help='显示名称，例如 "爆炸 1"')
    args = parser.parse_args()

    src_w, src_h, duration = probe(args.input)
    frames, scale = sample_frames(args.input)
    x0, y0, x1, y1 = nongreen_bbox(frames)

    # 换算回原分辨率并外扩
    pad_x, pad_y = src_w * PADDING_RATIO, src_h * PADDING_RATIO
    left = max(0, x0 * scale - pad_x)
    top = max(0, y0 * scale - pad_y)
    right = min(src_w, x1 * scale + pad_x)
    bottom = min(src_h, y1 * scale + pad_y)
    crop_w, crop_h = even(right - left), even(bottom - top)
    left, top = even(left), even(top)
    out_w = min(crop_w, MAX_OUTPUT_WIDTH)
    out_h = even(crop_h * out_w / crop_w)

    out_dir = os.path.dirname(os.path.abspath(args.input))
    video_name = f'{args.id}_cut.mp4'
    thumb_name = f'{args.id}_thumb.jpg'
    video_path = os.path.join(out_dir, video_name)
    thumb_path = os.path.join(out_dir, thumb_name)

    subprocess.check_call([
        'ffmpeg', '-v', 'error', '-y', '-i', args.input,
        '-vf', f'crop={crop_w}:{crop_h}:{left}:{top},scale={out_w}:{out_h},fps={OUTPUT_FPS}',
        '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart',
        video_path,
    ])

    key = key_color(frames)
    thumb_time = (best_thumb_index(frames) + 0.5) / len(frames) * duration
    subprocess.check_call([
        'ffmpeg', '-v', 'error', '-y', '-ss', f'{thumb_time:.2f}', '-i', video_path,
        '-filter_complex',
        f'color=c={THUMB_BG}:s={out_w}x{out_h}[bg];'
        # setpts 归零：seek 后首帧时间戳略大于 0，overlay 会先输出一张只有背景的帧；
        # 先转 rgba，否则 despill 会丢掉 chromakey 算出的透明度
        f'[0:v]setpts=PTS-STARTPTS,format=rgba,chromakey={key}:0.18:0.08,despill=type=green:mix=0.6:expand=0.1[fg];'
        f'[bg][fg]overlay=shortest=1:format=auto,scale=256:256:force_original_aspect_ratio=decrease',
        '-frames:v', '1', thumb_path,
    ])

    entry = {
        'id': args.id,
        'name': args.name,
        'type': 'video',
        'file': video_name,
        'thumb': thumb_name,
        'aspect': round(out_w / out_h, 4),
        'width': 0.25,
        'playback': {'mode': 'interval', 'intervalSec': 10, 'jitterSec': 3},
        'chroma': {'enabled': True, 'strength': 0.5},
    }
    print(f'外框（取样分辨率）: {(x0, y0, x1, y1)}，裁剪: {crop_w}x{crop_h}+{left}+{top}，输出: {out_w}x{out_h}，键色: {key}',
          file=sys.stderr)
    print(json.dumps(entry, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
