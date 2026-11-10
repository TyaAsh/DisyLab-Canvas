import type { SkillManifest } from './types'
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
  'cartoon-ad': '首轮用户尚未提供信息时，按顺序问四题：品牌或产品名（自填，例：Disy）、主角的职业与广告里的动作（自填，例：咖啡师展示拉花）、画幅（选项：16:9 横屏、9:16 竖屏、1:1 方形）、主角类型（选项：女主角、男主角、儿童、小怪物）。已经知道的直接略过。确认角色类型后，用三句短描述给出外形方向，也允许自定。已有片尾 Logo 时不再追问，否则可建议沿用品牌名。',
  'neo-chinese-tvc': '从品牌和产品起步，行业能从描述判断就别重复问。用日常语言聊想要的感觉，再定镜头和旁白方向。不要虚构产品卖点。',
  'gameplay-pv': '优先弄清是有实机录屏、只有设定图、还是从零构思；用一个具体的操作和反馈讲清玩法。实机录屏走剪辑建议路线，只给选段、字幕和剪辑方案，不返回 filmDraft；生成镜头只用于概念预演。',
  'toy-animation': '先看手办图；收到照片后，如果用户还没想好故事，可以先提一个小点子。用日常语言问喜欢定格、潮玩还是特摄；已有偏好直接沿用。确认故事和分镜，再进入参考图阶段，保留手办原造型与配件。',
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
  const filmInstructions = film ? [
    filmDirections[skill.slug],
    skill.slug === 'toy-animation' && !hasImage ? '还没有收到手办参考图，请邀请用户上传；可以聊创意，但不得返回 filmDraft。' : '',
    '只在用户已经想好创作方向、素材可用，且本轮明确要制作成片或确认了你给的方向时，返回一个 filmDraft。不得用普通 videoPlans 代替整片。',
    'filmDraft 格式：{"subject":"可制作的简报，包含已确认的故事、镜头和素材用途","values":{"duration":30,"ratio":"16:9"}}。values 只填下方参数定义中的有效值；用户明确要求清晰度时才加 resolution。可以使用参数默认值，在确认卡上告知时长与画幅。不能编造品牌、实机素材或角色设定。用户只想聊想法时不返回 filmDraft。',
    '成片只能从界面上的确认卡开始，之后由制作流程在相应阶段暂停确认。不要在对话里预告整套步骤，也不要声称已经开始生成。',
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

export function resolveFilmDraft(skill: SkillManifest, draft: { subject: string; values: Record<string, unknown> }, hasImage: boolean) {
  const film = getFilmSkillShowcase(skill)
  if (!film || !draft.subject.trim() || (skill.slug === 'toy-animation' && !hasImage)) return null
  const values: Record<string, string | number | boolean> = {}
  for (const field of skill.parameters) {
    if (field.bind === 'prompt') continue
    const input = draft.values[field.name] ?? field.default
    if (input === undefined && !field.required) continue
    if (field.type === 'number') {
      if (typeof input !== 'number' || !Number.isInteger(input) || input < (field.min ?? -Infinity) || input > (field.max ?? Infinity)) return null
    } else if (field.type === 'boolean') {
      if (typeof input !== 'boolean') return null
    } else if (typeof input !== 'string' || !input.trim() || (field.type === 'enum' && !field.enum?.includes(input))) {
      return null
    }
    values[field.name] = input
  }
  if (values.sourceMode === '真实实机录屏') return null
  const { resolution } = draft.values
  if (typeof resolution === 'string' && ['480p', '720p', '1080p'].includes(resolution)) values.resolution = resolution
  return { subject: draft.subject.trim(), values }
}
