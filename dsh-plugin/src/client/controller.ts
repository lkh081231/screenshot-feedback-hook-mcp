/**
 * 卡片控制器：把 `screenshot-feedback` 命名空间的 settings scope 桥到暂存表单上。
 * @module dsh-screenshot-feedback-hook-mcp/client/controller
 */

import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { CardForm, booleanField, numberField, textField } from './card-form.js'
import type { CardActions, CardFieldSpec, CardFieldState, CardShell } from './card-form.js'
import type { ScreenshotLocaleKey } from './locales.js'

/**
 * Host 半侧注册的 settings 命名空间。在这里**重新拼写**而不是从 Host 包 import：
 * 客户端包不能依赖 Host 包（bundle 纯净度门禁），设置页也正是靠这个字符串把
 * 两半配对的。与 `src/index.ts` 的 `SETTINGS_NS` 必须一致。
 */
export const SETTINGS_NS = 'screenshot-feedback'

/** 卡片里的一个控件：字段换算规格加上它的文案键。 */
export interface CardFieldEntry {
  spec: CardFieldSpec
  labelKey: ScreenshotLocaleKey
  hintKey: ScreenshotLocaleKey
  /** true 时该行前面留出缩进，表示它属于上一行那个开关。 */
  nested?: true
}

/**
 * 卡片编辑的字段，按渲染顺序排列。`command` / `args` / `cwd` 刻意不在其中：
 * 它们决定去哪里找可执行文件，属于部署组合，不是用户偏好。
 */
export const CARD_FIELDS: readonly CardFieldEntry[] = [
  { spec: numberField('monitor'), labelKey: 'monitor', hintKey: 'monitorHint' },
  { spec: numberField('delayMs'), labelKey: 'delayMs', hintKey: 'delayMsHint' },
  { spec: booleanField('autoAfterTools'), labelKey: 'autoAfterTools', hintKey: 'autoAfterToolsHint' },
  { spec: textField('autoAfterToolsMatcher'), labelKey: 'autoAfterToolsMatcher', hintKey: 'autoAfterToolsMatcherHint', nested: true },
  { spec: numberField('autoAfterToolsDelayMs'), labelKey: 'autoAfterToolsDelayMs', hintKey: 'autoAfterToolsDelayMsHint', nested: true },
  { spec: booleanField('autoOnTurnStop'), labelKey: 'autoOnTurnStop', hintKey: 'autoOnTurnStopHint' },
  { spec: numberField('autoOnTurnStopDelayMs'), labelKey: 'autoOnTurnStopDelayMs', hintKey: 'autoOnTurnStopDelayMsHint', nested: true },
  { spec: booleanField('autoOnTurnStopSteer'), labelKey: 'autoOnTurnStopSteer', hintKey: 'autoOnTurnStopSteerHint', nested: true },
  { spec: booleanField('warnOnTextOnlyModel'), labelKey: 'warnOnTextOnlyModel', hintKey: 'warnOnTextOnlyModelHint' },
  { spec: numberField('maxEdge'), labelKey: 'maxEdge', hintKey: 'maxEdgeHint' },
  { spec: numberField('targetKb'), labelKey: 'targetKb', hintKey: 'targetKbHint' },
  { spec: numberField('captureTimeoutMs'), labelKey: 'captureTimeoutMs', hintKey: 'captureTimeoutMsHint' },
]

/** 卡片渲染所需的全部状态。 */
export interface ScreenshotCardState extends CardShell {
  /** 每个控件的状态，按字段名索引。 */
  fields: Record<string, CardFieldState>
}

/** 卡片 slot 注册注入的面。 */
export interface ScreenshotCardFace extends CardActions {
  hooks: {
    /** 渲染层以 useScreenshotCard 绑定的快照。 */
    screenshotCard: SnapshotStore<ScreenshotCardState>
  }
}

/** 本插件 settings 分节的形状（卡片只关心它是个记录）。 */
export type ScreenshotSettings = Record<string, unknown>

/** 把 scope 桥到卡片的暂存表单上。 */
export class ScreenshotCardController {
  private readonly form: CardForm<ScreenshotSettings>
  private readonly store: SnapshotStore<ScreenshotCardState>

  /** @param scope - 已绑定到 `screenshot-feedback` 命名空间的 settings scope。 */
  constructor(scope: SettingsScope<ScreenshotSettings>) {
    this.form = new CardForm(scope, CARD_FIELDS.map(entry => entry.spec))
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): ScreenshotCardState {
    const fields: Record<string, CardFieldState> = {}
    for (const entry of CARD_FIELDS) fields[entry.spec.field] = this.form.field(entry.spec.field)
    return { ...this.form.shell(), fields }
  }

  /**
   * 构建卡片 slot 注册注入的面。
   * @returns 快照与表单动作。
   */
  inject(): ScreenshotCardFace {
    return { hooks: { screenshotCard: this.store }, ...this.form.actions() }
  }
}
