/**
 * 卡片的暂存表单。
 *
 * 每一次 settings 写入都是一次带 revision 栅栏的持久文档变更，所以控件不能
 * 「一失焦就写」——那会把一次编辑变成用户没要求、也没机会预览的写入。这里把
 * 用户输入暂存成草稿文本，只有点保存才写，屏幕上看到的就是保存后会存下的。
 *
 * 一个字段是否「被覆盖」，看的是它**出现在**用户层里，而不是值等不等于默认值：
 * 一个刚好等于组合层默认值的覆盖，仍然是覆盖。
 *
 * 这一份是本插件自己的实现：客户端 bundle 纯净度门禁禁止以值的形式导入 dsh
 * 自带卡片的表单模型，所以暂存与 revision 设栅要自己拥有。
 * @module dsh-screenshot-feedback-hook-mcp/client/card-form
 */

import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SettingsScope, SettingsScopeSnapshot, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** 一个字段的草稿文本在保存时执行的写入。 */
export type FieldWrite =
  | { kind: 'set'; value: unknown }
  | { kind: 'clear' }

/** 一个 settings 字段在「存储值」与「草稿文本」之间的换算。 */
export interface CardFieldSpec {
  /** 命名空间分节里的字段名。 */
  field: string
  /** 控件形态，决定卡片渲染成输入框还是开关。 */
  kind: 'number' | 'text' | 'boolean'
  /** 把存储值渲染成草稿文本；分节里没有值时给空串。 */
  format: (value: unknown) => string
  /** 这段草稿文本对应的写入；undefined 表示这不是该字段接受的值，会挡住保存而不是被丢弃。 */
  parse: (text: string) => FieldWrite | undefined
}

/** 一个控件当前的状态。 */
export interface CardFieldState {
  /** 控件渲染的草稿文本。 */
  text: string
  /** 保存后这个字段是否会在用户层留下一条记录（暂存的编辑自己说了算，徽标预览的是保存结果）。 */
  overridden: boolean
  /** 草稿不是该字段接受的值，会挡住保存。 */
  invalid: boolean
}

/** 每张卡片共享的表单状态。 */
export interface CardShell {
  /** 命名空间没有被服务给这个客户端时为 false，卡片整张不渲染。 */
  available: boolean
  /** Host 文档是否接受写入。 */
  writable: boolean
  /** 是否有保存会写下去的编辑。 */
  dirty: boolean
  /** 是否有草稿不合法，从而挡住保存。 */
  invalid: boolean
  /** 是否正在写入。 */
  saving: boolean
  /** 上一次保存没有按暂存落盘；下一次编辑或保存会清掉。 */
  failed: boolean
}

/** 卡片注入给渲染层的写操作。 */
export interface CardActions {
  /** 为某个字段暂存草稿文本。 */
  edit: (field: string, text: string) => void
  /** 暂存一次清除，保存后该字段重新继承组合层。 */
  resetField: (field: string) => void
  /** 写下所有暂存编辑，再按 Host 实际接受的值重新取种。 */
  save: () => void
  /** 丢弃所有暂存编辑。 */
  discard: () => void
}

/** 一条暂存编辑。 */
interface StagedEdit {
  text: string
  /** 无论文本是什么，这条编辑都清除该字段。 */
  clear: boolean
}

/** 一条暂存编辑解析出的写入计划。 */
interface PlannedWrite {
  field: string
  /** 执行写入并回答 Host 事后是否持有暂存值；undefined 表示草稿不合法。 */
  run: (() => Promise<boolean>) | undefined
}

/**
 * 整数字段：空草稿清除该字段，其他非有限数字挡住保存。
 * @param field - 分节里的字段名。
 * @returns 换算规格。
 */
export function numberField(field: string): CardFieldSpec {
  return {
    field,
    kind: 'number',
    format: value => typeof value === 'number' ? String(value) : '',
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      const parsed = Number(trimmed)
      return Number.isFinite(parsed) ? { kind: 'set', value: parsed } : undefined
    },
  }
}

