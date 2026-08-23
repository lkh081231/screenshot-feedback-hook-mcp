import { describe, expect, it } from 'vitest'
import { MAX_TIMER_DELAY_MS, captureArgv, captureDeadlineMs, parseCaptureJson } from '../src/capture.js'
import { makeConfig } from './make-config.js'

const config = makeConfig({})

describe('captureArgv', () => {
  it('asks the CLI for machine-readable output and converts delay to seconds', () => {
    expect(captureArgv(config, '/tmp/shot.jpg', 2, 1500)).toEqual([
      'uvx', 'screenshot-feedback-hook-mcp', 'capture', '--json',
      '--monitor', '2',
      '--out', '/tmp/shot.jpg',
      '--delay', '1.5',
      '--max-edge', '1568',
      '--target-kb', '80',
    ])
  })

  it('drops the package argument once the command is the binary itself', () => {
    const direct = makeConfig({ command: 'screenshot-feedback-hook-mcp', args: [] })
    expect(captureArgv(direct, '/tmp/shot.jpg', 0, 0).slice(0, 3)).toEqual([
      'screenshot-feedback-hook-mcp', 'capture', '--json',
    ])
  })
})

describe('captureDeadlineMs', () => {
  it('adds the wait to the budget in the ordinary case', () => {
    expect(captureDeadlineMs(30_000, 1_500)).toBe(31_500)
  })

  it('rounds a fractional config value up, which AbortSignal.timeout would have rejected', () => {
    // 设置卡片的 numberField 只查 Number.isFinite，30000.5 是合法配置
    expect(captureDeadlineMs(30_000.5, 0)).toBe(30_001)
  })

  it('floors at 1ms instead of handing a negative to the timer', () => {
    expect(captureDeadlineMs(1, -5_000)).toBe(1)
    expect(captureDeadlineMs(-Infinity, 0)).toBe(1)
  })

  it('ceilings at the Node timer limit', () => {
    expect(captureDeadlineMs(5e9, 0)).toBe(MAX_TIMER_DELAY_MS)
    expect(captureDeadlineMs(Infinity, 0)).toBe(MAX_TIMER_DELAY_MS)
  })

  it('treats NaN as the ceiling rather than propagating it into the timer', () => {
    expect(captureDeadlineMs(NaN, 0)).toBe(MAX_TIMER_DELAY_MS)
  })
})

describe('parseCaptureJson', () => {
  it('returns the payload of a successful capture', () => {
    const payload = parseCaptureJson('{"path":"/tmp/a.jpg","warnings":["wayland"]}', '', 0)
    expect(payload.path).toBe('/tmp/a.jpg')
    expect(payload.warnings).toEqual(['wayland'])
  })

  it('turns the CLI error field into an exception even on a zero exit', () => {
    expect(() => parseCaptureJson('{"error":"no display","warnings":[]}', '', 0))
      .toThrow('no display')
  })

  it('reports stderr when the command printed nothing', () => {
    expect(() => parseCaptureJson('', 'uvx: command not found', 1))
      .toThrow('uvx: command not found')
  })

  it('names the upgrade when the installed CLI predates --json', () => {
    const usage = 'usage: screenshot-feedback-hook-mcp [-h] {capture,monitors} ...\nscreenshot-feedback-hook-mcp: error: unrecognized arguments: --json'
    expect(() => parseCaptureJson('', usage, 2)).toThrow(/older than 0\.3\.0/)
  })

  it('reports unreadable output instead of throwing a raw SyntaxError', () => {
    expect(() => parseCaptureJson('not json at all', '', 0))
      .toThrow(/unreadable output/)
  })

  it('rejects a payload without a path', () => {
    expect(() => parseCaptureJson('{"warnings":[]}', '', 0)).toThrow(/no output path/)
  })
})
