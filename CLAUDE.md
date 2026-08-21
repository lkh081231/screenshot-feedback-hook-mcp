# CLAUDE.md

本文件给在此仓库工作的 Claude Code 提供项目上下文与约定。

## 项目是什么

**screenshot-feedback-hook-mcp** —— 一个开源、跨平台（Windows / Linux / macOS）、低部署门槛的「截图反馈」工具，让 coding agent 在做前端设计、画工程图（EasyEDA/CAD）等任务时能**看到自己产出的真实画面**并据此自我纠正。
（曾用名 agent-eye，因 PyPI 相似度规则弃用；现在包名/命令名/分发名/仓库名统一为 screenshot-feedback-hook-mcp。）

核心技术现实（设计前提，勿推翻）：
- **Claude Code 的 hook 只能回传文本**，无法直接把图片塞进上下文（feature request anthropics/claude-code#16592 未实现）。
- **MCP 工具能回传原生图片块**（FastMCP 的 `Image(data=..., format=...)`）。
- **DeepSeek Harness 没有这条限制**：它有持久图片附件服务 `ctx.attachments`，原生插件可以在拦截点上把截图直接变成图片块推进上下文，agent 无需主动做任何事。
- 故采用**三层架构**：MCP 负责「agent 主动调用、直接拿图」；Claude Code hook 负责「操作后自动截图、回传路径让 agent 用 Read 读」；dsh 原生插件负责「手动 + 两个自动时机，直接推图片块」。

## 已锁定的设计决策