/**
 * 自由文本字段：清空控件再保存，等同于重置。
 * @param field - 分节里的字段名。
 * @returns 换算规格。
 */
export function textField(field: string): CardFieldSpec {
  return {
    field,
    kind: 'text',
    format: value => typeof value === 'string' ? value : '',
    parse: (text) => {
      const trimmed = text.trim()
      return trimmed === '' ? { kind: 'clear' } : { kind: 'set', value: trimmed }
    },
  }
}

/**
 * 开关字段。草稿只会由开关控件产生，所以只接受 `true` / `false` 两种文本。
 * @param field - 分节里的字段名。
 * @returns 换算规格。
 */
export function booleanField(field: string): CardFieldSpec {
  return {
    field,
    kind: 'boolean',
    format: value => typeof value === 'boolean' ? String(value) : '',
    parse: (text) => {
      if (text === '') return { kind: 'clear' }
      if (text === 'true') return { kind: 'set', value: true }
      if (text === 'false') return { kind: 'set', value: false }
      return undefined
    },
  }
}

/** 把一个已解析的 settings 分节当作字符串键的记录读取。 */
function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

/**
 * 在一个 settings 命名空间上暂存一张卡片的编辑，并在保存时写下去。
 *
 * 用快照 store 发布：slot 组件通过快照选择器读取，而 scope 与本地草稿会各自
 * 变化，所以每次投影都由两者重新组合出来。
 */
export class CardForm<T> {
  private readonly specs: Map<string, CardFieldSpec>
  private readonly staged = new Map<string, StagedEdit>()
  private readonly listeners = new Set<() => void>()
  private saving = false
  private failed = false

  /**
   * @param scope - 已绑定到本卡片命名空间的 settings scope。
   * @param specs - 本卡片编辑的字段。
   */
  constructor(private readonly scope: SettingsScope<T>, specs: readonly CardFieldSpec[]) {
    this.specs = new Map(specs.map(spec => [spec.field, spec]))
    scope.subscribe(() => { this.publish() })
  }

  /**
   * 发布本表单的一份投影，scope 或草稿一变就重建。
   * @param project - 从当前读数构建卡片状态。
   * @returns 卡片组件通过绑定选择器读取的 store。
   */
  bind<S>(project: () => S): SnapshotStore<S> {
    const store = createSnapshotStore(project())
    this.listeners.add(() => { store.set(project()) })
    return store
  }

