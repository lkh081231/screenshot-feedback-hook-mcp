# dsh-screenshot-feedback-hook-mcp

[English](README.md) | **中文**

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件：让 agent **看到自己刚产出的真实画面** —— 前端页面、EasyEDA/CAD 工程图、任意桌面应用 —— 并据此自我纠正。

它是 [screenshot-feedback-hook-mcp](https://github.com/lkh081231/screenshot-feedback-hook-mcp) 的 dsh 那一半；截图与压缩仍然全部由 Python 包负责（mss + Pillow，Windows/Linux/macOS 通用），本插件只负责 dsh 这一侧的接线。

## 为什么要做原生插件，而不是直接桥接 Claude Code hook

Claude Code 的 hook 只能回传**文本**，能做到的极限就是把文件路径丢回去、指望 agent 自己去读。dsh 有持久图片附件服务，所以原生插件可以把截图提交进附件库、再作为真正的**图片块**送进对话 —— agent 什么都不用做。

| 路径 | 图片怎么到达模型 |
|---|---|
| `take_screenshot` 工具 | 工具结果里直接带图片块 |
| 工具执行后（默认关） | 截图作为附加上下文随工具结果一起进上下文 |
| 轮次结束时（默认关） | 截图被 steer / inject 进下一步 |

## 前置条件

- **dsh `v0.1.0-rc.8` 或更高** —— 本插件用到的每个 API 都是对着这个 tag 核对过的。
- **PATH 上有 pnpm** —— `dsh plugin` 是转发给它执行的。
- **Python 包 `screenshot-feedback-hook-mcp` >= 0.3.0**，可以用 `uvx screenshot-feedback-hook-mcp` 零安装运行（需要 [uv](https://docs.astral.sh/uv/)），也可以 `pipx` / `uv tool` 常驻安装。更早的版本没有 `capture --json`，插件会识别出来并提示你升级。
- **一个支持图片输入的模型** —— 见[支持图片的模型](#支持图片的模型)。没有的话插件会拒绝截图，并说明怎么换。

## 安装

```sh
dsh plugin --profile web add dsh-screenshot-feedback-hook-mcp
dsh web
```

然后让 agent「截个图，告诉我屏幕上是什么」。用别的 profile 就把 `--profile` 换掉。

从源码 checkout 安装：

```sh
git clone https://github.com/lkh081231/screenshot-feedback-hook-mcp.git
dsh plugin --profile web add ./screenshot-feedback-hook-mcp/dsh-plugin
```

## 它是怎么注册进 dsh 的

本包是一个 dsh **组合包（bundle）** —— 一个附带配置层的 npm 包，不需要你手写任何 patch。它靠 `package.json` 里的 `dsh.bundle` manifest 声明自己贡献什么：

```json
{
  "name": "dsh-screenshot-feedback-hook-mcp",
  "main": "lib/index.js",
  "files": ["lib", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

`cordis.patch.yml` 就是那一层，按**包名**引用插件模块（不是相对路径，否则 Node 解析不到已安装的代码）：

```yaml
- insert:
    - id: screenshot-feedback
      name: dsh-screenshot-feedback-hook-mcp
      config:
        command: uvx
        args: ['screenshot-feedback-hook-mcp']
        monitor: 0
```

`dsh plugin --profile <name> add ...` 会在 profile 目录里转发给 pnpm 装包，认出 `dsh.bundle` 后把包名追加进该 profile 的 `dsh.profile.bundles`：

```json
{
  "name": "dsh-profile-web",
  "dependencies": { "dsh-screenshot-feedback-hook-mcp": "..." },
  "dsh": { "profile": { "bundles": [
    "@deepseek-ai/dsh-base",
    "@deepseek-ai/dsh-web-app",
    "dsh-screenshot-feedback-hook-mcp"
  ] } }
}
```

启动前先只验证这一层，不真的跑起来：

```sh
dsh --profile web --dump-config   # 应当出现 `# == dsh-screenshot-feedback-hook-mcp` 层与 id: screenshot-feedback 那一行
```

卸载：`dsh plugin --profile web remove dsh-screenshot-feedback-hook-mcp`，依赖和对应的层会一起消失。

生效配置的层顺序是：各组合包的 patch（按 `dsh.profile.bundles` 顺序，`@deepseek-ai/dsh-base` 在最前）→ profile 自己的 `cordis.patch.yml` → home 级 `$DSH_HOME/cordis.patch.yml` → 每个 `--patch` overlay。所以**你可以在自己 profile 的层里覆盖本包的行，不用改这个包**。

## 配置

组合包插入的那一行 id 是 `screenshot-feedback`。要改它，在自己 profile 的 `$DSH_HOME/profiles/<name>/cordis.patch.yml` 里写一行同 id 的配置。**后应用的层会替换整个 `config`**，所以要重述所有你想要的键，而不是只写改动的那个：

```yaml
- id: screenshot-feedback
  name: dsh-screenshot-feedback-hook-mcp
  config:
    command: uvx
    args: ['screenshot-feedback-hook-mcp']
    monitor: 1
    autoAfterTools:
      enabled: true
      delayMs: 2000
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `command` | `uvx` | 截图可执行文件。用 pipx / uv tool 装过的，改成 `screenshot-feedback-hook-mcp` 并清空 `args`。 |
| `args` | `['screenshot-feedback-hook-mcp']` | 置于子命令之前的固定参数。 |
| `cwd` | `''` | 子进程工作目录；留空用 host 的 cwd。 |
| `monitor` | `0` | `0` = 全部显示器拼接，`1..N` = 单屏。编号用 `list_monitors` 查。 |
| `delayMs` | `0` | 手动截图前的等待，等页面 / 工程图渲染完成。 |
| `maxEdge` | `1568` | 最长边像素。**不要超过 2000**，附件库会拒绝更大的图。 |
| `targetKb` | `80` | 字节预算。dsh 没有 Claude Code 那条 25k token 的 MCP 输出上限，要看清细节可以调大。 |
| `captureTimeoutMs` | `30000` | 单次截图超时（在等待时间之外另算）。 |
| `warnOnTextOnlyModel` | `true` | 纯文本模型时，每会话提示一次该怎么换模型。 |
| `autoAfterTools.enabled` | `false` | 命中的工具执行完就截图。 |
| `autoAfterTools.matcher` | `edit\|write\|str_replace_editor` | 工具名匹配。纯 `[A-Za-z0-9_|]+` 按字面量精确交替，其余按正则。 |
| `autoAfterTools.delayMs` | `1500` | 自动截图前的等待。 |
| `autoOnTurnStop.enabled` | `false` | 轮次即将结束时截图。 |
| `autoOnTurnStop.delayMs` | `1500` | 自动截图前的等待。 |
| `autoOnTurnStop.steer` | `true` | `true` = steer 让模型再跑一步看图；`false` = 只 inject 进上下文。 |

改 `config` 会触发 HMR 热替换，不需要重启进程。

### 关于两个自动时机

两个**默认都关**：每张截图都会一直跟着后续每次请求走，直到发生压缩。

- `autoAfterTools` 挂在 `tools/post-execute`，把截图挂到工具结果旁边。它不可能死循环，并且会跳过失败的工具调用（那时候的画面说明不了任何事）。
- `autoOnTurnStop` 挂在 `agent/turn-stopping`。在那里 steer 会强制模型再跑一步、再次回到同一个停止边界 —— dsh 的 Claude Code hook 桥接把 `stop_hook_active` 恒置为 `false` 且没有连击上限，所以照搬的 Stop hook 会让 agent 无限续跑。本插件按 `payload.turn` 去重：**一个 turn 最多截一次**。

截图失败绝不会阻断任何东西 —— 只记一条日志，工具流水线和轮次照常走。

## 支持图片的模型

dsh 只有在**当前这条确切路由**声明了图片输入（`ctx.llm.resolveModelInfo(...).inputModalities`）时才会把图片放进对话 —— 和内置 `read_image` 工具是同一道闸。在 dsh `v0.1.0-rc.8` 上，内置的 `deepseek-official` 路由只公布 `deepseek-v4-flash` 和 `deepseek-v4-pro`，**两者都是纯文本模型**。

拿到支持图片的路由有三条路：

1. 在**设置 → 模型**里添加 Anthropic / OpenAI 等 catalog provider，选它的视觉模型。
2. 自定义 provider 在 `$DSH_HOME/settings.yaml` 里声明模态：

   ```yaml
   llm-pi-ai:
     providers:
       my-gateway:
         apiKeyEnv: GATEWAY_API_KEY
         api: openai-completions
         baseURL: https://gateway.example/v1
         models:
           - id: vision-model
             input: [text, image]
   ```

   catalog provider 改用 `modelOverrides.<模型id>.input`；整条路由可以用 `defaultInput: [text, image]` 兜底。
3. 如果你的 DeepSeek 端点确实提供视觉模型，在 `llm-deepseek.models` 里给它加 `inputModalities: [text, image]`。

这些字段是对你端点的**断言**，端点本身不支持的话不会因此变得支持。

## 不用这个插件的其他接法

- **桥接 MCP server**：`@deepseek-ai/dsh-mcp-client` 可以把同一个 Python 包当 MCP server 跑起来，工具名变成 `mcp__screenshot__take_screenshot`。图片闸门一样，但没有自动截图。
- **桥接已有的 Claude Code hook**：`@deepseek-ai/dsh-hooks-claude-code` 能跑现成的 `hooks.json`。只用 `PostToolUse`，matcher 里写 dsh 的小写工具名，并加 `--image-tool read_image`，否则 agent 会被指去调一个不存在的工具。**那边不要用 `Stop` hook** —— dsh 上 `stop_hook_active` 恒为 `false`，CLI 自带的防死循环逻辑根本不会触发。

## 开发

```sh
npm install
npm run typecheck
npm test
npm run build
```

真实截图的集成测试默认跳过，要跑就指向一个已安装的 CLI：

```sh
DSH_SCREENSHOT_CLI=../.venv/Scripts/screenshot-feedback-hook-mcp.exe npx vitest run
```

MIT License.
