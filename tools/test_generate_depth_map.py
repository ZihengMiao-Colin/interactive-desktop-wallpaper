"""generate_depth_map.py 深度图后处理的单元测试：
venv/Scripts/python.exe -m unittest tools/test_generate_depth_map.py
"""

import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from generate_depth_map import (  # noqa: E402
    blur_support,
    depth_output_size,
    dilate_max,
    gaussian_blur,
    postprocess_depth,
)


class DepthOutputSizeTest(unittest.TestCase):
    def test_small_image_keeps_size(self):
        self.assertEqual(depth_output_size(1280, 720), (1280, 720))

    def test_landscape_long_side_capped(self):
        self.assertEqual(depth_output_size(3840, 2560), (1920, 1280))

    def test_portrait_long_side_capped(self):
        self.assertEqual(depth_output_size(2000, 4000), (960, 1920))


class DilateMaxTest(unittest.TestCase):
    def test_matches_brute_force(self):
        a = np.random.default_rng(1).random((23, 31), dtype=np.float32)
        for r in (0, 1, 2, 5, 9, 40):
            expected = np.empty_like(a)
            for i in range(a.shape[0]):
                for j in range(a.shape[1]):
                    expected[i, j] = a[max(0, i - r):i + r + 1, max(0, j - r):j + r + 1].max()
            np.testing.assert_array_equal(dilate_max(a, r), expected, err_msg=f'r={r}')


class GaussianBlurTest(unittest.TestCase):
    def test_constant_stays_constant(self):
        a = np.full((30, 40), 0.7, np.float32)
        np.testing.assert_allclose(gaussian_blur(a, 5), a, atol=1e-6)

    def test_zero_sigma_is_identity(self):
        a = np.random.default_rng(2).random((10, 12), dtype=np.float32)
        np.testing.assert_array_equal(gaussian_blur(a, 0), a)

    def test_impulse_spread_matches_sigma(self):
        a = np.zeros((121, 121), np.float32)
        a[60, 60] = 1
        out = gaussian_blur(a, 6)
        self.assertAlmostEqual(float(out.sum()), 1.0, places=4)
        np.testing.assert_allclose(out, out[:, ::-1], atol=1e-7)
        row = out.sum(axis=0)
        x = np.arange(121) - 60
        self.assertAlmostEqual(float(np.sqrt((row * x * x).sum())), 6, delta=0.5)

    def test_support_is_finite(self):
        a = np.zeros((121, 121), np.float32)
        a[60, 60] = 1
        k = blur_support(6)
        out = gaussian_blur(a, 6)
        self.assertGreater(out[60, 60 + k], 0)
        self.assertEqual(out[60, 60 + k + 1], 0)


class PostprocessDepthTest(unittest.TestCase):
    @staticmethod
    def step():
        """左半边近（模型输出值大），右半边远；故意用任意量纲的原始值"""
        raw = np.full((40, 120), 3.0, np.float32)
        raw[:, :60] = 7.0
        return raw

    def test_normalizes_to_full_range_without_smoothing(self):
        out = postprocess_depth(self.step(), (120, 40), 0)
        self.assertEqual(out.dtype, np.uint8)
        self.assertEqual(out.shape, (40, 120))
        self.assertTrue((out[:, :60] == 255).all())
        self.assertTrue((out[:, 60:] == 0).all())

    def test_near_side_untouched_ramp_on_far_side(self):
        out = postprocess_depth(self.step(), (120, 40), 4)
        k = blur_support(4)
        # 主体（近处）一直到轮廓都保持原深度，过渡带整个落在背景一侧
        self.assertTrue((out[:, :60] == 255).all())
        self.assertLess(out[0, 60], 255)
        self.assertTrue((out[:, 60 + 2 * k:] == 0).all())
        self.assertTrue((np.diff(out[0].astype(int)) <= 0).all())

    def test_invert_applies_after_smoothing(self):
        out = postprocess_depth(self.step(), (120, 40), 4)
        inverted = postprocess_depth(self.step(), (120, 40), 4, invert=True)
        np.testing.assert_array_equal(inverted, 255 - out)

    def test_flat_input_gives_black(self):
        out = postprocess_depth(np.full((20, 20), 2.5, np.float32), (20, 20), 4)
        self.assertTrue((out == 0).all())

    def test_resizes_to_requested_size(self):
        raw = np.random.default_rng(3).random((518, 518), dtype=np.float32)
        self.assertEqual(postprocess_depth(raw, (300, 200), 2).shape, (200, 300))


if __name__ == '__main__':
    unittest.main()
