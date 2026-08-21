"""hook JSON / --json schema 正确性——写错字段消费方会静默忽略，必须测住。"""

import argparse
import json

from PIL import Image

from screenshot_feedback_hook_mcp import cli


def _args(**overrides):
    """cmd_capture 需要的完整 Namespace，测试只覆盖关心的字段。"""
    base = dict(
        monitor=0,
        out=None,
        delay=0.0,
        max_edge=1568,
        target_kb=80,
        image_tool="Read",
        hook_output=None,
        json_out=False,
    )
    base.update(overrides)
    return argparse.Namespace(**base)


def _fake_image(width=200, height=120):
    # 渐变而非纯色：纯色会触发 macOS 权限告警启发式
    img = Image.new("RGB", (width, height))
    img.putdata([(x % 256, y % 256, (x + y) % 256) for y in range(height) for x in range(width)])
    return img


def test_post_tool_use_schema(capsys):
    cli._emit_hook_json("post-tool-use", "msg")
    payload = json.loads(capsys.readouterr().out)
    assert payload == {
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": "msg",
        }
    }


def test_stop_schema_uses_block(capsys):
    cli._emit_hook_json("stop", "msg")
    payload = json.loads(capsys.readouterr().out)
    assert payload == {"decision": "block", "reason": "msg"}
    assert "additionalContext" not in json.dumps(payload)  # Stop 没有这个字段


def test_stop_hook_active_guard(monkeypatch, capsys):
    """二次触发(stop_hook_active=true)必须放行，否则死循环。"""
    monkeypatch.setattr(cli, "_read_hook_stdin", lambda: {"stop_hook_active": True})
    assert cli.cmd_capture(_args(hook_output="stop")) == 0
    assert capsys.readouterr().out == ""


def test_image_tool_name_lands_in_hook_message(monkeypatch, capsys, tmp_path):
    """dsh 的读图工具叫 read_image，指错工具名 agent 就会去调一个不存在的工具。"""
    monkeypatch.setattr(cli.capture, "grab", lambda monitor: _fake_image())
    out = tmp_path / "shot.jpg"
    rc = cli.cmd_capture(
        _args(out=str(out), hook_output="post-tool-use", image_tool="read_image")
    )
    assert rc == 0
    context = json.loads(capsys.readouterr().out)["hookSpecificOutput"]["additionalContext"]
    assert "read_image" in context
    assert "Read 工具" not in context


def test_json_output_schema(monkeypatch, capsys, tmp_path):
    monkeypatch.setattr(cli.capture, "grab", lambda monitor: _fake_image())
    out = tmp_path / "shot.jpg"
    assert cli.cmd_capture(_args(out=str(out), json_out=True)) == 0
    payload = json.loads(capsys.readouterr().out)
    assert set(payload) == {"path", "bytes", "width", "height", "format", "warnings"}
    assert payload["path"] == str(out.resolve())
    assert payload["format"] == "jpeg"
    assert payload["bytes"] == out.stat().st_size
    assert (payload["width"], payload["height"]) == (200, 120)
    assert payload["warnings"] == []


def test_json_output_reports_failure_without_nonzero_exit(monkeypatch, capsys):
    """程序化调用方靠 error 字段判失败；非零退出会被 dsh 当成基础设施故障。"""

    def boom(monitor):
        raise RuntimeError("no display")

    monkeypatch.setattr(cli.capture, "grab", boom)
    assert cli.cmd_capture(_args(json_out=True)) == 0
    payload = json.loads(capsys.readouterr().out)
    assert "no display" in payload["error"]
    assert "path" not in payload


def test_json_and_hook_output_are_mutually_exclusive(capsys):
    try:
        cli.main(["capture", "--json", "--hook-output", "stop"])
    except SystemExit as exc:
        assert exc.code == 2
    else:  # pragma: no cover - argparse 必然 SystemExit
        raise AssertionError("--json 与 --hook-output 应当互斥")
