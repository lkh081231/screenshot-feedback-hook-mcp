import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { imageValueFromRef, refFromImageValue, screenshotContent } from '../src/content.js'
import { MAX_MODEL_DELAY_MS, applyTools, clampModelDelayMs } from '../src/tools.js'
import { FAKE_REF, createAgent, createHarness } from './harness.js'
import { makeSource } from './make-config.js'
import type { ScreenshotValue } from '../src/content.js'

function runContext(): ToolRunContext {
  return { agent: createAgent().agent, signal: new AbortController().signal } as unknown as ToolRunContext
}

describe('take_screenshot', () => {
  it('returns the image as a real image block beside its text envelope', async () => {
    const harness = createHarness()
    applyTools(harness.ctx, makeSource({}))
    const tool = harness.tools.get('take_screenshot')
    expect(tool).toBeDefined()

    const value = await tool?.execute({}, runContext()) as ScreenshotValue
    expect(value.image.attachmentId).toBe(FAKE_REF.attachmentId)
    expect(harness.saved[0]?.mediaType).toBe('image/jpeg')

    const content = tool?.output.render({}, value as never) ?? []
    expect(content.map(block => block.type)).toEqual(['text', 'image'])
    expect(content[1]).toEqual({ type: 'image', attachment: FAKE_REF })
  })

  it('honors the monitor argument over the configured default', async () => {
    const harness = createHarness()
    applyTools(harness.ctx, makeSource({ monitor: 0 }))
    await harness.tools.get('take_screenshot')?.execute({ monitor: 2 }, runContext())
    expect(harness.spawns[0]).toContain('--monitor')
    expect(harness.spawns[0]?.[harness.spawns[0].indexOf('--monitor') + 1]).toBe('2')
  })

  it('refuses before touching the screen when the model has no image input', async () => {
    const harness = createHarness()
    harness.modalities = ['text']
    applyTools(harness.ctx, makeSource({}))
    await expect(harness.tools.get('take_screenshot')?.execute({}, runContext()))
      .rejects.toThrow(/does not declare image input/)
    // 拒绝时不该已经截过一张没人能看的图
    expect(harness.spawns).toHaveLength(0)
  })

  it('returns a value the registry will accept against its own output schema', async () => {
    const harness = createHarness()
    applyTools(harness.ctx, makeSource({}))
    const tool = harness.tools.get('take_screenshot')
    const value = await tool?.execute({}, runContext()) as ScreenshotValue
    // 工具注册表在 createSuccessResult 里跑的就是这个校验器；additionalProperties:false
    // 会把「schema 与规范值不一致」变成运行时错误，而单测直接调 execute 是绕过它的
    expect(validateJsonSchemaValue(tool?.output.schema as never, value, 'value')).toEqual([])
    // path 现在是真话：文件保留在盘上
    expect(existsSync(value.path)).toBe(true)
  })

  it('caps a model-supplied delay instead of letting it blow past the capture timeout', async () => {
    const harness = createHarness()
    applyTools(harness.ctx, makeSource({}))
    const value = await harness.tools.get('take_screenshot')
      ?.execute({ delay_ms: 600_000 }, runContext()) as ScreenshotValue
    // Python 侧的 --delay 是秒
    expect(harness.spawns[0]?.[harness.spawns[0].indexOf('--delay') + 1]).toBe('10')
    // 钳制必须让模型看见，否则它会把没渲染完当成产出坏了
    const [text] = screenshotContent(value, 'headline')
    expect(text?.type === 'text' && text.text).toContain('delay_ms was capped at 10000ms')
  })

  it('lets a long-delay deployment keep its own default as the ceiling', async () => {
    const harness = createHarness()
    applyTools(harness.ctx, makeSource({ delayMs: 20_000 }))
    const value = await harness.tools.get('take_screenshot')
      ?.execute({ delay_ms: 20_000 }, runContext()) as ScreenshotValue
    expect(harness.spawns[0]?.[harness.spawns[0].indexOf('--delay') + 1]).toBe('20')
    expect(value.warnings).toEqual([])
  })

  it('surfaces a capture failure as a tool error', async () => {
    const harness = createHarness()
    harness.failCapture = true
    applyTools(harness.ctx, makeSource({}))
    await expect(harness.tools.get('take_screenshot')?.execute({}, runContext()))
      .rejects.toThrow('screenshot failed: no display')
  })
})

describe('list_monitors', () => {
  it('is registered alongside the screenshot tool', () => {
    const harness = createHarness()
    applyTools(harness.ctx, makeSource({}))
    expect(harness.tools.get('list_monitors')).toBeDefined()
  })
})

describe('clampModelDelayMs', () => {
  it('passes an absent request through so the configured default wins', () => {
    expect(clampModelDelayMs(undefined, MAX_MODEL_DELAY_MS)).toBeUndefined()
  })

  it('keeps a request that is already inside the ceiling', () => {
    expect(clampModelDelayMs(1_500, MAX_MODEL_DELAY_MS)).toBe(1_500)
  })

  it('clamps both ends of the range', () => {
    expect(clampModelDelayMs(600_000, MAX_MODEL_DELAY_MS)).toBe(MAX_MODEL_DELAY_MS)
    // 负数会反过来把超时预算缩小
    expect(clampModelDelayMs(-5_000, MAX_MODEL_DELAY_MS)).toBe(0)
    expect(clampModelDelayMs(Infinity, MAX_MODEL_DELAY_MS)).toBe(0)
  })
})

describe('content projection', () => {
  it('round-trips an attachment reference through the canonical value', () => {
    expect(refFromImageValue(imageValueFromRef(FAKE_REF))).toEqual(FAKE_REF)
  })

  it('carries platform warnings into the text envelope', () => {
    const value: ScreenshotValue = {
      path: '/tmp/shot.jpg',
      warnings: ['macOS screen recording is not authorized'],
      image: imageValueFromRef(FAKE_REF),
    }
    const [text] = screenshotContent(value, 'headline')
    expect(text?.type === 'text' && text.text).toContain('macOS screen recording is not authorized')
    expect(text?.type === 'text' && text.text).toContain('1568x800')
  })
})
