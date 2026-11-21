# -*- coding: utf-8 -*-
"""make_icon.py 的单元测试：venv/Scripts/python.exe -m unittest tools/test_make_icon.py"""

import os
import shutil
import sys
import tempfile
import unittest

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_icon  # noqa: E402

ASSETS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'assets')
TILE = (15, 15, 16, 255)                         # #0f0f10
COLORS = ('#0f0f10', '#0d5a6e', '#18d1ff', '#ffffff')
WHITE = (255, 255, 255, 255)


def ico_frames(path):
    """读出 .ico 里的每一帧，按尺寸存成 RGBA 字节，方便逐像素比较。"""
    with Image.open(path) as ico:
        return {size: ico.ico.getimage(size).convert('RGBA').tobytes() for size in ico.ico.sizes()}


def png_bytes(path):
    with Image.open(path) as im:
        return im.size, im.convert('RGBA').tobytes()


class MakeIconTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        make_icon.build(cls.tmp)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_ico_has_all_sizes(self):
        frames = ico_frames(os.path.join(self.tmp, 'icon.ico'))
        self.assertEqual(set(frames), {(s, s) for s in [16, 20, 24, 32, 40, 48, 64, 128, 256]})

    def test_each_ico_frame_is_hand_drawn(self):
        # 每一帧都要和按这个尺寸自己的参数画出来的图逐像素相同，不能是从 256 缩下来的
        frames = ico_frames(os.path.join(self.tmp, 'icon.ico'))
        for s in make_icon.SIZES:
            with self.subTest(size=s):
                self.assertEqual(frames[(s, s)], make_icon.render(s).tobytes())

    def test_corners_are_tile_color(self):
        for s in make_icon.SIZES:
            im = make_icon.render(s)
            for xy in ((0, 0), (s - 1, 0), (0, s - 1), (s - 1, s - 1)):
                with self.subTest(size=s, xy=xy):
                    self.assertEqual(im.getpixel(xy), TILE)

    def test_front_k_stem_is_white(self):
        # 最前面那层 K 的竖笔正中间是纯白（位置对、颜色对、没有被后面的层盖住）
        for s in make_icon.SIZES:
            x0, y0 = make_icon.origin(s)
            p = make_icon.K_GRID[s]
            with self.subTest(size=s):
                self.assertEqual(make_icon.render(s).getpixel((x0 + p['S'] // 2, y0 + p['H'] // 2)), WHITE)

    def test_png_is_256(self):
        size, data = png_bytes(os.path.join(self.tmp, 'icon.png'))
        self.assertEqual(size, (256, 256))
        self.assertEqual(data, make_icon.render(256).tobytes())

    def test_svgs(self):
        for name, g in (('icon.svg', 256), ('icon-20.svg', 20)):
            with open(os.path.join(self.tmp, name), encoding='utf-8') as f:
                text = f.read()
            with self.subTest(name=name):
                self.assertIn(f'viewBox="0 0 {g} {g}"', text)
                for c in COLORS:
                    self.assertIn(c, text)

    def test_assets_up_to_date(self):
        # 改了脚本却忘了重新生成时，这里会失败：重新跑 venv/Scripts/python.exe tools/make_icon.py
        for name in ('icon.svg', 'icon-20.svg'):
            with open(os.path.join(ASSETS, name), encoding='utf-8') as a, \
                    open(os.path.join(self.tmp, name), encoding='utf-8') as b:
                self.assertEqual(a.read(), b.read(), name)
        self.assertEqual(png_bytes(os.path.join(ASSETS, 'icon.png')),
                         png_bytes(os.path.join(self.tmp, 'icon.png')), 'icon.png')
        self.assertEqual(ico_frames(os.path.join(ASSETS, 'icon.ico')),
                         ico_frames(os.path.join(self.tmp, 'icon.ico')), 'icon.ico')


if __name__ == '__main__':
    unittest.main()
