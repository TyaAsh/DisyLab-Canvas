/*!
 * Copyright (c) 2026 DisyLab. All rights reserved.
 * Proprietary source-available software under LicenseRef-DisyLab-Proprietary.
 * Unauthorized commercial use, redistribution, white-labeling, relicensing,
 * or removal of this copyright notice is prohibited.
 * Repository: https://github.com/TyaAsh/DisyLab-Canvas
 * SPDX-FileCopyrightText: 2026 DisyLab
 * SPDX-License-Identifier: LicenseRef-DisyLab-Proprietary
 */
import type { AgentCanvasEditDraft, AgentCanvasEditProposal } from './agentCanvasEdits'
import type { AgentImageOperationDraft } from './agentImageOperations'

export type AgentMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  references?: AgentImageReference[]
  skillUseId?: string
  questions?: AgentQuestion[]
  canvasEditDraft?: AgentCanvasEditDraft
  canvasEditTargetQuestion?: boolean
  imageOperation?: AgentImageOperationDraft
  retry?: {
    userMessageId: string
    invocationText: string
    videoGenerationMode?: 'text' | 'image' | 'frames' | 'reference' | 'omni'
    useTeam: boolean
    legacyStoryboardPlanId?: string
  }
  filmPlan?: {
    skillSlug: string
    subject: string
    values: Record<string, string | number | boolean>
    references: AgentImageReference[]
    nodeId?: string
    imageModelKey?: string
    videoModelKey?: string
    confirmed?: { summary: string; models: string }
  }
  textNode?: {
    title: string
    content: string
    nodeId?: string
  }
  decision?: AgentDecision
}

export type AgentQuestion = { prompt: string; options: string[]; example?: string }

export type AgentImageReference = {
  nodeId: string
  name: string
  url: string
  mediaId?: string
  kind?: 'image' | 'video'
  autoResolved?: boolean
  resolutionReason?: string
}

export type AgentContextReference = {
  nodeId: string
  name: string
  kind: 'image' | 'video' | 'text'
  url?: string
  mediaId?: string
  excerpt?: string
  autoResolved?: boolean
  resolutionReason?: string
}

export type AgentStyleReference = {
  id: string
  name: string
  url: string
  mediaId?: string
}

export type AgentInvokedStylePreset = {
  id: string
  name: string
  keyword: string
  references: AgentStyleReference[]
}

export type AgentImagePlan = {
  id: string
  status: 'proposed' | 'ready' | 'running' | 'completed' | 'failed' | 'cancelled'
  label?: string
  prompt: string
  referenceNodeIds: string[]
  references?: AgentImageReference[]
  contextReferences?: AgentContextReference[]
  invokedStyleReferences?: AgentStyleReference[]
  styleInvocationWord?: string
  invokedStylePresets?: AgentInvokedStylePreset[]
  aspectRatio: string
  resolution: string
  detail: string
  count: number
  /** Separates cards with confirmed draft settings from older composer defaults. */
  hasDraftImageSpecs?: boolean
  deliverableIndex?: number
  imageConnectionId?: string
  imageModelId?: string
  assistantMessageId?: string
  createdAt?: string
  collapsed?: boolean
  nodeId?: string
  results?: Array<{
    id: string
    url: string
    fileName: string
    mediaId?: string
  }>
  error?: string
}

export type AgentInteractionMode = 'answer' | 'clarify' | 'plan' | 'execute' | 'inspect'

export type AgentDecision = {
  mode: AgentInteractionMode
  confidence: number
  needsApproval: boolean
  reason: string
}

export type AgentRun = {
  id: string
  projectId: string
  canvasId: string
  conversationId: string
  canvasRevision: string
  mode: AgentInteractionMode
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  startedAt: string
  updatedAt: string
  title?: string
  stage?: string
  team?: boolean
}

export type AgentCanvasContextSnapshot = {
  projectId: string
  canvasId: string
  canvasName: string
  revision: string
  selectedNodeIds: string[]
  nodes: Array<{ id: string; kind: string; title: string; status?: string; excerpt?: string }>
  edges: Array<{ source: string; target: string }>
}

