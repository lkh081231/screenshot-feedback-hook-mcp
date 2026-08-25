/**
 * 卡片暂存表单的行为。这里的假 scope 只实现本表单用到的那几个 seam，写入是
 * **可控地异步**的：两个被修的 bug 都只在「写入还没结算」的窗口里才看得见。
 */

import { describe, expect, it } from 'vitest'
import { CardForm, booleanField, numberField, textField } from '../src/client/card-form.js'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'

type Section = Record<string, unknown>

interface FakeScope {
  scope: SettingsScope<Section>
  /** 让下一批写入挂起，直到 `release()` 被调用。 */
  hold: () => void
  release: () => void
  /** 用户层现在存了什么。 */
  user: Section
}

/**
 * 造一个假 settings scope。
 * @param base - 组合层的值。
 * @param user - 用户层初始存了什么。
 * @returns scope 与操纵它的把手。
 */
function fakeScope(base: Section, user: Section = {}): FakeScope {
  const state = { base, user: { ...user } }
  let gate: Promise<void> | undefined
  let open: (() => void) | undefined
  const listeners = new Set<() => void>()
  const settle = async (): Promise<void> => {
    if (gate !== undefined) await gate
  }
  const snapshot = (): SettingsScopeSnapshot<Section> => ({
    status: 'ready',
    // 合成层：用户层盖在组合层上，与 Host 的解析顺序一致
    value: { ...state.base, ...state.user },
    base: state.base,
    user: state.user,
    revision: 1,
    writable: true,
    mode: 'host',
  })
  const scope = {
    getSnapshot: snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
    set: async (field: string, value: unknown) => {
      await settle()
      state.user = { ...state.user, [field]: value }
    },
    unset: async (field: string) => {
      await settle()
      const next = { ...state.user }
      delete next[field]
      state.user = next
    },
  } as unknown as SettingsScope<Section>
  return {
    scope,
    hold: () => { gate = new Promise<void>((resolve) => { open = resolve }) },
    release: () => { open?.(); gate = undefined },
    get user() { return state.user },
  }
}

const SPECS = [numberField('monitor'), numberField('delayMs'), textField('matcher'), booleanField('flag')]

describe('CardForm 保存', () => {
  it('把暂存的编辑写进用户层，然后清掉草稿', async () => {
    const fake = fakeScope({ monitor: 0, delayMs: 0 })
    const form = new CardForm(fake.scope, SPECS)
    form.actions().edit('monitor', '2')
    expect(form.shell().dirty).toBe(true)

    await form.save()
    expect(fake.user['monitor']).toBe(2)
    expect(form.shell().dirty).toBe(false)
    expect(form.field('monitor').overridden).toBe(true)
  })

  it('保留保存期间打下的草稿，而不是连坐清掉', async () => {
    const fake = fakeScope({ monitor: 0, delayMs: 0 })
    const form = new CardForm(fake.scope, SPECS)
    const actions = form.actions()
    actions.edit('monitor', '2')

    // 控件在写入期间不禁用，用户完全可能接着填下一格
    fake.hold()
    const saving = form.save()
    actions.edit('delayMs', '1500')
    fake.release()
    await saving

    expect(fake.user['monitor']).toBe(2)
    // 以前整批 clear() 会把这条连坐吞掉，用户得重打
    expect(form.field('delayMs').text).toBe('1500')
    expect(form.shell().dirty).toBe(true)

    await form.save()
    expect(fake.user['delayMs']).toBe(1500)
  })

  it('保存期间被改回去的那一条，写完也不会盖掉新草稿', async () => {
    const fake = fakeScope({ monitor: 0 })
    const form = new CardForm(fake.scope, SPECS)
    const actions = form.actions()
    actions.edit('monitor', '2')

    fake.hold()
    const saving = form.save()
    actions.edit('monitor', '5')
    fake.release()
    await saving

    // 落盘的是本次计划里的 2，但屏幕上仍是用户后打的 5，且仍待保存
    expect(fake.user['monitor']).toBe(2)
    expect(form.field('monitor').text).toBe('5')
    expect(form.shell().dirty).toBe(true)
  })

  it('不合法的草稿挡住整批保存而不是被丢掉', async () => {
    const fake = fakeScope({ monitor: 0, delayMs: 0 })
    const form = new CardForm(fake.scope, SPECS)
    const actions = form.actions()
    actions.edit('monitor', '2')
    actions.edit('delayMs', '不是数字')

    expect(form.shell().invalid).toBe(true)
    await form.save()
    expect(fake.user['monitor']).toBeUndefined()
    expect(form.field('monitor').text).toBe('2')
  })
})

describe('CardForm 覆盖判定', () => {
  it('钉得住一个刚好等于组合层默认值的覆盖', async () => {
    // 组合层给了 1；用户想在自己那层也钉成 1，这样组合层以后改了也不会跟着漂
    const fake = fakeScope({ monitor: 1 })
    const form = new CardForm(fake.scope, SPECS)
    form.actions().edit('monitor', '1')

    // 以前这条被 plan() 当成「白写」跳过：dirty 为 false，连 Discard 都点不动
    expect(form.shell().dirty).toBe(true)
    await form.save()
    expect(Object.hasOwn(fake.user, 'monitor')).toBe(true)
    expect(fake.user['monitor']).toBe(1)
  })

  it('徽标与用户层的实情一致，而不是自说自话', async () => {
    const fake = fakeScope({ monitor: 1 })
    const form = new CardForm(fake.scope, SPECS)
    form.actions().edit('monitor', '1')
    // 徽标已经在说「已覆盖」，那保存后用户层里就必须真有这条记录 ——
    // 按 Host 契约，字段的**存在**才是覆盖的标志。以前徽标亮着但什么都没写。
    expect(form.field('monitor').overridden).toBe(true)
    await form.save()
    expect(form.field('monitor').overridden).toBe(Object.hasOwn(fake.user, 'monitor'))
    expect(form.field('monitor').overridden).toBe(true)
  })

  it('把草稿改回用户层已存的值不算一次写入', async () => {
    const fake = fakeScope({ monitor: 0 }, { monitor: 3 })
    const form = new CardForm(fake.scope, SPECS)
    form.actions().edit('monitor', '3')
    expect(form.shell().dirty).toBe(false)
  })

  it('清空一个已覆盖的字段会让它重新继承组合层', async () => {
    const fake = fakeScope({ monitor: 0 }, { monitor: 3 })
    const form = new CardForm(fake.scope, SPECS)
    form.actions().resetField('monitor')
    expect(form.shell().dirty).toBe(true)

    await form.save()
    expect(Object.hasOwn(fake.user, 'monitor')).toBe(false)
    expect(form.field('monitor').overridden).toBe(false)
    expect(form.field('monitor').text).toBe('0')
  })

  it('重置一个本来就没被覆盖的字段是空操作', () => {
    const fake = fakeScope({ monitor: 0 })
    const form = new CardForm(fake.scope, SPECS)
    form.actions().resetField('monitor')
    expect(form.shell().dirty).toBe(false)
  })
})
