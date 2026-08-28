/**
 * 截图 → 模型可见内容块的共享投影。手动工具的 `output.render` 和两个自动时机
 * 注入的消息用的是同一份，保证模型无论从哪条路看到截图，格式都一致。
 * @module dsh-screenshot-feedback-hook-mcp/content
 */

import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'

/** 注入消息的来源标记，让持久历史里能看出这是插件产生的上下文而非用户输入。 */
export const PLUGIN_SOURCE = 'screenshot-feedback'

/** `take_screenshot` 输出 schema 里图片那一半的规范值。 */
export interface ImageValue {
  attachmentId: string
  mediaType: ImageMediaType
  bytes: number
  width: number
  height: number
  name?: string
}

/** `take_screenshot` 的完整规范值。 */
export interface ScreenshotValue {
  path: string
  warnings: string[]
  image: ImageValue
}

/**
 * 把附件引用降成 JSON 安全的规范值（工具的 `value` 会被冻结并校验）。
 * @param ref - `saveImage` 返回的持久引用。
 * @returns 规范值形态的同一份元数据。
 */
export function imageValueFromRef(ref: ImageAttachmentRef): ImageValue {
  return {
    attachmentId: ref.attachmentId,
    mediaType: ref.mediaType,
    bytes: ref.bytes,
    width: ref.width,
    height: ref.height,
    ...ref.name === undefined ? {} : { name: ref.name },
  }
}

/**
 * 规范值还原成附件引用，供 `ImageBlock` 使用。
 * @param image - 规范值形态的图片元数据。
 * @returns 带 brand 的附件引用。
 */
export function refFromImageValue(image: ImageValue): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId(image.attachmentId),
    mediaType: image.mediaType,
    bytes: image.bytes,
    width: image.width,
    height: image.height,
    ...image.name === undefined ? {} : { name: image.name },
  }
}

/**
 * 截图旁边那条文字信封：说明这是什么、什么时候截的、有没有环境告警。
 * @param value - 规范值。
 * @param headline - 首行，手动/自动两条路各自不同。
 * @returns 面向模型的文本。
 */
export function formatScreenshotText(value: ScreenshotValue, headline: string): string {
  const lines = [
    headline,
    `<image>${value.image.mediaType}, ${String(value.image.width)}x${String(value.image.height)} px, ${String(value.image.bytes)} bytes</image>`,
  ]
  if (value.warnings.length > 0) lines.push(`<warnings>${value.warnings.join(' | ')}</warnings>`)
  return lines.join('\n')
}

/**
 * 文字信封 + 图片块，两块一起才是模型看到的完整截图。
 * @param value - 规范值。
 * @param headline - 文字信封的首行。
 * @returns 内容块数组。
 */
export function screenshotContent(value: ScreenshotValue, headline: string): ContentBlock[] {
  return [
    { type: 'text', text: formatScreenshotText(value, headline) },
    { type: 'image', attachment: refFromImageValue(value.image) },
  ]
}

/**
 * 把截图包成一条插件来源的 user 消息，供 `additionalContexts` / `inject` / `steer` 使用。
 * @param content - 内容块。
 * @returns 带稳定标识与插件来源的消息。
 */
export function pluginMessage(content: ContentBlock[]): UserMessage {
  return createUserMessage({
    source: { kind: 'plugin', plugin: PLUGIN_SOURCE },
    content,
  })
}

/**
 * 纯文字的插件消息（用于报告截图失败或换模型提示）。
 * @param text - 文本。
 * @returns 带稳定标识与插件来源的消息。
 */
export function pluginTextMessage(text: string): UserMessage {
  return pluginMessage([{ type: 'text', text }])
}

/**
 * 自动截图失败时给模型的那条文字。
 *
 * 两个自动时机的失败以前只进日志：模型和用户在对话里什么都看不到，插件表现为
 * 「静默地什么也没做」。而最常见的那个失败 —— PATH 上没有 `uvx` —— 恰恰带着一段
 * 照做就能修好的说明，把它烂在日志里是最亏的。
 * @param headline - 首行，说明是哪个时机失败了。
 * @param reason - 失败原因。
 * @returns 面向模型的文本。
 */
export function formatCaptureFailureText(headline: string, reason: string): string {
  return [headline, `<error>${reason}</error>`].join('\n')
}
