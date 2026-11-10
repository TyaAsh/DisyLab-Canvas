import type { ImageOutput } from './imageApi'

export const IMAGE_OUTPUT_LABELS: Record<ImageOutput, string> = {
  png: 'PNG',
  'transparent-png': '透明底 PNG',
  gif: 'GIF 动图',
  svg: 'SVG',
}

const OUTPUT_TERMS = /(?<transparent>透明\s*(?:背景|底色?|通道|的?\s*(?=png\b))|背景\s*(?:设(?:置)?为|改为|是|[:=])?\s*透明|不带背景|无背景|\b(?:transparent\s+(?:background|png)|no\s+background|background\s*(?:(?:is\b|[:=])\s*)?transparent)\b)|(?<format>\b(?:gif|svg|png)\b)|(?<motion>动态图|动图)/gi
const CHINESE_TARGET = /输出|导出|另存为|保存为|生成|制作|设计|创作|绘制|画(?:一张|一个|一幅)|做(?:成|一张|一个|一幅)|转(?:换)?(?:成|为)|改(?:成|为)/
const ENGLISH_TARGET = /\b(?:output|export|generate|create|make|render|save\s+as|convert\s+to)\b/
const CONTEXT_TERMS = new RegExp([
  `(?<exclude>(?:不要|不用|不需要|不是|别)\\s*(?:再\\s*)?(?:${CHINESE_TARGET.source}|使用)?|不(?:生成|输出|导出)|\\b(?:avoid|without|instead\\s+of|no|(?:do\\s+)?not|don't)\\b(?:\\s+(?:${ENGLISH_TARGET.source}|use))?)`,
  /(?<source>参考|基于|仿照|参照|输入|上传的|生成的|\b(?:reference|based\s+on|source|input|uploaded)\b)/.source,
  `(?<target>${CHINESE_TARGET.source}|${ENGLISH_TARGET.source}|而是|\\b(?:as|rather)\\b)`,
].join('|'), 'gi')
const SOURCE_SUFFIX = /^\s*(?:风格|样式|字样|(?:为|作)主题|转(?:换)?(?:成|为)?|改(?:成|为)|变成|\b(?:style|to|into|as\s+(?:a\s+)?reference)\b)/i
const REFERENCE_SUFFIX = /^\s*(?:格式(?:的)?\s*)?(?:参考(?:图|素材)|\breference\b)/i

/** Detect an output request from the user's prompt, separate from attached assets. */
export function inferImageOutput(prompt: string): ImageOutput | undefined {
  const text = prompt.normalize('NFKC')
    .replace(/@\[node:[^\]]+\]|https?:\/\/[^\s，。；！？]+/gi, '')
  let format: 'png' | 'gif' | 'svg' | undefined
  let transparent = false
  let motion = false

  for (const clause of text.split(/[，。；！？,;!?\n]/)) {
    for (const match of clause.matchAll(OUTPUT_TERMS)) {
      const before = clause.slice(0, match.index)
      const after = clause.slice(match.index + match[0].length)
      const context = [...before.matchAll(CONTEXT_TERMS)].at(-1)?.groups
      if (context?.exclude || context?.source || SOURCE_SUFFIX.test(after) || (!context?.target && REFERENCE_SUFFIX.test(after))) continue

      if (match.groups?.transparent) {
        if (!before.endsWith('不')) transparent = true
      } else if (match.groups?.format) {
        format = match.groups.format.toLowerCase() as typeof format
      } else {
        motion = true
      }
    }
  }

  if (format === 'gif' || format === 'svg') return format
  if (transparent) return 'transparent-png'
  return format ?? (motion ? 'gif' : undefined)
}

export function imageOutputIntent(prompt: string, supported?: readonly ImageOutput[]) {
  const requested = inferImageOutput(prompt)
  const output = requested && supported?.includes(requested) ? requested : undefined
  const blocked = Boolean(requested && requested !== 'png' && !output)
  const message = requested && blocked
    ? `当前模型${supported ? '不支持' : '尚未确认支持'} ${IMAGE_OUTPUT_LABELS[requested]}，请更换模型或修改提示词。`
    : output ? `已从提示词识别，将请求 ${IMAGE_OUTPUT_LABELS[output]}。` : ''
  return { output, blocked, message }
}