export type AgentVideoPlan = {
  id: string
  mediaKind: 'video'
  status: 'ready' | 'running' | 'completed' | 'failed' | 'cancelled'
  label?: string
  prompt: string
  referenceNodeIds: string[]
  references?: AgentImageReference[]
  contextReferences?: AgentContextReference[]
  invokedStyleReferences?: AgentStyleReference[]
  styleInvocationWord?: string
  invokedStylePresets?: AgentInvokedStylePreset[]
  aspectRatio: string
  resolution: string
  duration: number
  count: number
  generationMode?: 'text' | 'image' | 'frames' | 'reference' | 'omni'
  videoConnectionId?: string
  videoModelId?: string
  assistantMessageId?: string
  createdAt?: string
  nodeId?: string
  error?: string
}

export type AgentTextPlan = {
  id: string
  status: 'ready' | 'completed' | 'cancelled'
  title: string
  content: string
  contextReferences?: AgentContextReference[]
  assistantMessageId?: string
  createdAt?: string
  nodeId?: string
}

export type AgentConversation = {
  id: string
  title: string
  messages: AgentMessage[]
  createdAt: string
  updatedAt: string
}

export interface CanvasAgentService {
  sendMessage(conversation: AgentConversation, message: string): Promise<AgentConversation>
}

export type AgentReply = {
  reply: string
  questions?: AgentQuestion[]
  filmDraft?: { subject: string; values: Record<string, unknown> }
  decision?: AgentDecision
  imagePlan?: AgentImagePlanDraft
  imagePlans?: AgentImagePlanDraft[]
  imagePlanIntent?: 'alternatives' | 'deliverables'
  videoPlan?: AgentVideoPlanDraft
  videoPlans?: AgentVideoPlanDraft[]
  textEdits?: AgentCanvasEditProposal[]
  textNode?: {
    title: string
    content: string
  }
}

export type AgentImagePlanDraft = Pick<AgentImagePlan, 'prompt' | 'aspectRatio' | 'resolution' | 'detail' | 'count' | 'label'>

/** The user's explicit image specs win over the model's suggested settings. */
export function resolveAgentImageDraftSettings(
  request: string,
  draft: AgentImagePlanDraft,
  defaults: Pick<AgentImagePlanDraft, 'aspectRatio' | 'resolution' | 'detail' | 'count'>,
) {
  const ratio = (text: string) => {
    const value = text.normalize('NFKC')
    const specified = /(?:比例|横版|竖版|方形|宽高比|横屏|竖屏)\s*(?:为|用|[:：])?\s*(\d{1,2}(?:\.\d+)?)[ \t]*:[ \t]*(\d{1,2}(?:\.\d+)?)(?![\d.:])/.exec(value)
    return specified ?? /(?:^|[^\d:])(21|16|9|5|4|3|2|1)[ \t]*:[ \t]*(21|16|9|5|4|3|2|1)(?![\d.:])/.exec(value)
  }
  const ratioString = (match: RegExpMatchArray | null) => match && Number(match[1]) > 0 && Number(match[2]) > 0 ? `${Number(match[1])}:${Number(match[2])}` : undefined
  const normalized = request.normalize('NFKC')
  const count = normalized.match(/(?:^\s*|(?:数量|张数|生成|出图|做|画|给我|要|每个方案)[：:\s]*)([1-4一二两三四])\s*张/)
  const countWords: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4 }
  const quality = normalized.match(/(?:画质|品质|质量|精度)\s*[:：]?\s*(自动|最高|高|中|低)/)
  const qualityWords: Record<string, string> = { 自动: 'auto', 最高: 'max', 高: 'high', 中: 'medium', 低: 'low' }
  const suppliedResolution = normalized.match(/(?:^|[^a-z0-9])([124]K)(?![a-z0-9])/i)?.[1].toUpperCase()
  return {
    aspectRatio: ratioString(ratio(normalized)) ?? ratioString(ratio(draft.prompt)) ?? ratioString(ratio(draft.aspectRatio)) ?? defaults.aspectRatio,
    resolution: suppliedResolution ?? draft.resolution ?? defaults.resolution,
    detail: (quality && qualityWords[quality[1]]) || draft.detail || defaults.detail,
    count: count ? (countWords[count[1]] ?? Number(count[1])) : Math.min(4, Math.max(1, Math.round(draft.count || defaults.count))),
  }
}

