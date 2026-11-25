import type { AgentDecision, AgentMessage, AgentTurnOptions } from './agent'

export type AgentWorkflow = 'smart' | 'collaborate' | 'direct'
export type AgentCreativeDirection = {
  id: string
  title: string
  description: string
  brief: string
  kind: 'image' | 'video'
  recommended: boolean
}
export const AGENT_WORKFLOWS = [
  { value: 'smart', label: '智能', detail: '需求清楚直接做，方向模糊先给建议' },
  { value: 'collaborate', label: '协作', detail: '先完善创意与方案，点头后再生成' },
  { value: 'direct', label: '直接生成', detail: '合理补齐参数，减少讨论；关键歧义才追问' },
] as const

const directStart = /(?:直接|立即|马上|现在|开始|可以|确认|就按|照着|按这个|按这版|就这样).{0,22}(?:生成|出图|生图|制作|做出来|执行|做|开工)|(?:生成|出图|生图).{0,6}(?:吧|即可|就行)|^(?:开始|开工|生成|执行)[！!。\s]*$/

export function agentWantsReview(text: string, includeExploration = true) {
  const withoutDeclinedPlans = text.replace(/(?:不用|不要|无需)(?:再|先)?(?:给|提供|出|讨论|看|选择)?我?(?:任何|多个|这些|几个|三套)?(?:方案|方向|创意)/g, '')
  const hold = /(?:不要|不用|不想|不再|不|先别|别|先不|暂不|暂时不|不急着|不需要|无需)\s*(?:(?:再|先|马上|立刻|直接|开始|现在|替我|帮我|自动|急着|任何|擅自|真的|实际|去|进行)\s*)*(?:生成|生图|出图|执行|制作)|(?:先|只给|只看|只聊|只想|只讨论|只要|暂时).{0,10}(?:方案|方向|思路|讨论|聊聊|分析|看看|给我看|提案)|(?:确认|同意|点头|选好).{0,6}(?:后|再).{0,4}(?:生成|做|执行)/.test(withoutDeclinedPlans)
  const explore = /没(?:有)?想法|不知道.{0,8}(?:做什么|什么风格|怎么做)|帮我想想|给.{0,6}(?:几个|一些|多个).{0,4}(?:方向|方案|创意)/.test(text)
  return hold || includeExploration && explore && !directStart.test(text)
}

export function agentExplicitlyStarts(text: string) {
  if (agentWantsReview(text)) return false
  return directStart.test(text)
}

export function resolveAgentDirectionChoice(history: readonly AgentMessage[], choice: AgentTurnOptions['directionChoice']) {
  if (!choice) return undefined
  const message = history.at(-1)
  if (message?.role !== 'assistant' || message.id !== choice.messageId) return undefined
  return message.directions?.find(direction => direction.id === choice.directionId)
}

export function prepareAgentMessageEdit(messages: readonly AgentMessage[], messageId: string, text: string) {
  const index = messages.findIndex(message => message.id === messageId && message.role === 'user')
  const content = text.trim()
  if (index < 0 || !content || content === messages[index].content.trim()) return undefined
  const source = messages[index]
  return { history: messages.slice(0, index), source, content,
    options: { ...source.turnOptions, directionChoice: undefined } satisfies AgentTurnOptions }
}

