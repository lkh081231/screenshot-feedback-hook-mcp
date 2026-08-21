/**
 * 设置 → 插件 → 插件配置 里的那张卡片。
 *
 * 卡片自带外观：bundle 纯净度门禁禁止以值的形式导入 dsh 自带卡片的外观与
 * 表单模型，所以这里用 `--dsw-alias-*` 主题变量画一份形状一致的，不引入
 * CSS 文件（省掉一整条 CSS Modules 构建管线）。
 *
 * 命名空间不可用时整张卡片不渲染：没有组装本插件的部署不该看到它的任何痕迹。
 * @module dsh-screenshot-feedback-hook-mcp/client/ScreenshotCard
 */

import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// 类型 only：`settings.plugin.item` 这个 keyed slot 的声明由设置页那个包拥有。
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { CARD_FIELDS } from './controller.js'
import type { ScreenshotCardFace, ScreenshotCardState } from './controller.js'
import type { CardFieldState } from './card-form.js'
import type { ScreenshotLocaleKey } from './locales.js'

/** 渲染层为本卡片绑定的 props。 */
export type ScreenshotCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'screenshot-feedback'>
  & InjectFace<ScreenshotCardFace>

const styles = {
  card: {
    listStyle: 'none',
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 12,
    background: 'var(--dsw-alias-bg-layer-3)',
  },
  cardOpen: { background: 'var(--dsw-alias-bg-layer-2)', borderColor: 'var(--dsw-alias-label-dimmed)' },
  header: {
    width: '100%',
    appearance: 'none',
    border: 0,
    background: 'none',
    font: 'inherit',
    color: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '14px 16px',
    borderRadius: 12,
  },
  headText: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 },
  name: { fontSize: 15, fontWeight: 600, lineHeight: 1.4, color: 'var(--dsw-alias-label-primary)' },
  description: { fontSize: 13, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' },
  pending: {
    flex: 'none',
    borderRadius: 999,
    padding: '1px 8px',
    fontSize: 11,
    lineHeight: '17px',
    fontWeight: 500,
    whiteSpace: 'nowrap',
    background: 'var(--dsw-alias-bg-module-platform)',
    color: 'var(--dsw-alias-label-secondary)',
  },
  chevron: { flex: 'none', fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' },
  body: { borderTop: '1px solid var(--dsw-alias-border-l2)', margin: '0 16px', paddingBottom: 8 },
  note: { margin: '12px 0 0', fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' },
  row: { display: 'flex', flexDirection: 'column', gap: 4, padding: '12px 0' },
  rowNested: { paddingLeft: 16, borderLeft: '2px solid var(--dsw-alias-border-l2)' },
  rowHead: { display: 'flex', alignItems: 'center', gap: 8 },
  label: { flex: 1, minWidth: 0, fontSize: 13, color: 'var(--dsw-alias-label-primary)' },
  badge: {
    flex: 'none',
    borderRadius: 999,
    padding: '1px 8px',
    fontSize: 11,
    lineHeight: '17px',
    background: 'var(--dsw-alias-bg-module-platform)',
    color: 'var(--dsw-alias-label-secondary)',
  },
  hint: { margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' },
  invalid: { margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-error)' },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    padding: '12px 0 4px',
    borderTop: '1px solid var(--dsw-alias-border-l2)',
  },
  failed: { flex: 1, minWidth: 0, margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-error)' },
} satisfies Record<string, CSSProperties>

/** 一行控件的 props。 */
interface FieldRowProps {
  t: (key: ScreenshotLocaleKey) => string
  labelKey: ScreenshotLocaleKey
  hintKey: ScreenshotLocaleKey
  kind: 'number' | 'text' | 'boolean'
  nested: boolean
  state: CardFieldState
  disabled: boolean
  onEdit: (text: string) => void
  onReset: () => void
}

/**
 * 渲染一行控件：标签、覆盖徽标、重置入口、控件本身与说明。
 * @param props - 文案、控件形态与当前草稿状态。
 * @returns 该行。
 */
function FieldRow(props: FieldRowProps): ReactNode {
  const { state, t } = props
  const rowStyle = props.nested ? { ...styles.row, ...styles.rowNested } : styles.row
  const control = props.kind === 'boolean'
    ? (
      <Button
        variant="outline"
        size="sm"
        disabled={props.disabled}
        aria-pressed={state.text === 'true'}
        onClick={() => { props.onEdit(state.text === 'true' ? 'false' : 'true') }}
      >
        {t(state.text === 'true' ? 'on' : 'off')}
      </Button>
      )
    : (
      <Input
        value={state.text}
        inputMode={props.kind === 'number' ? 'numeric' : 'text'}
        disabled={props.disabled}
        aria-label={t(props.labelKey)}
        onChange={(event) => { props.onEdit(event.target.value) }}
      />
      )
  return (
    <div style={rowStyle}>
      <div style={styles.rowHead}>
        <span style={styles.label}>{t(props.labelKey)}</span>
        {state.overridden ? <span style={styles.badge}>{t('overridden')}</span> : null}
        {state.overridden
          ? (
            <Button variant="ghost" size="sm" disabled={props.disabled} onClick={props.onReset}>
              {t('reset')}
            </Button>
            )
          : null}
        {control}
      </div>
      <p style={state.invalid ? styles.invalid : styles.hint}>
        {state.invalid ? t('invalid') : t(props.hintKey)}
      </p>
    </div>
  )
}

/**
 * 渲染截图反馈插件的配置卡片。
 * @param props - 文案、卡片快照与表单动作。
 * @returns 卡片；命名空间不可用时什么都不渲染。
 */
export function ScreenshotCard(props: ScreenshotCardProps): ReactNode {
  const [open, setOpen] = useState(false)
  const { t } = props
  const state: ScreenshotCardState = props.useScreenshotCard(snapshot => snapshot)
  if (!state.available) return null
  const disabled = !state.writable
  const blocked = !state.dirty || state.invalid || state.saving
  return (
    <li style={open ? { ...styles.card, ...styles.cardOpen } : styles.card}>
      <button
        type="button"
        style={styles.header as CSSProperties}
        aria-expanded={open}
        aria-label={`${t(open ? 'collapse' : 'expand')}: ${t('title')}`}
        onClick={() => { setOpen(!open) }}
      >
        <span style={styles.headText as CSSProperties}>
          <span style={styles.name}>{t('title')}</span>
          <span style={styles.description}>{t('description')}</span>
        </span>
        {state.dirty ? <span style={styles.pending as CSSProperties}>{t('unsaved')}</span> : null}
        <span style={styles.chevron as CSSProperties} aria-hidden>{open ? '▲' : '▼'}</span>
      </button>
      {open
        ? (
          <div style={styles.body}>
            {disabled ? <p style={styles.note} role="status">{t('readOnly')}</p> : null}
            {CARD_FIELDS.map(entry => (
              <FieldRow
                key={entry.spec.field}
                t={t}
                labelKey={entry.labelKey}
                hintKey={entry.hintKey}
                kind={entry.spec.kind}
                nested={entry.nested === true}
                state={state.fields[entry.spec.field] ?? { text: '', overridden: false, invalid: false }}
                disabled={disabled}
                onEdit={(text) => { props.edit(entry.spec.field, text) }}
                onReset={() => { props.resetField(entry.spec.field) }}
              />
            ))}
            <p style={styles.note}>{t('advancedNote')}</p>
            <div style={styles.footer}>
              {state.failed ? <p style={styles.failed}>{t('saveFailed')}</p> : null}
              <Button variant="outline" size="sm" disabled={!state.dirty || state.saving} onClick={props.discard}>
                {t('discard')}
              </Button>
              <Button variant="primary" size="sm" disabled={blocked} onClick={props.save}>
                {t(state.saving ? 'saving' : 'save')}
              </Button>
            </div>
          </div>
          )
        : null}
    </li>
  )
}
