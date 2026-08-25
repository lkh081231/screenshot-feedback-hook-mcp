/**
 * 图片能力闸门。
 *
 * dsh 里图片能不能进上下文，取决于**当前这条确切路由**是否声明 `image` 输入
 * （`ctx.llm.resolveModelInfo(...).inputModalities`）—— 内置的 `read_image`
 * 和 MCP 图片结果走的是同一道闸。声明不了就别截图：图片会在发请求前被拒，
 * 白花时间还给模型塞一段没用的诊断文本。
 * @module dsh-screenshot-feedback-hook-mcp/route
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
// 副作用式类型 import：把 llm 服务并进 Context。
import type {} from '@deepseek-ai/dsh-llm'

/** 一条确切模型路由。 */
export interface RouteIdentity {
  provider: string | undefined
  model: string | undefined
}

/**
 * 解析 agent 当前实际使用的路由：优先取会话日志里最后一次 `request/header`
 * （模型选择器换过模型时它才是真的），再回退到 agent 创建时的选项。
 * @param agent - 发起本次调用的 agent；无 agent 的调用返回两个 undefined。
 * @returns provider 与 model。
 */
export function resolveRoute(agent: Agent | undefined): RouteIdentity {
  const routed = agent?.session.requestHeader()?.config
  return {
    provider: routed?.provider ?? agent?.options.provider,
    model: routed?.model ?? agent?.options.model,
  }
}

/** 路由都解析不出来时的说明。 */
export function unresolvedRouteMessage(): string {
  return 'cannot capture a screenshot: the current model route could not be resolved, so image support cannot be proven.'
}

/**
 * 纯文本模型的说明 —— 这是本插件对用户最有价值的一段话，务必给出**可执行**的下一步。
 * @param provider - 当前 provider 路由。
 * @param model - 当前模型 id。
 * @returns 面向模型（并由模型转述给用户）的提示文本。
 */
export function textOnlyModelMessage(provider: string, model: string): string {
  return [
    `cannot capture a screenshot: model "${model}" (provider "${provider}") does not declare image input,`,
    'so the screenshot could not enter the conversation and was skipped.',
    "dsh's built-in DeepSeek route ships text-only models (deepseek-v4-flash, deepseek-v4-pro).",
    'Tell the user to switch to an image-capable model, in one of these ways:',
    '(1) add an Anthropic/OpenAI-style catalog provider under Settings -> Models and pick one of its vision models;',
    '(2) for a custom provider, declare `input: [text, image]` on that model (or `defaultInput: [text, image]` on the route)',
    'in the `llm-pi-ai` section of $DSH_HOME/settings.yaml; catalog providers use `modelOverrides.<model-id>.input`;',
    '(3) if your DeepSeek endpoint really serves a vision model, add it under `llm-deepseek.models` with',
    '`inputModalities: [text, image]`.',
    'These fields assert what the endpoint supports; they do not add capability an endpoint lacks.',
  ].join(' ')
}

/** 闸门拒绝的原因类别。两类的可执行性不同，调用方要能分开记账。 */
export type RouteProbeKind = 'unresolved' | 'text-only'

/** 闸门结论。 */
export type RouteProbe = { ok: true } | { ok: false; kind: RouteProbeKind; reason: string }

/**
 * 探测当前路由是否支持图片输入。**拒绝是返回值、故障才是异常** —— 拿异常当控制流
 * 的话，调用方分不清「模型不声明图片输入」和「模型目录一时查不通」，只好把两者
 * 一视同仁地当成前者。
 * @param ctx - 插件上下文，用于软取 `llm` 服务。
 * @param agent - 发起本次调用的 agent。
 * @param signal - 适配器查询的取消信号。
 * @returns 放行或带原因类别的拒绝。
 * @throws `resolveModelInfo` 的瞬时故障（查不通、被取消）原样上抛，由调用方决定
 * 是记日志还是放行 —— 它不是一个关于模型能力的结论。
 */
export async function probeImageCapableRoute(ctx: Context, agent: Agent | undefined, signal?: AbortSignal): Promise<RouteProbe> {
  const { provider, model } = resolveRoute(agent)
  const llm = ctx.get('llm')
  if (provider === undefined || model === undefined || llm === undefined) {
    return { ok: false, kind: 'unresolved', reason: unresolvedRouteMessage() }
  }
  const info = await llm.resolveModelInfo(provider, model, signal)
  // `inputModalities` 缺席表示「未知」，未知一律按不支持处理：图片一旦进了持久
  // 历史，后面每个请求都会重发，出错就得开新会话才能摆脱。
  if (info.inputModalities === undefined || !info.inputModalities.includes('image')) {
    return { ok: false, kind: 'text-only', reason: textOnlyModelMessage(provider, model) }
  }
  return { ok: true }
}

/**
 * 证明当前路由支持图片输入，否则抛出带修复指引的异常。手动路径用它：工具调用被
 * 拒绝时本来就该以错误收场。
 * @param ctx - 插件上下文，用于软取 `llm` 服务。
 * @param agent - 发起本次调用的 agent。
 * @param signal - 适配器查询的取消信号。
 * @throws 路由不可解析、`llm` 未挂载或模型未声明 `image` 时抛出。
 */
export async function assertImageCapableRoute(ctx: Context, agent: Agent | undefined, signal?: AbortSignal): Promise<void> {
  const probe = await probeImageCapableRoute(ctx, agent, signal)
  if (!probe.ok) throw new Error(probe.reason)
}
