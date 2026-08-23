/**
 * 截图落地：spawn Python CLI（`capture --json`）→ 读字节 → 存进 `ctx.attachments`。
 *
 * 「怎么截图、怎么压缩」全部留在 Python 侧（mss + Pillow，跨平台且已测过），
 * 这里只负责 dsh 这一侧的进程管理与图片入仓。
 * @module dsh-screenshot-feedback-hook-mcp/capture
 */

import { randomUUID } from 'node:crypto'
import { readFile, readdir, rm, stat } from 'node:fs/promises'
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
  /**
   * 截图落盘的绝对路径。成功时文件**保留**在盘上，模型可以照着这个路径再读一次；
   * 失败时没有任何人拿得到它，文件已被清掉。留存量由 {@link KEEP_RECENT_SHOTS} 兜住。
   */
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

/**
 * Node 定时器上限。`AbortSignal.timeout` 对非整数/负数/超限值一律抛
 * `ERR_OUT_OF_RANGE`，接近上限时又会静默把时长压成 1ms。故意在本地重述而不是从
 * `@deepseek-ai/dsh-timeout` import —— 它不是本包的 peer，会让 packaging.spec 红。
 */
export const MAX_TIMER_DELAY_MS = 2_147_483_647

/**
 * 把「超时预算 + 等待时间」归一成 `AbortSignal.timeout` 一定收得下的整数毫秒。
 * 配置里这几个毫秒字段只有下界、没有 `.step(1)` 也没有上界，设置页里敲一个
 * `30000.5` 就能让每一次截图在 spawn 之前崩掉。
 * @param captureTimeoutMs - 配置的单次超时。
 * @param delayMs - 本次截图前的等待。
 * @returns [1, {@link MAX_TIMER_DELAY_MS}] 区间内的整数。
 */
export function captureDeadlineMs(captureTimeoutMs: number, delayMs: number): number {
  const total = captureTimeoutMs + delayMs
  if (Number.isNaN(total)) return MAX_TIMER_DELAY_MS
  return Math.min(Math.max(Math.ceil(total), 1), MAX_TIMER_DELAY_MS)
}

/** 本插件独占的截图目录；只有这里的 `shot-*.jpg` 会被修剪。 */
const SHOT_DIR = join(tmpdir(), 'dsh-screenshot-feedback')

/**
 * 保留最近几张截图。`path` 是工具输出的一部分、模型可以照着再读一次，所以成功的
 * 截图不能删；但也不能让 tmpdir 无限长。这是安全兜底而不是策略旋钮，故意用常量：
 * 加成配置字段要连带改 config.spec 的整对象断言、CARD_FIELDS、两份 locales 和两份
 * README，代价远大于收益。
 */
const KEEP_RECENT_SHOTS = 20

let sequence = 0

/**
 * 每次截图一个独立文件名：同一轮里可能有并发调用，而且文件现在会留在盘上 ——
 * 只靠 pid + 序号，dsh 重启后 pid 复用就会盖掉别人保留着的截图。
 */
function nextOutputPath(): string {
  sequence += 1
  return join(SHOT_DIR, `shot-${process.pid}-${String(sequence)}-${randomUUID()}.jpg`)
}

/**
 * 尽力删掉一个文件。`finally` 里抛出会**替换掉原始错误**（`rm` 的 force 吞 ENOENT
 * 但仍会抛 EPERM/EBUSY），正好把新写的超时/取消消息盖掉，所以一律吞。
 * @param path - 要删的绝对路径。
 */
async function removeQuietly(path: string): Promise<void> {
  await rm(path, { force: true }).catch(() => undefined)
}

/**
 * 把截图目录修剪到最近 {@link KEEP_RECENT_SHOTS} 张。全程尽力而为、绝不抛：目录还
 * 没建、或并发的另一次修剪抢先删掉了某个文件，都不值得打扰调用方。
 */