- 回传机制 = **MCP server + Claude Code hook + DeepSeek Harness 原生插件 三层**
- 技术栈 = **Python ≥ 3.10 + uv/uvx**
- 截图库 = **mss**（纯 ctypes 调原生 API，Linux 无需 imagemagick），压缩用 **Pillow**，MCP 用 **mcp**(FastMCP)
- MVP 截图范围 = **全屏 / 指定显示器**；区域(坐标)、按窗口标题、URL/无头浏览器 = roadmap
- dsh 插件 = **TypeScript（Cordis 插件）**，npm 名 `dsh-screenshot-feedback-hook-mcp`，钉死 dsh **v0.1.0-rc.8**；截图与压缩仍全部委托 Python CLI（`capture --json`），TS 侧只做 dsh 接线

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
dsh-plugin/              # DeepSeek Harness 原生插件（独立 npm 包，双面：Host + 浏览器）
├── src/config.ts        # Schemastery Config，同时充当 settings 命名空间的 schema
├── src/capture.ts       # spawn Python CLI(--json) → ctx.attachments.saveImage
├── src/route.ts         # 图片能力闸门 + 换 provider 提示文案
├── src/content.ts       # 规范值 ↔ 图片块/插件来源消息 的共享投影
├── src/tools.ts         # take_screenshot / list_monitors
├── src/auto.ts          # tools/post-execute 与 agent/turn-stopping
├── src/index.ts         # Host 半侧：installSettingsSection + 注册工具/自动时机
├── src/client/          # 浏览器半侧：设置页那张卡片（React）
│   ├── card-form.ts     #   自己的暂存表单 + revision 设栅（不能 import dsh 那份）
│   ├── controller.ts    #   settings scope ↔ 表单，CARD_FIELDS 决定卡片长什么样
│   └── ScreenshotCard.tsx
├── tsdown.config.ts     # 复刻 dsh 未发布的 clientBundle 产物格式
└── cordis.patch.yml     # 组合包 patch 层（package.json 的 dsh.bundle 指向它）
```

## 常用命令

```bash
uv sync                                                            # 安装依赖
uv run screenshot-feedback-hook-mcp capture --monitor 0 --out shot.png  # 跑 CLI 截图
uv run screenshot-feedback-hook-mcp                                # 启动 MCP server（无参数）
uv run pytest                                                      # 跑测试
```

零安装运行：`uvx screenshot-feedback-hook-mcp`（MCP）/ `uvx screenshot-feedback-hook-mcp capture ...`（CLI）——单一入口按有无子命令分流，无需 --from。

dsh 插件（在 `dsh-plugin/` 下）：

```bash
npm install && npm run typecheck && npm test && npm run build     # 开发循环
DSH_SCREENSHOT_CLI=../.venv/Scripts/screenshot-feedback-hook-mcp.exe npx vitest run  # 真实截图集成测试（默认跳过）
npx @deepseek-ai/dsh@0.1.0-rc.8 plugin --profile web add ./dsh-plugin   # 装进 profile（需要 PATH 上有 pnpm）
npx @deepseek-ai/dsh@0.1.0-rc.8 --profile web --dump-config             # 确认层已 composed 进去
```

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

dsh 专属的坑：

- **基线是 dsh v0.1.0-rc.8**（tag `dsh-v0.1.0-rc.8`）。npm 的 `latest` dist-tag 还指向旧的 `0.0.1-rc.*`，依赖必须写死 `0.1.0-rc.8`；master 已经比 rc.8 走远（例如多了 `deepseek-v4-flash-vision-exp`），**别照 master 文档写**。
- **图片能进上下文的前提**：`ctx.llm.resolveModelInfo(provider, model).inputModalities` 必须含 `'image'`。rc.8 内置的 `deepseek-official` 只有 `deepseek-v4-flash` / `deepseek-v4-pro`，两者纯文本 —— 所以截图前先过闸门，不通过就别截。
- **dsh 上没有 `stop_hook_active`**：它的 CC hook 桥接把这个字段恒置为 false 且没有连击上限，我们 CLI 的防死循环逻辑在那边不生效。原生插件的 `agent/turn-stopping` 靠 `payload.turn` 去重自限。
- **dsh 的内置工具名全小写**（`edit` / `write` / `read` / `read_image` / `str_replace_editor`），照抄 Claude Code 的 `Edit|Write` matcher 一个都匹配不上。
- **附件准入单边上限 2000px**：`maxEdge` 超过它 `saveImage` 会直接拒。
- **截图失败绝不能阻断 agent**：`tools/post-execute` 里所有异常都要吞掉并原样返回上游决策。
- **只有 `defineTool` 等纯 builder 可以运行时 import**；服务一律走 `ctx`，避免与 host 的重复实例互相干扰。
- **Config 必须是扁平标量**：它同时是 settings 命名空间的 schema，而 `SettingsScope.set/unset` 按字段写入与重置；嵌套一层对象会让卡片上的覆盖徽标与重置退化成整组操作（`args` 是唯一例外，卡片不编辑它）。
- **配置一律按次读（`ConfigSource` thunk）**，不能缓存 `apply()` 那一刻的快照，否则用户在设置页存完要重启才生效。
- **浏览器半侧的 bundle 有纯净度门禁**：只有 `PLATFORM_MODULES` + `PRELOADED_CLIENT_EXTERNALS`（react / react-dom / cordis / ui-slots / ui-primitives / client-runtime/client）能保持 `require()`，其余一律内联；跨插件的值导入必须改成类型 import 或走 cordis 服务。dsh 的 `clientBundle` 预设**没发到 npm**，产物格式由本仓库的 `tsdown.config.ts` 自己复刻，升级 dsh 时要复核。

## 工作方式

- **执行大的更改后先 commit 再继续**：每完成一项较大的改动（新增模块、重构、跨文件变更）就先提交一次，保持可回滚的工作状态，不要把多项大改动堆在一个 commit 里。
- 实现进度见 TodoWrite 列表；完整方案见计划文件（plan）。
- 改动后用上面的「常用命令」做端到端验证（CLI 出图 → MCP Inspector 看图 → hook 触发后 agent Read 到图 → dsh 里 `pluginInventory/list` 显示插件 active 且模型能看到截图）。
- 保持代码风格与周边一致；新增依赖走 `uv add`。
