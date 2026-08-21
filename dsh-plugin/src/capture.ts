/**
 * 截图落地：spawn Python CLI（`capture --json`）→ 读字节 → 存进 `ctx.attachments`。
 *
 * 「怎么截图、怎么压缩」全部留在 Python 侧（mss + Pillow，跨平台且已测过），
 * 这里只负责 dsh 这一侧的进程管理与图片入仓。
 * @module dsh-screenshot-feedback-hook-mcp/capture
 */

import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
// 副作用式类型 import：把 attachments / subprocess 服务并进 Context。
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { Config } from './config.js'

/** 一次成功截图的结果。 */
export interface CaptureResult {
  /** 截图落盘的绝对路径（诊断用；图片本身走 attachment）。 */
  path: string
  /** 已持久化的图片引用，可以直接放进 `{type:'image'}` 内容块。 */
  ref: ImageAttachmentRef
  /** Python 侧的环境告警（macOS 未授权 / Wayland 受限等）。 */
  warnings: string[]
}

/** `capture --json` 成功时的输出。 */
interface CaptureJson {
  path?: string
  bytes?: number
  width?: number
  height?: number
  format?: string
  warnings?: string[]
  error?: string
}

/** 第一个带 `capture --json` 的 Python 包版本；更早的版本这个插件用不了。 */
export const MIN_CLI_VERSION = '0.3.0'

/** stdout 只装一行 JSON，64KB 绰绰有余。 */
const STDOUT_CAP = 64 * 1024
/** stderr 只作诊断尾巴。 */
const STDERR_CAP = 16 * 1024
/** 子进程 SIGTERM → SIGKILL 的宽限期。 */
const GRACE_MS = 5_000

let sequence = 0

/** 每次截图一个独立文件名：同一轮里可能有并发调用。 */
function nextOutputPath(): string {
  sequence += 1
  return join(tmpdir(), 'dsh-screenshot-feedback', `shot-${process.pid}-${sequence}.jpg`)
}

/**
 * 解析截图 CLI 的可执行文件；找不到时给出「装什么、怎么改配置」的可读原因，
 * 而不是把 PATH 查找的原始异常直接抛给模型。
 * @param ctx - 插件上下文，需要 `subprocess`。
 * @param command - 配置里的可执行文件名或绝对路径。
 * @returns 规范化的可执行文件路径。
 */
async function resolveCommand(ctx: Context, command: string): Promise<string> {
  try {
    return await ctx.subprocess.resolveExecutable(command)
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(
      `cannot run the screenshot command "${command}": ${reason}. `
      + 'Install uv (https://docs.astral.sh/uv/) so `uvx` is on PATH, or install the Python package '
      + '(`pipx install screenshot-feedback-hook-mcp`) and set the plugin config `command` to '
      + '`screenshot-feedback-hook-mcp` with an empty `args`.',
    )
  }
}

/**
 * 拼出 `capture --json` 的完整 argv。
 * @param config - 已被 schemastery 填好默认值的插件配置。
 * @param outPath - 截图落盘路径。
 * @param monitor - 本次使用的显示器编号。
 * @param delayMs - 本次截图前的等待毫秒数。
 * @returns argv，`argv[0]` 是可执行文件本身。
 */
export function captureArgv(config: Config, outPath: string, monitor: number, delayMs: number): string[] {
  return [
    config.command,
    ...config.args,
    'capture',
    '--json',
    '--monitor', String(monitor),
    '--out', outPath,
    // Python 侧的 --delay 是秒
    '--delay', String(delayMs / 1000),
    '--max-edge', String(config.maxEdge),
    '--target-kb', String(config.targetKb),
  ]
}

/**
 * 解析 CLI 的 JSON 输出。CLI 约定业务失败也以 0 退出并给 `error` 字段，
 * 所以这里把「非零退出」「非 JSON」「有 error」统一成一个可读异常。
 * @param stdout - 子进程 stdout 全文。
 * @param stderr - 子进程 stderr 全文，仅在无法解析时用于诊断。
 * @param exitCode - 进程退出码，null 表示被信号杀死。
 * @returns 解析后的成功结果。
 */
