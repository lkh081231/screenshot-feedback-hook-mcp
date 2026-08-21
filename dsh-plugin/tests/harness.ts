/** 假的 Cordis 上下文与 agent，让自动路径可以在没有 dsh 运行时的情况下测。 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ImageAttachmentRef, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

/** 一个看起来合理的持久图片引用。 */
export const FAKE_REF = {
  attachmentId: 'sha256:deadbeef',
  mediaType: 'image/jpeg',
  bytes: 1234,
  width: 1568,
  height: 800,
  name: 'screenshot.jpg',
} as unknown as ImageAttachmentRef

export interface Harness {
  ctx: Context
  /** 插件注册的事件监听器，按事件名取用。 */
  handlers: Map<string, (...args: never[]) => unknown>
  /** 每次 spawn 的 argv，用来断言参数拼装。 */
  spawns: string[][]
  /** 提交进附件库的图片。 */
  saved: SaveImageAttachment[]
  /** 记录的日志行。 */
  warnings: string[]
  /** 插件注册的模型可见工具，按名字取用。 */
  tools: Map<string, ToolDefinition>
  /** 当前路由声明的输入模态；undefined = 未知（按不支持处理）。 */
  modalities: string[] | undefined
  /** 让下一次截图失败。 */
  failCapture: boolean
}

/**
 * 造一个只实现本插件用到的那几个 seam 的上下文。
 * @returns harness，测试可直接改它的可变字段来切换场景。
 */
export function createHarness(): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-shot-test-'))
  const shot = join(dir, 'shot.jpg')

  const harness: Partial<Harness> = {
    handlers: new Map(),
    spawns: [],
    saved: [],
    warnings: [],
    tools: new Map(),
    modalities: ['text', 'image'],
    failCapture: false,
  }

  const stdoutOf = (): string => harness.failCapture === true
    ? JSON.stringify({ error: 'screenshot failed: no display', warnings: [] })
    : JSON.stringify({ path: shot, bytes: 1234, width: 1568, height: 800, format: 'jpeg', warnings: [] })

  harness.ctx = {
    tools: {
      register(definition: ToolDefinition) {
        harness.tools?.set(definition.name, definition)
        return () => undefined
      },
    },
    on(event: string, listener: (...args: never[]) => unknown) {
      harness.handlers?.set(event, listener)
      return () => undefined
    },
    logger: () => ({
      warn: (...args: unknown[]) => { harness.warnings?.push(args.map(String).join(' ')) },
      info: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    }),
    get: (key: string) => {
      if (key === 'attachments') {
        return {
          saveImage: async (input: SaveImageAttachment) => { harness.saved?.push(input); return FAKE_REF },
        }
      }
      if (key === 'llm') {
        return { resolveModelInfo: async () => ({ id: 'm', name: 'm', inputModalities: harness.modalities }) }
      }
      return undefined
    },
    subprocess: {
      resolveExecutable: async (command: string) => command,
      spawn: (spec: { argv: readonly string[] }) => {
        harness.spawns?.push([...spec.argv])
        // 真实 CLI 每次都会写出文件；插件在存进附件库后会删掉它
        if (harness.failCapture !== true) writeFileSync(shot, 'jpeg-bytes-are-never-decoded-by-the-fake-store')
        return {
          done: Promise.resolve({ exitCode: 0, signal: null }),
          collected: { stdout: { readFrom: () => ({ text: stdoutOf(), nextOffset: 0, lossy: false }) } },
        }
      },
    },
  } as unknown as Context

  return harness as Harness
}

/** 记录 steer / inject 的假 agent。 */
export interface FakeAgent {
  agent: Agent
  steered: UserMessage[]
  injected: UserMessage[]
}

/**
 * 造一个假 agent。
 * @param provider - 路由 provider。
 * @param model - 路由 model。
 * @returns agent 与它收到的 steering / 注入消息。
 */
export function createAgent(provider = 'deepseek-official', model = 'deepseek-v4-flash'): FakeAgent {
  const steered: UserMessage[] = []
  const injected: UserMessage[] = []
  const agent = {
    options: { provider, model },
    session: { requestHeader: () => undefined },
    steer: (message: UserMessage) => { steered.push(message) },
    inject: (message: UserMessage) => { injected.push(message) },
  } as unknown as Agent
  return { agent, steered, injected }
}