async function pruneOldShots(): Promise<void> {
  try {
    const names = (await readdir(SHOT_DIR)).filter(name => name.startsWith('shot-') && name.endsWith('.jpg'))
    if (names.length <= KEEP_RECENT_SHOTS) return
    const dated = await Promise.all(names.map(async (name) => {
      const full = join(SHOT_DIR, name)
      return { full, mtimeMs: (await stat(full)).mtimeMs }
    }))
    dated.sort((a, b) => b.mtimeMs - a.mtimeMs)
    await Promise.all(dated.slice(KEEP_RECENT_SHOTS).map(entry => removeQuietly(entry.full)))
  } catch {
    // 修剪失败不影响这一次截图，下一次还会再试
  }
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

  // 已经取消了就别再付 PATH 查找和拉起进程的钱
  if (options.signal.aborted) throw new Error('the screenshot was cancelled before it started')
  const executable = await resolveCommand(ctx, argv[0] as string)
  // 截图本身要等 delayMs，超时预算必须把它算进去，否则慢渲染场景永远超时
  const deadlineMs = captureDeadlineMs(config.captureTimeoutMs, delayMs)
  const timeout = AbortSignal.timeout(deadlineMs)
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

  let parsedPath: string | undefined
  let delivered = false
  try {
    const outcome = await handle.done
    // harness 的假 spawn 只给 stdout，`?.` 不能省
    const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
    const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
    // 取消比超时更具体，先判它；两个信号相互独立，不会同时为真地误报。
    // 不做这两句分类的话，取消会伪装成「produced no output (exit code null)」。
    if (options.signal.aborted) throw new Error('the screenshot was cancelled before it finished')
    // 打印定时器真正收到的那个数：归一之后它未必等于 captureTimeoutMs + delayMs
    if (timeout.aborted) throw new Error(`the screenshot command timed out after ${String(deadlineMs)}ms`)
    const parsed = parseCaptureJson(stdout, stderr, outcome.exitCode)
    parsedPath = parsed.path as string
    const data = await readFile(parsedPath)
    const ref = await attachments.saveImage({ data, mediaType: 'image/jpeg', name: 'screenshot.jpg' })
    delivered = true
    return { path: parsedPath, ref, warnings: parsed.warnings ?? [] }
  } finally {
    // 成功时文件留着：`path` 是工具输出的一部分，模型可以照着再读一次。失败时没有
    // 任何人拿得到这个路径，留在盘上纯属垃圾 —— 两个候选路径都清，因为 Python 侧
    // 的 Path.resolve() 在 Windows 上会把 os.tmpdir() 的 8.3 短名展开成长名，
    // 「文本不等才删第二个」那种守卫的行为与直觉正好相反。
    if (delivered) await pruneOldShots()
    else {
      await removeQuietly(outPath)
      if (parsedPath !== undefined) await removeQuietly(parsedPath)
    }
  }
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
  const deadlineMs = captureDeadlineMs(config.captureTimeoutMs, 0)
  const timeout = AbortSignal.timeout(deadlineMs)
  const handle = ctx.subprocess.spawn({
    argv: [executable, ...argv.slice(1)],
    cwd: config.cwd.length > 0 ? config.cwd : process.cwd(),
    stdio: { stdin: 'ignore', stdout: { maxBytes: STDOUT_CAP }, stderr: { maxBytes: STDERR_CAP } },
    graceMs: GRACE_MS,
    signal: AbortSignal.any([signal, timeout]),
  })
  const outcome = await handle.done
  const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
  // 与 captureScreenshot 同理：不分类的话，取消和超时都会伪装成「exit code null」
  if (signal.aborted) throw new Error('listing monitors was cancelled')
  if (timeout.aborted) throw new Error(`listing monitors timed out after ${String(deadlineMs)}ms`)
  if (outcome.exitCode !== 0 || stdout.trim().length === 0) {
    const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
    throw new Error(`listing monitors failed (${stderr.trim() || `exit code ${String(outcome.exitCode)}`})`)
  }
  return stdout.trim()
}
