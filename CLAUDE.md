# CLAUDE.md

本文件给在此仓库工作的 Claude Code 提供项目上下文与约定。

## 项目是什么

**screenshot-feedback-hook-mcp** —— 一个开源、跨平台（Windows / Linux / macOS）、低部署门槛的「截图反馈」工具，让 coding agent 在做前端设计、画工程图（EasyEDA/CAD）等任务时能**看到自己产出的真实画面**并据此自我纠正。
（曾用名 agent-eye，因 PyPI 相似度规则弃用；现在包名/命令名/分发名/仓库名统一为 screenshot-feedback-hook-mcp。）

核心技术现实（设计前提，勿推翻）：
- **Hook 只能回传文本**，无法直接把图片塞进上下文（feature request anthropics/claude-code#16592 未实现）。
- **MCP 工具能回传原生图片块**（FastMCP 的 `Image(data=..., format=...)`）。
- 故采用**双层架构**：MCP 负责「agent 主动调用、直接拿图」；Hook 负责「操作后自动截图、回传路径让 agent 用 Read 读」。

## 已锁定的设计决策

- 回传机制 = **MCP server + Claude Code hook 双层**
- 技术栈 = **Python ≥ 3.10 + uv/uvx**
- 截图库 = **mss**（纯 ctypes 调原生 API，Linux 无需 imagemagick），压缩用 **Pillow**，MCP 用 **mcp**(FastMCP)
- MVP 截图范围 = **全屏 / 指定显示器**；区域(坐标)、按窗口标题、URL/无头浏览器 = roadmap

## 目录结构（目标）

```
screenshot_feedback_hook_mcp/
├── core/capture.py      # 截图核心：mss 抓帧 → Pillow bytes
├── core/optimize.py     # 字节预算导向：降采样(~1568px)+迭代降 JPEG 质量至 ≤~80KB
├── core/platform_check.py  # macOS 权限/Wayland 检测提示
├── server.py            # MCP server（FastMCP，take_screenshot/list_monitors）
├── cli.py               # CLI + 统一入口 entry()：无参数=MCP server，带子命令=CLI
└── __init__.py
examples/                # hook 配置样例、MCP 配置样例
tests/                   # optimize 单测 + hook schema 单测 + capture 冒烟测试
pyproject.toml           # uv 管理，[project.scripts] 只暴露 screenshot-feedback-hook-mcp
```

## 常用命令

```bash
uv sync                                                            # 安装依赖
uv run screenshot-feedback-hook-mcp capture --monitor 0 --out shot.png  # 跑 CLI 截图
uv run screenshot-feedback-hook-mcp                                # 启动 MCP server（无参数）
uv run pytest                                                      # 跑测试
```

零安装运行：`uvx screenshot-feedback-hook-mcp`（MCP）/ `uvx screenshot-feedback-hook-mcp capture ...`（CLI）——单一入口按有无子命令分流，无需 --from。

## 关键约定与坑（务必遵守）

- **不要在 hook 里回传 base64 图片**：hook 输出有 10k 字符上限，只回传**绝对路径 + 指令**（让 agent 用 Read 读图）。
- **hook JSON schema 因事件而异，勿混用**：
  - PostToolUse：`{"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": "..."}}`
  - Stop：无 additionalContext，用 `{"decision": "block", "reason": "..."}`（block 使 Claude 继续并看到 reason）。
- **控制图片体积按字节预算**：25k token 上限按 base64 文本长度计（≈70–100KB 二进制），只控分辨率不够——降采样后迭代降 JPEG 质量至 ≤~80KB（claude-code#9152）；勿连续返回多张大图累积上下文（#27869）。
- **截图时机**：PostToolUse 触发时页面/EDA 可能还没渲染完，CLI 支持 `--delay <秒>`。
- **跨平台权限/限制**（运行时检测并给明确提示）：
  - macOS：首次需在「系统设置 → 隐私与安全性 → 屏幕录制」授权，否则黑屏/只截到壁纸。
  - Linux：X11 正常；**Wayland 下 mss 受限**——启动探测 `XDG_SESSION_TYPE` 并提示。
  - Windows：mss 直接可用，无额外依赖。
- **多显示器**：monitor=0 = 全部拼接，1..N = 单屏；用 `list_monitors` 暴露编号。

## 工作方式

- **执行大的更改后先 commit 再继续**：每完成一项较大的改动（新增模块、重构、跨文件变更）就先提交一次，保持可回滚的工作状态，不要把多项大改动堆在一个 commit 里。
- 实现进度见 TodoWrite 列表；完整方案见计划文件（plan）。
- 改动后用上面的「常用命令」做端到端验证（CLI 出图 → MCP Inspector 看图 → hook 触发后 agent Read 到图）。
- 保持代码风格与周边一致；新增依赖走 `uv add`。
