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
 * 本模块是 Host 半侧；浏览器半侧（设置页上的插件卡片）在 `./client`，两半
 * 靠同一个 settings 命名空间 {@link SETTINGS_NS} 配对。
 *
 * @module dsh-screenshot-feedback-hook-mcp
 */

import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
// 副作用式类型 import：把 tools 服务并进 Context。
import type {} from '@deepseek-ai/dsh-tools'
import { applyAutoCapture } from './auto.js'
import { applyTools } from './tools.js'
import { Config } from './config.js'
import type { ConfigSource } from './config.js'

export { Config } from './config.js'
export type { ConfigSource } from './config.js'
export { matchesToolName } from './auto.js'
export { resolveRoute, textOnlyModelMessage, unresolvedRouteMessage } from './route.js'

/** Cordis 插件名，loader 诊断用。 */
export const name = 'screenshot-feedback'

/**
 * 本插件拥有的 settings 命名空间。浏览器半侧的卡片以同一个字符串为键注册，
 * 设置页靠它把两半配对（它不需要知道这个命名空间是什么意思）。
 */
export const SETTINGS_NS = settingsNamespace('screenshot-feedback')

/**
 * 必需服务。`llm` 与 `settings` 故意都不写在这里：前者只在证明图片能力时软取，
 * 后者由 `installSettingsSection` 自己按「有就用、没有就退回组合层」处理。
 */
export const inject = ['tools', 'subprocess', 'attachments']

/**
 * 注册 settings 命名空间、工具与自动时机。
 * @param ctx - 插件上下文；所有注册都是 effect，卸载/HMR 时自动清理。
 * @param config - 已被 schemastery 填好默认值的组合层配置。
 */
export function apply(ctx: Context, config: Config): void {
  // 挂上 settings 后 source 指向解析后的 scope，用户在设置页存一次就换一份值；
  // 没挂 settings 时它一直是 cordis.yml 里那份，行为与从前完全一致。
  let source: ConfigSource = () => config
  installSettingsSection(ctx, SETTINGS_NS, Config, config, {
    setSource: (current) => { source = current },
    // 每次读都走 source()，没有需要重建的注册期事实
    onChange: () => undefined,
  })
  applyTools(ctx, () => source())
  applyAutoCapture(ctx, () => source())
}
