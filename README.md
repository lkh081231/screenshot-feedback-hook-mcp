# screenshot-feedback-hook-mcp 👁

**中文** | [English](README.en.md)

**让 coding agent 看到自己产出的真实画面** —— 跨平台截图反馈工具（MCP server + Claude Code hook 双层）。

Let your coding agent **see what it builds**: a cross-platform (Windows / Linux / macOS) screenshot-feedback tool for AI agents, shipped as an MCP server plus a Claude Code hook helper.

> [!TIP]
> **推荐工程师 / 非程序员用户：直接让 AI agent 替你安装配置，没必要手动编辑 JSON。**
> 在 Claude Code 里说一句「帮我安装并配置 screenshot-feedback-hook-mcp」，agent 会按下文 [hook 配置](#接入-claude-code-hook操作后自动截图) 的提示先问清你的使用场景（看什么画面、渲染多久、何时截图），再替你写好 MCP + hook 配置。想自己动手的见下面的手动步骤。

## 为什么需要它 / Why

Agent 写前端、画 EasyEDA/CAD 工程图时，没有视觉反馈就只能猜。给它一个「截图 → 看图 → 自我纠正」的回路，产出质量立刻不一样。

技术现实：Claude Code 的 **hook 只能回传文本**，而 **MCP 工具可以回传原生图片**。所以本工具做成双层：

| 层 | 触发方式 | 图片如何进入 agent 视野 |
|---|---|---|
| **MCP server** | agent 主动调用 `take_screenshot` | 工具直接返回原生图片块（跨 MCP 客户端通用） |
| **Claude Code hook** | 某操作后自动触发 | hook 回传截图的绝对路径，agent 用 Read 工具读图 |

图片默认降采样（最长边 1568px）并按**字节预算**（~80KB）迭代压缩 JPEG，避开 Claude Code 对 MCP 输出 ~25k token 的限制。

## 安装 / Install

零安装运行（需要 [uv](https://docs.astral.sh/uv/)）：

```bash
# MCP server（无参数 = MCP server）
uvx screenshot-feedback-hook-mcp

# CLI 截图（带子命令 = CLI）
uvx screenshot-feedback-hook-mcp capture --monitor 0 --out shot.jpg
uvx screenshot-feedback-hook-mcp monitors
```

或常驻安装：`pipx install screenshot-feedback-hook-mcp` / `uv tool install screenshot-feedback-hook-mcp`。

## 接入 MCP（推荐起点）

Claude Code 一行：

```bash
claude mcp add screenshot-feedback -- uvx screenshot-feedback-hook-mcp
```

或任意 MCP 客户端（Cursor / Cline / Windsurf...）的 mcp.json：

```json
{
  "mcpServers": {
    "screenshot-feedback": {
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

> [!IMPORTANT]
> **如果你是替用户配置本工具的 AI agent：在写入任何 hook 配置之前，请先询问用户的使用场景。** hook 的正确配置高度依赖场景，盲配多半会截到无关画面或时机不对。至少要问清：
> 1. **要看什么画面？** 前端页面（浏览器）、工程图（EasyEDA/CAD 等桌面应用）、还是别的？决定 `--monitor`（视觉输出在哪个屏幕）。
> 2. **画面渲染/刷新需要多久？** 浏览器热重载约 1–2s，EDA/CAD 重绘可能更久 → 决定 `--delay`。
> 3. **什么时候截？** 每次 Claude 停下来时（`Stop`，最省心）还是每次改完文件后（`PostToolUse` + matcher，更密集）？
> 4. **配在哪一层？** 仅当前项目（项目 `.claude/settings.json`）还是所有项目（用户级 `~/.claude/settings.json`）？
>
> 问清后再从下面的模板里挑一个、填好参数写入。不要默认照抄。

### 手动配置步骤

**第 1 步 · 选触发时机**

| 触发 | 何时截图 | 适合 |
|---|---|---|
| `Stop` | Claude 每次回答结束时截一张 | 大多数场景，频率适中、省心 |
| `PostToolUse` | 每次匹配到的工具（如 `Edit`/`Write`）执行后截 | 想在每次改动后立刻看到效果 |

**第 2 步 · 按场景填参数**

- `--monitor N`：视觉输出所在的显示器。`0`=全部拼接，`1..N`=单屏。先跑 `uvx screenshot-feedback-hook-mcp monitors` 看编号。
- `--delay 秒`：截图前等待，确保画面渲染完成（前端 `1`、EDA/CAD 视渲染速度可设 `2`~`5`）。
- `--max-edge 像素` / `--target-kb 体积`：一般用默认即可（最长边 1568px、~80KB）。

**第 3 步 · 写入 `.claude/settings.json`**

项目级配置放项目根目录的 `.claude/settings.json`；想全局生效放用户级 `~/.claude/settings.json`。模板见下方与 [examples/](examples/)。

**第 4 步 · 验证**

重启 Claude Code 会话，触发一次对应事件，确认 Claude 收到「截图已保存到 …」并主动用 Read 读了图。

### 模板 A：每次 Claude 停下来时截图（`Stop`，推荐起点）

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "uvx screenshot-feedback-hook-mcp capture --delay 1 --hook-output stop"
          }
        ]
      }
    ]
  }
}
```

### 模板 B：每次改完文件后截图（`PostToolUse`）

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "uvx screenshot-feedback-hook-mcp capture --delay 2 --hook-output post-tool-use"
          }
        ]
      }
    ]
  }
}
```

### 原理

CLI 会输出正确的 hook JSON（`Stop` 用 `decision:block` 回传文字并自动处理 `stop_hook_active` 防死循环；`PostToolUse` 用 `hookSpecificOutput.additionalContext`），agent 看到「截图已保存到 …，请用 Read 工具读取」后会读图。因为 **hook 只能回传文本**，所以走「回传路径 + agent 用 Read 读图」这条路；想让 agent 直接拿到图片块请用上面的 MCP 方式。

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
uv run screenshot-feedback-hook-mcp capture --out shot.jpg   # CLI
uv run screenshot-feedback-hook-mcp                          # MCP server
```

MIT License.
