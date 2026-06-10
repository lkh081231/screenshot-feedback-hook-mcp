"""hook JSON schema 正确性——写错字段 Claude Code 会静默忽略，必须测住。"""

import json

from agent_eye import cli


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
    import argparse

    monkeypatch.setattr(cli, "_read_hook_stdin", lambda: {"stop_hook_active": True})
    ns = argparse.Namespace(
        monitor=0, out=None, delay=0.0, max_edge=1568, target_kb=80, hook_output="stop"
    )
    assert cli.cmd_capture(ns) == 0
    assert capsys.readouterr().out == ""
