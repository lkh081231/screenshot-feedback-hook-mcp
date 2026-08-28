# dsh-screenshot-feedback-hook-mcp

[English](README.md) | **中文**

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件：让 agent **看到自己刚产出的真实画面** —— 前端页面、EasyEDA/CAD 工程图、任意桌面应用 —— 并据此自我纠正。

它是 [screenshot-feedback-hook-mcp](https://github.com/lkh081231/screenshot-feedback-hook-mcp) 的 dsh 那一半；截图与压缩仍然全部由 Python 包负责（mss + Pillow，Windows/Linux/macOS 通用），本插件只负责 dsh 这一侧的接线。

![agent 调用 take_screenshot，图片直接出现在对话里](https://raw.githubusercontent.com/lkh081231/screenshot-feedback-hook-mcp/main/dsh-plugin/docs/screenshot-in-context.png)

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
- **一个能跑 `capture --json` 的 `screenshot-feedback-hook-mcp` >= 0.3.0** —— 截图与压缩都由它做，装法见下面[三条路](#怎么把截图-cli-装上)。更早的版本没有这个子命令，插件会识别出来并点名让你升级。
- **macOS 上的屏幕录制授权** —— 而且未授权**不一定会被检测出来**，信任截图之前先读[平台注意事项](#平台注意事项)。
- **一个支持图片输入的模型** —— 见[支持图片的模型](#支持图片的模型)。没有的话插件会拒绝截图，并说明怎么换。

### 怎么把截图 CLI 装上

插件对这个 CLI 的唯一接触点是配置里的 `command` / `args` 两个字段（见[配置](#配置)），它拿 `command` 去 PATH 上查一次可执行文件，仅此而已。所以下面三条随便挑一条，**uv 不是硬性依赖**，只是默认那条路。

**A. 装 uv —— 默认配置直接可用，推荐**

```sh
# Windows
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"
# macOS / Linux
curl -LsSf https://astral.sh/uv/install.sh | sh
```

装完什么都不用改：默认就是 `command: uvx` + `args: ['screenshot-feedback-hook-mcp']`，`uvx` 会按需从 PyPI 拉包（首次需要联网）。

**uv 自己不需要 Python** —— 它是独立二进制，会按需下载解释器。所以对「机器上还没有可用 Python」的人，这条反而门槛最低；B 那条要求你先有 Python。

**B. 已经有 Python，想常驻安装**

```sh
pipx install screenshot-feedback-hook-mcp
# 或 uv tool install screenshot-feedback-hook-mcp
```

然后改配置。**后应用的层会替换整个 `config`**，所以要重述你想要的所有键：

```yaml
# ~/.dsh/profiles/<name>/cordis.patch.yml
- id: screenshot-feedback
  name: dsh-screenshot-feedback-hook-mcp
  config:
    command: screenshot-feedback-hook-mcp
    args: []
    monitor: 0
```

**C. 装在 venv 里，或者根本不想动 PATH**

`command` 直接填绝对路径，其余同 B：

```yaml
    command: C:\Users\you\proj\.venv\Scripts\screenshot-feedback-hook-mcp.exe
    args: []
```

> `command` / `args` / `cwd` **不在设置卡片上** —— 它们决定去哪里找可执行文件，属于部署事实而不是用户偏好。所以走 B / C 必须编辑上面那个 YAML 文件，在设置页里点不出来。
>
> 好在装错了给的信息是可执行的：命令找不到时插件会直接告诉你「装 uv，或者 pipx 装完把 `command` 改成什么、`args` 清空」；装了旧版 Python 包时会点名让你升级，而不是丢一段 argparse usage 让你自己猜。

## 安装

本插件已经上架 [awesome-dsh-plugin](https://awesome-dsh-plugin.com)（`vision` 分类），可以直接从 dsh 的插件市场里装。**市场卡片目前给的是下面那条 GitHub 写法** —— npm 写法要等对方的探针把 npm 链接补上，跟本仓库无关；手动敲下面这条 npm 命令是一直可用的。

```sh
dsh plugin --profile web add dsh-screenshot-feedback-hook-mcp
dsh web
```

然后让 agent「截个图，告诉我屏幕上是什么」。用别的 profile 就把 `--profile` 换掉。

### 从 GitHub 安装，以及为什么不能直接指向源码目录

插件市场给的是 git 写法，这条能用：pnpm 会克隆仓库、跑本包的 `prepare` 脚本把 `lib/` 构建出来，再按打包结果安装。

```sh
dsh plugin --profile web add github:lkh081231/screenshot-feedback-hook-mcp#path:/dsh-plugin
```

> **pnpm 10 起对构建脚本设了闸门。** 首次安装（构建产物还没进 pnpm 的内容寻址 store）可能停在 `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`。在 `~/.dsh/profiles/<name>/pnpm-workspace.yaml` 的 `onlyBuiltDependencies` 里放行即可 —— 照着报错里打印的那一行原样抄，然后重跑上面的命令。构建产物进了缓存之后就不再过这个闸门。

**不要让 `dsh plugin add` 指向源码工作区。** `dsh plugin --profile web add ./screenshot-feedback-hook-mcp/dsh-plugin` 会把这个目录装成 pnpm 的 `link:`，它会以两种方式失败：

- **`lib/` 是构建产物，不在 git 里。** pnpm 不会为 link 依赖跑 `prepare`，于是 `main: "lib/index.js"` 指向一个不存在的文件，dsh 启动即崩：

  ```
  dsh: plugin tree failed to load: ... Cannot find module
  '~/.dsh/profiles/web/node_modules/dsh-screenshot-feedback-hook-mcp/lib/index.js'
  ```

- **就地构建能解决上一条，但会引出更糟的问题。** Node 按真实路径解析 link 过来的包，所以 `npm install` 之后落在 `dsh-plugin/node_modules/` 里的那几份 `@deepseek-ai/dsh-*` 会盖住宿主的 —— 正是[从 0.1.0 升级](#从-010-升级必看)那节讲的双实例故障，它会让该 profile 里**所有**工具调用挂掉，不止截图。

要从 checkout 安装，先打包，让只有 `files` 白名单里的东西进 profile：

```sh
git clone https://github.com/lkh081231/screenshot-feedback-hook-mcp.git
cd screenshot-feedback-hook-mcp/dsh-plugin
npm install && npm run build && npm pack
dsh plugin --profile web add ./dsh-screenshot-feedback-hook-mcp-0.2.1.tgz
```

不管走哪条路，装完都确认 `~/.dsh/profiles/<name>/node_modules/@deepseek-ai/` 下**没有任何 `dsh-*` 包** —— 那里只该有 `schemastery` 和 `cosmokit`。

### 0.2.1 有什么变化

- **自动截图失败现在会在对话里说明原因。** 两个自动时机以前把所有失败都吞进日志，插件表现为「静默地什么也没做」—— 而最常见的那个失败（PATH 上没有 `uvx`）恰恰带着照做就能修好的指引。现在原因会作为插件上下文送到模型面前：`autoAfterTools` 挂在工具结果旁边，`autoOnTurnStop` 走 inject。决策本身仍然原样放行；轮次结束时的失败**只 inject 不 steer**，不会把本该收尾的轮次续下去。同一段原因只报一次、直到它变了为止；成功一次就清账，之后再坏会重新报。至于闸门自己都查不通（模型目录不可达）那种，仍然只记日志 —— 它没有任何可执行的建议能给模型。

### 0.2.0 有什么变化

- **截图文件现在会留在盘上。** `take_screenshot` 的结果里声明了 `path`，现在这个路径指向一个真实可读的文件，你可以照着再读一次。0.2.0 之前文件在工具返回前就被删了，声明的 `path` 永远指向一个不存在的文件。插件会在临时目录里保留最近 20 张、修剪更早的；失败的截图不留任何东西。
- **`delay_ms` 有上界了。** 模型要一个很长的等待，不再能顶穿运维设的 `captureTimeoutMs`。上限是 10000 毫秒，配置的 `delayMs` 更大时以它为准；被钳制时结果的 warnings 里会说明。
- **图片能力闸门能区分两种拒绝了。**「这个模型不声明图片输入」和「路由解析不出来」现在各记各的提醒额度，前者（告诉你该怎么换模型的那条）不会再被后者挤掉。查询模型目录时的瞬时故障两者都不算，只记日志并跳过。
- **取消和超时会分别报出来**，不再都显示成「the screenshot command produced no output」。

### 从 0.1.0 升级（必看）

**0.1.0 会把 dsh 的运行时包当成普通依赖装进 profile**，在 profile 里造出第二份 `@deepseek-ai/dsh-tools`，盖掉 dsh 自己那份。结果不只是截图不能用 —— 该 profile 里**任何**工具调用都会崩：

```
Cannot read properties of undefined (reading 'prepare')
```

0.1.1 起改成 peer 依赖，不会再往 profile 里装任何 dsh 包。已经装过 0.1.0 的，把被污染的 `node_modules` 一并清掉再装：

```sh
dsh plugin --profile web remove dsh-screenshot-feedback-hook-mcp
rm -rf ~/.dsh/profiles/web/node_modules
dsh plugin --profile web add dsh-screenshot-feedback-hook-mcp
```

装完确认一下 `~/.dsh/profiles/<name>/node_modules/@deepseek-ai/` 里**没有任何 `dsh-*`**（只该有 `schemastery` 和 `cosmokit`）。

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

![设置 → 插件 → 插件配置 里的那张卡片](https://raw.githubusercontent.com/lkh081231/screenshot-feedback-hook-mcp/main/dsh-plugin/docs/settings-card.png)

装好之后日常调参在**设置 → 插件 → 插件配置 → 截图反馈**那张卡片上，它写的是
`$DSH_HOME/settings.yaml`，叠在组合层之上、免重启。卡片上每个字段都标注是否被
你覆盖过，并且能一键重置回组合层的值。

组合包插入的那一行 id 是 `screenshot-feedback`，适合放固定的部署事实。要改它，
在自己 profile 的 `$DSH_HOME/profiles/<name>/cordis.patch.yml` 里写一行同 id 的
配置。**后应用的层会替换整个 `config`**，所以要重述所有你想要的键：

```yaml
- id: screenshot-feedback
  name: dsh-screenshot-feedback-hook-mcp
  config:
    command: uvx
    args: ['screenshot-feedback-hook-mcp']
    monitor: 1
    autoAfterTools: true
    autoAfterToolsDelayMs: 2000
```

| 字段 | 默认 | 卡片上可改 | 说明 |
|---|---|:--:|---|
| `command` | `uvx` | | 截图可执行文件。用 pipx / uv tool 装过的，改成 `screenshot-feedback-hook-mcp` 并清空 `args`。 |
| `args` | `['screenshot-feedback-hook-mcp']` | | 置于子命令之前的固定参数。 |
| `cwd` | `''` | | 子进程工作目录；留空用 host 的 cwd。 |
| `monitor` | `0` | ✓ | `0` = 全部显示器拼接，`1..N` = 单屏。编号用 `list_monitors` 查。 |
| `delayMs` | `0` | ✓ | 手动截图前的等待，等页面 / 工程图渲染完成。 |
| `maxEdge` | `1568` | ✓ | 最长边像素。**不要超过 2000**，附件库会拒绝更大的图。 |
| `targetKb` | `80` | ✓ | 字节预算。dsh 没有 Claude Code 那条 25k token 的 MCP 输出上限，要看清细节可以调大。 |
| `captureTimeoutMs` | `30000` | ✓ | 单次截图超时（在等待时间之外另算）。 |
| `warnOnTextOnlyModel` | `true` | ✓ | 闸门拒绝时提示该怎么办（纯文本模型 / 路由解析不出来）。每种原因每会话一次。 |
| `autoAfterTools` | `false` | ✓ | 命中的工具执行完就截图。 |
| `autoAfterToolsMatcher` | `edit\|write\|str_replace_editor` | ✓ | 工具名匹配。纯 `[A-Za-z0-9_|]+` 按字面量精确交替，其余按正则。 |
| `autoAfterToolsDelayMs` | `1500` | ✓ | 自动截图前的等待。 |
| `autoOnTurnStop` | `false` | ✓ | 轮次即将结束时截图。 |
| `autoOnTurnStopDelayMs` | `1500` | ✓ | 自动截图前的等待。 |
| `autoOnTurnStopSteer` | `true` | ✓ | `true` = steer 让模型再跑一步看图；`false` = 只 inject 进上下文。 |

`command` / `args` / `cwd` 刻意不上卡片：它们决定去哪里找可执行文件，属于部署
组合，不是用户偏好。改 `config` 会触发 HMR 热替换，改卡片则连热替换都不需要——
插件每次触发都重读配置。

### 设置页那张卡片是怎么接上去的

dsh 的**插件配置**标签页渲染的是两份账本的交集：Host 服务了哪些 settings 命名
空间，以及浏览器里有哪些卡片注册在这些键上。所以这个包同时提供两半，用同一个
命名空间 `screenshot-feedback` 配对：

- **Host 半侧**（`src/index.ts`）用 `@deepseek-ai/dsh-settings` 的
  `installSettingsSection` 注册命名空间，把 `cordis.yml` 那一行当作组合层 `base`，
  并把配置读取器指向解析后的 scope。没挂 settings 服务时它自动退回组合层，
  行为与从前完全一致。
- **浏览器半侧**（`src/client/`）把一张 React 卡片注册进 `settings.plugin.item`
  这个 keyed slot，键就是同一个命名空间。它经 `ctx.settingsScope` 读写，写入用
  读取时的 revision 设栅，所以已经和文档脱节的表单会被拒绝而不是覆盖并发改动。

浏览器半侧靠 `package.json` 的 `dsh.client` 声明被发现，产物是 `lib/client.js`：

```jsonc
{
  "exports": { "./client": { "default": "./lib/client.js" } },
  "dsh": { "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-ui-settings-plugins"] } }
}
```

> [!NOTE]
> dsh 官方产出这种 bundle 的 `clientBundle` 预设**没有发布到 npm**（官方 README
> 把这条列为已知限制），所以本包在 [tsdown.config.ts](tsdown.config.ts) 里自己复刻
> 了那份产物契约：lazy-CJS 闭包工厂、`window.__ModuleLoader__.load` 的
> banner/footer、以及只让模块表里那几个 specifier 保持 `require()`。升级 dsh 时
> 要跟着复核 `packages/client/tsdown.client.ts` 与 `packages/client/web/src/platform.ts`。

### 关于两个自动时机

两个**默认都关**：每张截图都会一直跟着后续每次请求走，直到发生压缩。

- `autoAfterTools` 挂在 `tools/post-execute`，把截图挂到工具结果旁边。它不可能死循环，并且会跳过失败的工具调用（那时候的画面说明不了任何事）。
- `autoOnTurnStop` 挂在 `agent/turn-stopping`。在那里 steer 会强制模型再跑一步、再次回到同一个停止边界 —— dsh 的 Claude Code hook 桥接把 `stop_hook_active` 恒置为 `false` 且没有连击上限，所以照搬的 Stop hook 会让 agent 无限续跑。本插件按 `payload.turn` 去重：**一个 turn 最多截一次**。

截图失败绝不会阻断任何东西 —— 只记一条日志，工具流水线和轮次照常走。

## 平台注意事项

截图本身在 Python 包里，所以下面这些对它的每一个前端都成立，本插件也不例外。

- **Windows**：开箱即用。
- **Linux**：X11 开箱即用。纯 Wayland 下 `mss` 受限；CLI 会探测会话类型，每张截图都带上这条告警送给模型。注意它只看 `XDG_SESSION_TYPE=wayland`，所以 XWayland 下截图其实正常时也照样提示。
- **macOS**：在「系统设置 → 隐私与安全性 → 屏幕录制」里勾选运行 dsh 的终端/IDE，然后**完全退出并重启**该应用。未授权时截到的**不是黑屏，而是壁纸 + 菜单栏** —— 其他应用的窗口一个都不在图里。

> [!WARNING]
> **macOS 未授权不一定会被检测出来，请先手动验证一次。**
>
> 现在的检测是事后启发式：把画面缩到 16x16 看灰度极差，只有**接近纯色**（纯黑、纯色壁纸）才会触发提示。**照片壁纸下不会触发**，而那正是 macOS 的默认样子。
>
> 也就是说模型可能收到一张「看起来完全正常的桌面截图」、一句告警都没有，而它要看的窗口根本不在图里。这比黑屏更糟：模型会以为是自己的页面没渲染出来，跑去 debug 一份没问题的代码。
>
> 所以在打开两个自动时机之前，先手动跑一次并亲眼看一下：
>
> ```sh
> uvx screenshot-feedback-hook-mcp capture --out shot.jpg
> ```
>
> 图里有你的窗口，就说明授权到位、下面的一切都能正常工作。确定性的检测（`CGPreflightScreenCaptureAccess()`，与画面内容无关）已列入计划，但需要一台 macOS 机器才能验证。

**触发了的**环境告警是会送到模型面前的：它们跟在截图的 `warnings` 里，渲染成图片旁边的一行 `<warnings>`，所以模型看到的是原因，而不只是一张坏掉的图。

## 支持图片的模型

dsh 只有在**当前这条确切路由**声明了图片输入（`ctx.llm.resolveModelInfo(...).inputModalities`）时才会把图片放进对话 —— 和内置 `read_image` 工具是同一道闸。在 dsh `v0.1.0-rc.8` 上，内置的 `deepseek-official` 路由只公布 `deepseek-v4-flash` 和 `deepseek-v4-pro`，**两者都是纯文本模型**。

> [!IMPORTANT]
> **设置页声明不了模态。**「设置 → 模型」的模型卡片只能编辑 `id` / 名称 / 上下文窗口 / 最大输出，没有模态字段 —— 在那里新加的模型一律按**纯文本**处理，本插件会拒绝截图。加完自定义模型后，请点该页的**「打开配置文件」**，在 `settings.yaml` 里手工给这条模型补上 `input: [text, image]`（`llm-deepseek` 下的字段名是 `inputModalities: [text, image]`）。手写的字段不会被之后在设置页里的编辑抹掉。

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

> [!WARNING]
> **所有 `@deepseek-ai/dsh-*` 与 `@deepseek-ai/cordis` 一律是 peer，绝不能放进 `dependencies`。** 本地开发靠 `devDependencies` 提供，运行时必须由 host 那份安装提供。把任何一个挪回 `dependencies`，pnpm 就会在 profile 里物化出第二份副本，盖掉 dsh 建在 `~/.dsh/profiles/node_modules/` 的符号链接；而 dsh-tools 的调度器是用模块局部 `Symbol` 索引的，两份副本会让 `ctx.tools[TOOL_RUNTIME_SCHEDULER]` 变成 `undefined`，**该 profile 里所有工具调用**（`read` / `write` / `bash` 全都算）都会以 `Cannot read properties of undefined (reading 'prepare')` 崩掉。`tests/packaging.spec.ts` 守着这条线。

MIT License.
