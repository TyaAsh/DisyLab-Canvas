import type { AgentGenerationSettings } from './agent'

type Choice = { value: string; label: string }
type VideoMode = NonNullable<AgentGenerationSettings['generationMode']>
type ModeRules = { textOnly?: boolean; framesOnly?: boolean; wanSuffix?: string; minImages?: number; minReferenceImages?: number; frames?: boolean; images?: number; videos?: number; exclusiveVideo?: boolean }
export type VideoEditingOptions = { supported: boolean; maxImages: number; inheritsSource: boolean; detail: string }

export function videoGenerationModes(rules: ModeRules, allowOmni = true, editing?: VideoEditingOptions) {
  const choices: Array<{ value: VideoMode; label: string; detail: string }> = [
    { value: 'text', label: '文生视频', detail: '只使用文字描述，不发送媒体参考。' },
    { value: 'omni', label: '参考图/视频', detail: '参考主体、风格或运镜生成新视频；不保证逐帧保留原视频。' },
    { value: 'image', label: '图生视频', detail: '用 1 张图片作为首帧，让画面动起来。' },
    { value: 'frames', label: '首尾帧', detail: '按顺序添加 2 张图片，分别作为开头和结尾；也可在提示词中指定。' },
    { value: 'reference', label: '图片参考', detail: '参考图片的主体或风格，不固定首尾帧。' },
    { value: 'edit', label: '视频编辑', detail: editing?.detail ?? '对已有视频进行修改。请先选择已接通视频编辑的模型。' },
  ]
  return choices.filter(({ value }) => {
    if (value === 'edit') return Boolean(editing?.supported)
    if (rules.textOnly || rules.wanSuffix === 't2v') return value === 'text'
    if (rules.framesOnly) return value === 'image' || value === 'frames'
    if (rules.wanSuffix === 'i2v') return value === 'image'
    if (rules.wanSuffix === 'videoedit') return false
    if (rules.wanSuffix === 'r2v' && (value === 'text' || value === 'image')) return false
    if (value === 'text') return !rules.minImages
    if (value === 'image') return !rules.minReferenceImages && (rules.minImages ?? 0) <= 1
    if (value === 'frames') return Boolean(rules.frames)
    if (value === 'reference') return rules.images !== 0
    return allowOmni && !rules.exclusiveVideo
  })
}
export type ComposerParameterOptions = { ratios: Choice[]; resolutions: Choice[]; qualities?: Choice[]; outputs?: readonly import('./imageApi').ImageOutput[]; durations?: Choice[]; modes?: Array<Choice & { detail?: string }>; editing?: VideoEditingOptions }

export const AGENT_VIDEO_WORKFLOWS = [
  { value: 'generate', label: '参考图/视频', detail: '可直接用文字生成，也可添加图片或视频参考主体、风格和运镜；这会生成新片。只有首帧能力的模型会将单张图片作为开头。' },
  { value: 'edit', label: '视频编辑', detail: '添加 1 段待编辑原视频，写明需要修改的内容。图片可作为替换或风格参考，能否使用取决于所选模型。' },
  { value: 'frames', label: '首尾帧', detail: '添加 2 张图片，分别作为首帧和尾帧。请按顺序添加，或在提示词中明确指定；不接收视频素材。' },
] as const

export function composerVideoMode(settings: AgentGenerationSettings, options: ComposerParameterOptions, images: number, videos: number): VideoMode {
  const workflow = settings.videoWorkflow ?? (settings.generationMode === 'edit' ? 'edit' : settings.generationMode === 'frames' ? 'frames' : 'generate')
  if (workflow === 'edit' || workflow === 'frames') return workflow
  const supports = (mode: string) => options.modes?.some(option => option.value === mode)
  if (videos) return 'omni'
  if (!images) return 'text'
  if (supports('omni')) return 'omni'
  if (supports('reference')) return 'reference'
  return 'image'
}

export function composerVideoInputIssue(settings: AgentGenerationSettings, options: ComposerParameterOptions, images: number, videos: number) {
  const mode = composerVideoMode(settings, options, images, videos)
  if (mode === 'edit' && !options.editing?.supported) return options.editing?.detail ?? '当前模型尚未接通视频编辑，请更换模型。'
  if (mode === 'frames' && !options.modes?.some(option => option.value === 'frames')) return '当前模型不支持首尾帧，请更换模型或选择「参考图/视频」。'
  const missing = composerVideoReferenceIssue(mode, images, videos)
  if (missing) return missing
  if (mode === 'edit' && images > (options.editing?.maxImages ?? 0)) return options.editing?.maxImages ? `当前编辑模型最多接收 ${options.editing.maxImages} 张辅助图片。` : '当前编辑模型只接受原视频，请移除辅助图片。'
  if (!options.modes?.some(option => option.value === mode)) return videos ? '当前模型不能参考视频生成新片，请选择「视频编辑」或更换模型。' : images ? '当前模型不支持这组图片，请调整素材或更换模型。' : '当前模型需要参考素材，请添加图片或视频。'
}

export function normalizeComposerSettings(kind: 'image' | 'video', draft: Partial<AgentGenerationSettings>, options: ComposerParameterOptions): AgentGenerationSettings {
  const choose = (choices: Choice[], value: string | undefined, preferred: string) =>
    choices.find(choice => choice.value === value)?.value ?? choices.find(choice => choice.value === preferred)?.value ?? choices[0]?.value ?? ''
  const common = {
    kind,
    aspectRatio: choose(options.ratios, draft.aspectRatio, '1:1'),
    resolution: choose(options.resolutions, draft.resolution, kind === 'image' ? '1K' : '720p'),
    count: Number.isFinite(draft.count) ? Math.max(1, Math.min(4, Math.round(draft.count!))) : 1,
  }
  return kind === 'image'
    ? { ...common, detail: choose(options.qualities ?? [], draft.detail, 'medium'), ...(draft.output && options.outputs?.includes(draft.output) ? { output: draft.output } : {}) }
    : { ...common, duration: Number(choose(options.durations ?? [], draft.duration === undefined ? undefined : String(draft.duration), '5')) || undefined,
      videoWorkflow: draft.videoWorkflow ?? (draft.generationMode === 'edit' ? 'edit' : draft.generationMode === 'frames' ? 'frames' : 'generate'),
      ...(draft.generationMode && options.modes?.some(option => option.value === draft.generationMode) ? { generationMode: draft.generationMode } : {}) }
}

export function composerVideoReferenceIssue(mode: AgentGenerationSettings['generationMode'], images: number, videos: number) {
  if (mode === 'edit' && videos !== 1) return videos ? '视频编辑只接受 1 段待编辑原视频，请移除多余视频。' : '请添加 1 段待编辑的原视频。'
  if (mode === 'text' && images + videos) return '文生视频只使用文字。请移除媒体参考，或选择「自动匹配」或参考生成方式。'
  if (mode === 'image' && (images !== 1 || videos)) return '图生视频需要且只使用 1 张首帧图片，请调整参考素材。'
  if (mode === 'frames' && (images !== 2 || videos)) return '首尾帧需要 2 张图片，不接收视频。请按首帧、尾帧的顺序添加；也可以在提示词中指定。'
  if (mode === 'reference' && (!images || videos)) return '图片参考需要至少 1 张图片，不接收视频。'
  if (mode === 'omni' && !images && !videos) return '参考图/视频需要至少 1 项媒体素材。无参考素材时请选择「自动匹配」或「文生视频」。'
}
