/**
 * 插件配置。dsh 的约定是「凡是不同部署可能取不同值的参数都必须是配置字段」，
 * 所以截图命令、显示器编号、等待时间、体积预算和两个自动时机全部在这里。
 * @module dsh-screenshot-feedback-hook-mcp/config
 */

import z from '@deepseek-ai/schemastery'

/** 与 Python 侧 `core.optimize.MAX_EDGE` 一致的最长边默认值。 */
export const DEFAULT_MAX_EDGE = 1568

/**
 * `dsh-attachment-local` 的单边准入上限（2000px）。超过它 `saveImage` 会以
 * `IMAGE_DIMENSION_TOO_LARGE` 拒绝，图片根本进不了会话，所以这里挡在前面。
 */
export const ATTACHMENT_MAX_EDGE = 2000

/** 与 Python 侧 `core.optimize.TARGET_BYTES` 一致的字节预算（KB）。 */
export const DEFAULT_TARGET_KB = 80

/** 自动截图默认等 1.5s：浏览器热重载约 1–2s，EDA/CAD 重绘更久时由用户调大。 */
const DEFAULT_AUTO_DELAY_MS = 1_500

/**
 * dsh 内置的改文件工具名**全小写**，与 Claude Code 的 `Edit|Write` 不是一套；
 * 照抄 CC 的 matcher 在 dsh 上一个都匹配不上。
 */
export const DEFAULT_TOOL_MATCHER = 'edit|write|str_replace_editor'

/** 工具执行后自动截图。 */
export interface AutoAfterToolsConfig {
  /** 是否启用。默认关：截图会给每次工具调用增加一张图的上下文成本。 */
  enabled: boolean
  /** 工具名匹配；纯 `[A-Za-z0-9_|]+` 按字面量交替处理，其余按正则（与 CC hook matcher 同语义）。 */
  matcher: string
  /** 截图前等待毫秒数，等页面/工程图渲染完成。 */
  delayMs: number
}

/** 轮次结束时自动截图。 */
export interface AutoOnTurnStopConfig {
  /** 是否启用。默认关。 */
  enabled: boolean
  /** 截图前等待毫秒数。 */
  delayMs: number
  /**
   * true = 用 `agent.steer()` 强制模型再跑一步看图；false = 只 `agent.inject()`
   * 塞进上下文，等下次唤醒才被消费。无论哪种，每个 turn 最多触发一次。
   */
  steer: boolean
}

/** 插件配置。 */
export interface Config {
  /** 截图 CLI 可执行文件。零安装用 `uvx`；`pipx`/`uv tool install` 的用户直接填 `screenshot-feedback-hook-mcp`。 */
  command: string
  /** 置于子命令之前的固定参数。`command: uvx` 时这里是包名。 */
  args: string[]
  /** 子进程工作目录；留空用 host 进程的 cwd。 */
  cwd: string
  /** 0 = 全部显示器拼接，1..N = 单屏。`list_monitors` 可以查编号。 */
  monitor: number
  /** 手动调用 `take_screenshot` 时的截图前等待毫秒数。 */
  delayMs: number
  /** 最长边像素上限；不要超过 {@link ATTACHMENT_MAX_EDGE}。 */
  maxEdge: number
  /** 目标体积（KB）。dsh 没有 Claude Code 那条 25k token 的 MCP 输出上限，画面细节不够时可以调大。 */
  targetKb: number
  /** 单次截图超时（毫秒）。 */
  captureTimeoutMs: number
  /** 当前模型不支持图片输入时，是否给模型一条说明该怎么换 provider 的提示（每会话一次）。 */
  warnOnTextOnlyModel: boolean
  /** 工具执行后自动截图。 */
  autoAfterTools: AutoAfterToolsConfig
  /** 轮次结束时自动截图。 */
  autoOnTurnStop: AutoOnTurnStopConfig
}

const AutoAfterTools: z<AutoAfterToolsConfig> = z.object({
  enabled: z.boolean().default(false),
  matcher: z.string().default(DEFAULT_TOOL_MATCHER),
  delayMs: z.number().min(0).default(DEFAULT_AUTO_DELAY_MS),
})

const AutoOnTurnStop: z<AutoOnTurnStopConfig> = z.object({
  enabled: z.boolean().default(false),
  delayMs: z.number().min(0).default(DEFAULT_AUTO_DELAY_MS),
  steer: z.boolean().default(true),
})

export const Config: z<Config> = z.object({
  command: z.string().default('uvx'),
  args: z.array(String).default(['screenshot-feedback-hook-mcp']),
  cwd: z.string().default(''),
  monitor: z.number().step(1).min(0).default(0),
  delayMs: z.number().min(0).default(0),
  maxEdge: z.number().step(1).min(1).max(ATTACHMENT_MAX_EDGE).default(DEFAULT_MAX_EDGE),
  targetKb: z.number().step(1).min(1).default(DEFAULT_TARGET_KB),
  captureTimeoutMs: z.number().min(1).default(30_000),
  warnOnTextOnlyModel: z.boolean().default(true),
  autoAfterTools: AutoAfterTools,
  autoOnTurnStop: AutoOnTurnStop,
})
