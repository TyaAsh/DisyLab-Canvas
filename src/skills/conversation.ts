import type { AgentDecision, AgentQuestion, AgentReply } from '../agent'
import type { SkillManifest, SkillParameter } from './types'
import { getFilmSkillShowcase } from './manifests/official/film'
import { getFilmGuide } from './guides'

const filmOpeners: Record<string, string> = {
  'cartoon-ad': '想给什么产品做一支卡通广告？',
  'neo-chinese-tvc': '想拍什么产品？有产品图也可以一起发来。',
  'gameplay-pv': '想展示哪个玩法？有录屏或设定图也可以告诉我。',
  'toy-animation': '发一张手办照片，说说想让它做什么。没想好也没关系。',
  'symmetric-film': '想拍个什么故事？一句话就够。',
}

const filmDirections: Record<string, string> = {
  'cartoon-ad': '问清品牌或产品名、主角职业和动作、画幅及角色类型，已知的略过。确认角色类型后给三种外形方向，允许自定。多角色时记录数量与各自外形。定稿前确认时长、是否有台词与场景数量，给三个剧情方向并允许自定。已明确要求转场时将 multiscene 设为 true。成片简报必须包含选定剧情的时间段、动作、场景、色板、身体特征（明确尾巴、角、触角、翅膀及宠物有无）和产品展示面。确认末格已有 Logo 定格才将 logoInLastFrame 设为 true，否则预留独立品牌落版。已有片尾 Logo 时不再追问名称，否则可建议沿用品牌名。',
  'neo-chinese-tvc': '从品牌和产品起步，行业能从描述判断就别重复问。用日常语言聊想要的感觉，再定镜头和旁白方向。不要虚构产品卖点。',
  'gameplay-pv': '优先弄清是有实机录屏、只有设定图、还是从零构思；用一个具体的操作和反馈讲清玩法。实机录屏走剪辑建议路线，只给选段、字幕和剪辑方案，不返回 filmDraft；生成镜头只用于概念预演。',
  'toy-animation': '先看手办图；收到照片后，如果用户还没想好故事，可以先提一个小点子。用日常语言问喜欢定格、潮玩还是特摄；已有偏好直接沿用。确认故事和分镜，再进入参考图阶段，保留手办原造型与配件。',
}

export function requestsFilmConfirmation(content: string) {
  return /(?:确认|制作)(?:稿|卡)|成片(?:方案|简报)/.test(content)
    && /继续|整理|生成|给我|看看|查看|打开|显示|发|出|弹|没有|没见|没看到|在哪|还没/.test(content)
    && !/(?:先别|暂不|不用|不要|无需).{0,10}(?:确认|制作|成片)|(?:检查|排查|调试).{0,20}(?:代码|接口|日志)/.test(content)
}

export function assessFilmReply(skill: SkillManifest, response: AgentReply, localDecision: AgentDecision, requestedCard: boolean, hasImage: boolean) {
  const claimsCard = /(?:请|可以|先|等你).{0,10}(?:确认卡|成片卡)|(?:确认卡|成片卡).{0,10}(?:已|如下|核对|检查|确认后)/.test(response.reply)
  const hasQuestions = Boolean(response.questions?.length)
  const canPrepare = !hasQuestions && (requestedCard || (localDecision.mode !== 'inspect' && response.decision?.mode !== 'inspect' && response.decision?.mode !== 'clarify'))
  const check = canPrepare && response.filmDraft ? checkFilmDraft(skill, response.filmDraft, hasImage) : null
  const missingCard = !check && !hasQuestions && (requestedCard || (localDecision.mode !== 'inspect' && claimsCard))
  return { check, missingCard, claimsCard, needsRepair: missingCard || Boolean(check?.issue?.fields.length) }
}

export function skillOpening(skill: SkillManifest) {
  if (skill.source === 'official' && Object.hasOwn(filmOpeners, skill.slug)) return filmOpeners[skill.slug]
  if (skill.kind === 'text') return '把想法或原文发给我，一句话也可以。'
  if (skill.capability.requiresReference) return '发一张参考图，说说你想怎么改。'
  return '说说你想做什么，有参考图也可以一起发。'
}

