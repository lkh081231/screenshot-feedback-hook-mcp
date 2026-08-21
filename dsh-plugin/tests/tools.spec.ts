import { describe, expect, it } from 'vitest'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { imageValueFromRef, refFromImageValue, screenshotContent } from '../src/content.js'
import { applyTools } from '../src/tools.js'
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