export function agentWorkflowGuide(workflow: AgentWorkflow = 'smart') {
  const mode = workflow === 'collaborate'
    ? '当前为协作：先完善创意，用户明确说开始生成或点击「按这个生成」才执行；信息齐全后可返回可审阅的生成方案。'
    : workflow === 'direct'
      ? '当前为直接生成：目标明确就返回可执行媒体任务并将 decision.mode 设为 execute。没有写出的技术参数按用途和所选模型补齐，默认只做一张或一条；只对缺失主体、素材用途冲突等关键歧义追问。'
      : '当前为智能：用户清楚表达想要的成品就返回可执行媒体任务并将 decision.mode 设为 execute；用户缺少创意方向时先给可选择的创意。'
  return `${mode} 用户本轮说「先聊/先给方案/先不要生成」时始终先讨论。不能把有参数或有参考素材单独当作生成意图。用户只问知识、分析或文案时直接回答，不创建媒体任务。\n创意方向：当用户说没想法、帮我构思，或宽泛目标存在明显不同的视觉方向时，返回 directions（2–3项，最多一项 recommended=true），不要同时返回 imagePlans、videoPlans 或长篇重复方向文案。每项包含 title（简短方向名）、description（效果和推荐理由）、brief（保留用户主体与限制的完整创作要求）、kind（image或video）。无需追问比例、清晰度等用户不懂的技术参数；真正缺少主体或用途时最多问1–2个关键问题。用户跳过问题或说「你决定」时合理补齐并简短说明，避免重复问同一件事。\n用户选定方向并要求生成时，直接返回唯一可执行任务，不再追问方向或要求重复确认。执行任务之前只能说准备或开始制作，不能声称媒体已生成。多镜头成片、互斥备选、扩大交付范围时保留审阅方案，decision.mode=plan。模型与参数是否可用由应用校验；不要擅自更换用户指定的模型，不要超出用户数量。`
}

type ExecutionInput = {
  workflow?: AgentWorkflow
  requests: readonly string[]
  currentRequest?: string
  decision?: AgentDecision
  questions?: readonly unknown[]
  directions?: readonly unknown[]
  directionApproved?: boolean
  protectedTask?: boolean
  plans: ReadonlyArray<{ kind: 'image' | 'video'; status: string; count: number }>
  requestedImageCount?: number
  requestedVideoCount?: number
}

/** The application, never a model's needsApproval flag, authorizes paid execution. */
export function decideAgentMediaExecution(input: ExecutionInput): { automatic: boolean; reason: string } {
  const latest = input.currentRequest ?? input.requests.at(-1) ?? ''
  const start = input.directionApproved || agentExplicitlyStarts(latest)
  const review = agentWantsReview(latest, input.workflow !== 'direct') || !start && input.requests.some(text => agentWantsReview(text, false))
  if (input.protectedTask) return { automatic: false, reason: '成片、画布修改等复合任务需要审阅后开始。' }
  if (input.questions?.length || input.directions?.length) return { automatic: false, reason: '先确定关键要求或创意方向。' }
  if (review || input.workflow === 'collaborate' && !start) return { automatic: false, reason: '按你的要求，先审阅这版方案。' }
  if (!input.plans.length || input.plans.some(plan => plan.status !== 'ready')) return { automatic: false, reason: '需要先选择要制作的方案。' }
  if (input.plans.length > 1) return { automatic: false, reason: '这次包含多项交付，请确认内容后开始。' }
  const plan = input.plans[0]
  const limit = (plan.kind === 'image' ? input.requestedImageCount : input.requestedVideoCount) ?? 1
  if (!Number.isInteger(plan.count) || plan.count < 1 || plan.count > Math.min(4, limit)) return { automatic: false, reason: '生成数量需要先确认。' }
  if (input.decision?.mode !== 'execute' && !start && input.workflow !== 'direct') return { automatic: false, reason: '创意方案已整理好，可以继续调整或开始生成。' }
  if (input.decision?.mode === 'inspect' || input.decision?.mode === 'clarify') return { automatic: false, reason: '当前仍在分析或澄清需求。' }
  if (input.decision?.mode === 'answer' && !start) return { automatic: false, reason: '当前是在回答问题。' }
  if (!start && !/(?:生成|生图|出图|画|制作|设计|做|想要|希望|给我|来一|修图|换背景|改成|让.{0,12}动起来)/i.test(input.requests.join('\n'))) return { automatic: false, reason: '这次没有明确要求制作成品。' }
  return { automatic: true, reason: '需求明确，按已选模型和规格开始生成。' }
}
