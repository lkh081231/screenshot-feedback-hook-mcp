import { describe, expect, it } from 'vitest'
import { ATTACHMENT_MAX_EDGE, DEFAULT_MAX_EDGE, DEFAULT_TARGET_KB, DEFAULT_TOOL_MATCHER } from '../src/config.js'
import { makeConfig } from './make-config.js'

describe('Config', () => {
  it('fills every default, including the nested auto sections', () => {
    expect(makeConfig({})).toEqual({
      command: 'uvx',
      args: ['screenshot-feedback-hook-mcp'],
      cwd: '',
      monitor: 0,
      delayMs: 0,
      maxEdge: DEFAULT_MAX_EDGE,
      targetKb: DEFAULT_TARGET_KB,
      captureTimeoutMs: 30_000,
      warnOnTextOnlyModel: true,
      autoAfterTools: false,
      autoAfterToolsMatcher: DEFAULT_TOOL_MATCHER,
      autoAfterToolsDelayMs: 1_500,
      autoOnTurnStop: false,
      autoOnTurnStopDelayMs: 1_500,
      autoOnTurnStopSteer: true,
    })
  })

  it('keeps both automatic timings off by default', () => {
    const config = makeConfig({})
    expect(config.autoAfterTools).toBe(false)
    expect(config.autoOnTurnStop).toBe(false)
  })

  it('defaults the tool matcher to dsh tool names, not Claude Code ones', () => {
    expect(DEFAULT_TOOL_MATCHER).toBe('edit|write|str_replace_editor')
  })

  it('refuses a maxEdge the attachment store would reject anyway', () => {
    expect(() => makeConfig({ maxEdge: ATTACHMENT_MAX_EDGE + 1 })).toThrow()
    expect(makeConfig({ maxEdge: ATTACHMENT_MAX_EDGE }).maxEdge).toBe(ATTACHMENT_MAX_EDGE)
  })

  it('leaves the sibling auto fields on their defaults when only the switch is set', () => {
    const config = makeConfig({ autoAfterTools: true })
    expect(config.autoAfterTools).toBe(true)
    expect(config.autoAfterToolsMatcher).toBe(DEFAULT_TOOL_MATCHER)
    expect(config.autoAfterToolsDelayMs).toBe(1_500)
  })

  it('keeps every field a flat scalar, which is what the settings card writes', () => {
    for (const [field, value] of Object.entries(makeConfig({}))) {
      // args 是这份 schema 里唯一的非标量，卡片刻意不编辑它
      if (field === 'args') continue
      expect(typeof value, field).not.toBe('object')
    }
  })
})
