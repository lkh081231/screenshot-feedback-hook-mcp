/**
 * 两个自动截图时机，默认都关。
 *
 * - `tools/post-execute`：改完文件立刻看一眼，图片随工具结果一起进上下文，
 *   不需要模型主动做任何事，也没有死循环风险。
 * - `agent/turn-stopping`：轮次收尾时看一眼。dsh 的 Claude Code hook 桥接把
 *   `stop_hook_active` 恒置为 false 且没有连击上限，所以自限必须自己做：这里
 *   按 `payload.turn` 去重，一个 turn 最多触发一次。
 * @module dsh-screenshot-feedback-hook-mcp/auto
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { PostToolDecision } from '@deepseek-ai/dsh-tools'
import { captureScreenshot } from './capture.js'
import type { Config, ConfigSource } from './config.js'
import { imageValueFromRef, pluginMessage, pluginTextMessage, screenshotContent } from './content.js'
import type { ScreenshotValue } from './content.js'
import { assertImageCapableRoute } from './route.js'

/** 只由字母数字下划线和竖线组成的 matcher 按字面量交替处理，其余按正则 —— 与 CC hook matcher 同语义。 */
const LITERAL_MATCHER = /^[A-Za-z0-9_|]+$/

/**
 * 工具名是否命中 matcher。
 * @param matcher - 配置里的匹配表达式；空串或 `*` 匹配全部。
 * @param name - 模型可见的工具名。
 * @returns 是否命中；非法正则一律按不命中隔离，绝不把异常抛进工具流水线。
 */
export function matchesToolName(matcher: string, name: string): boolean {
  const pattern = matcher.trim()
  if (pattern.length === 0 || pattern === '*') return true
  if (LITERAL_MATCHER.test(pattern)) return pattern.split('|').includes(name)
  try {
    return new RegExp(pattern).test(name)
  } catch {
    return false
  }
}

/**
 * 把一条附加上下文挂到既有决策上，保留决策本身与它已有的 `additionalContexts`。
 * @param decision - 下游给出的决策。
 * @param message - 要追加的消息。
 * @returns 追加后的决策。
 */
export function withAdditionalContext(decision: PostToolDecision, message: UserMessage): PostToolDecision {
  return { ...decision, additionalContexts: [...decision.additionalContexts ?? [], message] }
}

/** 自动路径的共享状态：谁已经被提醒过换模型、谁在哪个 turn 已经截过。 */
interface AutoState {
  warned: WeakSet<Agent>
  steeredTurn: WeakMap<Agent, number>
}

/**
 * 自动路径下证明路由支持图片；不支持时按配置最多提醒一次。
 * @param ctx - 插件上下文。
 * @param config - 插件配置。
 * @param state - 共享状态。
 * @param agent - 当前 agent。
 * @param signal - 取消信号。
 * @returns 可用时为 undefined；不可用时为「要不要提醒」的消息（或 null 表示静默跳过）。
 */
async function gateOrWarning(
  ctx: Context,
  config: Config,
  state: AutoState,
  agent: Agent | undefined,
  signal: AbortSignal,
): Promise<UserMessage | null | undefined> {
  try {
    await assertImageCapableRoute(ctx, agent, signal)
    return undefined
  } catch (error: unknown) {
    if (!config.warnOnTextOnlyModel) return null
    // 每会话只提醒一次：自动时机每轮都触发，重复同一段文字纯属烧 token
    if (agent !== undefined) {
      if (state.warned.has(agent)) return null
      state.warned.add(agent)
    }
    return pluginTextMessage(error instanceof Error ? error.message : String(error))
  }
}

/**
 * 截一张并投影成规范值。
 * @param ctx - 插件上下文。
 * @param config - 插件配置。
 * @param delayMs - 本次等待时间。
 * @param signal - 取消信号。
 * @returns 规范值。
 */
async function captureValue(ctx: Context, config: Config, delayMs: number, signal: AbortSignal): Promise<ScreenshotValue> {
  const result = await captureScreenshot(ctx, config, { delayMs, signal })
  return { path: result.path, warnings: result.warnings, image: imageValueFromRef(result.ref) }
}

/**
 * 注册两个自动时机。两者都由配置开关控制，且都在**运行时**读配置，
 * 这样改 cordis.yml（HMR）或在设置页改值都不需要重启进程。
 * @param ctx - 插件上下文（监听器随它的生命周期自动注销）。
 * @param source - 配置读取器；每次触发都重读。
 */
export function applyAutoCapture(ctx: Context, source: ConfigSource): void {
  const logger = ctx.logger('screenshot-feedback')
  const state: AutoState = { warned: new WeakSet(), steeredTurn: new WeakMap() }

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next()
    const config = source()
    if (!config.autoAfterTools) return decision
    if (!matchesToolName(config.autoAfterToolsMatcher, exec.name)) return decision
    // 工具本身就失败了，这时候的画面说明不了任何事
    if (result.isError) return decision
    try {
      const warning = await gateOrWarning(ctx, config, state, exec.agent, exec.signal)
      if (warning === null) return decision
      if (warning !== undefined) return withAdditionalContext(decision, warning)
      const value = await captureValue(ctx, config, config.autoAfterToolsDelayMs, exec.signal)
      const content = screenshotContent(value, `Screenshot taken automatically after ${exec.name}.`)
      return withAdditionalContext(decision, pluginMessage(content))
    } catch (error: unknown) {
      // 截图是锦上添花：它坏了绝不能连累工具流水线
      logger.warn('automatic screenshot after %s failed: %s', exec.name, error)
      return decision
    }
  })

  ctx.on('agent/turn-stopping', async ({ agent, turn, signal }) => {
    const config = source()
    if (!config.autoOnTurnStop) return
    // dsh 上没有 stop_hook_active，自限就靠这一行：同一个 turn 只截一次，
    // 否则 steer 会让模型再跑一步、再次触发本事件，无限续跑。
    if (state.steeredTurn.get(agent) === turn) return
    state.steeredTurn.set(agent, turn)
    try {
      const warning = await gateOrWarning(ctx, config, state, agent, signal)
      if (warning === null) return
      if (warning !== undefined) {
        agent.inject(warning)
        return
      }
      const value = await captureValue(ctx, config, config.autoOnTurnStopDelayMs, signal)
      const content = screenshotContent(value, 'Screenshot of the screen as this turn was about to end. Check it against what you intended to produce.')
      const message = pluginMessage(content)
      if (config.autoOnTurnStopSteer) agent.steer(message)
      else agent.inject(message)
    } catch (error: unknown) {
      logger.warn('automatic screenshot at turn end failed: %s', error)
    }
  })
}
