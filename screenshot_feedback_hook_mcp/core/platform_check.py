"""跨平台运行环境检测：在截图注定失败/异常前给出人类可读的提示。

只产出警告字符串，不阻断流程——调用方（CLI 打到 stderr，MCP 附在
工具说明里）自行决定怎么呈现。
"""

from __future__ import annotations

import os
import sys

from PIL import Image

MACOS_PERMISSION_HINT = (
    "macOS 截图疑似未授权：画面接近纯色（黑屏/壁纸是典型症状）。"
    "请在「系统设置 → 隐私与安全性 → 屏幕录制」中勾选运行本工具的终端/IDE，"
    "然后完全退出并重启该应用。"
)

WAYLAND_HINT = (
    "检测到 Wayland 会话：mss 依赖 X11，纯 Wayland 下可能截到黑屏或报错。"
    "可改用 XWayland/X11 会话，或等待 roadmap 中的 grim/portal 后端。"
)


def session_warning() -> str | None:
    """启动期检测：返回与当前桌面会话相关的警告，没有则为 None。"""
    if sys.platform.startswith("linux") and os.environ.get("XDG_SESSION_TYPE", "").lower() == "wayland":
        return WAYLAND_HINT
    return None


def capture_warning(img: Image.Image) -> str | None:
    """截图后检测：画面接近纯色时提示可能的权限问题（macOS 典型）。"""
    if sys.platform != "darwin":
        return None
    # 缩到 16x16 看灰度极差，纯黑/纯壁纸色块的极差极小
    probe = img.convert("L").resize((16, 16))
    lo, hi = probe.getextrema()
    if hi - lo < 8:
        return MACOS_PERMISSION_HINT
    return None
