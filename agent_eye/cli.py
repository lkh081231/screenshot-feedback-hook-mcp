"""CLI：`agent-eye capture` 截图存盘，供 Claude Code hook 调用。

hook 只能回传文本，所以这里只输出「绝对路径 + 让 agent 用 Read 读图」
的指令；--hook-output 按事件输出对应的 hook JSON schema（两种事件字段
不同，封装在这里避免用户手拼出错）。
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path

from agent_eye.core import capture, optimize, platform_check


def _default_out() -> Path:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out_dir = Path(tempfile.gettempdir()) / "agent-eye"
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
    print(json.dumps(payload, ensure_ascii=False))


def cmd_capture(args: argparse.Namespace) -> int:
    hook_event = args.hook_output
    if hook_event == "stop":
        # Stop hook 用 block 回传文字会让 Claude 继续跑、再次触发 Stop。
        # Claude Code 以 stop_hook_active 标记二次触发，此时必须放行，否则死循环。
        if _read_hook_stdin().get("stop_hook_active"):
            return 0

    if args.delay > 0:
        time.sleep(args.delay)

    warnings = [w for w in (platform_check.session_warning(),) if w]
    try:
        img = capture.grab(args.monitor)
    except Exception as exc:  # noqa: BLE001 — 截图失败原因五花八门，统一转成可读输出
        msg = f"agent-eye 截图失败：{exc}"
        if warnings:
            msg += " | " + " | ".join(warnings)
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

    message = f"截图已保存到 {out}，请用 Read 工具读取该图片查看实际画面。"
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

    parser = argparse.ArgumentParser(prog="agent-eye", description="给 coding agent 的截图反馈工具")
    sub = parser.add_subparsers(dest="command", required=True)

    p_cap = sub.add_parser("capture", help="截图存盘（hook 用）")
    p_cap.add_argument("--monitor", type=int, default=0, help="0=全部拼接，1..N=单屏（默认 0）")
    p_cap.add_argument("--out", help="输出路径（默认临时目录，带时间戳）")
    p_cap.add_argument("--delay", type=float, default=0.0, help="截图前等待秒数（等页面/EDA 渲染完）")
    p_cap.add_argument("--max-edge", type=int, default=optimize.MAX_EDGE, help="最长边像素上限")
    p_cap.add_argument("--target-kb", type=int, default=optimize.TARGET_BYTES // 1000, help="目标体积 KB")
    p_cap.add_argument(
        "--hook-output",
        choices=["post-tool-use", "stop"],
        help="按 Claude Code hook 事件输出对应 JSON（PostToolUse/Stop schema 不同）",
    )
    p_cap.set_defaults(func=cmd_capture)

    p_mon = sub.add_parser("monitors", help="列出显示器编号")
    p_mon.set_defaults(func=cmd_monitors)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