export function reconcileAgentImagePlanSpecs(plan: AgentImagePlan): AgentImagePlan {
  if (plan.hasDraftImageSpecs || plan.aspectRatio !== '1:1' || (plan.status !== 'ready' && plan.status !== 'proposed')) return plan
  const specs = resolveAgentImageDraftSettings('', plan, plan)
  return { ...plan, aspectRatio: specs.aspectRatio }
}
export type AgentVideoPlanDraft = Pick<AgentVideoPlan, 'prompt' | 'aspectRatio' | 'resolution' | 'duration' | 'count' | 'label'>

export function compactReferenceName(value: string, maxLength = 8) {
  const characters = Array.from(value.trim())
  return characters.length > maxLength ? `${characters.slice(0, maxLength).join('')}...` : value.trim()
}

const CHINESE_DIGITS: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

function parsePlanCountText(value: string) {
  if (/^\d+$/.test(value)) {
    const count = Number(value)
    return Number.isSafeInteger(count) && count > 0 ? count : null
  }
  if (value === '十') return 10
  const [tensText, onesText] = value.split('十')
  if (onesText !== undefined) {
    const tens = tensText ? CHINESE_DIGITS[tensText] : 1
    const ones = onesText ? CHINESE_DIGITS[onesText] : 0
    return tens !== undefined && ones !== undefined ? tens * 10 + ones : null
  }
  return CHINESE_DIGITS[value] ?? null
}

export function requestedAgentImageCount(content: string) {
  const text = content.normalize('NFKC')
  const count = /(?:生成|输出|制作|出|画|给我|要|一共|总共|共|设计)\s*(?:是|要)?\s*(\d{1,2}|[一二两三四五六七八九十]{1,3})\s*(?:张|幅)/.exec(text)?.[1]
  return count ? parsePlanCountText(count) : null
}

export function getRequestedAgentPlanCount(content: string) {
  const match = content.match(/(?:给|要|来|出|提供|做|准备|整理|生成|想要)?\s*(\d+|[一二两三四五六七八九十]+)\s*(?:个|套|份|种|款)?\s*(?:不同的?|备选的?|独立的?)?\s*(?:方案|方向|创意|版本)/i)
  return match ? parsePlanCountText(match[1]) : null
}

export function agentDirectionLimit(content: string) {
  return getRequestedAgentPlanCount(content)
    ?? (/(?:多套|多种|多个|不同|几套|几种|几个|备选|可选).{0,6}(?:方案|方向|创意|版本)|(?:头脑风暴|脑暴|brainstorm)/i.test(content) ? 3 : 1)
}

export function messageRequestsDirectImagePlan(content: string) {
  return /(?:不用|不要|无需)(?:再|先)?(?:选择|提供|给出|查看)?(?:任何|多个|这些|三套)?(?:方案|方向)/i.test(content)
    || /(?:直接|就|照着|按照|按我说的).{0,18}(?:生成|生图|出图|做|制作|设计|修复|修改)/i.test(content)
}

export function requestsAgentImageEdit(content: string) {
  const text = content.replace(/@\[node:[^\]]+\]/g, '')
  return /(?:换背景|替换背景|改背景|去背景|抠图|移除背景|修复原图|调色|去水印|修图|(?:把|将|给).{0,24}(?:背景|颜色|构图).{0,10}(?:改|换)|\b(?:remove|replace|change) (?:the )?background\b)/i.test(text)
}

