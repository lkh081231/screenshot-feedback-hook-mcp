# agent-eye 👁

**让 coding agent 看到自己产出的真实画面** —— 跨平台截图反馈工具（MCP server + Claude Code hook 双层）。

Let your coding agent **see what it builds**: a cross-platform (Windows / Linux / macOS) screenshot-feedback tool for AI agents, shipped as an MCP server plus a Claude Code hook helper.

## 为什么需要它 / Why

Agent 写前端、画 EasyEDA/CAD 工程图时，没有视觉反馈就只能猜。给它一个「截图 → 看图 → 自我纠正」的回路，产出质量立刻不一样。

技术现实：Claude Code 的 **hook 只能回传文本**，而 **MCP 工具可以回传原生图片**。所以 agent-eye 做成双层：

| 层 | 触发方式 | 图片如何进入 agent 视野 |
|---|---|---|
| **MCP server** | agent 主动调用 `take_screenshot` | 工具直接返回原生图片块（跨 MCP 客户端通用） |
| **Claude Code hook** | 某操作后自动触发 | hook 回传截图的绝对路径，agent 用 Read 工具读图 |

图片默认降采样（最长边 1568px）并按**字节预算**（~80KB）迭代压缩 JPEG，避开 Claude Code 对 MCP 输出 ~25k token 的限制。

## 安装 / Install

零安装运行（需要 [uv](https://docs.astral.sh/uv/)）：

```bash
# MCP server（包名同名入口，零参数直接起）
uvx screenshot-feedback-hook-mcp

# CLI 截图（uvx 按包名解析，CLI 入口要加 --from）
uvx --from screenshot-feedback-hook-mcp agent-eye capture --monitor 0 --out shot.jpg
```

或常驻安装：`pipx install screenshot-feedback-hook-mcp` / `uv tool install screenshot-feedback-hook-mcp`（之后直接用 `agent-eye` / `agent-eye-mcp` 命令）。

## 接入 MCP（推荐起点）

Claude Code 一行：

```bash
claude mcp add agent-eye -- uvx screenshot-feedback-hook-mcp
```

或任意 MCP 客户端（Cursor / Cline / Windsurf...）的 mcp.json：

```json
{
  "mcpServers": {
    "agent-eye": {
      "command": "uvx",
      "args": ["screenshot-feedback-hook-mcp"]
    }
  }
}
```

工具：
- `take_screenshot(monitor=0)` —— 截屏，直接返回图片。0=全部显示器拼接，1..N=单屏。
- `list_monitors()` —— 列出显示器编号/分辨率。

## 接入 Claude Code hook（操作后自动截图）

把样例（见 [examples/](examples/)）复制进项目 `.claude/settings.json`。例如「每次 Claude 停下来时自动截图给它看」：

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "uvx --from screenshot-feedback-hook-mcp agent-eye capture --delay 1 --hook-output stop"
          }
        ]
      }
    ]
  }
}
```

CLI 会输出正确的 hook JSON（Stop 用 `decision:block` 回传文字并自动处理 `stop_hook_active` 防死循环；PostToolUse 用 `hookSpecificOutput.additionalContext`），agent 看到「截图已保存到 …，请用 Read 工具读取」后会读图。

常用参数：`--monitor N`、`--delay 秒`（等渲染完）、`--max-edge 像素`、`--target-kb 体积`。

## 平台注意事项 / Platform notes

- **Windows**：开箱即用。
- **macOS**：首次使用需在「系统设置 → 隐私与安全性 → 屏幕录制」勾选运行 agent 的终端/IDE 并重启该应用，否则截到黑屏/壁纸（工具会检测并提示）。
- **Linux**：X11 开箱即用；**纯 Wayland 下 mss 受限**，工具启动时会探测并提示（grim/portal 后端在 roadmap）。

## Roadmap

- [ ] 区域截图（`--region x,y,w,h`）
- [ ] 按窗口标题截图（Win EnumWindows / mac CGWindowList / Linux wmctrl）
- [ ] URL / 无头浏览器模式（前端确定性截图）
- [ ] Wayland 后端（grim / xdg-desktop-portal）

## 开发 / Development

```bash
uv sync           # 安装依赖
uv run pytest     # 测试
uv run agent-eye capture --out shot.jpg
uv run agent-eye-mcp
```

MIT License.
