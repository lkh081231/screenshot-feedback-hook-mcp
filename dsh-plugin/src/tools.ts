/**
 * 模型可见工具：`take_screenshot` 与 `list_monitors`。
 *
 * 结构照抄 dsh 自己的 `@deepseek-ai/dsh-tool-fs` 的 `read_image`：`execute`
 * 返回规范值，`output.render` 把它投影成「文字信封 + 图片块」。
 * @module dsh-screenshot-feedback-hook-mcp/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import { captureScreenshot, listMonitors } from './capture.js'
import type { Config } from './config.js'
import { imageValueFromRef, screenshotContent } from './content.js'
import type { ScreenshotValue } from './content.js'
import { assertImageCapableRoute } from './route.js'

/** 手动截图时文字信封的首行。 */
const MANUAL_HEADLINE = 'Screenshot of the live screen, captured just now.'

/** `take_screenshot` 的输出 schema，与 {@link ScreenshotValue} 一一对应。 */
const SCREENSHOT_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true },
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
 * 注册两个工具。
 * @param ctx - 插件上下文（工具随它的生命周期自动注销）。
 * @param config - 插件配置。
 */
export function applyTools(ctx: Context, config: Config): void {
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
        description: 'Milliseconds to wait before capturing, so a page or drawing finishes rendering. Defaults to the configured delay.',
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
      const result = await captureScreenshot(ctx, config, {
        monitor: args.monitor,
        delayMs: args.delay_ms,
        signal: exec.signal,
      })
      return {
        path: result.path,
        warnings: result.warnings,
        image: imageValueFromRef(result.ref),
      }
    },
    presentCall(args): GenericCallView {
      const monitor = args.monitor ?? config.monitor
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
      return await listMonitors(ctx, config, exec.signal)
    },
  }))
}
