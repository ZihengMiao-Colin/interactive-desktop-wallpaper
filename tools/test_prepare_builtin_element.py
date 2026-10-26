"""prepare_builtin_element.py 的单元测试：venv/Scripts/python.exe -m unittest tools/test_prepare_builtin_element.py"""

import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from prepare_builtin_element import best_thumb_index, nongreen_bbox  # noqa: E402

GREEN = (10, 230, 10)
RED = (220, 40, 30)


def green_frame(h=60, w=80):
    frame = np.zeros((h, w, 3), dtype=np.uint8)
    frame[:, :] = GREEN
    return frame


class NongreenBboxTest(unittest.TestCase):
    def test_single_block(self):
        f = green_frame()
        f[10:20, 30:50] = RED
        self.assertEqual(nongreen_bbox([f]), (30, 10, 50, 20))

    def test_union_of_frames(self):
        a = green_frame()
        a[10:20, 30:50] = RED
        b = green_frame()
        b[40:50, 5:15] = RED
        self.assertEqual(nongreen_bbox([a, b]), (5, 10, 50, 50))

    def test_isolated_noise_pixels_ignored(self):
        f = green_frame()
        f[10:20, 30:50] = RED
        f[55, 75] = RED   # 压缩噪点
        self.assertEqual(nongreen_bbox([f]), (30, 10, 50, 20))

    def test_mostly_non_green_frames_skipped(self):
        f = green_frame()
        f[10:20, 30:50] = RED
        black = np.zeros_like(f)   # 淡出到黑场的帧不应把外框撑满整幅画面
        self.assertEqual(nongreen_bbox([f, black]), (30, 10, 50, 20))

    def test_all_green_raises(self):
        with self.assertRaises(ValueError):
            nongreen_bbox([green_frame()])


class BestThumbIndexTest(unittest.TestCase):
    def test_picks_brightest_subject(self):
        dark = green_frame()
        dark[10:40, 10:60] = (40, 40, 40)      # 大片暗烟
        bright = green_frame()
        bright[20:35, 20:45] = (255, 180, 60)  # 较小但明亮的火光
        empty = green_frame()
        self.assertEqual(best_thumb_index([empty, dark, bright, empty]), 2)


if __name__ == '__main__':
    unittest.main()