export function resolveAgentVideoDraftSettings(
  request: string,
  draft: AgentVideoPlanDraft,
  defaults: Pick<AgentVideoPlanDraft, 'aspectRatio' | 'resolution' | 'duration' | 'count'>,
) {
  const text = request.normalize('NFKC')
  const aspect = /(?:^|[^\d:])(21|16|9|5|4|3|2|1)\s*:\s*(21|16|9|5|4|3|2|1)(?![\d.:])/.exec(text)
  const duration = /(?:时长\s*(?:为|用|[:：])?\s*|(?:做|生成|制作|要)(?:一个|一段|成)?\s*|^)(\d{1,2}|[一二两三四五六七八九十]{1,3})\s*(?:秒|seconds?)/i.exec(text)
    ?? /(?:^|[^\d-])(\d{1,2})\s*秒(?:钟)?(?:的)?(?:视频|短片|动画)/.exec(text)
  const count = /(?:生成|制作|做|输出|数量\s*[:：]?)\s*([1-4一二两三四])\s*(?:条|段|个|份)/.exec(text)
  const resolution = /(?:^|[^a-z0-9])(480p|720p|768p|1080p|2k|4k)(?![a-z0-9])/i.exec(text)
  return {
    aspectRatio: aspect ? `${aspect[1]}:${aspect[2]}` : /竖版|竖屏/.test(text) ? '9:16' : /横版|横屏/.test(text) ? '16:9' : draft.aspectRatio || defaults.aspectRatio,
    resolution: resolution?.[1].toLowerCase() || draft.resolution.toLowerCase() || defaults.resolution,
    duration: (duration && parsePlanCountText(duration[1])) || draft.duration || defaults.duration,
    count: Math.min(4, Math.max(1, (count && parsePlanCountText(count[1])) || Math.round(draft.count || defaults.count))),
  }
}

export function messageExpectsImagePlans(content: string) {
  const explicitImageIntent = /(?:生图|出图|绘图|画图|生成图片|生成图像|制作图片|制作海报|设计海报|视觉稿|效果图|封面图|配图)/i.test(content)
    || /(?:生成|制作|设计|创作|画|做|出)(?:.{0,10})(?:图像|图片|海报|视觉画面)/i.test(content)
  return explicitImageIntent
}

export function inferAgentInteractionMode(content: string): AgentDecision {
  const normalized = content.trim()
  const inspect = /(?:检查|分析|审计|评估|看看|为什么|怎么回事|找问题|排查)/i.test(normalized)
  const explicitPlan = /(?:先|只|暂时).{0,8}(?:计划|方案|分析|思路|建议)|(?:不要|先别|暂不).{0,8}(?:执行|生成|修改|动手)|计划模式/i.test(normalized)
  const explicitExecute = /(?:开始|直接|立即|现在|马上|就按|照着|执行|落实|修改好|修复好|生成|制作|创建|删除)/i.test(normalized)
  const ambiguous = normalized.length < 5 || /^(?:这个|那个|它|继续|然后呢|怎么办)[？?。！!]*$/i.test(normalized)
  if (/^(?:(?:请|帮我|先|只|分析一下|看一下)\s*)*(?:检查|分析|审计|评估|看看|为什么|怎么回事|找问题|排查)/.test(normalized)
    && !/(?:然后|并且|之后|接着).{0,14}(?:执行|修改|修复|生成|制作|创建)/.test(normalized)) {
    return { mode: 'inspect', confidence: .93, needsApproval: false, reason: '用户要求先检查或分析现状' }
  }
  if (explicitPlan) return { mode: 'plan', confidence: .96, needsApproval: false, reason: '用户明确要求先规划或暂不执行' }
  if (explicitExecute) return { mode: 'execute', confidence: .88, needsApproval: true, reason: '用户明确要求开始产生变更' }
  if (ambiguous) return { mode: 'clarify', confidence: .72, needsApproval: false, reason: '目标或指代不足以安全执行' }
  if (inspect) return { mode: 'inspect', confidence: .82, needsApproval: false, reason: '用户请求分析现状或定位问题' }
  return { mode: 'answer', confidence: .62, needsApproval: false, reason: '未发现明确执行或规划指令' }
}

export function agentReplyAllowsProposals(local: AgentDecision, reply: Pick<AgentReply, 'decision' | 'questions'>) {
  return local.mode !== 'inspect' && reply.decision?.mode !== 'inspect' && reply.decision?.mode !== 'clarify' && !reply.questions?.length
}