export function parseCaptureJson(stdout: string, stderr: string, exitCode: number | null): CaptureJson {
  const trimmed = stdout.trim()
  if (trimmed.length === 0) {
    const detail = stderr.trim() || `exit code ${String(exitCode)}`
    // 0.2.0 及更早的 CLI 没有 --json；点名升级比丢一段 argparse usage 有用得多
    if (detail.includes('unrecognized arguments: --json')) {
      throw new Error(
        `the installed screenshot-feedback-hook-mcp is older than ${MIN_CLI_VERSION}, which is the first release with \`capture --json\`. `
        + 'Upgrade it (`uv tool upgrade screenshot-feedback-hook-mcp`, `pipx upgrade screenshot-feedback-hook-mcp`, '
        + 'or let `uvx` fetch the latest by clearing its cache) and try again.',
      )
    }
    throw new Error(`the screenshot command produced no output (${detail})`)
  }
  let parsed: CaptureJson
  try {
    parsed = JSON.parse(trimmed) as CaptureJson
  } catch {
    throw new Error(`the screenshot command produced unreadable output: ${trimmed.slice(0, 400)}`)
  }
  if (typeof parsed.error === 'string') throw new Error(parsed.error)
  if (typeof parsed.path !== 'string' || parsed.path.length === 0) {
    throw new Error(`the screenshot command reported no output path: ${trimmed.slice(0, 400)}`)
  }
  return parsed
}

/**
 * 跑一次截图并把图片提交进附件库。
 * @param ctx - 插件上下文，需要 `subprocess` 与 `attachments`。
 * @param config - 插件配置。
 * @param options - 本次覆盖的显示器编号与等待时间，以及调用方的取消信号。
 * @returns 落盘路径、持久图片引用和环境告警。
 */
export async function captureScreenshot(
  ctx: Context,
  config: Config,
  options: { monitor?: number | undefined; delayMs?: number | undefined; signal: AbortSignal },
): Promise<CaptureResult> {
  const attachments = ctx.get('attachments')
  if (attachments === undefined) throw new Error('no attachment service is mounted, so a screenshot cannot enter the conversation')

  const monitor = options.monitor ?? config.monitor
  const delayMs = options.delayMs ?? config.delayMs
  const outPath = nextOutputPath()
  const argv = captureArgv(config, outPath, monitor, delayMs)

  const executable = await resolveCommand(ctx, argv[0] as string)
  // 截图本身要等 delayMs，超时预算必须把它算进去，否则慢渲染场景永远超时
  const timeout = AbortSignal.timeout(config.captureTimeoutMs + delayMs)
  const signal = AbortSignal.any([options.signal, timeout])

  const handle = ctx.subprocess.spawn({
    argv: [executable, ...argv.slice(1)],
    cwd: config.cwd.length > 0 ? config.cwd : process.cwd(),
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: STDOUT_CAP },
      stderr: { maxBytes: STDERR_CAP },
    },
    graceMs: GRACE_MS,
    signal,
  })

  const outcome = await handle.done
  const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
  const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
  if (timeout.aborted) throw new Error(`the screenshot command timed out after ${String(config.captureTimeoutMs + delayMs)}ms`)
  const parsed = parseCaptureJson(stdout, stderr, outcome.exitCode)

  const data = await readFile(parsed.path as string)
  let ref: ImageAttachmentRef
  try {
    ref = await attachments.saveImage({ data, mediaType: 'image/jpeg', name: 'screenshot.jpg' })
  } finally {
    // 字节已经进了内容寻址的附件库，磁盘上的临时文件没有留存价值
    await rm(parsed.path as string, { force: true }).catch(() => undefined)
  }
  return { path: parsed.path as string, ref, warnings: parsed.warnings ?? [] }
}

/**
 * 列出可用显示器（直接透传 CLI 的 `monitors` 子命令文本）。
 * @param ctx - 插件上下文，需要 `subprocess`。
 * @param config - 插件配置。
 * @param signal - 调用方的取消信号。
 * @returns 每行一个显示器的可读文本。
 */
export async function listMonitors(ctx: Context, config: Config, signal: AbortSignal): Promise<string> {
  const argv = [config.command, ...config.args, 'monitors']
  const executable = await resolveCommand(ctx, argv[0] as string)
  const handle = ctx.subprocess.spawn({
    argv: [executable, ...argv.slice(1)],
    cwd: config.cwd.length > 0 ? config.cwd : process.cwd(),
    stdio: { stdin: 'ignore', stdout: { maxBytes: STDOUT_CAP }, stderr: { maxBytes: STDERR_CAP } },
    graceMs: GRACE_MS,
    signal: AbortSignal.any([signal, AbortSignal.timeout(config.captureTimeoutMs)]),
  })
  const outcome = await handle.done
  const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
  if (outcome.exitCode !== 0 || stdout.trim().length === 0) {
    const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
    throw new Error(`listing monitors failed (${stderr.trim() || `exit code ${String(outcome.exitCode)}`})`)
  }
  return stdout.trim()
}
