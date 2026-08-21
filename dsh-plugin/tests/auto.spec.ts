import { describe, expect, it } from 'vitest'
import type { PostToolDecision, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { applyAutoCapture, matchesToolName, withAdditionalContext } from '../src/auto.js'
import { createAgent, createHarness } from './harness.js'
import { makeConfig } from './make-config.js'
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
    applyAutoCapture(harness.ctx, makeConfig({}))
    const decision = await postExecute(harness)(execOf('edit', createAgent()), success, accept)
    expect(decision.additionalContexts).toBeUndefined()
    expect(harness.spawns).toHaveLength(0)
  })

  it('attaches the screenshot to a matching successful tool call', async () => {
    const harness = createHarness()
    applyAutoCapture(harness.ctx, makeConfig({ autoAfterTools: { enabled: true, delayMs: 0 } }))
    const decision = await postExecute(harness)(execOf('write', createAgent()), success, accept)
    expect(decision.additionalContexts).toHaveLength(1)
    expect(decision.additionalContexts?.[0]?.content.map(block => block.type)).toEqual(['text', 'image'])
    expect(harness.saved).toHaveLength(1)
  })

  it('ignores tools the matcher does not name', async () => {
    const harness = createHarness()
    applyAutoCapture(harness.ctx, makeConfig({ autoAfterTools: { enabled: true, delayMs: 0 } }))
    const decision = await postExecute(harness)(execOf('read', createAgent()), success, accept)
    expect(decision.additionalContexts).toBeUndefined()
  })

  it('skips a failed tool call, whose screen proves nothing', async () => {
    const harness = createHarness()
    applyAutoCapture(harness.ctx, makeConfig({ autoAfterTools: { enabled: true, delayMs: 0 } }))
    const decision = await postExecute(harness)(execOf('edit', createAgent()), failure, accept)
    expect(decision.additionalContexts).toBeUndefined()
    expect(harness.spawns).toHaveLength(0)
  })

  it('never lets a broken screenshot break the tool pipeline', async () => {
    const harness = createHarness()
    harness.failCapture = true
    applyAutoCapture(harness.ctx, makeConfig({ autoAfterTools: { enabled: true, delayMs: 0 } }))
    const decision = await postExecute(harness)(execOf('edit', createAgent()), success, accept)
    expect(decision).toEqual({ kind: 'accept' })
    expect(harness.warnings.join(' ')).toContain('no display')
  })

  it('explains a text-only model once and then keeps quiet', async () => {
    const harness = createHarness()
    harness.modalities = ['text']
    applyAutoCapture(harness.ctx, makeConfig({ autoAfterTools: { enabled: true, delayMs: 0 } }))
    const agent = createAgent()
    const first = await postExecute(harness)(execOf('edit', agent), success, accept)
    const text = first.additionalContexts?.[0]?.content[0]
    expect(text?.type === 'text' && text.text).toContain('does not declare image input')

    const second = await postExecute(harness)(execOf('edit', agent), success, accept)
    expect(second.additionalContexts).toBeUndefined()
    expect(harness.spawns).toHaveLength(0)
  })
})

describe('automatic capture at turn end', () => {
  it('steers exactly once per turn, which is what stops the loop', async () => {
    const harness = createHarness()
    applyAutoCapture(harness.ctx, makeConfig({ autoOnTurnStop: { enabled: true, delayMs: 0 } }))
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
    applyAutoCapture(harness.ctx, makeConfig({ autoOnTurnStop: { enabled: true, delayMs: 0, steer: false } }))
    const { agent, steered, injected } = createAgent()
    await turnStopping(harness)({ agent, turn: 1, signal: new AbortController().signal })
    expect(steered).toHaveLength(0)
    expect(injected).toHaveLength(1)
  })

  it('does nothing while disabled', async () => {
    const harness = createHarness()
    applyAutoCapture(harness.ctx, makeConfig({}))
    const { agent, steered } = createAgent()
    await turnStopping(harness)({ agent, turn: 1, signal: new AbortController().signal })
    expect(steered).toHaveLength(0)
    expect(harness.spawns).toHaveLength(0)
  })

  it('never steers on a failed screenshot, so the turn can still close', async () => {
    const harness = createHarness()
    harness.failCapture = true
    applyAutoCapture(harness.ctx, makeConfig({ autoOnTurnStop: { enabled: true, delayMs: 0 } }))
    const { agent, steered } = createAgent()
    await turnStopping(harness)({ agent, turn: 1, signal: new AbortController().signal })
    expect(steered).toHaveLength(0)
    expect(harness.warnings.join(' ')).toContain('no display')
  })
})
