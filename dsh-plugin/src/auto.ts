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
import { formatCaptureFailureText, imageValueFromRef, pluginMessage, pluginTextMessage, screenshotContent } from './content.js'
import type { ScreenshotValue } from './content.js'
import { probeImageCapableRoute } from './route.js'
import type { RouteProbeKind } from './route.js'

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

/** 自动路径的共享状态：谁为哪种原因被提醒过、谁在哪个 turn 已经截过。 */
interface AutoState {
  /**
   * 每种拒绝原因各记一笔账。合成一笔的话，先撞上的「路由解析不出来」会把真正可
   * 执行的「换个支持图片的模型」永久挤掉 —— 后者是本插件产出的最有用的一段文字。
   */
  warned: Map<RouteProbeKind, WeakSet<Agent>>
  /** agent 为 undefined 时没有可挂载的键，只能按插件实例记一次。 */
  warnedWithoutAgent: Set<RouteProbeKind>
  /**
   * 上一次已经报给模型的截图失败原因。自动时机每轮都触发，同一段原因反复贴过去
   * 纯属烧 token；但也不能只报一次就永远闭嘴，所以记的是「上一次」而不是「报过」
   * —— 换了原因立刻再说，成功一次则由 {@link clearFailure} 清账。
   */
  lastFailure: WeakMap<Agent, string>
  /** agent 为 undefined 时的同一笔账。 */
  lastFailureWithoutAgent: string | undefined
  steeredTurn: WeakMap<Agent, number>
}

/**
 * 领取「这一类原因、这个 agent」的一次提醒额度。
 * @param state - 共享状态。
 * @param kind - 拒绝原因类别。
 * @param agent - 当前 agent；undefined 时按插件实例记账。
 * @returns 领到了就是 true；已经提醒过就是 false。
 */
function claimWarning(state: AutoState, kind: RouteProbeKind, agent: Agent | undefined): boolean {
  if (agent === undefined) {
    if (state.warnedWithoutAgent.has(kind)) return false
    state.warnedWithoutAgent.add(kind)
    return true
  }
  let seen = state.warned.get(kind)
  if (seen === undefined) {
    seen = new WeakSet()
    state.warned.set(kind, seen)
  }
  if (seen.has(agent)) return false
  seen.add(agent)
  return true
}

/**
 * 把抛出来的任意值收成一句可读原因。
 * @param error - 捕获到的值。
 * @returns 原因文本。
 */
function failureReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 领取一次「把截图失败告诉模型」的额度。同一段原因连续复发只说一次，换了原因
 * 立刻再说。
 * @param state - 共享状态。
 * @param agent - 当前 agent；undefined 时按插件实例记账。
 * @param reason - 本次失败原因。
 * @returns 该说就是 true。
 */
function claimFailure(state: AutoState, agent: Agent | undefined, reason: string): boolean {
  if (agent === undefined) {
    if (state.lastFailureWithoutAgent === reason) return false
    state.lastFailureWithoutAgent = reason
    return true
  }
  if (state.lastFailure.get(agent) === reason) return false
  state.lastFailure.set(agent, reason)
  return true
}

/**
 * 截图成功后清掉失败记账。不清的话，用户装好 uv、中间成功过若干次之后再坏，
 * 模型就再也听不到了。
 * @param state - 共享状态。
 * @param agent - 当前 agent。
 */
function clearFailure(state: AutoState, agent: Agent | undefined): void {
  if (agent === undefined) state.lastFailureWithoutAgent = undefined
  else state.lastFailure.delete(agent)
}

/**
 * 自动路径下证明路由支持图片；不支持时按配置、按原因类别各提醒一次。
 *
 * 故意**不 catch**：`probeImageCapableRoute` 把「拒绝」做成返回值之后，还能抛出来
 * 的只有瞬时故障（模型目录查不通、被取消）。那既不该冒充「模型是纯文本」，也不该
 * 吃掉提醒额度 —— 让它上抛到两个监听器各自的兜底 catch 里记日志。
 * @param ctx - 插件上下文。
 * @param config - 插件配置。
 * @param state - 共享状态。
 * @param agent - 当前 agent。
 * @param signal - 取消信号。
 * @returns 可用时为 undefined；不可用时为要提醒的消息（或 null 表示静默跳过）。
 */
async function gateOrWarning(
  ctx: Context,
  config: Config,
  state: AutoState,
  agent: Agent | undefined,
  signal: AbortSignal,
): Promise<UserMessage | null | undefined> {
  const probe = await probeImageCapableRoute(ctx, agent, signal)
  if (probe.ok) return undefined
  if (!config.warnOnTextOnlyModel) return null
  // 每种原因每会话只提醒一次：自动时机每轮都触发，重复同一段文字纯属烧 token
  if (!claimWarning(state, probe.kind, agent)) return null
  return pluginTextMessage(probe.reason)
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
  const state: AutoState = {
    warned: new Map(),
    warnedWithoutAgent: new Set(),
    lastFailure: new WeakMap(),
    lastFailureWithoutAgent: undefined,
    steeredTurn: new WeakMap(),
  }

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
    } catch (error: unknown) {
      // 闸门自己查不通（模型目录不可达、被取消）不是「截图失败」：没有任何可执行
      // 的建议能给模型，贴过去只是噪声。只记日志。
      logger.warn('the screenshot gate before %s failed: %s', exec.name, error)
      return decision
    }
    try {
      const value = await captureValue(ctx, config, config.autoAfterToolsDelayMs, exec.signal)
      clearFailure(state, exec.agent)
      const content = screenshotContent(value, `Screenshot taken automatically after ${exec.name}.`)
      return withAdditionalContext(decision, pluginMessage(content))
    } catch (error: unknown) {
      // 截图是锦上添花：它坏了绝不能连累工具流水线 —— 决策原样返回，只在旁边附一
      // 条说明。最常见的失败（PATH 上没有 uvx）带着照做就能修好的指引，只写进
      // 日志的话，用户在对话里看到的是「插件静默地什么也没做」。
      logger.warn('automatic screenshot after %s failed: %s', exec.name, error)
      const reason = failureReason(error)
      if (!claimFailure(state, exec.agent, reason)) return decision
      const headline = `The automatic screenshot after ${exec.name} failed, so there is no image for this step.`
      return withAdditionalContext(decision, pluginTextMessage(formatCaptureFailureText(headline, reason)))
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
    } catch (error: unknown) {
      // 与 tools/post-execute 同理：闸门查不通没有可执行建议，只记日志
      logger.warn('the screenshot gate at turn end failed: %s', error)
      return
    }
    try {
      const value = await captureValue(ctx, config, config.autoOnTurnStopDelayMs, signal)
      clearFailure(state, agent)
      const content = screenshotContent(value, 'Screenshot of the screen as this turn was about to end. Check it against what you intended to produce.')
      const message = pluginMessage(content)
      if (config.autoOnTurnStopSteer) agent.steer(message)
      else agent.inject(message)
    } catch (error: unknown) {
      logger.warn('automatic screenshot at turn end failed: %s', error)
      const reason = failureReason(error)
      if (!claimFailure(state, agent, reason)) return
      // 一律 inject，即便配了 steer：为读一条错误信息而让模型再跑一步不值当，
      // 何况 steer 会把本该收尾的轮次续下去 —— 截图失败绝不能延长 agent 的生命。
      const headline = 'The automatic screenshot at the end of this turn failed, so there is no image of the final state.'
      agent.inject(pluginTextMessage(formatCaptureFailureText(headline, reason)))
    }
  })
}
