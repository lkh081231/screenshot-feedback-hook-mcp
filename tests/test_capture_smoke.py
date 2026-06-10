"""capture 冒烟测试：有显示环境才跑，headless CI 自动跳过。"""

import pytest

from agent_eye.core import capture


def _has_display() -> bool:
    try:
        return len(capture.list_monitors()) > 0
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not _has_display(), reason="无显示环境(headless)")


def test_list_monitors_has_combined_entry():
    monitors = capture.list_monitors()
    assert monitors[0].index == 0
    assert monitors[0].width > 0


def test_grab_returns_rgb_image():
    img = capture.grab(0)
    assert img.mode == "RGB"
    assert img.width > 0 and img.height > 0


def test_grab_invalid_monitor_raises():
    with pytest.raises(ValueError, match="monitor=99"):
        capture.grab(99)
