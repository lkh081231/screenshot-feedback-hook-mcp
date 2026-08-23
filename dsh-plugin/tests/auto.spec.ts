import { describe, expect, it } from 'vitest'
import type { PostToolDecision, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { applyAutoCapture, matchesToolName, withAdditionalContext } from '../src/auto.js'
import { createAgent, createHarness } from './harness.js'
import { makeConfig, makeSource } from './make-config.js'
import type { FakeAgent, Harness } from './harness.js'

type PostExecute = (exec: ToolExecution, result: ToolExecutionResult, next: () => Promise<PostToolDecision>) => Promise<PostToolDecision>
type TurnStopping = (payload: { agent: unknown; turn: number; signal: AbortSignal }) => Promise<void>

function postExecute(harness: Harness): PostExecute {
  return harness.handlers.get('tools/post-execute') as unknown as PostExecute
}

function turnStopping(harness: Harness): TurnStopping {
  return harness.handlers.get('agent/turn-stopping') as unknown as TurnStopping
}

function execOf(name: string, agent: FakeAgent): ToolExecution {
  return { name, agent: agent.agent, signal: new AbortController().signal } as unknown as ToolExecution
}

/** `ToolExecution.agent` 是可选的；没有 agent 时闸门必然给出 unresolved 类拒绝。 */
function agentlessExecOf(name: string): ToolExecution {
  return { name, signal: new AbortController().signal } as unknown as ToolExecution
}

/** 决策上那条附加消息的首块文字。 */
function contextText(decision: PostToolDecision): string {
  const block = decision.additionalContexts?.[0]?.content[0]
  return block?.type === 'text' ? block.text : ''
}

const success = { isError: false } as unknown as ToolExecutionResult
const failure = { isError: true } as unknown as ToolExecutionResult
const accept = async (): Promise<PostToolDecision> => ({ kind: 'accept' })

describe('matchesToolName', () => {
  it('treats a plain pipe pattern as exact alternation', () => {
    expect(matchesToolName('edit|write|str_replace_editor', 'edit')).toBe(true)
    expect(matchesToolName('edit|write|str_replace_editor', 'str_replace_editor')).toBe(true)
    // Claude Code 的大写工具名在 dsh 上不该命中
    expect(matchesToolName('edit|write', 'Edit')).toBe(false)
    expect(matchesToolName('edit|write', 'read')).toBe(false)
    // 字面量交替是精确匹配，不是子串
    expect(matchesToolName('edit', 'str_replace_editor')).toBe(false)
  })

  it('falls back to an unanchored regex for anything else', () => {
    expect(matchesToolName('^mcp__.*', 'mcp__x__y')).toBe(true)
    expect(matchesToolName('edit.*', 'editor_thing')).toBe(true)
  })

  it('matches everything for an empty or star matcher', () => {
    expect(matchesToolName('', 'anything')).toBe(true)
    expect(matchesToolName('*', 'anything')).toBe(true)
  })

  it('isolates an invalid regex as a non-match instead of throwing', () => {
    expect(matchesToolName('(unclosed', 'edit')).toBe(false)
  })
})

describe('withAdditionalContext', () => {
  it('keeps the downstream decision and its existing contexts', () => {
    const existing = { id: 'a' } as never
    const added = { id: 'b' } as never
    const decision = withAdditionalContext({ kind: 'block', feedback: [], additionalContexts: [existing] }, added)
    expect(decision.kind).toBe('block')
    expect(decision.additionalContexts).toEqual([existing, added])
  })
})

describe('automatic capture after tools', () => {
  it('stays out of the way while disabled', async () => {
    const harness = createHarness()
    applyAutoCapture(harness.ctx, makeSource({}))
    const decision = await postExecute(harness)(execOf('edit', createAgent()), success, accept)
    expect(decision.additionalContexts).toBeUndefined()
    expect(harness.spawns).toHaveLength(0)
  })

  it('attaches the screenshot to a matching successful tool call', async () => {
    const harness = createHarness()
    applyAutoCapture(harness.ctx, makeSource({ autoAfterTools: true, autoAfterToolsDelayMs: 0 }))
    const decision = await postExecute(harness)(execOf('write', createAgent()), success, accept)
    expect(decision.additionalContexts).toHaveLength(1)
    expect(decision.additionalContexts?.[0]?.content.map(block => block.type)).toEqual(['text', 'image'])
    expect(harness.saved).toHaveLength(1)
  })

  it('ignores tools the matcher does not name', async () => {
    const harness = createHarness()
    applyAutoCapture(harness.ctx, makeSource({ autoAfterTools: true, autoAfterToolsDelayMs: 0 }))
    const decision = await postExecute(harness)(execOf('read', createAgent()), success, accept)
    expect(decision.additionalContexts).toBeUndefined()
  })

  it('skips a failed tool call, whose screen proves nothing', async () => {
    const harness = createHarness()
    applyAutoCapture(harness.ctx, makeSource({ autoAfterTools: true, autoAfterToolsDelayMs: 0 }))
    const decision = await postExecute(harness)(execOf('edit', createAgent()), failure, accept)
    expect(decision.additionalContexts).toBeUndefined()
    expect(harness.spawns).toHaveLength(0)
  })

  it('never lets a broken screenshot break the tool pipeline', async () => {
    const harness = createHarness()
    harness.failCapture = true
    applyAutoCapture(harness.ctx, makeSource({ autoAfterTools: true, autoAfterToolsDelayMs: 0 }))
    const decision = await postExecute(harness)(execOf('edit', createAgent()), success, accept)
    expect(decision).toEqual({ kind: 'accept' })
    expect(harness.warnings.join(' ')).toContain('no display')
  })

  it('explains a text-only model once and then keeps quiet', async () => {
    const harness = createHarness()
    harness.modalities = ['text']
    applyAutoCapture(harness.ctx, makeSource({ autoAfterTools: true, autoAfterToolsDelayMs: 0 }))
    const agent = createAgent()
    const first = await postExecute(harness)(execOf('edit', agent), success, accept)
    const text = first.additionalContexts?.[0]?.content[0]
    expect(text?.type === 'text' && text.text).toContain('does not declare image input')

    const second = await postExecute(harness)(execOf('edit', agent), success, accept)
    expect(second.additionalContexts).toBeUndefined()
    expect(harness.spawns).toHaveLength(0)
  })

  it('also warns only once when the execution carries no agent', async () => {
    const harness = createHarness()
    applyAutoCapture(harness.ctx, makeSource({ autoAfterTools: true, autoAfterToolsDelayMs: 0 }))
    // 没有 agent 就没有可挂载的 WeakSet 键；以前这条路径每次触发都重新注入同一段文字
    const first = await postExecute(harness)(agentlessExecOf('edit'), success, accept)
    expect(contextText(first)).toContain('could not be resolved')

    const second = await postExecute(harness)(agentlessExecOf('edit'), success, accept)
    expect(second.additionalContexts).toBeUndefined()
  })

  it('treats a model-catalog failure as transient instead of as a text-only model', async () => {
    const harness = createHarness()
    harness.resolveFails = true
    applyAutoCapture(harness.ctx, makeSource({ autoAfterTools: true, autoAfterToolsDelayMs: 0 }))
    const agent = createAgent()

    const during = await postExecute(harness)(execOf('edit', agent), success, accept)
    expect(during).toEqual({ kind: 'accept' })
    expect(harness.warnings.join(' ')).toContain('temporarily unreachable')
    expect(harness.spawns).toHaveLength(0)

    // 关键：瞬时故障不该吃掉提醒额度，否则唯一可执行的那条建议被永久压制
    harness.resolveFails = false
    harness.modalities = ['text']
    const after = await postExecute(harness)(execOf('edit', agent), success, accept)
    expect(contextText(after)).toContain('does not declare image input')
  })

  it('budgets each rejection reason separately, so the actionable one still lands', async () => {
    const harness = createHarness()
    harness.llmMounted = false
    applyAutoCapture(harness.ctx, makeSource({ autoAfterTools: true, autoAfterToolsDelayMs: 0 }))
    const agent = createAgent()

    const unresolved = await postExecute(harness)(execOf('edit', agent), success, accept)
    expect(contextText(unresolved)).toContain('could not be resolved')

    // 合成一笔账的话，先撞上的 unresolved 会把「换个支持图片的模型」永久挤掉
    harness.llmMounted = true
    harness.modalities = ['text']
    const textOnly = await postExecute(harness)(execOf('edit', agent), success, accept)
    expect(contextText(textOnly)).toContain('does not declare image input')
  })

  it('stays silent about the gate when the deployment turned warnings off', async () => {
    const harness = createHarness()
    harness.modalities = ['text']
    applyAutoCapture(harness.ctx, makeSource({
      autoAfterTools: true,
      autoAfterToolsDelayMs: 0,
      warnOnTextOnlyModel: false,
    }))
    const decision = await postExecute(harness)(execOf('edit', createAgent()), success, accept)
    expect(decision.additionalContexts).toBeUndefined()
    expect(harness.spawns).toHaveLength(0)
  })
})

describe('live configuration', () => {
  it('reads the source on every trigger, so a settings-page save takes effect without a restart', async () => {
    const harness = createHarness()
    // installSettingsSection 会在挂上 settings 后换掉这个 thunk；插件必须按次读，
    // 而不是缓存 apply() 那一刻的快照，否则设置页存完要重启才生效
    let current = makeConfig({})
    applyAutoCapture(harness.ctx, () => current)

    const off = await postExecute(harness)(execOf('edit', createAgent()), success, accept)
    expect(off.additionalContexts).toBeUndefined()

    current = makeConfig({ autoAfterTools: true, autoAfterToolsDelayMs: 0 })
    const on = await postExecute(harness)(execOf('edit', createAgent()), success, accept)
    expect(on.additionalContexts).toHaveLength(1)
    expect(harness.saved).toHaveLength(1)
  })

  it('picks up a matcher change without re-registering the listener', async () => {
    const harness = createHarness()
    let current = makeConfig({ autoAfterTools: true, autoAfterToolsDelayMs: 0 })
    applyAutoCapture(harness.ctx, () => current)

    const before = await postExecute(harness)(execOf('bash', createAgent()), success, accept)
    expect(before.additionalContexts).toBeUndefined()

    current = makeConfig({ autoAfterTools: true, autoAfterToolsDelayMs: 0, autoAfterToolsMatcher: 'bash' })
    const after = await postExecute(harness)(execOf('bash', createAgent()), success, accept)
    expect(after.additionalContexts).toHaveLength(1)
  })
})

describe('automatic capture at turn end', () => {
  it('steers exactly once per turn, which is what stops the loop', async () => {
    const harness = createHarness()
    applyAutoCapture(harness.ctx, makeSource({ autoOnTurnStop: true, autoOnTurnStopDelayMs: 0 }))
    const { agent, steered } = createAgent()
    const signal = new AbortController().signal
    const stop = turnStopping(harness)

    await stop({ agent, turn: 4, signal })
    // steering 让模型再跑一步，回到同一个 turn 的 stop 边界；这次必须放行
    await stop({ agent, turn: 4, signal })
    expect(steered).toHaveLength(1)
    expect(harness.spawns).toHaveLength(1)

    await stop({ agent, turn: 5, signal })
    expect(steered).toHaveLength(2)
  })

  it('injects without steering when the deployment asks for it', async () => {
    const harness = createHarness()
    applyAutoCapture(harness.ctx, makeSource({ autoOnTurnStop: true, autoOnTurnStopDelayMs: 0, autoOnTurnStopSteer: false }))
    const { agent, steered, injected } = createAgent()
    await turnStopping(harness)({ agent, turn: 1, signal: new AbortController().signal })
    expect(steered).toHaveLength(0)
    expect(injected).toHaveLength(1)
  })

  it('does nothing while disabled', async () => {
    const harness = createHarness()
    applyAutoCapture(harness.ctx, makeSource({}))
    const { agent, steered } = createAgent()
    await turnStopping(harness)({ agent, turn: 1, signal: new AbortController().signal })
    expect(steered).toHaveLength(0)
    expect(harness.spawns).toHaveLength(0)
  })

  it('never steers on a failed screenshot, so the turn can still close', async () => {
    const harness = createHarness()
    harness.failCapture = true
    applyAutoCapture(harness.ctx, makeSource({ autoOnTurnStop: true, autoOnTurnStopDelayMs: 0 }))
    const { agent, steered } = createAgent()
    await turnStopping(harness)({ agent, turn: 1, signal: new AbortController().signal })
    expect(steered).toHaveLength(0)
    expect(harness.warnings.join(' ')).toContain('no display')
  })
})
