/**
 * screenshot-feedback：让 dsh 里的 agent 看到自己产出的真实画面。
 *
 * 手动路径是 `take_screenshot` 工具；两个自动路径（工具执行后 / 轮次结束时）
 * 默认关闭，打开后截图会作为图片块直接进上下文，模型不需要主动做任何事——
 * 这是 dsh 原生插件相对 Claude Code hook 的关键差别（hook 只能回传文本）。
 *
 * 截图与压缩全部委托给 Python 包 `screenshot-feedback-hook-mcp` 的 CLI，
 * 本插件只负责 dsh 这一侧的接线：图片能力闸门、附件入仓、上下文注入。
 *
 * @module dsh-screenshot-feedback-hook-mcp
 */

import type { Context } from '@deepseek-ai/cordis'
// 副作用式类型 import：把 tools 服务并进 Context。
import type {} from '@deepseek-ai/dsh-tools'
import { applyAutoCapture } from './auto.js'
import { applyTools } from './tools.js'
import type { Config } from './config.js'

export { Config } from './config.js'
export type { AutoAfterToolsConfig, AutoOnTurnStopConfig } from './config.js'
export { matchesToolName } from './auto.js'
export { resolveRoute, textOnlyModelMessage, unresolvedRouteMessage } from './route.js'

/** Cordis 插件名，loader 诊断用。 */
export const name = 'screenshot-feedback'

/**
 * 必需服务。`llm` 故意不写在这里：它只在证明图片能力时软取，缺失时按
 * 「无法证明」处理即可，不该让整个插件加载不起来。
 */
export const inject = ['tools', 'subprocess', 'attachments']

/**
 * 注册工具与自动时机。
 * @param ctx - 插件上下文；所有注册都是 effect，卸载/HMR 时自动清理。
 * @param config - 已被 schemastery 填好默认值的配置。
 */
export function apply(ctx: Context, config: Config): void {
  applyTools(ctx, config)
  applyAutoCapture(ctx, config)
}
