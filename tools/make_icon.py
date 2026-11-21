# -*- coding: utf-8 -*-
"""生成软件图标（Kirie 的 K 字图标）。

图标是黑底上三个往右下错开的 K，从远到近：深青、青、白。
16 到 256 每个尺寸各有一套整数参数，单独画（不是从大图缩小）：斜笔严格 45 度、顶点都落在整像素上，
抗锯齿后边缘是整齐的半格台阶，小尺寸也清楚。

生成的文件（都在 assets/ 下）：
  icon.ico     九个尺寸，安装包、exe、任务栏、托盘用；Windows 按屏幕缩放自己挑
  icon.png     256px
  icon.svg     256 那套参数的矢量版
  icon-20.svg  20 那套参数的矢量版，设置窗口标题栏左上角用

用法：venv/Scripts/python.exe tools/make_icon.py [输出目录]（不给目录就写到仓库的 assets/）
改了下面的颜色或参数要重新跑一遍，tools/test_make_icon.py 会检查 assets/ 里的文件是不是最新的。
"""

import os
import sys

from PIL import Image, ImageDraw

TILE = '0f0f10'                               # 底色
LAYERS = ['0d5a6e', '18d1ff', 'ffffff']       # 三层 K，从远到近

# 每个尺寸一套参数：H 高、W 宽、S 竖笔宽、A 斜笔的水平宽度（约 S×1.41，斜笔和竖笔看起来一样粗）、o 每层错开
K_GRID = {
    16: dict(H=12, W=10, S=3, A=4, o=1),
    20: dict(H=14, W=13, S=4, A=6, o=1),
    24: dict(H=16, W=14, S=5, A=7, o=2),
    32: dict(H=22, W=20, S=7, A=9, o=2),
    40: dict(H=28, W=24, S=8, A=11, o=3),
    48: dict(H=34, W=30, S=10, A=13, o=3),
    64: dict(H=46, W=38, S=12, A=18, o=4),
    128: dict(H=92, W=76, S=25, A=35, o=7),
    256: dict(H=184, W=150, S=50, A=70, o=14),
}
SIZES = sorted(K_GRID)


def _rgb(hex6):
    return tuple(int(hex6[i:i + 2], 16) for i in (0, 2, 4))


def origin(g):
    """最前面那层 K 的左上角：三层整体（K 加两次错开）在方块里居中。"""
    p = K_GRID[g]
    span_w = p['W'] + 2 * p['o']
    span_h = p['H'] + 2 * p['o']
    return int((g - span_w) / 2 + 0.5), int((g - span_h) / 2 + 0.5)


def k_polys(x, y, H, W, S, A):
    """K 的三个多边形：竖笔、上斜笔、下斜笔（两笔斜笔都是 45 度）。"""
    stem = [(x, y), (x + S, y), (x + S, y + H), (x, y + H)]
    upper = [(x + W - A, y), (x + W, y), (x + S, y + W - S), (x + S, y + W - A - S)]
    lower = [(x, y + H / 2), (x + W - H / 2, y + H / 2), (x + W, y + H), (x + W - A, y + H),
             (x, y + H - (W - A))]
    return [stem, upper, lower]


def _layers(g):
    """[(颜色, 多边形列表)]，从远到近。"""
    p = K_GRID[g]
    x0, y0 = origin(g)
    out = []
    for i, color in enumerate(LAYERS):
        d = (len(LAYERS) - 1 - i) * p['o']       # 越远错开得越多
        out.append((color, k_polys(x0 + d, y0 + d, p['H'], p['W'], p['S'], p['A'])))
    return out


def render(g):
    """按 g 这套参数画 g×g 的图（RGBA）：先超采样画大图，再用 BOX 缩小，等于按面积算抗锯齿。"""
    ss = max(4, 1024 // g)
    n = g * ss
    img = Image.new('RGB', (n, n), _rgb(TILE))
    for color, polys in _layers(g):
        mask = Image.new('L', (n, n), 0)
        draw = ImageDraw.Draw(mask)
        for poly in polys:
            draw.polygon([(px * ss, py * ss) for px, py in poly], fill=255)
        img.paste(_rgb(color), (0, 0, n, n), mask)
    return img.resize((g, g), Image.BOX).convert('RGBA')


def to_svg(g):
    """g 这套参数的矢量版。K 没有洞，每层一个 path 就够了。"""
    def num(v):
        return f'{v:g}'

    lines = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {g} {g}" width="{g}" height="{g}">',
             f'<rect width="{g}" height="{g}" fill="#{TILE}"/>']
    for color, polys in _layers(g):
        d = ' '.join('M' + ' L'.join(f'{num(px)} {num(py)}' for px, py in poly) + ' Z' for poly in polys)
        lines.append(f'<path fill="#{color}" d="{d}"/>')
    lines.append('</svg>')
    return '\n'.join(lines) + '\n'


def build(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    # 每个尺寸都放自己画的那张；存成 BMP 帧（NSIS 打包时读不了 PNG 压缩的图标帧）
    render(256).save(os.path.join(out_dir, 'icon.ico'), format='ICO',
                     sizes=[(s, s) for s in SIZES],
                     append_images=[render(s) for s in SIZES if s != 256],
                     bitmap_format='bmp')
    render(256).save(os.path.join(out_dir, 'icon.png'))
    for name, g in (('icon.svg', 256), ('icon-20.svg', 20)):
        with open(os.path.join(out_dir, name), 'w', encoding='utf-8', newline='\n') as f:
            f.write(to_svg(g))


if __name__ == '__main__':
    default = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'assets')
    target = sys.argv[1] if len(sys.argv) > 1 else default
    build(target)
    print('已生成到', target)
