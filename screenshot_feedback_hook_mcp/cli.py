"""CLI：`screenshot-feedback-hook-mcp capture` 截图存盘，供 Claude Code hook 调用。

hook 只能回传文本，所以这里只输出「绝对路径 + 让 agent 用读图工具读图」
的指令；--hook-output 按事件输出对应的 hook JSON schema（两种事件字段
不同，封装在这里避免用户手拼出错）。读图工具名各宿主不同（Claude Code
是 Read，DeepSeek Harness 是 read_image），用 --image-tool 指定。

--json 供程序化调用方（dsh 原生插件）使用：只吐结构化结果，不吐给人看
的中文提示，也不用退出码表达业务失败。

入口 entry() 同时承担 MCP server：不带子命令时直接以 MCP server 运行，
这样 `uvx screenshot-feedback-hook-mcp` 即 MCP、加子命令即 CLI，单一
包名覆盖两种用法。
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
import time
from datetime import datetime
from io import BytesIO
from pathlib import Path

from PIL import Image

from screenshot_feedback_hook_mcp.core import capture, optimize, platform_check


def _default_out() -> Path:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out_dir = Path(tempfile.gettempdir()) / "screenshot-feedback-hook-mcp"
    out_dir.mkdir(parents=True, exist_ok=True)
    return out_dir / f"shot-{stamp}.jpg"


def _read_hook_stdin() -> dict:
    """hook 模式下 Claude Code 会从 stdin 喂事件 JSON；非 hook 场景可能为空。"""
    if sys.stdin.isatty():
        return {}
    try:
        # Claude Code 喂的是 UTF-8 JSON，而 Windows 管道默认按本地代码页(GBK)解码
        # 会整体乱码；utf-8-sig 同时吞掉 PowerShell 可能加的 BOM
        if hasattr(sys.stdin, "reconfigure"):
            sys.stdin.reconfigure(encoding="utf-8-sig")
        raw = sys.stdin.read()
        return json.loads(raw) if raw.strip() else {}
    except (json.JSONDecodeError, OSError, ValueError):
        return {}


def _emit_json(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False))


def _emit_hook_json(event: str, message: str) -> None:
    if event == "post-tool-use":
        payload = {
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "additionalContext": message,
            }
        }
    else:  # stop：没有 additionalContext 字段，用 block+reason 让 Claude 继续并看到文字
        payload = {"decision": "block", "reason": message}
    _emit_json(payload)


def cmd_capture(args: argparse.Namespace) -> int:
    hook_event = args.hook_output
    if hook_event == "stop":
        # Stop hook 用 block 回传文字会让 Claude 继续跑、再次触发 Stop。
        # Claude Code 以 stop_hook_active 标记二次触发，此时必须放行，否则死循环。
        # 注意：dsh 的 CC hook 桥接恒为 false，那边的防循环由 dsh 插件按 turn 去重。
        if _read_hook_stdin().get("stop_hook_active"):
            return 0

    if args.delay > 0:
        time.sleep(args.delay)

    warnings = [w for w in (platform_check.session_warning(),) if w]
    try:
        img = capture.grab(args.monitor)
    except Exception as exc:  # noqa: BLE001 — 截图失败原因五花八门，统一转成可读输出
        msg = f"screenshot-feedback-hook-mcp 截图失败：{exc}"
        if warnings:
            msg += " | " + " | ".join(warnings)
        if args.json_out:
            # 程序化调用方自己决定怎么呈现，失败不走退出码
            _emit_json({"error": msg, "warnings": warnings})
            return 0
        if hook_event:
            _emit_hook_json(hook_event, msg)
            return 0  # hook 模式下不以非零退出，避免干扰 agent 主流程
        print(msg, file=sys.stderr)
        return 1

    if w := platform_check.capture_warning(img):
        warnings.append(w)

    data = optimize.optimize(img, max_edge=args.max_edge, target_bytes=args.target_kb * 1000)
    out = Path(args.out).expanduser().resolve() if args.out else _default_out()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(data)

    if args.json_out:
        with Image.open(BytesIO(data)) as final:
            width, height = final.size
        _emit_json(
            {
                "path": str(out),
                "bytes": len(data),
                "width": width,
                "height": height,
                "format": "jpeg",
                "warnings": warnings,
            }
        )
        return 0

    message = f"截图已保存到 {out}，请用 {args.image_tool} 工具读取该图片查看实际画面。"
    if warnings:
        message += " 注意：" + " ".join(warnings)

    if hook_event:
        _emit_hook_json(hook_event, message)
    else:
        print(out)
        for w in warnings:
            print(w, file=sys.stderr)
    return 0


def cmd_monitors(_: argparse.Namespace) -> int:
    for mon in capture.list_monitors():
        print(mon.label)
    return 0


def main(argv: list[str] | None = None) -> int:
    # Windows 控制台默认 GBK，而 hook JSON 的消费方（Claude Code）按 UTF-8 读
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(
        prog="screenshot-feedback-hook-mcp", description="给 coding agent 的截图反馈工具"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_cap = sub.add_parser("capture", help="截图存盘（hook 用）")
    p_cap.add_argument("--monitor", type=int, default=0, help="0=全部拼接，1..N=单屏（默认 0）")
    p_cap.add_argument("--out", help="输出路径（默认临时目录，带时间戳）")
    p_cap.add_argument("--delay", type=float, default=0.0, help="截图前等待秒数（等页面/EDA 渲染完）")
    p_cap.add_argument("--max-edge", type=int, default=optimize.MAX_EDGE, help="最长边像素上限")
    p_cap.add_argument("--target-kb", type=int, default=optimize.TARGET_BYTES // 1000, help="目标体积 KB")
    p_cap.add_argument(
        "--image-tool",
        default="Read",
        help="提示 agent 用哪个工具读图（Claude Code: Read，DeepSeek Harness: read_image）",
    )
    out_mode = p_cap.add_mutually_exclusive_group()
    out_mode.add_argument(
        "--hook-output",
        choices=["post-tool-use", "stop"],
        help="按 Claude Code hook 事件输出对应 JSON（PostToolUse/Stop schema 不同）",
    )
    out_mode.add_argument(
        "--json",
        dest="json_out",
        action="store_true",
        help="输出结构化 JSON（供 dsh 插件等程序化调用方使用）",
    )
    p_cap.set_defaults(func=cmd_capture)

    p_mon = sub.add_parser("monitors", help="列出显示器编号")
    p_mon.set_defaults(func=cmd_monitors)

    args = parser.parse_args(argv)
    return args.func(args)


def entry() -> int:
    """统一入口：不带参数 = MCP server，带子命令 = CLI。"""
    if len(sys.argv) <= 1:
        from screenshot_feedback_hook_mcp.server import main as server_main

        server_main()
        return 0
    return main()


if __name__ == "__main__":
    sys.exit(entry())
