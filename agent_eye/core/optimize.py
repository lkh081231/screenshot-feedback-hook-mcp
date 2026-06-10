"""图片优化：字节预算导向的降采样 + JPEG 压缩。

为什么按字节而不是只按分辨率：Claude Code 对 MCP 工具输出有 ~25k token
上限，且按 base64 文本长度计（≈70–100KB 二进制，claude-code#9152）。
只控制最长边 1568px 时，复杂画面的 JPEG 仍可能 100–300KB，照样超限。
策略：先降到 max_edge，再逐级降 JPEG 质量；仍超预算则按 0.8 比例继续
缩小尺寸重试。
"""

from __future__ import annotations

from io import BytesIO

from PIL import Image

MAX_EDGE = 1568  # Claude 视觉建议的最长边
TARGET_BYTES = 80_000  # 默认字节预算，留出 base64 膨胀(4/3)后仍 < 25k token 的余量
_QUALITY_STEPS = (85, 75, 65, 55, 45, 35, 25)
_MIN_EDGE = 480  # 再小就失去「看清画面」的意义


def downscale(img: Image.Image, max_edge: int = MAX_EDGE) -> Image.Image:
    """最长边超过 max_edge 时等比缩小，否则原样返回。"""
    longest = max(img.size)
    if longest <= max_edge:
        return img
    scale = max_edge / longest
    new_size = (max(1, round(img.width * scale)), max(1, round(img.height * scale)))
    return img.resize(new_size, Image.LANCZOS)


def to_jpeg(img: Image.Image, quality: int) -> bytes:
    buf = BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=quality, optimize=True)
    return buf.getvalue()


def optimize(
    img: Image.Image,
    max_edge: int = MAX_EDGE,
    target_bytes: int = TARGET_BYTES,
) -> bytes:
    """压缩到 ≤ target_bytes 的 JPEG bytes。

    无法在 _MIN_EDGE 内达标时，返回当前能做到的最小结果（不抛错——
    给 agent 一张略大的图好过没有图）。
    """
    current = downscale(img, max_edge)
    best: bytes | None = None
    while True:
        for quality in _QUALITY_STEPS:
            data = to_jpeg(current, quality)
            if best is None or len(data) < len(best):
                best = data
            if len(data) <= target_bytes:
                return data
        if max(current.size) <= _MIN_EDGE:
            return best
        current = downscale(current, int(max(current.size) * 0.8))