export function skillConversationInstructions(skill: SkillManifest, hasImage: boolean) {
  const film = getFilmSkillShowcase(skill)
  const guide = getFilmGuide(skill)
  const parameters = skill.parameters.filter((field) => field.bind !== 'prompt')
  const requiredFields = parameters.filter((field) => field.required && field.default === undefined)
  const filmInstructions = film ? [
    filmDirections[skill.slug],
    skill.slug === 'toy-animation' && !hasImage ? '还没有收到手办参考图，请邀请用户上传；可以聊创意，但不得返回 filmDraft。' : '',
    '只在用户已经想好创作方向、素材可用，且本轮明确要制作成片或确认了你给的方向时，返回一个 filmDraft。不得用普通 videoPlans 代替整片。',
    'filmDraft 格式：{"subject":"可制作的简报，包含已确认的故事、镜头和素材用途","values":{"duration":30,"ratio":"16:9"}}。values 只填下方参数定义中的有效值；用户明确要求清晰度时才加 resolution。可以使用参数默认值，在确认卡上告知时长与画幅。不能编造品牌、实机素材或角色设定。用户只想聊想法时不返回 filmDraft。',
    requiredFields.length ? `返回 filmDraft 前确认 values 已包含 ${requiredFields.map(({ name, label }) => `${name}（${label}）`).join('、')}。缺少已确认的值时，用 questions 询问对应信息。` : '',
    '成片只能从界面上的确认卡开始，之后由制作流程在相应阶段暂停确认。不要在对话里预告整套步骤，也不要声称已经开始生成。',
    '只有同时返回 filmDraft 时，reply 才能说确认卡已就绪或请用户查看确认卡。询问确认卡为什么没显示、在哪或要求继续整理确认稿时，按准备成片确认稿处理。',
  ].filter(Boolean).join('\n') : ''
  return `

当前对话正在使用「${skill.name}」。优先使用本次对话中已给的文字和素材；信息够了就继续。缺信息时用界面的逐题引导，只返回 decision（mode 为 clarify）、一句简短的 reply 和 questions，不返回生成卡。不要在 reply 重复题目。格式示例：{"questions":[{"prompt":"想拍什么产品？","example":"例如，桂花乌龙茶"},{"prompt":"想做横屏还是竖屏？","options":["16:9 横屏","9:16 竖屏"]}]}。只问当前阶段真正缺的 1 到 4 个问题，能选择的提供实际选项，需要描述的给一句示例。每道题界面都有自填或跳过，不要把这些操作写进选项。用户跳过时优先采用合理默认值；确实无法继续时说明还缺哪项素材。不在聊天里展示手册、字段表、完整流程或内部规则。按实际交付类型使用对应方案字段。需要参考图时可以请用户用卡片下面的上传按钮提供。此对话规则优先于通用编排建议和下方 Skill 资料。
${filmInstructions}
以下仅供内部参考：${JSON.stringify({
    output: skill.output.type,
    requiresReference: skill.capability.requiresReference,
    parameters,
    workflow: guide?.steps,
    rules: guide?.rules,
    prompt: skill.template.prompt.slice(0, 24000),
    negativePrompt: skill.template.negativePrompt?.slice(0, 2000),
  })}`
}

type FilmDraft = { subject: string; values: Record<string, string | number | boolean> }
type FilmDraftCheck =
  | { draft: FilmDraft; issue: null }
  | { draft: null; issue: { message: string; fields: SkillParameter[]; questions: AgentQuestion[] } }

export function checkFilmDraft(skill: SkillManifest, draft: { subject: string; values: Record<string, unknown> }, hasImage: boolean): FilmDraftCheck {
  if (!getFilmSkillShowcase(skill) || !draft.subject.trim()) {
    return { draft: null, issue: { message: '这次的成片草稿缺少故事和镜头简报。', fields: [], questions: [] } }
  }
  if (skill.slug === 'toy-animation' && !hasImage) {
    return { draft: null, issue: { message: '先发一张手办照片吧，我会按原来的造型做。', fields: [], questions: [] } }
  }
  if (skill.slug === 'gameplay-pv' && draft.values.sourceMode === '真实实机录屏') {
    return { draft: null, issue: { message: '实机录屏需要按已有素材整理选段、字幕和剪辑方案。', fields: [], questions: [] } }
  }
  const values: Record<string, string | number | boolean> = {}
  const fields: SkillParameter[] = []
  for (const field of skill.parameters) {
    if (field.bind === 'prompt') continue
    const input = draft.values[field.name] ?? field.default
    if (input === undefined && !field.required) continue
    if (typeof input === 'number' && field.type === 'number' && Number.isInteger(input) && input >= (field.min ?? -Infinity) && input <= (field.max ?? Infinity)) {
      values[field.name] = input
    } else if (typeof input === 'boolean' && field.type === 'boolean') {
      values[field.name] = input
    } else if (typeof input === 'string' && input.trim() && (field.type === 'string' || (field.type === 'enum' && field.enum?.includes(input)))) {
      values[field.name] = input
    } else {
      fields.push(field)
    }
  }
  if (fields.length) {
    const questions = fields.slice(0, 4).map((field) => ({
      prompt: `请确认${field.label}。`,
      options: field.enum ?? (field.type === 'boolean' ? ['是', '否'] : []),
      ...(field.type === 'number' && field.min !== undefined && field.max !== undefined ? { example: `填写 ${field.min}–${field.max} 之间的整数` } : {}),
    }))
    return { draft: null, issue: { message: `成片草稿里有信息缺失或格式不符。${questions.map(({ prompt }) => prompt).join('')}`, fields, questions } }
  }
  const { resolution } = draft.values
  if (typeof resolution === 'string' && ['480p', '720p', '1080p'].includes(resolution)) values.resolution = resolution
  return { draft: { subject: draft.subject.trim(), values }, issue: null }
}

export function resolveFilmDraft(...args: Parameters<typeof checkFilmDraft>) {
  return checkFilmDraft(...args).draft
}