export function requestsAgentCanvasTextEdits(content: string, hasSelectedText: boolean) {
  if (!/修改|改写|改一下|重写|润色|精简|缩短|改短|更名|重命名|替换|改成|改为|改标题|改正文/.test(content)) return false
  const textField = /文本|文字|文案|标题|正文|脚本/.test(content)
  return (/《[^》]+》|@\[node:/.test(content) && (textField || hasSelectedText || /改写|重写|润色|精简|改短/.test(content)))
    || (textField && /画布|节点|选中|所选/.test(content))
    || (hasSelectedText && /选中|所选|这段|这些|这几段|这个标题|它/.test(content))
}

export function messageExpectsVideoPlans(content: string) {
  if (/(?:生成|制作|设计|出|画|输出).{0,16}(?:张|幅).{0,10}(?:关键帧|视频帧|分镜)/.test(content)) return false
  return /(?:生成|制作|创作|做|出|续写|延展).{0,12}(?:视频|短片|动画|动态画面)/i.test(content)
    || /(?:文生视频|图生视频|视频生成|生成视频|(?:让|把).{0,15}(?:图|画面).{0,8}动起来|\banimate (?:this|the) image\b)/i.test(content)
}

function extractFirstJsonContainer(value: string) {
  const objectStart = value.indexOf('{')
  const arrayStart = value.indexOf('[')
  const start = objectStart < 0 ? arrayStart : arrayStart < 0 ? objectStart : Math.min(objectStart, arrayStart)
  if (start < 0) return null
  const stack: string[] = []
  let quoted = false
  let escaped = false
  for (let index = start; index < value.length; index += 1) {
    const character = value[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') quoted = false
      continue
    }
    if (character === '"') quoted = true
    else if (character === '{') stack.push('}')
    else if (character === '[') stack.push(']')
    else if (character === '}' || character === ']') {
      if (stack.at(-1) !== character) return null
      stack.pop()
      if (!stack.length) return value.slice(start, index + 1)
    }
  }
  return null
}

function normalizeAgentReplyRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    const records = value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    const protocolRecords = records.filter((record) => ['reply', 'decision', 'imagePlan', 'imagePlans', 'videoPlan', 'videoPlans', 'textNode', 'textEdits', 'filmDraft', 'questions'].some((field) => field in record))
    return protocolRecords.length ? Object.assign({}, ...protocolRecords) : null
  }
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function parseAgentReplyRecord(value: string) {
  const attempts = [value, extractFirstJsonContainer(value)].filter((item, index, items): item is string => Boolean(item) && items.indexOf(item) === index)
  for (const attempt of attempts) {
    try {
      let parsed: unknown = JSON.parse(attempt)
      if (typeof parsed === 'string') parsed = JSON.parse(parsed)
      const record = normalizeAgentReplyRecord(parsed)
      if (record) return record
    } catch {
      // Try the next cleaned JSON candidate.
    }
  }
  return null
}

