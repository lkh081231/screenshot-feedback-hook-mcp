import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { assertImageCapableRoute, resolveRoute, textOnlyModelMessage } from '../src/route.js'

interface FakeRoute { provider?: string; model?: string }

function fakeAgent(header: FakeRoute | undefined, options: FakeRoute): Agent {
  return {
    options,
    session: { requestHeader: () => header === undefined ? undefined : { config: header } },
  } as unknown as Agent
}

function fakeCtx(modalities: readonly string[] | undefined, mounted = true): Context {
  return {
    get: (key: string) => key === 'llm' && mounted
      ? { resolveModelInfo: async () => ({ id: 'm', name: 'm', inputModalities: modalities }) }
      : undefined,
  } as unknown as Context
}

describe('resolveRoute', () => {
  it('prefers the session request header over the agent creation options', () => {
    const agent = fakeAgent({ provider: 'anthropic', model: 'vision' }, { provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    expect(resolveRoute(agent)).toEqual({ provider: 'anthropic', model: 'vision' })
  })

  it('falls back to the agent options before the first request header', () => {
    const agent = fakeAgent(undefined, { provider: 'deepseek-official', model: 'deepseek-v4-pro' })
    expect(resolveRoute(agent)).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })
  })

  it('resolves nothing without an agent', () => {
    expect(resolveRoute(undefined)).toEqual({ provider: undefined, model: undefined })
  })
})

describe('assertImageCapableRoute', () => {
  const agent = fakeAgent(undefined, { provider: 'deepseek-official', model: 'deepseek-v4-flash' })

  it('passes when the exact route declares image input', async () => {
    await expect(assertImageCapableRoute(fakeCtx(['text', 'image']), agent)).resolves.toBeUndefined()
  })

  it('refuses a text-only model and names it', async () => {
    await expect(assertImageCapableRoute(fakeCtx(['text']), agent))
      .rejects.toThrow(/deepseek-v4-flash/)
  })

  it('treats unknown modalities as unsupported', async () => {
    await expect(assertImageCapableRoute(fakeCtx(undefined), agent))
      .rejects.toThrow(/does not declare image input/)
  })

  it('refuses when no agent supplies a route', async () => {
    await expect(assertImageCapableRoute(fakeCtx(['text', 'image']), undefined))
      .rejects.toThrow(/could not be resolved/)
  })

  it('refuses when the llm service is not mounted', async () => {
    await expect(assertImageCapableRoute(fakeCtx(['text', 'image'], false), agent))
      .rejects.toThrow(/could not be resolved/)
  })
})

describe('textOnlyModelMessage', () => {
  it('names the route and gives the user an actionable next step', () => {
    const message = textOnlyModelMessage('deepseek-official', 'deepseek-v4-flash')
    expect(message).toContain('deepseek-v4-flash')
    expect(message).toContain('deepseek-official')
    // rc.8 的内置 DeepSeek 路由只有纯文本模型，提示必须点名这个事实
    expect(message).toContain('deepseek-v4-pro')
    expect(message).toContain('input: [text, image]')
    expect(message).toContain('llm-pi-ai')
  })
})
