"""截图核心：mss 抓帧 → PIL Image。

约定：monitor=0 = 所有显示器拼接的虚拟屏，1..N = 单个显示器（与 mss 的
monitors 索引语义一致）。
"""

from __future__ import annotations

from dataclasses import dataclass

import mss
from PIL import Image


@dataclass
class MonitorInfo:
    index: int
    left: int
    top: int
    width: int
    height: int

    @property
    def label(self) -> str:
        scope = "全部显示器拼接 (all monitors combined)" if self.index == 0 else f"显示器 {self.index}"
        return f"[{self.index}] {scope}: {self.width}x{self.height} @ ({self.left},{self.top})"


def list_monitors() -> list[MonitorInfo]:
    """列举可用显示器。index 0 为全部拼接，1..N 为单屏。"""
    with mss.MSS() as sct:
        return [
            MonitorInfo(index=i, left=m["left"], top=m["top"], width=m["width"], height=m["height"])
            for i, m in enumerate(sct.monitors)
        ]


def grab(monitor: int = 0) -> Image.Image:
    """抓取指定显示器，返回 RGB 的 PIL Image。

    monitor 越界时抛 ValueError，附带可用编号提示。
    """
    with mss.MSS() as sct:
        monitors = sct.monitors
        if not 0 <= monitor < len(monitors):
            raise ValueError(
                f"monitor={monitor} 不存在，可用范围 0..{len(monitors) - 1}"
                f"（0=全部拼接，1..{len(monitors) - 1}=单屏）"
            )
        shot = sct.grab(monitors[monitor])
        return Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")
