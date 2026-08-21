/**
 * 卡片的中英文案。字段的顺序与分组由 {@link CARD_FIELDS} 决定，这里只管文字。
 * @module dsh-screenshot-feedback-hook-mcp/client/locales
 */

/** 本卡片字典的键。 */
export type ScreenshotLocaleKey =
  | 'title' | 'description' | 'expand' | 'collapse'
  | 'unsaved' | 'readOnly' | 'save' | 'saving' | 'discard' | 'saveFailed'
  | 'overridden' | 'reset' | 'invalid' | 'on' | 'off' | 'advancedNote'
  | 'monitor' | 'monitorHint'
  | 'delayMs' | 'delayMsHint'
  | 'maxEdge' | 'maxEdgeHint'
  | 'targetKb' | 'targetKbHint'
  | 'captureTimeoutMs' | 'captureTimeoutMsHint'
  | 'warnOnTextOnlyModel' | 'warnOnTextOnlyModelHint'
  | 'autoAfterTools' | 'autoAfterToolsHint'
  | 'autoAfterToolsMatcher' | 'autoAfterToolsMatcherHint'
  | 'autoAfterToolsDelayMs' | 'autoAfterToolsDelayMsHint'
  | 'autoOnTurnStop' | 'autoOnTurnStopHint'
  | 'autoOnTurnStopDelayMs' | 'autoOnTurnStopDelayMsHint'
  | 'autoOnTurnStopSteer' | 'autoOnTurnStopSteerHint'

/** 一份完整字典。 */
export type ScreenshotLocaleDict = Record<ScreenshotLocaleKey, string>

export const zh: ScreenshotLocaleDict = {
  title: '截图反馈',
  description: '让 agent 看到自己产出的真实画面。',
  expand: '展开',
  collapse: '收起',
  unsaved: '未保存',
  readOnly: '当前部署不接受写入，改动无法保存。',
  save: '保存',
  saving: '保存中…',
  discard: '放弃修改',
  saveFailed: '有改动没有落盘，已保留草稿供你修改。',
  overridden: '已覆盖',
  reset: '重置',
  invalid: '这不是该字段接受的值',
  on: '开',
  off: '关',
  advancedNote: '截图命令（command / args / cwd）不在这里编辑，它决定去哪里找可执行文件，属于部署组合的事，请在 profile 的 cordis.patch.yml 里改。',
  monitor: '显示器',
  monitorHint: '0 = 全部显示器拼接，1..N = 单屏。编号可以让 agent 调 list_monitors 查。',
  delayMs: '手动截图前等待（毫秒）',
  delayMsHint: 'agent 主动调 take_screenshot 时，截图前等多久，等页面或工程图渲染完成。',
  maxEdge: '最长边（像素）',
  maxEdgeHint: '超过 2000 会被附件库拒绝，图片根本进不了会话。',
  targetKb: '目标体积（KB）',
  targetKbHint: 'dsh 没有 Claude Code 那条 25k token 的 MCP 输出上限，看不清细节时可以调大。',
  captureTimeoutMs: '截图超时（毫秒）',
  captureTimeoutMsHint: '在上面的等待时间之外另算。',
  warnOnTextOnlyModel: '纯文本模型时提示换模型',
  warnOnTextOnlyModelHint: '当前模型不声明图片输入时，给模型一条说明该怎么换 provider 的提示（每会话一次）。',
  autoAfterTools: '工具执行后自动截图',
  autoAfterToolsHint: '命中的工具跑完就截一张，随工具结果一起进上下文。每张截图都会跟着后续每次请求走，所以默认关。',
  autoAfterToolsMatcher: '触发的工具名',
  autoAfterToolsMatcherHint: '纯字母数字下划线和竖线按字面量精确交替，其余按正则。注意 dsh 的内置工具名是小写。',
  autoAfterToolsDelayMs: '工具后等待（毫秒）',
  autoAfterToolsDelayMsHint: '浏览器热重载约 1–2 秒，EDA/CAD 重绘更久时调大。',
  autoOnTurnStop: '轮次结束时自动截图',
  autoOnTurnStopHint: '一个 turn 最多截一次，这就是它不会让 agent 无限续跑的原因。',
  autoOnTurnStopDelayMs: '轮次结束等待（毫秒）',
  autoOnTurnStopDelayMsHint: '同上，等画面渲染完成。',
  autoOnTurnStopSteer: '强制模型再看一眼',
  autoOnTurnStopSteerHint: '开：截完用 steer 让模型再跑一步看图。关：只塞进上下文，等下次唤醒才被消费。',
}

export const en: ScreenshotLocaleDict = {
  title: 'Screenshot feedback',
  description: 'Let the agent see the screen it just produced.',
  expand: 'Expand',
  collapse: 'Collapse',
  unsaved: 'Unsaved',
  readOnly: 'This deployment does not accept writes, so changes cannot be saved.',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard',
  saveFailed: 'Some changes did not land; your drafts are kept so you can correct them.',
  overridden: 'Overridden',
  reset: 'Reset',
  invalid: 'Not a value this field accepts',
  on: 'On',
  off: 'Off',
  advancedNote: 'The screenshot command (command / args / cwd) is not edited here: it decides where the executable is found, which belongs to the deployment composition. Change it in your profile\'s cordis.patch.yml.',
  monitor: 'Monitor',
  monitorHint: '0 stitches every monitor, 1..N picks one. Ask the agent to call list_monitors for the indices.',
  delayMs: 'Manual capture delay (ms)',
  delayMsHint: 'How long take_screenshot waits before capturing, so a page or drawing finishes rendering.',
  maxEdge: 'Longest edge (px)',
  maxEdgeHint: 'Above 2000 the attachment store refuses the image and it never reaches the conversation.',
  targetKb: 'Byte budget (KB)',
  targetKbHint: 'dsh has no 25k-token MCP output cap, so raise it when you need more detail.',
  captureTimeoutMs: 'Capture timeout (ms)',
  captureTimeoutMsHint: 'Counted on top of the delay above.',
  warnOnTextOnlyModel: 'Explain text-only models',
  warnOnTextOnlyModelHint: 'When the current model declares no image input, tell the model how to switch provider (once per session).',
  autoAfterTools: 'Capture after tools',
  autoAfterToolsHint: 'Capture once a matching tool finishes; the image rides its result. Every screenshot rides every later request, so this ships off.',
  autoAfterToolsMatcher: 'Tool names',
  autoAfterToolsMatcherHint: 'A plain letters/digits/underscore/pipe pattern is exact alternation; anything else is a regex. dsh tool names are lowercase.',
  autoAfterToolsDelayMs: 'Delay after a tool (ms)',
  autoAfterToolsDelayMsHint: 'Browser hot reload takes 1–2s; raise it for slower EDA/CAD redraws.',
  autoOnTurnStop: 'Capture at turn end',
  autoOnTurnStopHint: 'At most one capture per turn — that is what keeps it from running the agent forever.',
  autoOnTurnStopDelayMs: 'Delay at turn end (ms)',
  autoOnTurnStopDelayMsHint: 'Same idea: wait for the screen to finish rendering.',
  autoOnTurnStopSteer: 'Steer the model to look',
  autoOnTurnStopSteerHint: 'On: steer the model into one more step to look at it. Off: only inject it as context for the next wake-up.',
}
