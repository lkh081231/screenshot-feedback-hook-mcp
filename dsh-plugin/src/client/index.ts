/**
 * 浏览器半侧：把本插件的配置卡片注册进「设置 → 插件 → 插件配置」。
 *
 * 两半靠 settings 命名空间 `screenshot-feedback` 配对——Host 半侧注册命名空间，
 * 这里以同一个字符串为键注册卡片，标签页把两者凑成一张卡，而它不需要知道这个
 * 命名空间是什么意思。没组装 Host 半侧的部署不会留下这张卡片的任何痕迹。
 * @module dsh-screenshot-feedback-hook-mcp/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// 类型 only：拉进 locale 插件的 Context 合并（ctx.locale）。
import type {} from '@deepseek-ai/dsh-client-locale/client'
// 类型 only：设置外壳的 ctx.settingsScope Context 合并。跨插件协作走服务，
// 绝不以值的形式 import（客户端 bundle 纯净度门禁）。
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// 类型 only：`settings.plugin.item` 这个 keyed slot 的声明。
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { SETTINGS_NS, ScreenshotCardController } from './controller.js'
import type { ScreenshotSettings } from './controller.js'
import { ScreenshotCard } from './ScreenshotCard.js'
import { en, zh } from './locales.js'
import type { ScreenshotLocaleKey } from './locales.js'

export type { ScreenshotCardProps } from './ScreenshotCard.js'
export type { ScreenshotCardFace, ScreenshotCardState } from './controller.js'
export type { ScreenshotLocaleKey } from './locales.js'
export { SETTINGS_NS, CARD_FIELDS } from './controller.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 本插件卡片的文案。 */
    'screenshot-feedback': ScreenshotLocaleKey
  }
}

/** 本插件拥有的字典命名空间，与 settings 命名空间同名。 */
const NS = 'screenshot-feedback'

/** 必需服务（cordis fiber inject）。 */
export const inject = ['slots', 'locale', 'settingsScope']

/**
 * 挂上卡片。
 * @param ctx - 浏览器插件上下文。
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'screenshot-feedback: card dictionaries')

  const card = new ScreenshotCardController(
    ctx.settingsScope.bind<ScreenshotSettings>({ namespace: SETTINGS_NS }),
  )

  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: SETTINGS_NS,
    locale: NS,
    inject: () => card.inject(),
  }, ScreenshotCard))

  // t 只是让绑定在这里就发生（重复 bind 返回同一个函数），渲染时由 slot 注入
  void t
}
