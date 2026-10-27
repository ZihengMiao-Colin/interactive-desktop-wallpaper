"""prepare_wallpapers.py 的单元测试：venv/Scripts/python.exe -m unittest tools/test_prepare_wallpapers.py"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from prepare_wallpapers import cover_crop_box, fit_width  # noqa: E402


class FitWidthTest(unittest.TestCase):
    def test_small_image_unchanged(self):
        self.assertEqual(fit_width(1920, 1280, 3840), (1920, 1280))

    def test_large_image_scaled_keeping_ratio(self):
        self.assertEqual(fit_width(7952, 5304, 3840), (3840, 2561))

    def test_exact_width_unchanged(self):
        self.assertEqual(fit_width(3840, 2160, 3840), (3840, 2160))


class CoverCropBoxTest(unittest.TestCase):
    def test_wider_source_crops_left_and_right(self):
        # 2:1 的图裁成 16:10：保留全部高度，左右各裁一些
        self.assertEqual(cover_crop_box(2000, 1000, 16, 10), (200, 0, 1800, 1000))

    def test_taller_source_crops_top_and_bottom(self):
        self.assertEqual(cover_crop_box(1600, 1600, 16, 10), (0, 300, 1600, 1300))

    def test_same_ratio_keeps_everything(self):
        self.assertEqual(cover_crop_box(1920, 1200, 16, 10), (0, 0, 1920, 1200))


if __name__ == '__main__':
    unittest.main()
