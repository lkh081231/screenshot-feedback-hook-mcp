"""MCP server：agent 主动调用、直接拿到原生图片块。

跨 MCP 客户端通用（Claude Code / Cursor / Cline / Windsurf...）。
图片经 optimize 压到字节预算内，避开 Claude Code 对 MCP 输出的
~25k token 上限（按 base64 长度计，claude-code#9152）。
"""

from __future__ import annotations

import sys

from mcp.server.fastmcp import FastMCP, Image

from agent_eye.core import capture, optimize, platform_check

mcp = FastMCP("agent-eye")


@mcp.tool()
def take_screenshot(monitor: int = 0) -> Image:
    """截取屏幕并返回图片，用于查看自己刚产出的真实画面（前端页面、EDA/CAD 图等）。

    Args:
        monitor: 0=所有显示器拼接（默认），1..N=指定单个显示器。
            不确定编号时先调 list_monitors。
    """
    img = capture.grab(monitor)
    if warning := platform_check.capture_warning(img):
        # 疑似权限问题时图片没有信息量，回传文字提示更有用
        raise RuntimeError(warning)
    data = optimize.optimize(img)
    return Image(data=data, format="jpeg")


@mcp.tool()
def list_monitors() -> str:
    """列出可用显示器编号与分辨率，供 take_screenshot 选择 monitor 参数。"""
    lines = [mon.label for mon in capture.list_monitors()]
    if warning := platform_check.session_warning():
        lines.append(f"⚠ {warning}")
    return "\n".join(lines)


def main() -> None:
    if warning := platform_check.session_warning():
        print(f"agent-eye-mcp: {warning}", file=sys.stderr)
    mcp.run()


if __name__ == "__main__":
    main()
