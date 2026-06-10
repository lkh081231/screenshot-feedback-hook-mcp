"""optimize 的字节预算逻辑——本项目最关键的单测。"""

from io import BytesIO

import pytest
from PIL import Image

from agent_eye.core import optimize


def _noise_image(width: int, height: int) -> Image.Image:
    """伪随机噪点图：JPEG 最难压的内容，逼出预算逻辑的最坏情况。"""
    data = bytes((x * 7 + y * 13 + (x * y) % 251) % 256 for y in range(height) for x in range(width))
    return Image.merge(
        "RGB",
        [Image.frombytes("L", (width, height), data)] * 3,
    )


def test_large_noise_image_fits_budget():
    img = _noise_image(2000, 1200)
    data = optimize.optimize(img)
    assert len(data) <= optimize.TARGET_BYTES
    decoded = Image.open(BytesIO(data))
    assert decoded.format == "JPEG"
    assert max(decoded.size) <= optimize.MAX_EDGE


def test_downscale_caps_longest_edge():
    img = Image.new("RGB", (4000, 1000))
    out = optimize.downscale(img)
    assert max(out.size) == optimize.MAX_EDGE
    # 等比：纵横比保持
    assert abs(out.width / out.height - 4.0) < 0.05


def test_small_image_not_upscaled():
    img = Image.new("RGB", (640, 480))
    assert optimize.downscale(img).size == (640, 480)


def test_custom_budget_respected():
    img = _noise_image(1600, 1000)
    data = optimize.optimize(img, target_bytes=30_000)
    assert len(data) <= 30_000


def test_impossible_budget_returns_best_effort():
    """预算小到不可能达成时返回当前最小结果而不是抛错/死循环。"""
    img = _noise_image(1600, 1000)
    data = optimize.optimize(img, target_bytes=1)
    assert isinstance(data, bytes) and len(data) > 0


@pytest.mark.parametrize("size", [(100, 100), (1568, 1568)])
def test_output_always_jpeg(size):
    data = optimize.optimize(Image.new("RGB", size, "white"))
    assert data[:2] == b"\xff\xd8"  # JPEG magic
