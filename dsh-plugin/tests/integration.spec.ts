/**
 * 真实端到端：真的起一个子进程跑真的 Python CLI，真的截一张屏。
 *
 * 默认跳过——CI 的无头容器没有桌面，mss 必然失败。要跑它请设置
 * `DSH_SCREENSHOT_CLI` 指向已安装的 screenshot-feedback-hook-mcp 可执行文件
 * （>= 0.3.0），例如：
 *   DSH_SCREENSHOT_CLI=.venv/Scripts/screenshot-feedback-hook-mcp.exe npx vitest run
 */

import { spawn as nodeSpawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import { captureScreenshot } from '../src/capture.js'
import { makeConfig } from './make-config.js'

const CLI = process.env['DSH_SCREENSHOT_CLI']

/** 把 stdout/stderr 攒成 dsh 的 offset 读取器形状。 */
function collector(): { push: (chunk: string) => void; reader: { readFrom: () => { text: string; nextOffset: number; lossy: boolean } } } {
  let text = ''
  return {
    push: (chunk: string) => { text += chunk },
    reader: { readFrom: () => ({ text, nextOffset: text.length, lossy: false }) },
  }
}

/** 用 node:child_process 实现 dsh subprocess seam 里本插件用到的那一小块。 */
function realSubprocessCtx(saved: SaveImageAttachment[]): Context {
  return {
    get: (key: string) => key === 'attachments'
      ? {
          saveImage: async (input: SaveImageAttachment): Promise<ImageAttachmentRef> => {
            saved.push(input)
            return {
              attachmentId: 'sha256:integration',
              mediaType: input.mediaType,
              bytes: input.data.byteLength,
              width: 0,
              height: 0,
            } as unknown as ImageAttachmentRef
          },
        }
      : undefined,
    subprocess: {
      resolveExecutable: async (command: string) => command,
      spawn: (spec: { argv: readonly string[]; cwd: string }) => {
        const out = collector()
        const err = collector()
        const child = nodeSpawn(spec.argv[0] as string, spec.argv.slice(1), { cwd: spec.cwd })
        child.stdout?.setEncoding('utf8')
        child.stderr?.setEncoding('utf8')
        child.stdout?.on('data', out.push)
        child.stderr?.on('data', err.push)
        return {
          done: new Promise(resolve => child.on('close', (exitCode, signal) => { resolve({ exitCode, signal }) })),
          collected: { stdout: out.reader, stderr: err.reader },
          terminate: () => { child.kill() },
        }
      },
    },
  } as unknown as Context
}

describe.skipIf(CLI === undefined)('real capture through the Python CLI', () => {
  it('hands real JPEG bytes to the attachment store and keeps the file its path names', async () => {
    const saved: SaveImageAttachment[] = []
    const ctx = realSubprocessCtx(saved)
    const config = makeConfig({ command: CLI, args: [] })
    const result = await captureScreenshot(ctx, config, { signal: new AbortController().signal })

    expect(saved).toHaveLength(1)
    const bytes = saved[0]?.data as Uint8Array
    expect(bytes.byteLength).toBeGreaterThan(1_000)
    // JPEG 魔数：真的是一张图，不是一段错误文本
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xff, 0xd8, 0xff])
    expect(saved[0]?.mediaType).toBe('image/jpeg')
    // `path` 是工具输出的一部分，模型可以照着再读一次 —— 文件必须还在
    expect(existsSync(result.path)).toBe(true)
    expect(statSync(result.path).size).toBeGreaterThan(1_000)
  }, 60_000)
})