function extractMalformedReply(value: string) {
  const match = value.match(/["']?reply["']?\s*:\s*["']((?:\\.|[^"'\\])*)["']/s)
  if (!match) return ''
  try {
    return (JSON.parse(`"${match[1]}"`) as string).trim()
  } catch {
    return match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').trim()
  }
}

function looksLikeAgentProtocolPayload(value: string) {
  const cleaned = value.trim()
  const hasProtocolField = /(?:["']|\\["'])?(?:reply|decision|imagePlans?|videoPlans?|textNode|textEdits|filmDraft|questions)(?:["']|\\["'])?\s*:/i.test(cleaned)
  if (!hasProtocolField) return false
  return /^```(?:json|js)?/i.test(cleaned)
    || /^[\[{"']/.test(cleaned)
    || /\{[\s\S]*(?:reply|imagePlans?|videoPlans?|textNode|textEdits|filmDraft|questions)\s*:/i.test(cleaned)
    || /^(?:reply|imagePlans?|videoPlans?|textNode|textEdits|filmDraft|questions)\s*:/i.test(cleaned)
    || /(?:^|\n)\s*(?:reply|imagePlans?|videoPlans?|textNode|textEdits|filmDraft|questions)\s*:/i.test(cleaned)
}

export function normalizeAgentMessageContent(content: string) {
  return looksLikeAgentProtocolPayload(content) ? parseAgentReply(content).reply : content
}

export function buildAgentConversationContext(messages: AgentMessage[], recentCount = 12) {
  const recent = messages.slice(-recentCount)
  const older = messages.slice(0, -recentCount)
  const summary = older.slice(-24).map((message) => {
    const content = normalizeAgentMessageContent(message.content).replace(/\s+/g, ' ').trim()
    return `${message.role === 'user' ? '用户' : 'Disy'}：${content.slice(0, 180)}`
  }).join('\n')
  const transcript = recent.map((message, index) => {
    const content = message.role === 'assistant' ? normalizeAgentMessageContent(message.content) : message.content
    const bounded = index === recent.length - 1 || content.length <= 1600 ? content : `${content.slice(0, 1100)}\n[中段略]\n${content.slice(-480)}`
    return `${message.role === 'user' ? '用户' : 'Disy'}：${bounded}`
  }).join('\n')
  return summary ? `较早对话摘要（按原顺序压缩）：\n${summary}\n\n最近对话：\n${transcript}` : transcript
}

export function parseAgentReply(raw: string): AgentReply {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    const value = parseAgentReplyRecord(cleaned)
    if (!value) throw new Error('Invalid Agent response payload')
    const reply = typeof value.reply === 'string' ? value.reply.trim() : ''
    const questions: AgentQuestion[] = []
    if (Array.isArray(value.questions)) {
      for (const item of value.questions.slice(0, 4)) {
        if (typeof item?.prompt !== 'string') continue
        const prompt = item.prompt.trim().slice(0, 180)
        if (!prompt || questions.some((question) => question.prompt === prompt)) continue
        const options = Array.isArray(item.options)
          ? [...new Set<string>(item.options.filter((option: unknown) => typeof option === 'string').map((option: string) => option.trim().slice(0, 120)).filter(Boolean))].slice(0, 5)
          : []
        questions.push({ prompt, options, example: typeof item.example === 'string' ? item.example.trim().slice(0, 160) : undefined })
      }
    }
    const draft = value.filmDraft && typeof value.filmDraft === 'object' ? value.filmDraft as Record<string, unknown> : null
    const filmDraft = typeof draft?.subject === 'string' && draft.subject.trim()
      && draft.values && typeof draft.values === 'object' && !Array.isArray(draft.values)
      ? { subject: draft.subject.trim().slice(0, 8000), values: draft.values as Record<string, unknown> }
      : undefined
    const decisionValue = value.decision && typeof value.decision === 'object' && !Array.isArray(value.decision)
      ? value.decision as Record<string, unknown>
      : null
    const decisionModes: AgentInteractionMode[] = ['answer', 'clarify', 'plan', 'execute', 'inspect']
    const decisionMode = decisionModes.find((mode) => mode === decisionValue?.mode)
    const decision = decisionMode ? {
      mode: decisionMode,
      confidence: Math.min(1, Math.max(0, Number(decisionValue?.confidence) || 0)),
      needsApproval: Boolean(decisionValue?.needsApproval),
      reason: typeof decisionValue?.reason === 'string' ? decisionValue.reason.trim() : '',
    } satisfies AgentDecision : undefined
    const candidates = Array.isArray(value.imagePlans)
      ? value.imagePlans.filter((candidate): candidate is Record<string, unknown> => Boolean(candidate) && typeof candidate === 'object')
      : value.imagePlan && typeof value.imagePlan === 'object'
        ? [value.imagePlan as Record<string, unknown>]
        : []
    const imagePlans = candidates
      .map((candidate, index): AgentImagePlanDraft | null => {
        const prompt = typeof candidate.prompt === 'string' ? candidate.prompt.trim() : ''
        if (!prompt) return null
        return {
          label: typeof candidate.label === 'string' && candidate.label.trim() ? candidate.label.trim() : `方案${index + 1}`,
          prompt,
          aspectRatio: typeof candidate.aspectRatio === 'string' ? candidate.aspectRatio : '1:1',
          resolution: typeof candidate.resolution === 'string' ? candidate.resolution : '1K',
          detail: typeof candidate.detail === 'string' ? candidate.detail : 'medium',
          count: Math.min(4, Math.max(1, Number(candidate.count) || 1)),
        }
      })
      .filter((candidate): candidate is AgentImagePlanDraft => Boolean(candidate))
    const videoCandidates = Array.isArray(value.videoPlans)
      ? value.videoPlans.filter((candidate): candidate is Record<string, unknown> => Boolean(candidate) && typeof candidate === 'object')
      : value.videoPlan && typeof value.videoPlan === 'object'
        ? [value.videoPlan as Record<string, unknown>]
        : []
    const videoPlans = videoCandidates
      .map((candidate, index): AgentVideoPlanDraft | null => {
        const prompt = typeof candidate.prompt === 'string' ? candidate.prompt.trim() : ''
        if (!prompt) return null
        return {
          label: typeof candidate.label === 'string' && candidate.label.trim() ? candidate.label.trim() : `视频方案${index + 1}`,
          prompt,
          aspectRatio: typeof candidate.aspectRatio === 'string' ? candidate.aspectRatio : '16:9',
          resolution: typeof candidate.resolution === 'string' ? candidate.resolution : '720p',
          duration: Math.min(30, Math.max(1, Number(candidate.duration) || 4)),
          count: Math.min(4, Math.max(1, Number(candidate.count) || 1)),
        }
      })
      .filter((candidate): candidate is AgentVideoPlanDraft => Boolean(candidate))
    const rawTextNode = value.textNode && typeof value.textNode === 'object'
      ? value.textNode as Record<string, unknown>
      : null
    const textNodeContent = typeof rawTextNode?.content === 'string' ? rawTextNode.content.trim() : ''
    const textNode = textNodeContent
      ? {
          title: typeof rawTextNode?.title === 'string' && rawTextNode.title.trim() ? rawTextNode.title.trim() : 'Agent 文本',
          content: textNodeContent,
        }
      : undefined
    const textEdits = Array.isArray(value.textEdits) ? value.textEdits.slice(0, 8).flatMap((item): AgentCanvasEditProposal[] => {
      if (!item || typeof item !== 'object' || typeof item.nodeId !== 'string' || (!Object.hasOwn(item, 'title') && !Object.hasOwn(item, 'body'))) return []
      return [{ nodeId: item.nodeId, title: typeof item.title === 'string' ? item.title : undefined, body: typeof item.body === 'string' ? item.body : undefined }]
    }) : []
    return {
      reply: reply
        || (questions.length ? '先确认几个细节，我们就能继续。' : '')
        || (imagePlans.length ? `我已整理好${imagePlans.length > 1 ? `${imagePlans.length}份` : '一份'}图像方案，请选择并确认后生成。` : '')
        || (videoPlans.length ? `我已整理好${videoPlans.length > 1 ? `${videoPlans.length}份` : '一份'}视频方案，请确认后生成。` : '')
        || (filmDraft ? '成片方案整理好了，可以先看一眼再开始制作。' : '')
        || (textEdits.length ? '修改建议已整理好，确认后才会更新画布。' : '')
        || (textNode ? '最终文本已整理好，确认后可加入画布。' : '这次回复格式异常，请重新发送一次。'),
      decision,
      questions: questions.length ? questions : undefined,
      filmDraft,
      imagePlanIntent: value.imagePlanIntent === 'deliverables' || value.imagePlanIntent === 'alternatives' ? value.imagePlanIntent : undefined,
      imagePlan: imagePlans[0],
      imagePlans: imagePlans.length ? imagePlans : undefined,
      videoPlan: videoPlans[0],
      videoPlans: videoPlans.length ? videoPlans : undefined,
      textNode,
      textEdits: textEdits.length ? textEdits : undefined,
    }
  } catch {
    const recoveredReply = extractMalformedReply(cleaned)
    const looksLikeProtocolPayload = looksLikeAgentProtocolPayload(cleaned)
    return { reply: recoveredReply || (looksLikeProtocolPayload ? '这次回复格式异常，请重新发送一次。' : cleaned) }
  }
}

export const canvasAgentAvailability = 'available' as const
