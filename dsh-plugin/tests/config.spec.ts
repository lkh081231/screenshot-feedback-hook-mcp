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
      autoAfterTools: { enabled: false, matcher: DEFAULT_TOOL_MATCHER, delayMs: 1_500 },
      autoOnTurnStop: { enabled: false, delayMs: 1_500, steer: true },
    })
  })

  it('keeps both automatic timings off by default', () => {
    const config = makeConfig({})
    expect(config.autoAfterTools.enabled).toBe(false)
    expect(config.autoOnTurnStop.enabled).toBe(false)
  })

  it('defaults the tool matcher to dsh tool names, not Claude Code ones', () => {
    expect(DEFAULT_TOOL_MATCHER).toBe('edit|write|str_replace_editor')
  })

  it('refuses a maxEdge the attachment store would reject anyway', () => {
    expect(() => makeConfig({ maxEdge: ATTACHMENT_MAX_EDGE + 1 })).toThrow()
    expect(makeConfig({ maxEdge: ATTACHMENT_MAX_EDGE }).maxEdge).toBe(ATTACHMENT_MAX_EDGE)
  })

  it('keeps a partially specified auto section on its own defaults', () => {
    expect(makeConfig({ autoAfterTools: { enabled: true } }).autoAfterTools).toEqual({
      enabled: true,
      matcher: DEFAULT_TOOL_MATCHER,
      delayMs: 1_500,
    })
  })
})
