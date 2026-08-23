/**
 * 模型可见工具：`take_screenshot` 与 `list_monitors`。
 *
 * 结构照抄 dsh 自己的 `@deepseek-ai/dsh-tool-fs` 的 `read_image`：`execute`
 * 返回规范值，`output.render` 把它投影成「文字信封 + 图片块」。
 * @module dsh-screenshot-feedback-hook-mcp/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, InferValue } from '@deepseek-ai/dsh-tools'
import { captureScreenshot, listMonitors } from './capture.js'
import type { ConfigSource } from './config.js'
import { imageValueFromRef, screenshotContent } from './content.js'
import type { ScreenshotValue } from './content.js'
import { assertImageCapableRoute } from './route.js'

/** 手动截图时文字信封的首行。 */
const MANUAL_HEADLINE = 'Screenshot of the live screen, captured just now.'

/**
 * 模型可控 `delay_ms` 的默认上限。它是不可信输入，而 dsh 的 schema DSL 表达不了
 * 数值上下界（`IntegerValueSchemaSpec` 只有 `enum` / `const`），所以上限只能在
 * 代码里执行、在 `description` 里告诉模型。
 */
export const MAX_MODEL_DELAY_MS = 10_000

/**
 * 把模型给的等待时间钳进 `[0, ceiling]`。
 * @param requested - 模型给的毫秒数；undefined 表示「用配置默认值」。
 * @param ceiling - 本次允许的上限。
 * @returns 钳制后的值；undefined 原样透传。
 */
export function clampModelDelayMs(requested: number | undefined, ceiling: number): number | undefined {
  if (requested === undefined) return undefined
  if (!Number.isFinite(requested)) return 0
  return Math.min(Math.max(requested, 0), ceiling)
}

/** `take_screenshot` 的输出 schema，与 {@link ScreenshotValue} 一一对应。 */
const SCREENSHOT_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: {
      type: 'string',
      description: 'Absolute path of the saved screenshot. The file is kept on disk, so you can read it again.',
      required: true,
    },
    warnings: { type: 'array', items: { type: 'string' }, required: true },
    image: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        attachmentId: { type: 'string', required: true },
        mediaType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], required: true },
        bytes: { type: 'integer', required: true },
        width: { type: 'integer', required: true },
        height: { type: 'integer', required: true },
        name: { type: 'string' },
      },
    },
  },
} as const

/**
 * 「schema 与规范值一一对应」由编译器兑现，而不是靠上面那句注释。工具注册表在
 * `createSuccessResult` 里会拿这份 schema 校验规范值，两边任何一侧单方面增删字段都
 * 是只在生产里炸的错 —— 「schema 声明了 path、实现却把那个文件删了」正是这么来的。
 * 改任一侧而不改另一侧，这里直接编译失败。
 */
const _outputMatchesValue: ScreenshotValue extends InferValue<typeof SCREENSHOT_OUTPUT>
  ? InferValue<typeof SCREENSHOT_OUTPUT> extends ScreenshotValue ? true : never
  : never = true
void _outputMatchesValue

/**
 * 注册两个工具。
 * @param ctx - 插件上下文（工具随它的生命周期自动注销）。
 * @param source - 配置读取器；按次读取，settings 页改完立刻生效。
 */
export function applyTools(ctx: Context, source: ConfigSource): void {
  ctx.tools.register(defineTool({
    name: 'take_screenshot',
    description:
      'Capture the live screen and return the image, so you can see what you just produced '
      + '(a web page, an EDA/CAD drawing, any desktop app) instead of guessing. '
      + 'Requires the current model to accept image input.',
    parameters: {
      monitor: {
        type: 'integer',
        description: 'Monitor to capture: 0 combines every monitor, 1..N picks one. Call list_monitors when unsure. Defaults to the configured monitor.',
      },
      delay_ms: {
        type: 'integer',
        description:
          'Milliseconds to wait before capturing, so a page or drawing finishes rendering. '
          + `Capped at ${String(MAX_MODEL_DELAY_MS)} ms, or at the configured default if that is larger; `
          + 'a capped request says so in warnings. Defaults to the configured delay.',
      },
    },
    output: {
      schema: SCREENSHOT_OUTPUT,
      render: (_args, value) => screenshotContent(value as ScreenshotValue, MANUAL_HEADLINE),
    },
    // 内容寻址的附件写入幂等，同屏并发截图不会互相冲突
    isConcurrencySafe: () => true,
    async execute(args, exec): Promise<ScreenshotValue> {
      // 闸门放在任何 I/O 之前：拒绝时不该已经截了一张没人能看的图
      await assertImageCapableRoute(ctx, exec.agent, exec.signal)
      const config = source()
      // 运维把默认等待调到 20s 时，模型照着要 20s 不该反而只等 10s
      const ceiling = Math.max(MAX_MODEL_DELAY_MS, config.delayMs)
      const delayMs = clampModelDelayMs(args.delay_ms, ceiling)
      const result = await captureScreenshot(ctx, config, {
        // config.monitor 有 .min(0)，工具参数绕过了它
        monitor: args.monitor === undefined ? undefined : Math.max(0, args.monitor),
        delayMs,
        signal: exec.signal,
      })
      // 钳制必须让模型看见：默默等 10s 而不是它要的 60s，它会把没渲染完当成产出坏了
      const warnings = args.delay_ms !== undefined && delayMs !== args.delay_ms
        ? [...result.warnings, `delay_ms was capped at ${String(ceiling)}ms`]
        : result.warnings
      return {
        path: result.path,
        warnings,
        image: imageValueFromRef(result.ref),
      }
    },
    presentCall(args): GenericCallView {
      const monitor = args.monitor ?? source().monitor
      return {
        card: 'generic',
        title: monitor === 0 ? 'Screenshot (all monitors)' : `Screenshot (monitor ${String(monitor)})`,
        kind: 'read',
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'list_monitors',
    description: 'List available monitors with their index and resolution, to choose take_screenshot\'s monitor argument.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    isConcurrencySafe: () => true,
    async execute(_args, exec): Promise<string> {
      return await listMonitors(ctx, source(), exec.signal)
    },
  }))
}
