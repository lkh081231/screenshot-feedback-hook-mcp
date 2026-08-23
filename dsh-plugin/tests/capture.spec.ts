import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MAX_TIMER_DELAY_MS, captureArgv, captureDeadlineMs, captureScreenshot, parseCaptureJson } from '../src/capture.js'
import { createHarness } from './harness.js'
import { makeConfig } from './make-config.js'
import type { Harness } from './harness.js'

const config = makeConfig({})

/** 假 spawn 收到的 `--out`，也就是「CLI 本来会写在哪」。 */
function requestedOutPath(harness: Harness): string {
  const argv = harness.spawns[0] ?? []
  return argv[argv.indexOf('--out') + 1] as string
}

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

describe('captureScreenshot', () => {
  const signal = (): AbortSignal => new AbortController().signal

  it('keeps the file on success, because `path` is part of the tool output', async () => {
    const harness = createHarness()
    const result = await captureScreenshot(harness.ctx, makeConfig({}), { signal: signal() })
    expect(result.path).toBe(requestedOutPath(harness))
    expect(existsSync(result.path)).toBe(true)
    expect(harness.saved).toHaveLength(1)
  })

  it('removes the file when the CLI output cannot be parsed', async () => {
    const harness = createHarness()
    harness.stdout = 'not json at all'
    await expect(captureScreenshot(harness.ctx, makeConfig({}), { signal: signal() }))
      .rejects.toThrow(/unreadable output/)
    expect(existsSync(requestedOutPath(harness))).toBe(false)
  })

  it('removes the file when the attachment store rejects the image', async () => {
    const harness = createHarness()
    harness.failSave = true
    // 这正是「子进程已退出、图片还没入仓」那一段：以前它会把文件漏在 tmpdir 里
    await expect(captureScreenshot(harness.ctx, makeConfig({}), { signal: signal() }))
      .rejects.toThrow(/attachment store rejected/)
    expect(existsSync(requestedOutPath(harness))).toBe(false)
  })

  it('reports a caller cancellation as a cancellation, not as empty output', async () => {
    const harness = createHarness()
    const controller = new AbortController()
    const pending = captureScreenshot(harness.ctx, makeConfig({}), { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toThrow(/cancelled before it finished/)
    expect(existsSync(requestedOutPath(harness))).toBe(false)
  })

  it('refuses an already-cancelled call without paying for a process', async () => {
    const harness = createHarness()
    const controller = new AbortController()
    controller.abort()
    await expect(captureScreenshot(harness.ctx, makeConfig({}), { signal: controller.signal }))
      .rejects.toThrow(/cancelled before it started/)
    expect(harness.spawns).toHaveLength(0)
  })

  it('names the deadline the timer actually got when it times out', async () => {
    const harness = createHarness()
    harness.spawnDelayMs = 40
    await expect(captureScreenshot(harness.ctx, makeConfig({ captureTimeoutMs: 1 }), { signal: signal() }))
      .rejects.toThrow(/timed out after 1ms/)
    expect(existsSync(requestedOutPath(harness))).toBe(false)
  })
})