  /**
   * 读卡片级状态：Host 服务了什么，以及保存会做什么。
   * @returns 共享的表单状态。
   */
  shell(): CardShell {
    const snapshot = this.scope.getSnapshot()
    const plan = this.plan()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: plan.length > 0,
      invalid: plan.some(item => item.run === undefined),
      saving: this.saving,
      failed: this.failed,
    }
  }

  /**
   * 读一个控件的状态。
   * @param field - 本卡片声明过的字段名。
   * @returns 草稿文本、保存后是否留下覆盖、以及是否不合法。
   */
  field(field: string): CardFieldState {
    const spec = this.spec(field)
    const staged = this.staged.get(field)
    if (staged === undefined) {
      return { text: spec.format(this.sectionValue(field)), overridden: this.stored(field), invalid: false }
    }
    const write = staged.clear ? { kind: 'clear' as const } : spec.parse(staged.text)
    return { text: staged.text, overridden: write?.kind === 'set', invalid: write === undefined }
  }

  /**
   * 构建绑定到本表单的编辑、重置、保存、丢弃动作。
   * @returns 卡片 slot 注册注入的动作集。
   */
  actions(): CardActions {
    return {
      edit: (field, text) => { this.stage(field, { text, clear: false }) },
      resetField: (field) => {
        this.stage(field, { text: this.spec(field).format(this.baseValue(field)), clear: true })
      },
      save: () => { void this.save() },
      discard: () => {
        if (this.staged.size === 0 && !this.failed) return
        this.staged.clear()
        this.failed = false
        this.publish()
      },
    }
  }

  /**
   * 写下所有暂存编辑，再按 Host 实际接受的值重新取种。
   *
   * 值有没有被接受只有 Host 说了算——schema 表达不了的约束归它的校验器所有——
   * 所以结果是从分节回读的，而不是在这里预测。没落盘的保存保留草稿，让用户
   * 改而不是重打。
   * @returns 所有写入与回读结算后的完成。
   */
  async save(): Promise<void> {
    const plan = this.plan()
    if (plan.length === 0 || this.saving || plan.some(item => item.run === undefined)) return
    // 控件在写入期间**不禁用**（禁用会让光标乱跳），所以草稿随时可能被改。逐条写完
    // 只清掉「确实落了盘、而且这期间没被重新编辑」的那一条：stage() 每次都塞一个新
    // 对象，比对象身份就足以认出「还是我刚写下去的那条」。整批 clear() 会把用户在
    // 保存那几百毫秒里打的字连坐吞掉——恰好是这个方法承诺不做的事。
    const inFlight = new Map(this.staged)
    this.saving = true
    this.failed = false
    this.publish()
    let landed = true
    for (const item of plan) {
      const settled = await (item.run as () => Promise<boolean>)()
      if (settled && this.staged.get(item.field) === inFlight.get(item.field)) this.staged.delete(item.field)
      landed = settled && landed
    }
    this.saving = false
    this.failed = !landed
    this.publish()
  }

  /**
   * 保存会执行的写入清单。草稿不合法的条目不带 run：表单依然是 dirty，保存
   * 会被拒绝而不是把这条编辑丢掉。
   * @returns 按字段暂存顺序排列的写入计划。
   */
  private plan(): PlannedWrite[] {
    const plan: PlannedWrite[] = []
    for (const [field, staged] of this.staged) {
      const spec = this.spec(field)
      if (staged.clear) {
        if (this.stored(field)) plan.push({ field, run: () => this.clear(field) })
        continue
      }
      // 一次写入白不白写，看的是**用户层里已经有什么**，不是合成后的解析值。拿解析值
      // 比的话，「把一个恰好等于组合层默认值的覆盖钉进用户层」这件事永远排不进计划，
      // 而它是 Host 契约明写支持的概念（见本模块头与 SettingsScopeSnapshot.user 的
      // 注释：字段的**存在**才是覆盖的标志，比较值根本看不见它）。
      if (this.stored(field) && staged.text === spec.format(this.userLayer()?.[field])) continue
      const write = spec.parse(staged.text)
      if (write === undefined) plan.push({ field, run: undefined })
      else if (write.kind === 'clear') plan.push({ field, run: () => this.clear(field) })
      else plan.push({ field, run: () => this.store(field, write.value) })
    }
    return plan
  }

  private async clear(field: string): Promise<boolean> {
    await this.scope.unset(field)
    return !this.stored(field)
  }

  private async store(field: string, value: unknown): Promise<boolean> {
    await this.scope.set(field, value)
    return this.userLayer()?.[field] === value
  }

  private stage(field: string, edit: StagedEdit): void {
    this.staged.set(field, edit)
    this.failed = false
    this.publish()
  }

  private spec(field: string): CardFieldSpec {
    const spec = this.specs.get(field)
    // 每个调用点用的都是本卡片声明过的字段；漏掉一个是接线错误，不该退化成一个静默失效的控件
    if (spec === undefined) throw new Error(`screenshot-feedback card has no field ${field}`)
    return spec
  }

  private snapshotOf(): SettingsScopeSnapshot<T> {
    return this.scope.getSnapshot()
  }

  private sectionValue(field: string): unknown {
    return record(this.snapshotOf().value)?.[field]
  }

  private baseValue(field: string): unknown {
    return record(this.snapshotOf().base)?.[field]
  }

  private userLayer(): Record<string, unknown> | undefined {
    return record(this.snapshotOf().user)
  }

  private stored(field: string): boolean {
    const user = this.userLayer()
    return user !== undefined && Object.hasOwn(user, field)
  }

  private publish(): void {
    for (const listener of this.listeners) listener()
  }
}
