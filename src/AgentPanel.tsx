import { AgentGenerationParameters } from './skill-ui/AgentGenerationParameters'
import { AgentDirections } from './skill-ui/AgentDirections'
import { AgentMediaResults } from './skill-ui/AgentMediaResults'
import { AGENT_WORKFLOWS, type AgentWorkflow } from './agentInteraction'
import { OriginalText, useLocale } from './i18n/react'
import { getIntlLocale, translateUi } from './i18n/core'
/*!
 * Copyright (c) 2026 DisyLab. All rights reserved.
 * Proprietary source-available software under LicenseRef-DisyLab-Proprietary.
 * Unauthorized commercial use, redistribution, white-labeling, relicensing,
 * or removal of this copyright notice is prohibited.
 * Repository: https://github.com/TyaAsh/DisyLab-Canvas
 * SPDX-FileCopyrightText: 2026 DisyLab
 * SPDX-License-Identifier: LicenseRef-DisyLab-Proprietary
 */
import { Fragment, useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { AGENT_VIDEO_WORKFLOWS, composerVideoInputIssue, composerVideoMode, normalizeComposerSettings, type ComposerParameterOptions, type VideoEditingOptions } from './agentComposer'
import { videoFileType } from './videoReference'
import { loadVideoThumbnailPoster, VideoReferenceThumbnail } from './VideoReferenceThumbnail'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowLeft, ArrowUp, ArrowUpRight, BrainCircuit, Box, Check, ChevronDown, CircleHelp, Copy, FilePlus2, FileText, Film, Focus, ImagePlus, ImageUp, KeyRound, Link2, ListTodo, LoaderCircle, LockKeyhole, MessageCircle, MessagesSquare, MousePointer2, PanelRight, Pencil, PictureInPicture2, Plus, RotateCcw, SlidersHorizontal, Sparkles, Trash2, WandSparkles, Wrench, X, Zap } from 'lucide-react'
import { AGENT_REFERENCE_PURPOSES, compactReferenceName, normalizeAgentMessageContent, reconcileAgentImagePlanSpecs, type AgentContextReference, type AgentImagePlan, type AgentImageReference, type AgentMessage, type AgentTextPlan, type AgentTurnOptions, type AgentVideoPlan, type AgentWebReference } from './agent'
import { AgentWebDisclosure, AgentWebReferenceCard, AgentWebReferenceInput } from './skill-ui/AgentWebReference'
import { resolveImageModelOptions, type ImageOutput, type ImageGenerationOptions } from './imageApi'
import { IMAGE_OUTPUT_LABELS, imageOutputIntent } from './imageOutputIntent'
import { legacyStoryboardOperation } from './agentImageOperations'
import { AgentSkillCreator } from './skill-ui/AgentSkillCreator'
import { AgentSkillMenu } from './skill-ui/AgentSkillMenu'
import { AgentFilmReview } from './skill-ui/AgentFilmReview'
import { AgentImageOperationReview } from './skill-ui/AgentImageOperationReview'
import { AgentQuestions } from './skill-ui/AgentQuestions'
import { AgentCanvasEditReview } from './skill-ui/AgentCanvasEditReview'
import { AgentSelect, getModelBrand, type SelectOption } from './skill-ui/AgentSelect'
import { AgentProjectGuide, AgentTasks, type AgentProjectView } from './skill-ui/AgentProjectPane'
import type { AgentTask } from './agentProject'
import type { AgentCanvasEditDraft } from './agentCanvasEdits'
import { skillOpening } from './skills/conversation'
import type { FilmReview, FilmReviewAnswer } from './skills/filmProduction'
import type { SkillManifest } from './skills/types'

export type AgentModelOption = {
  key: string; name: string; connectionName: string; outputs?: readonly ImageOutput[]
  imageParameters?: { baseUrl: string; modelId: string; ratios: SelectOption[]; resolutions: SelectOption[]; qualities: SelectOption[]; maxReferences?: number }
  videoParameters?: { ratios: SelectOption[]; resolutions: SelectOption[]; durations: SelectOption[]; modes?: Array<SelectOption & { detail?: string }>; editing?: VideoEditingOptions }
}
export type AgentConversationOption = { id: string; title: string; updatedAt: string }

function conversationDate(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return undefined
  return date.toLocaleString(getIntlLocale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const AGENT_PANEL_WIDTH_KEY = 'disylab.agent-panel-width'
const AGENT_PANEL_PLACEMENT_KEY = 'disylab.agent-panel-placement'
const AGENT_PANEL_RESIZE_BREAKPOINT = 721
const AGENT_PANEL_DEFAULT_WIDTH = 368

type AgentPanelPoint = { x: number; y: number }
type AgentPanelSize = { width: number; height: number }
type AgentPanelRect = AgentPanelPoint & AgentPanelSize
type AgentPanelPlacement = { mode: 'floating' | 'docked'; position?: AgentPanelPoint; size?: AgentPanelSize }
type AgentPanelBounds = { left: number; top: number; right: number; bottom: number }
const AGENT_PANEL_FLOAT_HANDLES = ['n', 'e', 's', 'w', 'nw', 'ne', 'se', 'sw'] as const
type AgentPanelResizeEdge = typeof AGENT_PANEL_FLOAT_HANDLES[number]
const AGENT_PANEL_FLOAT_MIN_WIDTH = 320
const AGENT_PANEL_FLOAT_MIN_HEIGHT = 350
const AGENT_PANEL_ARROW_OFFSETS: Record<string, AgentPanelPoint | undefined> = {
  ArrowLeft: { x: -16, y: 0 }, ArrowRight: { x: 16, y: 0 },
  ArrowUp: { x: 0, y: -16 }, ArrowDown: { x: 0, y: 16 },
}

function readAgentPanelPlacement(): AgentPanelPlacement {
  try {
    const saved = JSON.parse(window.localStorage.getItem(AGENT_PANEL_PLACEMENT_KEY) ?? 'null') as AgentPanelPlacement | null
    if (saved) {
      const position = saved.position
      const size = saved.size
      return {
        mode: saved.mode === 'docked' ? 'docked' : 'floating',
        position: position && Number.isFinite(position.x) && Number.isFinite(position.y) ? position : undefined,
        size: size && Number.isFinite(size.width) && size.width > 0 && Number.isFinite(size.height) && size.height > 0 ? size : undefined,
      }
    }
  } catch {
    // The default floating layout also works when browser storage is unavailable.
  }
  return { mode: 'floating' }
}

function getAgentFloatingBounds(panel: HTMLElement): AgentPanelBounds {
  // The motion wrapper resolves the same safe-area insets as the floating panel.
  const frame = panel.parentElement!
  const padding = getComputedStyle(frame)
  const rect = frame.getBoundingClientRect()
  return {
    left: rect.left + parseFloat(padding.paddingLeft),
    top: rect.top + parseFloat(padding.paddingTop),
    right: rect.right - parseFloat(padding.paddingRight),
    bottom: rect.bottom - parseFloat(padding.paddingBottom),
  }
}

function resizeAgentFloatingRect(rect: AgentPanelRect, offset: AgentPanelPoint, edge: AgentPanelResizeEdge, bounds: AgentPanelBounds): AgentPanelRect {
  const right = rect.x + rect.width
  const bottom = rect.y + rect.height
  const minWidth = Math.min(AGENT_PANEL_FLOAT_MIN_WIDTH, bounds.right - bounds.left)
  const minHeight = Math.min(AGENT_PANEL_FLOAT_MIN_HEIGHT, bounds.bottom - bounds.top)
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max))
  const x = edge.includes('w') ? clamp(rect.x + offset.x, bounds.left, right - minWidth) : rect.x
  const y = edge.includes('n') ? clamp(rect.y + offset.y, bounds.top, bottom - minHeight) : rect.y
  const nextRight = edge.includes('e') ? clamp(right + offset.x, x + minWidth, bounds.right) : right
  const nextBottom = edge.includes('s') ? clamp(bottom + offset.y, y + minHeight, bounds.bottom) : bottom
  return { x, y, width: nextRight - x, height: nextBottom - y }
}

function getAgentPanelMaxWidth() {
  return Math.min(window.innerWidth - 24, AGENT_PANEL_DEFAULT_WIDTH + Math.floor(window.innerWidth * .2))
}

function getInitialAgentPanelWidth() {
  const saved = Number(window.localStorage.getItem(AGENT_PANEL_WIDTH_KEY))
  if (window.innerWidth < AGENT_PANEL_RESIZE_BREAKPOINT) return AGENT_PANEL_DEFAULT_WIDTH
  const maximum = getAgentPanelMaxWidth()
  const preferred = Number.isFinite(saved) && saved > 0 ? saved : AGENT_PANEL_DEFAULT_WIDTH
  return Math.min(maximum, Math.max(AGENT_PANEL_DEFAULT_WIDTH, preferred))
}

type Props = {
  automaticPlanIds?: string[]
  onEditMessage?: (messageId: string, content: string) => Promise<boolean>
  projectId: string
  tasks: AgentTask[]
  onTaskCenterOpen: (open: boolean) => void
  onOpenTask: (task: AgentTask) => Promise<boolean>
  onStopTask: (id: string) => void
  messages: AgentMessage[]
  plans: AgentImagePlan[]
  videoPlans: AgentVideoPlan[]
  textPlans: AgentTextPlan[]
  references: AgentImageReference[]
  pendingReferences: AgentImageReference[]
  candidates: AgentImageReference[]
  styleCandidates: { id: string; name: string; keyword: string }[]
  textCandidates: { id: string; name: string }[]
  onReadWebReference: (url: URL, modelKey: string, signal: AbortSignal, pastedText?: string) => Promise<AgentWebReference>
  onSaveWebReference: (reference: AgentWebReference) => void
  getVideoPlanIssue: (plan: AgentVideoPlan) => string | undefined
  getImagePlanIssue: (plan: AgentImagePlan) => string | undefined
  conversations: AgentConversationOption[]
  activeConversationId: string
  skillSelection?: { id: string; skill: SkillManifest }
  skillDraft: string
  onSkillDraftConsumed: () => void
  startSkillAuthoring: boolean
  onSkillAuthoringStarted: () => void
  onAttachSkill: (skill: SkillManifest) => void
  onRemoveSkill: () => void
  filmRun: { nodeId: string; mediaNodeId?: string; label: string } | null
  filmReview: { id: string; stage: FilmReview; answer: (value: FilmReviewAnswer) => void } | null
  filmBusy: boolean
  onStopFilm: () => void
  getFilmPlanInfo: (plan: NonNullable<AgentMessage['filmPlan']>) => { summary?: string; cost?: string; issue?: string; settings?: boolean; imageModels: AgentModelOption[]; videoModels: AgentModelOption[]; imageModelKey?: string; videoModelKey?: string }
  onFilmModelChange: (messageId: string, kind: 'image' | 'video', key: string) => void
  onConfirmFilm: (messageId: string) => void
  canResumeFilm: (nodeId: string) => boolean
  textModels: AgentModelOption[]
  imageModels: AgentModelOption[]
  videoModels: AgentModelOption[]
  aspectOptions: SelectOption[]
  resolutionOptions: SelectOption[]
  detailOptions: SelectOption[]
  videoAspectOptions: SelectOption[]
  videoResolutionOptions: SelectOption[]
  videoDurationOptions: SelectOption[]
  textModelKey: string
  imageModelKey: string
  videoModelKey: string
  busy: boolean
  backgroundRunCount: number
  agentOnly: boolean
  onStop: () => void
  onClose: () => void
  onOpenApiSettings: () => void
  onOpenSkillFactory: (view: 'browse' | 'manage', skillSlug?: string) => void
  getSkillCanvasContext?: () => string
  onSkillAuthorReply: (prompt: string, signal: AbortSignal) => Promise<string>
  onDownloadImage: (url: string, fileName: string) => void | Promise<void>
  onNewConversation: () => void
  onDeleteConversation: () => void
  onSelectConversation: (id: string) => void
  onTextModelChange: (key: string) => void
  onImageModelChange: (key: string) => void
  onVideoModelChange: (key: string) => void
  onReferencesChange: (references: AgentImageReference[]) => void
  onCreateUploadedReference: (file: File) => Promise<AgentImageReference>
  onUploadNotice: (message: string) => void
  onPendingReferenceConsumed: () => void
  onPickFromCanvas: (mediaKind?: 'image' | 'video', videoGenerationMode?: 'text' | 'image' | 'frames' | 'reference' | 'omni') => void
  onSend: (message: string, invocationText: string, references: AgentImageReference[], videoGenerationMode: 'text' | 'image' | 'frames' | 'reference' | 'omni' | undefined, options: AgentTurnOptions) => void
  onRetry: (messageId: string) => void
  onOptimizePrompt: (prompt: string) => Promise<string>
  onPlanChange: (id: string, patch: Partial<Pick<AgentImagePlan, 'prompt' | 'aspectRatio' | 'resolution' | 'detail' | 'requestedDetail' | 'count' | 'imageConnectionId' | 'imageModelId' | 'modelMention'>>) => void
  onSelectPlanOptions: (groupPlanIds: string[], selectedPlanIds: string[]) => void
  onConfirmPlan: (id: string) => void
  onConfirmImageBatch: (ids: string[], signal: AbortSignal) => Promise<void>
  onConfirmImageOperation: (id: string, indices: number[]) => Promise<void>
  getImagePlanCostLabel?: (plan: AgentImagePlan) => string | null
  onCancelPlan: (id: string) => void
  onRemovePlanContextReference: (planId: string, nodeId: string) => void
  onVideoPlanChange: (id: string, patch: Partial<Pick<AgentVideoPlan, 'prompt' | 'aspectRatio' | 'resolution' | 'duration' | 'count' | 'videoConnectionId' | 'videoModelId' | 'modelMention'>>) => void
  onConfirmVideoPlan: (id: string) => void
  onCancelVideoPlan: (id: string) => void
  onRemoveVideoPlanContextReference: (planId: string, nodeId: string) => void
  onTextPlanChange: (id: string, patch: Partial<Pick<AgentTextPlan, 'title' | 'content'>>) => void
  onConfirmTextPlan: (id: string) => void
  onCanvasDraftChange: (messageId: string, update: (draft: AgentCanvasEditDraft) => AgentCanvasEditDraft) => void
  onSaveCanvasDraft: (messageId: string) => Promise<string | null>
  onConfirmCanvasDraft: (messageId: string) => string | null
  onRevertCanvasDraft: (messageId: string) => string | null
  onCancelTextPlan: (id: string) => void
  onRemoveTextPlanContextReference: (planId: string, nodeId: string) => void
  onLocateCanvasNode: (nodeId: string) => void
}

export function AgentPanel(props: Props) {
  const interfaceLocale = useLocale()
  const [projectView, setProjectView] = useState<AgentProjectView | null>(null)
  const changeProjectView = (view: AgentProjectView | null) => {
    setProjectView(view)
    props.onTaskCenterOpen(view === 'tasks')
  }
  const [skillMenuOpen, setSkillMenuOpen] = useState(false)
  const [skillAuthoring, setSkillAuthoring] = useState(false)
  const attachedSkill = props.skillSelection?.skill ?? null
  const composerHint = attachedSkill ? skillOpening(attachedSkill) : '说说想做什么，没想法也可以。输入 @ 引用素材。'
  const latestMessage = props.messages.at(-1)
  const [freeReplyMessageId, setFreeReplyMessageId] = useState<string>()
  const guidedMessage = !props.busy && !skillAuthoring && latestMessage?.role === 'assistant'
    && latestMessage.id !== freeReplyMessageId && latestMessage.skillUseId === props.skillSelection?.id && latestMessage.questions?.length ? latestMessage : undefined
  const skillMenuId = useId()
  const skillButtonRef = useRef<HTMLButtonElement>(null)
  const skillMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!skillMenuOpen) return
    skillMenuRef.current?.querySelector('button')?.focus()
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !skillMenuRef.current?.contains(event.target) && !skillButtonRef.current?.contains(event.target)) setSkillMenuOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [skillMenuOpen])
  const [mentionOpen, setMentionOpen] = useState(false)
  const reduceMenuMotion = useReducedMotion()
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionIndex, setMentionIndex] = useState(0)
  const mentionMenuId = useId()
  const [automaticModels, setAutomaticModels] = useState(!props.imageModelKey && !props.videoModelKey)
  const [preferenceTab, setPreferenceTab] = useState('image')
  const [manualImageModelKey, setManualImageModelKey] = useState(props.imageModelKey || props.imageModels[0]?.key || '')
  const [manualVideoModelKey, setManualVideoModelKey] = useState(props.videoModelKey || props.videoModels[0]?.key || '')
  useEffect(() => {
    setManualImageModelKey(current => props.imageModels.some(model => model.key === current) ? current : props.imageModels[0]?.key ?? '')
  }, [props.imageModels])
  useEffect(() => {
    setManualVideoModelKey(current => props.videoModels.some(model => model.key === current) ? current : props.videoModels[0]?.key ?? '')
  }, [props.videoModels])
  const [composerMode, setComposerMode] = useState('agent')
  const [workflow, setWorkflow] = useState<AgentWorkflow>(() => {
    try { const saved = localStorage.getItem('disy-agent-workflow'); return saved === 'collaborate' || saved === 'direct' ? saved : 'smart' } catch { return 'smart' }
  })
  const [composerMenu, setComposerMenu] = useState<'add' | 'models' | 'parameters' | null>(null)
  const composerMenuRef = useRef<HTMLDivElement>(null)
  const mediaControlsRef = useRef<HTMLDivElement>(null)
  const parameterTriggerRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!composerMenu) return
    const dismiss = (event: Event) => { if (!composerMenuRef.current?.contains(event.target as Node) && !mediaControlsRef.current?.contains(event.target as Node)) setComposerMenu(null) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setComposerMenu(null) }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape) }
  }, [composerMenu])
  const [imageDraft, setImageDraft] = useState<NonNullable<AgentTurnOptions['generation']>>({ kind: 'image' })
  const [videoDraft, setVideoDraft] = useState<NonNullable<AgentTurnOptions['generation']>>({ kind: 'video' })
  const [turnStyles, setTurnStyles] = useState<Props['styleCandidates']>([])
  const [turnTextNodes, setTurnTextNodes] = useState<Props['textCandidates']>([])
  const [webReferences, setWebReferences] = useState<AgentWebReference[]>([])
  const [webInputUrl, setWebInputUrl] = useState<string>()
  const webInputVersion = useRef(0)
  const [webDraftOpen, setWebDraftOpen] = useState(false)
  const [draftInvocationText, setDraftInvocationText] = useState('')
  const [editorHeight, setEditorHeight] = useState<number>()
  const editorResize = useRef<{ y: number; height: number } | null>(null)
  const [optimizingPrompt, setOptimizingPrompt] = useState(false)
  const [promptBackups, setPromptBackups] = useState<{ conversationId: string; contents: Node[] }[]>([])
  const [promptError, setPromptError] = useState('')
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editedMessageText, setEditedMessageText] = useState('')
  const [messageEditBusy, setMessageEditBusy] = useState(false)
  const [messageActionError, setMessageActionError] = useState('')
  const [messageActionMessageId, setMessageActionMessageId] = useState<string | null>(null)
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const messageEditInput = useRef<HTMLTextAreaElement>(null)
  const messageEditTrigger = useRef<HTMLButtonElement | null>(null)
  useEffect(() => { setEditingMessageId(null); setMessageActionError(''); setMessageEditBusy(false) }, [props.activeConversationId])
  useEffect(() => { if (editingMessageId) { messageEditInput.current?.focus({preventScroll:true}); messageEditInput.current?.setSelectionRange(editedMessageText.length, editedMessageText.length) } }, [editingMessageId])
  useEffect(() => { if (!copiedMessageId) return; const timer=window.setTimeout(() => setCopiedMessageId(null), 1800); return () => window.clearTimeout(timer) }, [copiedMessageId])
  const cancelMessageEdit = () => { setEditingMessageId(null); setMessageActionError(''); window.requestAnimationFrame(() => messageEditTrigger.current?.focus({preventScroll:true})) }
  const [parameterHelpOpen, setParameterHelpOpen] = useState(false)
  const optimizeHint = optimizingPrompt ? '正在优化，原稿已保留' : props.busy ? '请等待当前对话完成，或先停止对话' : '优化提示词，完成后可撤回'
  const undoHint = optimizingPrompt ? '等待本次优化完成后可撤回' : '恢复到上次优化前，支持逐次撤回'
  const conversationIdRef = useRef(props.activeConversationId)
  conversationIdRef.current = props.activeConversationId
  const latestUserMessage = props.messages.at(-2)
  const canRetryLatest = latestMessage?.role === 'assistant' && latestUserMessage?.role === 'user'
    && (latestMessage.retry?.userMessageId === latestUserMessage.id || latestMessage.content.startsWith('这次没有成功：'))
  const [activeReadyPlanId, setActiveReadyPlanId] = useState<string | null>(null)
  const [panelWidth, setPanelWidth] = useState(getInitialAgentPanelWidth)
  const [panelResizing, setPanelResizing] = useState(false)
  const [panelPlacement, setPanelPlacement] = useState(readAgentPanelPlacement)
  const [floatingInteraction, setFloatingInteraction] = useState<'move' | 'resize' | null>(null)
  const panelRef = useRef<HTMLElement>(null)
  const panelDragRef = useRef<{
    pointerId: number
    start: AgentPanelPoint
    origin: AgentPanelRect
    resize?: { edge: AgentPanelResizeEdge; bounds: AgentPanelBounds }
  } | null>(null)
  const panelFloating = !props.agentOnly && panelPlacement.mode === 'floating'
  const [referenceDropActive, setReferenceDropActive] = useState(false)
  const editorRef = useRef<HTMLDivElement>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const messagesRef = useRef<HTMLDivElement>(null)
  const pinnedToBottomRef = useRef(true)
  const savedRangeRef = useRef<Range | null>(null)
  const referenceRegistryRef = useRef(new Map<string, AgentImageReference>())
  const readyPlanIdsRef = useRef<string[]>([])
  const resizeStartRef = useRef({ pointerX: 0, width: AGENT_PANEL_DEFAULT_WIDTH })
  const readyPlans = props.plans.filter((plan) => plan.status === 'ready')
  const activeReadyPlan = readyPlans.find((plan) => plan.id === activeReadyPlanId) ?? readyPlans[readyPlans.length - 1]
  const draftImageModel = composerMode === 'image'
    ? props.imageModels.find(model => model.key === manualImageModelKey) ?? props.imageModels[0]
    : props.imageModels.find(model => model.key === props.imageModelKey)
  const draftVideoModel = composerMode === 'video'
    ? props.videoModels.find(model => model.key === manualVideoModelKey) ?? props.videoModels[0]
    : props.videoModels.find(model => model.key === props.videoModelKey)
  const mediaKind = composerMode === 'video' ? 'video' : 'image'
  const mediaModel = mediaKind === 'image' ? draftImageModel : draftVideoModel
  const mediaModels = mediaKind === 'image' ? props.imageModels : props.videoModels
  const parameterLockReason = mediaModels.length
    ? `请先在右侧选择${mediaKind === 'image' ? '生图' : '视频'}模型，再设置参数。比例、清晰度${mediaKind === 'video' ? '和时长' : '和画质'}的可选范围由模型决定。`
    : `当前没有可用的${mediaKind === 'image' ? '生图' : '视频'}模型，请先点击「配置模型」，添加并启用模型后再设置参数。`
  useEffect(() => {
    if (composerMenu === 'parameters' && !mediaModel) setComposerMenu(null)
  }, [composerMenu, mediaModel?.key])
  useEffect(() => { setParameterHelpOpen(false) }, [composerMode, mediaModel?.key])
  const parameterOptions: ComposerParameterOptions = mediaKind === 'image'
    ? { ...(draftImageModel?.imageParameters ?? { ratios: props.aspectOptions, resolutions: props.resolutionOptions, qualities: props.detailOptions }), outputs: draftImageModel?.outputs }
    : draftVideoModel?.videoParameters ?? { ratios: props.videoAspectOptions, resolutions: props.videoResolutionOptions, durations: props.videoDurationOptions }
  const generationSettings = normalizeComposerSettings(mediaKind, mediaKind === 'image' ? imageDraft : videoDraft, parameterOptions)
  const patchGenerationSettings = (patch: Partial<NonNullable<AgentTurnOptions['generation']>>) => {
    setPromptError('')
    if (mediaKind === 'image') setImageDraft(current => ({ ...current, ...generationSettings, ...patch, kind: 'image' }))
    else setVideoDraft(current => ({ ...current, ...generationSettings, ...patch, kind: 'video' }))
  }
  const videoWorkflow = generationSettings.videoWorkflow ?? 'generate'
  const inputImages = props.references.filter(reference => reference.kind !== 'video').length
  const inputVideos = props.references.filter(reference => reference.kind === 'video').length
  const videoInputIssue = composerMode === 'video' && !attachedSkill && mediaModel ? composerVideoInputIssue(generationSettings, parameterOptions, inputImages, inputVideos) : undefined
  const videoModeSummary = mediaKind === 'video' ? AGENT_VIDEO_WORKFLOWS.find(option => option.value === videoWorkflow)?.label ?? '参考图/视频' : ''
  const videoInheritsSource = mediaKind === 'video' && videoWorkflow === 'edit' && parameterOptions.editing?.inheritsSource
  const parameterSummary = videoInheritsSource ? `视频编辑 · 跟随原视频 · ${generationSettings.count ?? 1}条` : [mediaKind === 'video' ? videoModeSummary : generationSettings.resolution?.toUpperCase(), generationSettings.aspectRatio,
    mediaKind === 'video' && generationSettings.duration ? generationSettings.duration + '秒' : '',
    (generationSettings.count ?? 1) + (mediaKind === 'image' ? '张' : '条')].filter(Boolean).join(' · ')
  const draftOutputIntent = draftImageModel ? imageOutputIntent(generationSettings.output ? `输出格式：${IMAGE_OUTPUT_LABELS[generationSettings.output]}` : draftInvocationText, draftImageModel.outputs) : undefined
  const acceptsVideoReference = attachedSkill ? attachedSkill.kind === 'video' : composerMode !== 'image'
  const modeAcceptsReference = (reference: AgentImageReference) => reference.kind !== 'video' || acceptsVideoReference
  const modelMentionGroups = [
    ['text', '对话模型', props.textModels], ['image', '图像模型', props.imageModels], ['video', '视频模型', props.videoModels],
  ] as const
  const mentionCandidates = [
    ...props.candidates.filter(modeAcceptsReference).map((reference) => ({
      key: reference.nodeId, name: reference.name, kind: reference.kind === 'video' ? '画布视频' : '画布图片',
      preview: reference.kind === 'video' ? undefined : reference.url, choose: () => addReference(reference),
    })),
    ...props.textCandidates.map((item) => ({
      key: `text:${item.id}`, name: item.name, kind: '画布文本', preview: undefined,
      choose: () => selectMention(() => setTurnTextNodes((current) => current.some(({ id }) => id === item.id) ? current : [...current, item])),
    })),
    ...props.styleCandidates.map((item) => ({
      key: `style:${item.id}`, name: item.name, kind: '风格预设', detail: item.keyword, preview: undefined,
      choose: () => selectMention(() => setTurnStyles((current) => current.some(({ id }) => id === item.id) ? current : [...current, item])),
    })),
  ].filter((item) => `${item.name} ${item.kind} ${'detail' in item ? item.detail ?? '' : ''}`.toLocaleLowerCase().includes(mentionQuery.toLocaleLowerCase()))
  const attachWebReference = (reference: AgentWebReference) => {
    if (!webReferences.some(({ url }) => url === reference.url) && webReferences.length >= 3) {
      setPromptError('本轮最多引用 3 个网页。请先移除一条参考。')
      return
    }
    setWebReferences((current) => [...current.filter(({ url }) => url !== reference.url), reference])
    setWebInputUrl(undefined)
    setWebDraftOpen(false)
    setPromptError('')
    editorRef.current?.focus()
  }
  ;[...props.candidates, ...props.references].forEach((reference) => referenceRegistryRef.current.set(reference.nodeId, reference))

  const savePanelPlacement = (placement: AgentPanelPlacement) => {
    setPanelPlacement(placement)
    try { window.localStorage.setItem(AGENT_PANEL_PLACEMENT_KEY, JSON.stringify(placement)) } catch { /* keep the current layout */ }
  }

  const moveFloatingPanel = (x: number, y: number, size?: AgentPanelSize) => {
    // Keep pointer movement off the React render path for long conversations.
    const style = panelRef.current?.style
    if (!style) return
    style.setProperty('--agent-float-x', `${x}px`)
    style.setProperty('--agent-float-y', `${y}px`)
    if (size) {
      style.setProperty('--agent-float-preferred-width', `${size.width}px`)
      style.setProperty('--agent-float-preferred-height', `${size.height}px`)
    }
  }

  const saveFloatingGeometry = (resized = false) => {
    const rect = panelRef.current?.getBoundingClientRect()
    if (!rect) return
    const position = { x: rect.left, y: rect.top }
    const size = resized ? { width: rect.width, height: rect.height } : undefined
    moveFloatingPanel(position.x, position.y, size)
    savePanelPlacement({ mode: 'floating', position, size: size ?? panelPlacement.size })
  }

  const startPanelDrag = (event: ReactPointerEvent<HTMLElement>, edge?: AgentPanelResizeEdge) => {
    if (!panelFloating || !event.isPrimary || event.button !== 0 || panelDragRef.current) return
    if (event.target instanceof Element && event.target.closest('button, .agent-custom-select')) return
    const panel = panelRef.current
    if (!panel) return
    const rect = panel.getBoundingClientRect()
    event.preventDefault()
    panelDragRef.current = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      origin: rect,
      resize: edge ? { edge, bounds: getAgentFloatingBounds(panel) } : undefined,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setFloatingInteraction(edge ? 'resize' : 'move')
  }

  const dragPanel = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = panelDragRef.current
    if (drag?.pointerId !== event.pointerId) return
    const offset = { x: event.clientX - drag.start.x, y: event.clientY - drag.start.y }
    if (drag.resize) {
      const rect = resizeAgentFloatingRect(drag.origin, offset, drag.resize.edge, drag.resize.bounds)
      moveFloatingPanel(rect.x, rect.y, rect)
    } else {
      moveFloatingPanel(drag.origin.x + offset.x, drag.origin.y + offset.y)
    }
  }

  const finishPanelDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = panelDragRef.current
    if (drag?.pointerId !== event.pointerId) return
    if (event.type === 'pointerup') dragPanel(event)
    panelDragRef.current = null
    setFloatingInteraction(null)
    saveFloatingGeometry(Boolean(drag.resize))
  }

  const startPanelResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (window.innerWidth < AGENT_PANEL_RESIZE_BREAKPOINT) return
    const panel = event.currentTarget.closest<HTMLElement>('.agent-panel')
    if (!panel) return
    resizeStartRef.current = { pointerX: event.clientX, width: panel.getBoundingClientRect().width }
    event.currentTarget.setPointerCapture(event.pointerId)
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    setPanelResizing(true)
  }
  const resizePanel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!panelResizing) return
    const maximum = getAgentPanelMaxWidth()
    const minimum = AGENT_PANEL_DEFAULT_WIDTH
    const nextWidth = resizeStartRef.current.width + resizeStartRef.current.pointerX - event.clientX
    setPanelWidth(Math.min(maximum, Math.max(minimum, Math.round(nextWidth))))
  }
  const finishPanelResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!panelResizing) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    window.localStorage.setItem(AGENT_PANEL_WIDTH_KEY, String(panelWidth))
    setPanelResizing(false)
  }
  useEffect(() => {
    const clampPanelWidth = () => {
      if (window.innerWidth < AGENT_PANEL_RESIZE_BREAKPOINT) return
      const maximum = getAgentPanelMaxWidth()
      setPanelWidth((current) => Math.min(maximum, Math.max(AGENT_PANEL_DEFAULT_WIDTH, current)))
    }
    window.addEventListener('resize', clampPanelWidth)
    return () => {
      window.removeEventListener('resize', clampPanelWidth)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [])

  useEffect(() => {
    const previousIds = readyPlanIdsRef.current
    const nextIds = readyPlans.map((plan) => plan.id)
    const newestAddedId = [...nextIds].reverse().find((id) => !previousIds.includes(id))
    readyPlanIdsRef.current = nextIds
    if (!readyPlans.length) {
      setActiveReadyPlanId(null)
      return
    }
    if (newestAddedId || !readyPlans.some((plan) => plan.id === activeReadyPlanId)) {
      setActiveReadyPlanId(newestAddedId ?? readyPlans[readyPlans.length - 1].id)
    }
  }, [activeReadyPlanId, props.plans])

  const getEditorText = () => {
    const editor = editorRef.current
    if (!editor) return ''
    const clone = editor.cloneNode(true) as HTMLElement
    clone.querySelectorAll<HTMLElement>('.agent-inline-reference').forEach((chip) => {
      const id = chip.dataset.referenceId
      const reference = id ? referenceRegistryRef.current.get(id) : undefined
      chip.replaceWith(document.createTextNode(reference ? ` @${reference.name} ` : ' '))
    })
    return clone.innerText
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n?/g, '\n')
      .replace(/[\t\f\v ]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }
  const getInvocationText = () => {
    const editor = editorRef.current
    if (!editor) return ''
    const clone = editor.cloneNode(true) as HTMLElement
    clone.querySelectorAll('.agent-inline-reference').forEach((chip) => chip.replaceWith(document.createTextNode(' ')))
    return clone.innerText
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n?/g, '\n')
      .replace(/[\t\f\v ]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }
  const rememberSelection = () => {
    const selection = window.getSelection()
    const editor = editorRef.current
    if (!selection || !selection.rangeCount || !editor?.contains(selection.anchorNode)) return
    savedRangeRef.current = selection.getRangeAt(0).cloneRange()
  }
  const updateMentionTrigger = () => {
    const editor = editorRef.current
    const selection = window.getSelection()
    if (!editor || !selection?.rangeCount) return setMentionOpen(false)
    const range = selection.getRangeAt(0)
    if (!editor.contains(range.endContainer) || !range.collapsed) return setMentionOpen(false)
    const prefix = range.cloneRange()
    prefix.selectNodeContents(editor)
    prefix.setEnd(range.endContainer, range.endOffset)
    const holder = document.createElement('div')
    holder.append(prefix.cloneContents())
    holder.querySelectorAll('.agent-inline-reference').forEach((chip) => chip.replaceWith(document.createTextNode(' ')))
    const beforeCaret = holder.innerText.replace(/\u00a0/g, ' ')
    const trigger = beforeCaret.match(/@([^\s@]*)$/)
    setMentionQuery(trigger?.[1] ?? '')
    setMentionIndex(0)
    setMentionOpen(Boolean(trigger))
  }
  const removeReferenceBeforeCaret = () => {
    const editor = editorRef.current
    const selection = window.getSelection()
    if (!editor || !selection?.rangeCount) return false
    const range = selection.getRangeAt(0)
    if (!range.collapsed || !editor.contains(range.startContainer)) return false

    let candidate: ChildNode | null = null
    if (range.startContainer.nodeType === Node.TEXT_NODE) {
      const textNode = range.startContainer as Text
      const beforeCaret = textNode.data.slice(0, range.startOffset)
      if (beforeCaret.trim()) return false
      candidate = textNode.previousSibling
      if (beforeCaret) textNode.deleteData(0, range.startOffset)
    } else {
      candidate = range.startContainer.childNodes.item(range.startOffset - 1)
    }
    while (candidate?.nodeType === Node.TEXT_NODE && !(candidate.textContent ?? '').trim()) candidate = candidate.previousSibling
    const chip = candidate instanceof HTMLElement && candidate.matches('.agent-inline-reference') ? candidate : null
    if (!chip) return false

    const caret = document.createRange()
    caret.setStartBefore(chip)
    caret.collapse(true)
    chip.remove()
    selection.removeAllRanges()
    selection.addRange(caret)
    savedRangeRef.current = caret.cloneRange()
    syncReferencesFromEditor()
    setMentionOpen(false)
    return true
  }
  const hasReferenceAfterCaret = () => {
    const editor = editorRef.current
    const selection = window.getSelection()
    if (!editor || !selection?.rangeCount) return false
    const range = selection.getRangeAt(0)
    if (!range.collapsed || !editor.contains(range.startContainer)) return false

    let candidate: ChildNode | null = null
    if (range.startContainer.nodeType === Node.TEXT_NODE) {
      const textNode = range.startContainer as Text
      if (textNode.data.slice(range.startOffset).trim()) return false
      candidate = textNode.nextSibling
    } else {
      candidate = range.startContainer.childNodes.item(range.startOffset)
    }
    while (candidate?.nodeType === Node.TEXT_NODE && !(candidate.textContent ?? '').trim()) candidate = candidate.nextSibling
    return candidate instanceof HTMLElement && candidate.matches('.agent-inline-reference')
  }
  const selectionTouchesReference = () => {
    const editor = editorRef.current
    const selection = window.getSelection()
    if (!editor || !selection?.rangeCount) return false
    const range = selection.getRangeAt(0)
    if (range.collapsed || !editor.contains(range.commonAncestorContainer)) return false
    return Array.from(editor.querySelectorAll('.agent-inline-reference')).some((chip) => range.intersectsNode(chip))
  }
  const restoreSelection = () => {
    const editor = editorRef.current
    editor?.focus()
    const selection = window.getSelection()
    if (!selection) return
    selection.removeAllRanges()
    if (savedRangeRef.current && editor?.contains(savedRangeRef.current.commonAncestorContainer)) {
      selection.addRange(savedRangeRef.current)
      return
    }
    const range = document.createRange()
    range.selectNodeContents(editor!)
    range.collapse(false)
    selection.addRange(range)
  }
  const insertPlainTextAtSelection = (text: string) => {
    const editor = editorRef.current
    const selection = window.getSelection()
    if (!editor || !selection) return

    const range = selection.rangeCount && editor.contains(selection.anchorNode)
      ? selection.getRangeAt(0)
      : (() => {
          const fallback = document.createRange()
          fallback.selectNodeContents(editor)
          fallback.collapse(false)
          return fallback
        })()

    range.deleteContents()
    const lines = text.replace(/\r\n?/g, '\n').split('\n')
    const fragment = document.createDocumentFragment()
    lines.forEach((line, index) => {
      if (index) fragment.append(document.createElement('br'))
      if (line) fragment.append(document.createTextNode(line))
    })
    if (!text) fragment.append(document.createTextNode(''))
    range.insertNode(fragment)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
    savedRangeRef.current = range.cloneRange()
  }
  const createChip = (reference: AgentImageReference) => {
    const chip = document.createElement('span')
    chip.className = 'agent-inline-reference'
    chip.contentEditable = 'false'
    chip.dataset.referenceId = reference.nodeId
    const isVideo = reference.kind === 'video' || /\.(?:mp4|webm|mov|m4v)(?:$|\?)/i.test(reference.name) || reference.url.startsWith('data:video/')
    const image = document.createElement('img')
    image.setAttribute('aria-label', '')
    const preview = document.createElement('span')
    preview.className = 'video-reference-preview'
    if (isVideo) {
      const loading = document.createElement('span')
      loading.className = 'agent-video-thumbnail-status'
      loading.textContent = '…'
      preview.title = translateUi('正在读取视频画面…')
      preview.append(loading)
      void loadVideoThumbnailPoster(reference).then(url => {
        image.src = url; image.className = 'video-reference-thumbnail'; image.draggable = false
        preview.replaceChildren(image); preview.title = reference.name
      }).catch(() => { loading.textContent = translateUi('视频'); preview.title = translateUi('无法读取缩略图，请检查来源视频是否可以播放') })
    } else image.src = reference.url
    const label = document.createElement('b')
    const existingIndex = props.references.findIndex((item) => item.nodeId === reference.nodeId)
    label.textContent = `${translateUi(isVideo ? '视频' : '图')} ${existingIndex >= 0 ? existingIndex + 1 : props.references.length + 1} · ${compactReferenceName(reference.name)}`
    label.title = reference.name
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.setAttribute('aria-label', translateUi('移除引用'))
    remove.textContent = 'x'
    chip.append(isVideo ? preview : image, label, remove)
    return chip
  }
  const clearMentionTrigger = () => {
    const selection = window.getSelection()
    if (!selection?.rangeCount) return
    const range = selection.getRangeAt(0)
    const textNode = range.startContainer
    if (!(textNode instanceof Text)) return
    const value = textNode.data
    const before = value.slice(0, range.startOffset)
    const match = before.match(/@[^\s@]*$/)
    if (!match) return
    const start = before.length - match[0].length
    textNode.deleteData(start, match[0].length)
    range.setStart(textNode, start)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
  }
  const selectMention = (apply: () => void) => {
    restoreSelection()
    clearMentionTrigger()
    apply()
    syncReferencesFromEditor()
    setMentionOpen(false)
  }
  const getEditorReferences = () => {
    const ids = Array.from(editorRef.current?.querySelectorAll<HTMLElement>('[data-reference-id]') ?? []).map((node) => node.dataset.referenceId).filter(Boolean) as string[]
    const seen = new Set<string>()
    return ids
      .filter((id) => {
        if (seen.has(id)) return false
        seen.add(id)
        return true
      })
      .map((id) => referenceRegistryRef.current.get(id))
      .filter((reference): reference is AgentImageReference => Boolean(reference))
  }
  const syncReferencesFromEditor = () => {
    props.onReferencesChange(getEditorReferences())
    setDraftInvocationText(getInvocationText())
  }
  const resizeEditor = (height: number) => {
    const panelHeight = panelRef.current?.clientHeight ?? 500
    setEditorHeight(Math.max(60, Math.min(Math.round(panelHeight * .56), height)))
  }
  const optimizePrompt = async () => {
    const editor = editorRef.current
    if (!editor || !getInvocationText() || optimizingPrompt) return
    const conversationId = props.activeConversationId
    const originalMarkup = editor.innerHTML
    const contents = Array.from(editor.childNodes, (node) => node.cloneNode(true))
    const draft = editor.cloneNode(true) as HTMLElement
    const chips = Array.from(draft.querySelectorAll('.agent-inline-reference'))
    chips.forEach((chip, index) => chip.replaceWith(document.createTextNode(` [[REF_${index + 1}]] `)))
    const input = draft.innerText.trim()
    setPromptError('')
    setOptimizingPrompt(true)
    try {
      const output = (await props.onOptimizePrompt(input)).trim()
      if (editorRef.current !== editor || editor.innerHTML !== originalMarkup || conversationIdRef.current !== conversationId) return
      if (!output || output === input) return
      const parts = output.split(/(\[\[REF_\d+\]\])/)
      const tokens = parts.filter((part) => /^\[\[REF_\d+\]\]$/.test(part))
      const chipByToken = new Map(chips.map((chip, index) => [`[[REF_${index + 1}]]`, chip]))
      if (tokens.length !== chips.length || new Set(tokens).size !== chips.length || tokens.some((token) => !chipByToken.has(token))) {
        setPromptError('优化结果未保留全部参考素材，请重试。')
        return
      }
      editor.replaceChildren(...parts.map((part) => chipByToken.get(part) ?? document.createTextNode(part)))
      setPromptBackups((current) => [...current.filter((item) => item.conversationId === conversationId), { conversationId, contents }])
      savedRangeRef.current = null
      syncReferencesFromEditor()
    } catch {
      if (conversationIdRef.current === conversationId) setPromptError('提示词优化失败，请重试。')
    } finally {
      setOptimizingPrompt(false)
    }
  }
  const undoPromptOptimization = () => {
    const editor = editorRef.current
    const promptBackup = promptBackups.at(-1)
    if (!editor || promptBackup?.conversationId !== props.activeConversationId) return
    editor.replaceChildren(...promptBackup.contents)
    savedRangeRef.current = null
    setPromptBackups((current) => current.slice(0, -1))
    setPromptError('')
    syncReferencesFromEditor()
    editor.focus()
  }
  const addReference = (reference: AgentImageReference) => {
    restoreSelection()
    clearMentionTrigger()
    const editorReferences = getEditorReferences()
    if (editorReferences.some((item) => item.nodeId === reference.nodeId)) {
      setMentionOpen(false)
      return
    }
    if (editorReferences.length >= 16) {
      props.onUploadNotice('本轮最多引用 16 个媒体素材')
      setMentionOpen(false)
      return
    }
    referenceRegistryRef.current.set(reference.nodeId, reference)
    props.onReferencesChange([...editorReferences, reference])
    const selection = window.getSelection()
    if (selection?.rangeCount) {
      const range = selection.getRangeAt(0)
      range.deleteContents()
      range.insertNode(document.createTextNode(' '))
      range.insertNode(createChip(reference))
      range.insertNode(document.createTextNode(' '))
      range.collapse(false)
      selection.removeAllRanges()
      selection.addRange(range)
      savedRangeRef.current = range.cloneRange()
    }
    syncReferencesFromEditor()
    setMentionOpen(false)
  }
  const uploadReferences = async (files: File[]) => {
    const videoFiles = files.filter((file) => file.type.startsWith('video/'))
    if (videoFiles.length) {
      props.onUploadNotice(acceptsVideoReference ? '当前视频已识别为参考素材' : '当前对话只接收图片参考')
    }
    const supported = files.filter((file) => ['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || (acceptsVideoReference && videoFileType(file, file.name)?.startsWith('video/')))
    const remaining = Math.max(0, 16 - props.references.length)
    if (!supported.length) {
      props.onUploadNotice(acceptsVideoReference ? '支持 PNG、JPG/JPEG、WebP 图片或视频文件' : '当前模式仅支持 PNG、JPG/JPEG 和 WebP 图片')
      return
    }
    if (!remaining) {
      props.onUploadNotice('参考图最多 16 张，请先移除部分图片')
      return
    }
    let added = 0
    let failed = 0
    for (const file of supported.slice(0, remaining)) {
      try {
        addReference(await props.onCreateUploadedReference(file))
        added += 1
      } catch {
        failed += 1
      }
    }
    const rejected = files.length - supported.length
    const overLimit = Math.max(0, supported.length - remaining)
    const notes = [rejected ? `${rejected} 个格式不支持` : '', failed ? `${failed} 个文件无法保存` : '', overLimit ? `${overLimit} 张超出上限` : ''].filter(Boolean)
    props.onUploadNotice(added ? `已添加 ${added} 个参考素材${notes.length ? `，跳过${notes.join('、')}` : ''}` : `没有添加参考素材${notes.length ? `：${notes.join('、')}` : ''}`)
  }
  useEffect(() => {
    if (!props.pendingReferences.length) return
    props.pendingReferences.forEach(addReference)
    props.onPendingReferenceConsumed()
  }, [props.pendingReferences])
  useEffect(() => {
    if (!props.skillSelection) return
    setSkillMenuOpen(false)
    setSkillAuthoring(false)
    const frame = window.requestAnimationFrame(() => editorRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [props.skillSelection?.id])
  useEffect(() => {
    if (!props.skillDraft) return
    if (!getInvocationText().trim()) {
      savedRangeRef.current = null
      restoreSelection()
      insertPlainTextAtSelection(props.skillDraft)
      syncReferencesFromEditor()
    }
    props.onSkillDraftConsumed()
  }, [props.skillDraft])
  useEffect(() => {
    if (!props.startSkillAuthoring) return
    setSkillAuthoring(true)
    props.onSkillAuthoringStarted()
  }, [props.startSkillAuthoring])
  useEffect(() => {
    const referenceNumberById = new Map(props.references.map((reference, index) => [reference.nodeId, index + 1]))
    editorRef.current?.querySelectorAll<HTMLElement>('.agent-inline-reference').forEach((chip) => {
      const reference = props.references.find((item) => item.nodeId === chip.dataset.referenceId)
      const number = reference ? referenceNumberById.get(reference.nodeId) : undefined
      const label = chip.querySelector('b')
      if (label && reference && number) {
        const editing = composerMode === 'video' && videoWorkflow === 'edit'
        chip.dataset.mediaRole = editing ? reference.kind === 'video' ? 'edit-source' : 'edit-reference' : ''
        label.textContent = `${translateUi(editing ? reference.kind === 'video' ? '原视频' : '辅助图' : reference.kind === 'video' ? '视频' : '图')}${editing ? '' : ` ${number}`} · ${compactReferenceName(reference.name)}`
        label.title = reference.name
      }
    })
  }, [props.references, composerMode, videoWorkflow, interfaceLocale])
  useEffect(() => {
    setTurnStyles([])
    setTurnTextNodes([])
    setWebReferences([])
    setWebInputUrl(undefined)
    setWebDraftOpen(false)
    setMentionOpen(false)
    setPromptError('')
  }, [props.activeConversationId])
  useEffect(() => {
    if (!mentionOpen) return
    document.getElementById(`${mentionMenuId}-${mentionIndex}`)?.scrollIntoView({ block: 'nearest' })
  }, [mentionOpen, mentionIndex, mentionMenuId])
  useEffect(() => {
    const container = messagesRef.current
    if (!container) return
    const update = () => {
      pinnedToBottomRef.current = container.scrollHeight - container.scrollTop - container.clientHeight < 72
    }
    update()
    container.addEventListener('scroll', update, { passive: true })
    return () => {
      container.removeEventListener('scroll', update)
    }
  }, [])
  useEffect(() => {
    const container = messagesRef.current
    if (!container) return
    const frame = window.requestAnimationFrame(() => {
      const directions = latestMessage?.directions?.length ? [...container.querySelectorAll<HTMLElement>('.agent-creative-directions')].at(-1) : undefined
      const target = directions
      container.scrollTo({ top: target ? container.scrollTop + target.getBoundingClientRect().top - container.getBoundingClientRect().top - 12 : container.scrollHeight, behavior: 'instant' })
      pinnedToBottomRef.current = !target
    })
    return () => window.cancelAnimationFrame(frame)
  }, [props.activeConversationId])
  useEffect(() => {
    const container = messagesRef.current
    if (!container || !pinnedToBottomRef.current) return
    const frame = window.requestAnimationFrame(() => {
      const directions = latestMessage?.directions?.length ? [...container.querySelectorAll<HTMLElement>('.agent-creative-directions')].at(-1) : undefined
      const target = directions
      container.scrollTo({ top: target ? container.scrollTop + target.getBoundingClientRect().top - container.getBoundingClientRect().top - 12 : container.scrollHeight, behavior: target ? 'instant' : 'smooth' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [props.messages.length, props.plans.length, props.videoPlans.length, props.textPlans.length, props.busy, props.filmRun?.nodeId])
  useEffect(() => {
    if (!props.filmReview) return
    const frame = window.requestAnimationFrame(() => messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: 'instant' }))
    return () => window.cancelAnimationFrame(frame)
  }, [props.filmReview?.id])
  const submit = (answers?: string, directionChoice?: AgentTurnOptions['directionChoice']) => {
    const invocationText = [answers, getInvocationText()].filter(Boolean).join('\n\n')
    const value = [answers, getEditorText()].filter(Boolean).join('\n\n')
    if (!value) return
    if (composerMode !== 'agent' && !attachedSkill && directionChoice?.action !== 'refine' && !mediaModel) {
      setPromptError('请先选择' + (mediaKind === 'image' ? '生图' : '视频') + '模型。')
      return
    }
    if (composerMode !== 'agent' && !attachedSkill && directionChoice?.action !== 'refine' && (!generationSettings.aspectRatio || !generationSettings.resolution || (mediaKind === 'video' && !generationSettings.duration))) {
      setPromptError('当前模型缺少可用的生成参数，请重新选择模型。')
      return
    }
    if (!props.textModels.some(({ key }) => key === props.textModelKey)) {
      props.onOpenApiSettings()
      return
    }
    if (composerMode === 'video' && !attachedSkill) {
      const refs = getEditorReferences()
      const issue = composerVideoInputIssue(generationSettings, parameterOptions, refs.filter(ref => ref.kind !== 'video').length, refs.filter(ref => ref.kind === 'video').length)
      if (issue) { setPromptError(issue); setComposerMenu('parameters'); return }
    }
    if (turnStyles.some(({ id }) => !props.styleCandidates.some((item) => item.id === id))
      || turnTextNodes.some(({ id }) => !props.textCandidates.some((item) => item.id === id))) {
      setPromptError('部分引用已不可用，请移除后重新选择。')
      return
    }
    const incompatibleReferences = getEditorReferences().filter((reference) => !modeAcceptsReference(reference))
    if (incompatibleReferences.length) {
      setPromptError('当前生成模式不接收已添加的部分素材。请移除这些引用或切换生成模式。')
      return
    }
    pinnedToBottomRef.current = true
    props.onSend(value, composerMode === 'agent' || attachedSkill || answers ? invocationText : `${composerMode === 'image' ? '请生成或编辑图像' : '请规划并生成视频'}：\n${invocationText}`, getEditorReferences().filter(modeAcceptsReference), undefined, {
      workflow: composerMode === 'agent' ? workflow : 'direct',
      directionChoice,
      models: {
        image: draftImageModel ? { key: draftImageModel.key, name: draftImageModel.name } : undefined,
        video: draftVideoModel ? { key: draftVideoModel.key, name: draftVideoModel.name } : undefined,
      },
      generation: composerMode !== 'agent' && !attachedSkill ? { ...generationSettings, ...(composerMode === 'video' ? { generationMode: composerVideoMode(generationSettings, parameterOptions, getEditorReferences().filter(ref => ref.kind !== 'video').length, getEditorReferences().filter(ref => ref.kind === 'video').length) } : {}) } : undefined,
      styleIds: turnStyles.map(({ id }) => id),
      textNodeIds: turnTextNodes.map(({ id }) => id),
      webReferences,
    })
    if (editorRef.current) editorRef.current.innerHTML = ''
    setTurnStyles([])
    setTurnTextNodes([])
    setWebReferences([])
    setWebInputUrl(undefined)
    setWebDraftOpen(false)
    setDraftInvocationText('')
    setPromptBackups([])
    setPromptError('')
    setMentionOpen(false)
  }
  const attachSkill = (skill: SkillManifest) => {
    props.onAttachSkill(skill)
    setSkillMenuOpen(false)
    setSkillAuthoring(false)
    window.requestAnimationFrame(() => editorRef.current?.focus())
  }
  const [expandedImageCards, setExpandedImageCards] = useState<Record<string, boolean>>({})
  const [batchSelection, setBatchSelection] = useState<Record<string, boolean>>({})
  const [runningImageBatch, setRunningImageBatch] = useState<string[]>([])
  const batchControllerRef = useRef<AbortController | null>(null)
  const [stoppingImageBatch, setStoppingImageBatch] = useState(false)
  const [batchModelKeys, setBatchModelKeys] = useState<Record<string, string>>({})

  const reviewImagePlan = (storedPlan: AgentImagePlan) => {
    const plan = reconcileAgentImagePlanSpecs(storedPlan)
    const key = `${plan.imageConnectionId ?? ''}::${plan.imageModelId ?? ''}`
    const model = props.imageModels.find((item) => item.key === key)
    const referenceCount = new Set([...(plan.references ?? []).map(({ mediaId, url }) => mediaId || url), ...(plan.invokedStyleReferences ?? []).map(({ mediaId, url }) => mediaId || url)]).size
    const maxReferences = Math.min(16, model?.imageParameters?.maxReferences ?? 16)
    return { plan, model, key, outputIntent: imageOutputIntent(plan.prompt, model?.outputs),
      referenceIssue: props.getImagePlanIssue(plan) ?? (referenceCount > maxReferences ? (maxReferences ? `当前模型最多接收 ${maxReferences} 张参考图，请移除多余参考或换模型。` : '当前模型不接收参考图，请更换模型。') : undefined) }
  }

  const renderResultGroup = (plans: Array<AgentImagePlan | AgentVideoPlan>, kind: 'image' | 'video') => {
    const finished = plans.filter(plan => plan.results?.length)
    if (!finished.length) return null
    const submitted = plans.filter(plan => !['proposed', 'ready'].includes(plan.status))
    return <AgentMediaResults kind={kind} items={finished.flatMap(plan => (plan.results ?? []).map((result, index) => ({
      ...result, id: `${plan.id}:${result.id}`, nodeId: plan.nodeId, label: plan.label ? `${plan.label}${(plan.results?.length ?? 0) > 1 ? ` · ${index + 1}` : ''}` : undefined,
    })))} expected={submitted.reduce((count, plan) => count + plan.count, 0)} running={submitted.some(plan => plan.status === 'running')}
      meta={[...new Set(finished.map(plan => 'videoModelId' in plan && plan.generationMode === 'edit' && props.videoModels.find(model => model.key === `${plan.videoConnectionId ?? ''}::${plan.videoModelId ?? ''}`)?.videoParameters?.editing?.inheritsSource
        ? '视频编辑 · 跟随原视频 · 最高 720p'
        : [plan.aspectRatio === 'auto' ? '自适应' : plan.aspectRatio, plan.resolution, 'duration' in plan ? `${plan.duration} 秒` : undefined].filter(Boolean).join(' · ')))].join(' / ')}
      issues={finished.flatMap(plan => plan.error ? [`${plan.label ? `${plan.label}：` : ''}${plan.error}`] : [])}
      onDownloadImage={props.onDownloadImage} onLocate={props.agentOnly ? undefined : props.onLocateCanvasNode}/>
  }
  const renderPlan = (storedPlan: AgentImagePlan, collapsible = false) => {
    const { plan, model: imageModel, key: imageModelKey, outputIntent, referenceIssue } = reviewImagePlan(storedPlan)
    if (props.automaticPlanIds?.includes(plan.id) && plan.status === 'ready' || plan.execution === 'automatic' && plan.status === 'running') return <section key={plan.id} className="agent-auto-progress" role="status">
      <header><LoaderCircle size={15} className="is-spinning"/><strong>{plan.status === 'running' ? '正在生成图像' : '检查素材后开始生成'}</strong></header>
      <p>{imageModel?.name} · {plan.aspectRatio} · {plan.resolution} · {plan.count} 张</p>
      <details><summary>查看制作内容</summary><p>{plan.prompt}</p></details>
      {plan.status === 'ready' && <button type="button" onClick={() => props.onCancelPlan(plan.id)}>取消本次生成</button>}
    </section>
    const statusLabel = plan.status === 'ready' ? '待确认' : plan.status === 'running' ? '生成中' : plan.status === 'completed' ? '已完成' : plan.status === 'cancelled' ? '已取消' : '失败'
    const isCompact = plan.status === 'completed' || plan.status === 'cancelled' || Boolean(plan.results?.length)
    const queued = runningImageBatch.includes(plan.id)
    const disabled = plan.status !== 'ready' || queued
    const expanded = !collapsible || expandedImageCards[plan.id] === true
    const imageModelAvailable = Boolean(imageModel)
    const parameters = imageModel?.imageParameters
    const shown = parameters ? resolveImageModelOptions(parameters.baseUrl, parameters.modelId, {
      aspectRatio: plan.aspectRatio,
      resolution: plan.resolution as ImageGenerationOptions['resolution'],
      detail: plan.detail as ImageGenerationOptions['detail'],
    }) : plan
    const costLabel = props.getImagePlanCostLabel?.(plan)
    const displayedContextReferences: AgentContextReference[] = plan.contextReferences?.length
      ? plan.contextReferences
      : (plan.references ?? []).map((reference) => ({ ...reference, kind: reference.kind ?? 'image' as const }))
    if (isCompact) {
      if (plan.results?.length) {
        return renderResultGroup([plan], 'image')
      }
      return (
        <button
          type="button"
          key={plan.id}
          className={`agent-plan-card is-${plan.status} is-collapsed`}
          disabled={!plan.nodeId}
          onClick={() => !props.agentOnly && plan.nodeId && props.onLocateCanvasNode(plan.nodeId)}
        >
          <span><ImagePlus size={15} /><strong>{plan.status === 'completed' ? '图像已生成' : '图像方案已取消'}</strong></span>
          <span className="agent-plan-collapsed-meta">{plan.aspectRatio} · {plan.resolution} · {plan.count} 张</span>
          {!props.agentOnly && plan.nodeId && <span className="agent-plan-locate"><Focus size={14} />定位画布</span>}
        </button>
      )
    }
    const storyboard = plan.status === 'ready' ? legacyStoryboardOperation(plan) : undefined
    if (storyboard) return <section className="agent-plan-card agent-image-plan-card" key={plan.id} aria-label="旧分镜方案">
      <header><span><ImagePlus size={15} />分镜拆图</span><em>待识别原图</em></header>
      <p>{storyboard.requestedCount ? `目标是拆出 ${storyboard.requestedCount} 张独立图片。` : '将原图中的镜头拆成独立图片。'}先识别原图边界，再确认要保留的镜头。</p>
      <footer className="agent-plan-actions">
        <button type="button" className="agent-plan-cancel" disabled={props.busy} onClick={() => props.onCancelPlan(plan.id)}>取消</button>
        <button type="button" className="agent-plan-confirm" disabled={props.busy} onClick={() => props.onConfirmPlan(plan.id)}>识别原图并选择镜头</button>
      </footer>
    </section>
    return (
      <section
        className={`agent-plan-card agent-image-plan-card is-${plan.status} ${activeReadyPlan?.id === plan.id ? 'is-parameter-target' : ''}`}
        key={plan.id}
        onPointerDown={() => {
          if (plan.status === 'ready') setActiveReadyPlanId(plan.id)
        }}
        onFocusCapture={() => {
          if (plan.status === 'ready') setActiveReadyPlanId(plan.id)
        }}
      >
        <header>
          {collapsible && <input type="checkbox" aria-label={`批量选择 ${plan.label || '图像方案'}`} checked={batchSelection[plan.id] !== false}
            disabled={queued} onChange={(event) => setBatchSelection((current) => ({ ...current, [plan.id]: event.target.checked }))} />}
          {collapsible ? <button type="button" className="agent-image-card-toggle" aria-expanded={expanded}
            aria-controls={`review-${plan.id}`} onClick={() => setExpandedImageCards((current) => ({ ...current, [plan.id]: !expanded }))}>
            <ImagePlus size={15} /><span>{plan.deliverableIndex === undefined ? plan.label || '图像生成确认' : `${plan.deliverableIndex + 1}. ${plan.label || '图像'}`}</span><ChevronDown size={15} />
          </button> : <span><ImagePlus size={15} />{plan.deliverableIndex === undefined ? '图像生成确认' : `${plan.deliverableIndex + 1}. ${plan.label || '图像'}`}</span>}
          <em>{queued && plan.status === 'ready' ? '已排队' : statusLabel}</em>
        </header>
        {plan.label && plan.deliverableIndex === undefined && <p className="agent-plan-brief-title">{plan.label}</p>}
        <p className="agent-plan-brief-specs" aria-label="图像生成规格">{[imageModel?.name, `${plan.count} 张`, plan.aspectRatio === 'auto' ? '自适应' : plan.aspectRatio, plan.resolution, parameters?.qualities.find(({ value }) => value === plan.detail)?.label, outputIntent.output && outputIntent.output !== 'png' ? IMAGE_OUTPUT_LABELS[outputIntent.output] : undefined].filter(Boolean).join(' · ')}</p>
        {!imageModelAvailable && <p className="agent-image-plan-notice">{plan.modelMention ? `指定模型 ${plan.modelMention.name} 不可用。请在输入框重新选择模型并发送。` : '请选择可用的图像模型。'}</p>}
        {imageModelAvailable && referenceIssue && <p className="agent-image-plan-notice" role="status">{referenceIssue}</p>}
        {expanded && <div className="agent-image-card-fields" id={`review-${plan.id}`}>
        <details className="agent-plan-advanced" open={imageModelAvailable ? undefined : true}>
          <summary>查看提示词和设置</summary>
        <div className="agent-image-plan-field agent-image-plan-model">
          <span>图像模型{plan.modelMention ? ' · 本轮指定' : ''}</span>
          {plan.modelLocked ? <div className="agent-plan-locked-model"><ImagePlus size={15} /><span>{imageModel?.name ?? plan.modelMention?.name ?? '指定模型不可用'}</span><small>已指定</small></div> : <AgentSelect variant="floating" ariaLabel="选择本次图像模型" disabled={disabled} value={imageModelAvailable ? imageModelKey : ''} placeholder="选择图像模型" options={props.imageModels.map((model) => ({ value: model.key, label: model.name, detail: model.connectionName, brand: getModelBrand(model.name) }))} icon={<ImagePlus size={14} />} onChange={(key) => { const [imageConnectionId = '', imageModelId = ''] = key.split('::'); const chosen = props.imageModels.find((model) => model.key === key); props.onPlanChange(plan.id, { imageConnectionId, imageModelId, modelMention: chosen && { key, name: chosen.name } }) }} />}
        </div>
        <label className="agent-image-plan-field"><span>提示词</span><textarea value={plan.prompt} disabled={disabled} onChange={(event) => props.onPlanChange(plan.id, { prompt: event.target.value })} aria-label="编辑图像方案提示词" /></label>
        {plan.status === 'ready' && <div className="agent-image-plan-specs" role="group" aria-label="确认本次生成规格">
          {plan.deliverableIndex === undefined && <div className="agent-image-plan-field"><span>生成张数</span><AgentSelect variant="floating" ariaLabel="生成张数" value={String(plan.count)} placeholder="张数" options={[1, 2, 3, 4].map((count) => ({ value: String(count), label: `${count} 张` }))} icon={null} onChange={(value) => props.onPlanChange(plan.id, { count: Number(value) })} /></div>}
          <div className="agent-image-plan-field"><span>画面比例</span><AgentSelect variant="floating" ariaLabel="画面比例" disabled={!imageModelAvailable} value={plan.aspectRatio || shown.aspectRatio || ''} placeholder="比例" options={parameters?.ratios ?? props.aspectOptions} icon={null} onChange={(aspectRatio) => props.onPlanChange(plan.id, { aspectRatio })} /></div>
          {(parameters?.resolutions ?? props.resolutionOptions).length > 0 && <div className="agent-image-plan-field"><span>清晰度</span><AgentSelect variant="floating" ariaLabel="清晰度" disabled={!imageModelAvailable} value={plan.resolution || shown.resolution || ''} placeholder="清晰度" options={parameters?.resolutions ?? props.resolutionOptions} icon={null} onChange={(resolution) => props.onPlanChange(plan.id, { resolution })} /></div>}
          {(parameters?.qualities ?? props.detailOptions).length > 0 && <div className="agent-image-plan-field"><span>画质</span><AgentSelect variant="floating" ariaLabel="画质" disabled={!imageModelAvailable} value={plan.detail || shown.detail || ''} placeholder="画质" options={parameters?.qualities ?? props.detailOptions} icon={null} onChange={(detail) => props.onPlanChange(plan.id, { detail, requestedDetail: detail })} /></div>}
        </div>}
        {plan.status === 'ready' && imageModelAvailable && outputIntent.message && <p className={`image-output-hint ${outputIntent.blocked ? 'is-unsupported' : ''}`} role="status">{outputIntent.message}</p>}
        </details>
        {!!displayedContextReferences.length && renderContextReferences(displayedContextReferences, disabled ? undefined : (nodeId) => props.onRemovePlanContextReference(plan.id, nodeId))}
        {!!(plan.invokedStylePresets?.length || plan.invokedStyleReferences?.length) && <div className="agent-plan-invoked-styles">
          {(plan.invokedStylePresets?.length ? plan.invokedStylePresets : [{
            id: 'legacy-invoked-style',
            name: '风格设定',
            keyword: plan.styleInvocationWord || '',
            references: plan.invokedStyleReferences ?? [],
          }]).map((preset) => <div className="agent-plan-invoked-style" key={preset.id}>
            <span><Sparkles size={12} />{preset.name}{preset.keyword ? ` · ${preset.keyword}` : ''}</span>
            <div>{preset.references.map((reference) => <img src={reference.url} alt={reference.name} title={reference.name} key={reference.id} />)}</div>
          </div>)}
        </div>}
        {plan.reviewReason && plan.status === 'ready' && !plan.error && <p className="agent-image-plan-notice">{plan.reviewReason}</p>}{plan.error && <p className="agent-plan-error">{plan.error}</p>}
        {plan.status === 'ready' && <footer className="agent-plan-actions">
          <span className="agent-image-plan-confirm-note">{costLabel ? `预计 ${costLabel}` : '确认后才开始生成'}</span>
          <button type="button" className="agent-plan-cancel" disabled={disabled} onClick={() => props.onCancelPlan(plan.id)}>取消</button>
          <button type="button" className="agent-plan-confirm" disabled={disabled || !imageModelAvailable || Boolean(referenceIssue) || outputIntent.blocked || !plan.prompt.trim()} title={referenceIssue ?? (outputIntent.blocked ? outputIntent.message : undefined)} onClick={() => props.onConfirmPlan(plan.id)}><Check size={15} aria-hidden="true" /><span>{plan.deliverableIndex === undefined ? `确认生成 ${plan.count} 张` : `确认第 ${plan.deliverableIndex + 1} 张`}</span></button>
        </footer>}
        </div>}
      </section>
    )
  }
  const renderContextReferences = (references: AgentContextReference[], onRemove?: (nodeId: string) => void) => (
    <div className="agent-plan-context-references">
      <div className="agent-plan-context-heading"><span>关联素材</span>{references.some((reference) => reference.autoResolved) && <em><Sparkles size={11} />Agent 自动关联</em>}</div>
      <div>{references.map((reference, index) => <div className={`agent-plan-context-reference is-${reference.kind}`} key={`${reference.kind}-${reference.nodeId}`}>
        <button type="button" className="agent-context-locate" title={`${reference.name}${reference.resolutionReason ? ` · ${reference.resolutionReason}` : ''}`} onClick={() => props.onLocateCanvasNode(reference.nodeId)}>
          {reference.url ? (reference.kind === 'video' ? <video src={reference.url} muted playsInline preload="metadata" aria-label={reference.name} /> : <img src={reference.url} alt="" />) : <span className="agent-context-text-icon"><FileText size={14} /></span>}
          <span><strong>{reference.kind === 'image' ? `图${index + 1} · ` : reference.kind === 'video' ? `视频${index + 1} · ` : ''}{compactReferenceName(reference.name, 14)}</strong>{reference.purpose && <small>{AGENT_REFERENCE_PURPOSES[reference.purpose]}</small>}{reference.excerpt && <small>{reference.excerpt.slice(0, 180)}</small>}{reference.autoResolved && <small>{reference.resolutionReason || '根据上下文自动关联'}</small>}</span>
          <Focus size={12} />
        </button>
        {onRemove && <button type="button" className="agent-context-remove" aria-label={`移除关联 ${reference.name}`} title="从本次确认卡移除" onClick={() => onRemove(reference.nodeId)}><X size={12} /></button>}
      </div>)}</div>
    </div>
  )
  const renderVideoPlan = (plan: AgentVideoPlan) => {
    const inheritsSource = plan.generationMode === 'edit' && props.videoModels.find(model => model.key === `${plan.videoConnectionId ?? ''}::${plan.videoModelId ?? ''}`)?.videoParameters?.editing?.inheritsSource
    if (props.automaticPlanIds?.includes(plan.id) && plan.status === 'ready') return <section key={plan.id} className="agent-auto-progress" role="status">
      <header><LoaderCircle size={15} className="is-spinning"/><strong>检查素材后开始生成视频</strong></header>
      <p>{inheritsSource ? '视频编辑 · 比例与时长跟随原视频 · 最高 720p' : `${plan.aspectRatio} · ${plan.resolution} · ${plan.duration} 秒`} · {plan.count} 条</p>
      <button type="button" onClick={() => props.onCancelVideoPlan(plan.id)}>取消本次生成</button>
    </section>
    const statusLabel = plan.status === 'ready' ? '待确认' : plan.status === 'running' ? '生成中' : plan.status === 'completed' ? '已完成' : plan.status === 'cancelled' ? '已取消' : '失败'
    if (plan.status !== 'ready') return <button type="button" key={plan.id} className={`agent-plan-card agent-video-plan-card is-${plan.status} is-collapsed`} disabled={!plan.nodeId} onClick={() => !props.agentOnly && plan.nodeId && props.onLocateCanvasNode(plan.nodeId)}>
      <span><Film size={15} /><strong>{plan.status === 'completed' ? '视频已生成' : plan.status === 'running' ? '视频生成中' : plan.status === 'failed' ? '视频生成失败' : '视频方案已取消'}</strong></span>
      <span className="agent-plan-collapsed-meta">{inheritsSource ? '视频编辑 · 跟随原视频' : `${plan.aspectRatio} · ${plan.resolution} · ${plan.duration} 秒`} · {plan.count} 条</span>
      {plan.error && <span className="agent-plan-error">{plan.error}</span>}
      {!props.agentOnly && plan.nodeId && <span className="agent-plan-locate"><Focus size={14} />定位画布</span>}
    </button>
    const displayedContextReferences = plan.contextReferences?.length
      ? plan.contextReferences
      : (plan.references ?? []).map((reference) => ({ ...reference, kind: reference.kind ?? 'image' as const }))
    const videoModelKey = `${plan.videoConnectionId ?? ''}::${plan.videoModelId ?? ''}`
    const videoModel = props.videoModels.find((model) => model.key === videoModelKey)
    const videoModelAvailable = Boolean(videoModel)
    const referenceIssue = videoModelAvailable ? props.getVideoPlanIssue(plan) : undefined
    return <section className="agent-plan-card agent-video-plan-card is-ready" key={plan.id}>
      <header><span><Film size={15} />视频生成确认</span><em>{statusLabel}</em></header>
      {plan.label && <p className="agent-plan-brief-title">{plan.label}</p>}
      <p className="agent-plan-brief-specs" aria-label="视频生成规格">{[videoModel?.name,
        plan.generationMode && { text: '文生视频', image: '图生视频', frames: '首尾帧', reference: '图片参考', omni: '参考图/视频', edit: '视频编辑' }[plan.generationMode],
        `${plan.count} 条`, ...(inheritsSource ? ['跟随原视频', '最高 720p'] : [plan.aspectRatio === 'auto' ? '自适应' : plan.aspectRatio, plan.resolution.toUpperCase(), `${plan.duration} 秒/条`])].filter(Boolean).join(' · ')}</p>
      {plan.modelMention && !videoModelAvailable && <p className="agent-image-plan-notice">指定模型 {plan.modelMention.name} 不可用。请在输入框重新选择模型并发送。</p>}
      {referenceIssue && <p className="agent-image-plan-notice" role="status">{referenceIssue}</p>}
      {!videoModelAvailable && !plan.modelLocked && <p className="mb-2 text-[11px] text-amber-300">原视频模型已不可用，请重新选择。</p>}
      <details className="agent-plan-advanced" open={videoModelAvailable ? undefined : true}>
        <summary>查看提示词和设置</summary>
      <div className="mb-2 grid gap-1"><span className="text-[10px] text-[color:var(--muted)]">视频模型{plan.modelMention ? ' · 本轮指定' : ''}</span>{plan.modelLocked ? <div className="agent-plan-locked-model"><Film size={15} /><span>{videoModel?.name ?? plan.modelMention?.name ?? '指定模型不可用'}</span><small>已指定</small></div> : <AgentSelect className="w-full" ariaLabel="选择本次视频模型" value={videoModelAvailable ? videoModelKey : ''} placeholder="选择视频模型" options={props.videoModels.map((model) => ({ value: model.key, label: `${model.name} · ${model.connectionName}`, brand: getModelBrand(model.name) }))} icon={<Film size={13} />} onChange={(key) => {
        const [videoConnectionId = '', videoModelId = ''] = key.split('::')
        const chosen = props.videoModels.find((model) => model.key === key)
        props.onVideoPlanChange(plan.id, {
          videoConnectionId, videoModelId, modelMention: chosen && { key, name: chosen.name },
        })
      }} />}</div>
      <textarea value={plan.prompt} onChange={(event) => props.onVideoPlanChange(plan.id, { prompt: event.target.value })} aria-label="编辑视频方案提示词" />
      <div className="agent-video-plan-settings">
        {!inheritsSource && <>
        <AgentSelect ariaLabel="视频比例" value={plan.aspectRatio} placeholder="比例" options={videoModel?.videoParameters?.ratios ?? props.videoAspectOptions} icon={<SlidersHorizontal size={13} />} onChange={(aspectRatio) => props.onVideoPlanChange(plan.id, { aspectRatio })} />
        <AgentSelect ariaLabel="视频清晰度" value={plan.resolution} placeholder="清晰度" options={videoModel?.videoParameters?.resolutions ?? props.videoResolutionOptions} icon={<SlidersHorizontal size={13} />} onChange={(resolution) => props.onVideoPlanChange(plan.id, { resolution })} />
        <AgentSelect ariaLabel="视频时长" value={String(plan.duration)} placeholder="时长" options={videoModel?.videoParameters?.durations ?? props.videoDurationOptions} icon={<SlidersHorizontal size={13} />} onChange={(duration) => props.onVideoPlanChange(plan.id, { duration: Number(duration) })} />
        </>}
        {inheritsSource && <p className="video-mode-hint">比例与时长跟随原视频，清晰度最高 720p。</p>}
        <AgentSelect ariaLabel="视频数量" value={String(plan.count)} placeholder="数量" options={[1, 2, 3, 4].map((count) => ({ value: String(count), label: `${count} 条` }))} icon={<SlidersHorizontal size={13} />} onChange={(count) => props.onVideoPlanChange(plan.id, { count: Number(count) })} />
      </div>
      </details>
      {!!displayedContextReferences.length && renderContextReferences(displayedContextReferences, (nodeId) => props.onRemoveVideoPlanContextReference(plan.id, nodeId))}
      {!!(plan.invokedStylePresets?.length || plan.invokedStyleReferences?.length) && <div className="agent-plan-invoked-styles">
        {(plan.invokedStylePresets?.length ? plan.invokedStylePresets : [{ id: 'legacy-video-style', name: '风格设定', keyword: plan.styleInvocationWord || '', references: plan.invokedStyleReferences ?? [] }]).map((preset) => <div className="agent-plan-invoked-style" key={preset.id}><span><Sparkles size={12} />{preset.name}{preset.keyword ? ` · ${preset.keyword}` : ''}</span><div>{preset.references.map((reference) => <img src={reference.url} alt={reference.name} title={reference.name} key={reference.id} />)}</div></div>)}
      </div>}
      {plan.reviewReason && plan.status === 'ready' && !plan.error && <p className="agent-image-plan-notice">{plan.reviewReason}</p>}{plan.error && <p className="agent-plan-error">{plan.error}</p>}
      <footer className="agent-plan-actions"><button type="button" className="agent-plan-cancel" onClick={() => props.onCancelVideoPlan(plan.id)}>取消</button><button type="button" className="agent-plan-confirm" disabled={!videoModelAvailable || Boolean(referenceIssue) || !plan.prompt.trim()} title={referenceIssue ?? (videoModelAvailable ? '使用所选模型生成视频' : '请先选择可用的视频模型')} onClick={() => props.onConfirmVideoPlan(plan.id)}><Check size={15} />确认生成视频</button></footer>
    </section>
  }
  const renderTextPlan = (plan: AgentTextPlan) => {
    if (plan.status !== 'ready') return <button type="button" key={plan.id} className={`agent-plan-card agent-text-plan-card is-${plan.status} is-collapsed`} disabled={!plan.nodeId} onClick={() => plan.nodeId && props.onLocateCanvasNode(plan.nodeId)}><span><FileText size={15} /><strong>{plan.status === 'completed' ? '文本已加入画布' : '文本方案已取消'}</strong></span>{plan.nodeId && <span className="agent-plan-locate"><Focus size={14} />定位画布</span>}</button>
    return <section className="agent-plan-card agent-text-plan-card is-ready" key={plan.id}>
      <header><span><FileText size={15} />文本生成确认</span><em>待确认</em></header>
      <input className="agent-text-plan-title" value={plan.title} onChange={(event) => props.onTextPlanChange(plan.id, { title: event.target.value })} aria-label="编辑文本标题" />
      <textarea value={plan.content} onChange={(event) => props.onTextPlanChange(plan.id, { content: event.target.value })} aria-label="编辑最终文本" />
      {!!plan.contextReferences?.length && renderContextReferences(plan.contextReferences, (nodeId) => props.onRemoveTextPlanContextReference(plan.id, nodeId))}
      <footer className="agent-plan-actions"><button type="button" className="agent-plan-cancel" onClick={() => props.onCancelTextPlan(plan.id)}>取消</button><button type="button" className="agent-plan-confirm" onClick={() => props.onConfirmTextPlan(plan.id)}><Check size={15} />确认并加入画布</button></footer>
    </section>
  }
  const renderDirectionChoices = (plans: AgentImagePlan[]) => {
    const selectablePlans = plans.filter((plan) => plan.deliverableIndex === undefined && (plan.status === 'proposed' || plan.status === 'ready'))
    if (selectablePlans.length < 2) return null
    if (!selectablePlans.length) return null
    const planIds = selectablePlans.map((plan) => plan.id)
    const proposedIds = selectablePlans.filter((plan) => plan.status === 'proposed').map((plan) => plan.id)
    return (
      <section className="agent-plan-choice" key={`choice-${planIds.join('-')}`}>
        <header><span><Sparkles size={14} />选择创作方向</span><em>{selectablePlans.length} 个方案</em></header>
        <p>{proposedIds.length ? '选择你想继续的方向；已展开的方案会保留在下方，取消后可重新选择。' : '所有方向已展开为确认卡；你仍可取消任意一项后重新选择。'}</p>
        <div>
          {selectablePlans.map((plan, index) => {
            const isSelected = plan.status === 'ready'
            return <button
              type="button"
              key={plan.id}
              className={isSelected ? 'is-selected' : ''}
              disabled={isSelected}
              aria-label={isSelected ? `${plan.label || `方案${index + 1}`} 已选择，等待确认` : `选择 ${plan.label || `方案${index + 1}`}`}
              onClick={() => props.onSelectPlanOptions(planIds, [plan.id])}
            >
              <strong>{plan.label || `方案${index + 1}`}</strong>
              <span>{isSelected ? '已选择，等待确认；取消后可回到这里重新选择' : plan.prompt}</span>
            </button>
          })}
          {!!proposedIds.length && <button type="button" className="is-all" onClick={() => props.onSelectPlanOptions(planIds, planIds)}>
            <strong>全部方案</strong>
            <span>为全部 {planIds.length} 个方向分别创建确认卡</span>
          </button>
          }
        </div>
      </section>
    )
  }
  const messageIds = new Set(props.messages.map((message) => message.id))
  const plansByMessage = new Map<string, AgentImagePlan[]>()
  const videoPlansByMessage = new Map<string, AgentVideoPlan[]>()
  const textPlansByMessage = new Map<string, AgentTextPlan[]>()
  props.plans.forEach((plan) => {
    if (!plan.assistantMessageId || !messageIds.has(plan.assistantMessageId)) return
    plansByMessage.set(plan.assistantMessageId, [...(plansByMessage.get(plan.assistantMessageId) ?? []), plan])
  })
  props.videoPlans.forEach((plan) => {
    if (!plan.assistantMessageId || !messageIds.has(plan.assistantMessageId)) return
    videoPlansByMessage.set(plan.assistantMessageId, [...(videoPlansByMessage.get(plan.assistantMessageId) ?? []), plan])
  })
  props.textPlans.forEach((plan) => {
    if (!plan.assistantMessageId || !messageIds.has(plan.assistantMessageId)) return
    textPlansByMessage.set(plan.assistantMessageId, [...(textPlansByMessage.get(plan.assistantMessageId) ?? []), plan])
  })
  const orphanPlans = props.plans.filter((plan) => !plan.assistantMessageId || !messageIds.has(plan.assistantMessageId))
  const orphanVideoPlans = props.videoPlans.filter((plan) => !plan.assistantMessageId || !messageIds.has(plan.assistantMessageId))
  const orphanTextPlans = props.textPlans.filter((plan) => !plan.assistantMessageId || !messageIds.has(plan.assistantMessageId))
  const renderAttachedPlans = (plans: AgentImagePlan[]) => {
    const ready = plans.filter((plan) => plan.status === 'ready')
    const batch = ready.filter((plan) => !legacyStoryboardOperation(plan))
    const showBatch = batch.length > 1 || plans.some(({ id }) => runningImageBatch.includes(id))
    const selected = batch.filter(({ id }) => batchSelection[id] !== false)
    const reviews = selected.map(reviewImagePlan)
    const blocked = reviews.filter(({ plan, model, referenceIssue, outputIntent }) => !model || referenceIssue || outputIntent.blocked || !plan.prompt.trim())
    const expanded = batch.every(({ id }) => expandedImageCards[id])
    const key = plans[0]?.assistantMessageId ?? plans[0]?.id ?? ''
    const updateGroup = (ids: string[], value: boolean, update: typeof setBatchSelection) => {
      update((current) => ({ ...current, ...Object.fromEntries(ids.map((id) => [id, value])) }))
    }
    const busy = runningImageBatch.length > 0
    const batchModelKey = batchModelKeys[key] ?? ''
    const groupRunning = plans.some(({ id }) => runningImageBatch.includes(id))
    const selectedImageCount = selected.reduce((count, plan) => count + (plan.deliverableIndex === undefined ? plan.count : 1), 0)
    return <>
      {renderDirectionChoices(plans)}
      {showBatch && <section className="agent-image-batch" aria-label="批量确认图片">
        <header><strong>批量确认</strong><span>已选 {selected.length} / {batch.length}</span></header>
        <div className="agent-image-batch-controls">
          <button type="button" disabled={busy} onClick={() => updateGroup(batch.map(({ id }) => id), selected.length !== batch.length, setBatchSelection)}>{selected.length === batch.length ? '取消全选' : '全选'}</button>
          <button type="button" onClick={() => updateGroup(batch.map(({ id }) => id), !expanded, setExpandedImageCards)}>{expanded ? '全部折叠' : '全部展开'}</button>
        </div>
        <div className="agent-image-batch-model">
          <AgentSelect variant="floating" className="agent-batch-model-select" ariaLabel="为所选图片选择模型" disabled={busy || !selected.length} value={batchModelKey}
            placeholder="为所选图片选择模型" options={props.imageModels.map((model) => ({ value: model.key, label: model.name, detail: model.connectionName, brand: getModelBrand(model.name) }))} icon={<ImagePlus size={14} />}
            onChange={(value) => setBatchModelKeys((current) => ({ ...current, [key]: value }))} />
          <button type="button" disabled={busy || !batchModelKey || !selected.length} onClick={() => {
            const model = props.imageModels.find(({ key }) => key === batchModelKey)
            if (!model) return
            const [imageConnectionId, imageModelId] = model.key.split('::')
            selected.forEach(({ id }) => props.onPlanChange(id, { imageConnectionId, imageModelId, modelMention: { key: model.key, name: model.name } }))
          }}>应用</button>
        </div>
        {blocked.length > 0 && <small role="status">{blocked.length} 张需先设置模型或检查参数。可展开检查，也可取消勾选。</small>}
        <footer className="agent-image-batch-submit">
          {groupRunning && <button type="button" className="agent-plan-cancel" disabled={stoppingImageBatch} onClick={() => { batchControllerRef.current?.abort(); setStoppingImageBatch(true) }}>{stoppingImageBatch ? '正在停止排队…' : '停止剩余排队'}</button>}
          <button type="button" className="agent-plan-confirm" disabled={busy || !selected.length || blocked.length > 0} onClick={async () => {
          const ids = selected.map(({ id }) => id)
          const controller = new AbortController()
          batchControllerRef.current = controller
          setRunningImageBatch(ids)
          try { await props.onConfirmImageBatch(ids, controller.signal) }
          finally {
            batchControllerRef.current = null
            setRunningImageBatch([])
            setStoppingImageBatch(false)
          }
        }}><Check size={15} aria-hidden="true" /><span>{busy ? '批量处理中…' : `确认所选 ${selectedImageCount} 张`}</span></button>
        </footer>
      </section>}
      {renderResultGroup(plans, 'image')}
      {plans.filter((plan) => !plan.results?.length && plan.status !== 'proposed' && plan.status !== 'ready').map((plan) => renderPlan(plan))}
      {ready.map((plan) => renderPlan(plan, showBatch && batch.includes(plan)))}
    </>
  }
  return (
    <aside ref={panelRef} id="disy-agent-panel" className={`agent-panel ${props.agentOnly ? 'is-agent-only' : ''} ${panelFloating ? 'is-floating' : 'is-docked'} ${floatingInteraction === 'move' ? 'is-dragging' : ''} ${panelResizing ? 'is-resizing' : ''}`} style={{
      '--agent-panel-width': `${panelWidth}px`,
      '--agent-float-x': panelPlacement.position ? `${panelPlacement.position.x}px` : undefined,
      '--agent-float-y': panelPlacement.position ? `${panelPlacement.position.y}px` : undefined,
      '--agent-float-preferred-width': panelPlacement.size ? `${panelPlacement.size.width}px` : undefined,
      '--agent-float-preferred-height': panelPlacement.size ? `${panelPlacement.size.height}px` : undefined,
    } as CSSProperties} aria-label="Disy 对话 Agent">
      {!panelFloating && <div className="agent-panel-resize-handle" role="separator" aria-label="调整 Agent 面板宽度" aria-orientation="vertical" onPointerDown={startPanelResize} onPointerMove={resizePanel} onPointerUp={finishPanelResize} onPointerCancel={finishPanelResize}><span /></div>}
      <header className="agent-panel-header" tabIndex={panelFloating ? 0 : undefined} title={panelFloating ? '拖动标题栏，或聚焦后用方向键移动' : undefined}
        aria-label={panelFloating ? 'Disy Agent 标题栏，使用方向键移动浮窗' : undefined}
        onPointerDown={startPanelDrag} onPointerMove={dragPanel} onPointerUp={finishPanelDrag}
        onPointerCancel={finishPanelDrag} onLostPointerCapture={finishPanelDrag}
        onKeyDown={(event) => {
          if (!panelFloating || event.target !== event.currentTarget) return
          const offset = AGENT_PANEL_ARROW_OFFSETS[event.key]
          const rect = panelRef.current?.getBoundingClientRect()
          if (!offset || !rect) return
          event.preventDefault()
          event.stopPropagation()
          moveFloatingPanel(rect.left + offset.x, rect.top + offset.y)
          saveFloatingGeometry()
        }}>
        <div className="agent-panel-title"><span className="disy-agent-avatar agent-panel-avatar" aria-hidden="true"><img className="agent-panel-logo" src="/disy-logo-ui.png" alt="" /></span><span><span className="agent-title-name-row"><strong>Disy Agent</strong>
          </span><small>{composerMode === 'image' ? '图像创作 · 按所选模型和参数制作' : composerMode === 'video' ? '视频创作 · 按所选模型和参数制作' : '一起找方向，也能直接开始制作'}</small></span>{props.backgroundRunCount > 0 && <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2 py-1 text-[10px] text-cyan-200" title="其他画布中的 Agent 正在后台运行"><LoaderCircle size={11} className="is-spinning" />后台 {props.backgroundRunCount}</span>}</div>
        <div className="agent-panel-header-actions">
          <div className="agent-project-buttons" aria-label="项目工具">
            <button type="button" aria-label="任务中心" title="任务中心" aria-pressed={projectView === 'tasks'} onClick={() => changeProjectView(projectView === 'tasks' ? null : 'tasks')}><ListTodo size={16} /></button>
            <button type="button" aria-label="Agent 使用指南" title="使用指南" aria-pressed={projectView === 'guide'} onClick={() => changeProjectView(projectView === 'guide' ? null : 'guide')}><CircleHelp size={16} /></button>
          </div>
          {props.agentOnly && <button className="agent-panel-api" onClick={props.onOpenApiSettings} title="配置 API"><KeyRound size={16} /><span>API 配置</span></button>}
          {!props.agentOnly && <>
            <button type="button" className="agent-panel-dock-toggle" disabled={Boolean(floatingInteraction)} aria-label={panelFloating ? '贴靠右侧' : '切换为浮窗'} title={panelFloating ? '贴靠右侧' : '切换为浮窗'} onClick={() => savePanelPlacement({ ...panelPlacement, mode: panelFloating ? 'docked' : 'floating' })}>
              {panelFloating ? <PanelRight size={17} aria-hidden="true" /> : <PictureInPicture2 size={17} aria-hidden="true" />}
            </button>
            <button type="button" className="agent-panel-close" onClick={props.onClose} aria-label="关闭 Agent" title="关闭"><X size={17} /></button>
          </>}
        </div>
      </header>
      {projectView ? <div className="agent-conversation-row agent-project-heading">
        <button type="button" onClick={() => changeProjectView(null)} aria-label="返回 Agent 对话"><ArrowLeft size={16} /></button>
        <strong>{{ tasks: '任务中心', guide: '使用指南' }[projectView]}</strong>
      </div> : skillAuthoring ? <div className="agent-conversation-row agent-skill-mode">
        <button type="button" onClick={() => { setSkillAuthoring(false); window.requestAnimationFrame(() => skillButtonRef.current?.focus()) }} aria-label="返回 Agent 对话"><ArrowLeft size={16} /></button>
        <span><strong>Skill 创作</strong><small>新的 Skill</small></span>
      </div> : <div className="agent-conversation-row">
        <AgentSelect
          className="agent-conversation-select"
          variant="conversation"
          ariaLabel="选择 Agent 对话"
          value={props.activeConversationId}
          placeholder="选择对话"
          options={props.conversations.map((conversation) => ({ value: conversation.id, label: conversation.title, detail: conversationDate(conversation.updatedAt) }))}
          icon={<MessageCircle size={14} />}
          onChange={props.onSelectConversation}
        />
        <button type="button" className="agent-new-chat-button" onClick={props.onNewConversation} title="新建对话"><Plus size={15} /></button>
        <button type="button" className="agent-delete-chat-button" onClick={props.onDeleteConversation} title="删除当前对话"><Trash2 size={15} /></button>
      </div>}
      {projectView === 'tasks' && <AgentTasks key={props.projectId} tasks={props.tasks} onStop={props.onStopTask} onOpen={async (task) => {
        const opened = await props.onOpenTask(task)
        if (opened) changeProjectView(null)
        return opened
      }} />}
      {projectView === 'guide' && <AgentProjectGuide open={changeProjectView} onExample={text => {
        changeProjectView(null); setComposerMode('agent'); setComposerMenu(null)
        window.requestAnimationFrame(() => { editorRef.current?.focus(); savedRangeRef.current=null; restoreSelection(); insertPlainTextAtSelection(`${getEditorText() ? '\n' : ''}${text}`); syncReferencesFromEditor() })
      }} />}
      {skillAuthoring && !projectView ? <AgentSkillCreator
        key={props.activeConversationId}
        modelReady={props.textModels.some((model) => model.key === props.textModelKey)}
        request={props.onSkillAuthorReply}
        conversation={props.messages}
        getCanvasContext={props.getSkillCanvasContext}
        onCancel={() => { setSkillAuthoring(false); window.requestAnimationFrame(() => skillButtonRef.current?.focus()) }}
        onAttachSkill={attachSkill}
        onOpenFactory={() => props.onOpenSkillFactory('manage')}
        model={props.textModels.length ? <AgentSelect
          ariaLabel="Skill 创作模型"
          value={props.textModelKey}
          placeholder="选择对话模型"
          options={props.textModels.map((model) => ({ value: model.key, label: model.name }))}
          icon={<MessageCircle size={14} />}
          onChange={props.onTextModelChange}
        /> : <button type="button" className="agent-skill-retry" onClick={props.onOpenApiSettings}><KeyRound size={14} />配置对话模型</button>}
      /> : null}
      <div className="agent-panel-messages-wrap" hidden={skillAuthoring || Boolean(projectView)}>
        <div className="agent-panel-messages" ref={messagesRef}>
          {!props.messages.length && !attachedSkill && <div className="agent-empty"><span><Sparkles size={19} /></span><strong>今天想创造什么？</strong><p>没想法可以一起找方向，需求清楚就直接开始制作。</p></div>}
          {props.messages.map((message) => <Fragment key={message.id}>
            <article className={`agent-message is-${message.role} ${editingMessageId === message.id ? 'is-editing' : ''}`}>
              {Number.isFinite(Date.parse(message.createdAt)) && <time className="agent-message-time" dateTime={message.createdAt} title={new Date(message.createdAt).toLocaleString(getIntlLocale())}>
                {new Date(message.createdAt).toLocaleString(getIntlLocale(), { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}
              </time>}
              {editingMessageId === message.id ? <form className="agent-message-edit" onSubmit={async event => {
                event.preventDefault()
                if (messageEditBusy || props.busy || !editedMessageText.trim() || editedMessageText.trim() === message.content.trim()) return
                setMessageEditBusy(true); setMessageActionError('')
                try { if (await props.onEditMessage?.(message.id, editedMessageText)) setEditingMessageId(null) }
                catch (error) { setMessageActionError(error instanceof Error ? error.message : '修改未能发送，请重试。') }
                finally { setMessageEditBusy(false) }
              }}>
                <textarea ref={messageEditInput} aria-label="编辑已发送的消息" rows={2} value={editedMessageText} disabled={messageEditBusy} onChange={event => setEditedMessageText(event.target.value)}
                  onKeyDown={event => { if (event.key === 'Escape' && !messageEditBusy) { event.preventDefault(); cancelMessageEdit() } if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }}/>
                {messageActionError && <p className="agent-plan-error" role="alert">{messageActionError}</p>}
                <footer><button type="button" disabled={messageEditBusy} onClick={cancelMessageEdit}>取消</button><button type="submit" disabled={messageEditBusy || props.busy || !editedMessageText.trim() || editedMessageText.trim() === message.content.trim()}>{messageEditBusy ? '发送中…' : '发送'}</button></footer>
              </form> : <p className="agent-message-original"><OriginalText>{message.role === 'assistant' ? normalizeAgentMessageContent(message.content) : message.content}</OriginalText></p>}
              {message.role === 'user' && <div className="agent-message-actions">
                <button type="button" aria-label={copiedMessageId === message.id ? '已复制消息' : '复制消息'} title={copiedMessageId === message.id ? '已复制' : '复制'} onClick={async () => {
                  try { await navigator.clipboard.writeText(message.content); setCopiedMessageId(message.id); setMessageActionError('') } catch { setMessageActionMessageId(message.id); setMessageActionError('复制失败，请选择文字后复制。') }
                }}>{copiedMessageId === message.id ? <Check size={13}/> : <Copy size={13}/>}</button>
                {props.onEditMessage && <button type="button" aria-label="编辑消息" title={props.busy ? '请等待回复完成，或先停止当前对话' : '编辑并重新发送'} disabled={props.busy} onClick={event => {
                  messageEditTrigger.current=event.currentTarget; setMessageActionMessageId(message.id); setEditingMessageId(message.id); setEditedMessageText(message.content); setMessageActionError('')
                }}><Pencil size={13}/></button>}
              </div>}
              {messageActionError && !editingMessageId && message.id === messageActionMessageId && <small className="agent-plan-error" role="status">{messageActionError}</small>}
              {message === latestMessage && canRetryLatest && <button type="button" className="agent-draft-action agent-retry-message" disabled={props.busy} onClick={() => props.onRetry(message.id)}><RotateCcw size={13} />重新发送</button>}
              {!!message.references?.length && <div className="agent-message-references">{message.references.map((reference, index) => <button type="button" key={reference.nodeId} onClick={() => props.onLocateCanvasNode(reference.nodeId)} title={`${reference.name} · 定位到画布节点`}>{reference.kind === 'video' ? <VideoReferenceThumbnail reference={reference} name={reference.name} lazy/> : <img src={reference.url} alt="" />}<span>{reference.kind === 'video' ? '视频' : '图'}{index + 1} · {compactReferenceName(reference.name)}{reference.purpose ? ` · ${AGENT_REFERENCE_PURPOSES[reference.purpose]}` : ''}</span><Focus size={12} /></button>)}</div>}
              {(message.turnOptions?.workflow || message.turnOptions?.pace === 'quick' || message.turnOptions?.pace === 'deep' || message.turnOptions?.models?.text) && <p className="agent-turn-meta">{[
                AGENT_WORKFLOWS.find(item => item.value === message.turnOptions?.workflow)?.label,
                message.turnOptions?.pace === 'quick' ? '快速' : message.turnOptions?.pace === 'deep' ? '深度' : '',
                message.turnOptions?.models?.text?.name,
              ].filter(Boolean).join(' · ')}</p>}
              {message.turnOptions?.webReferences?.map((reference) => <AgentWebReferenceCard key={reference.url} reference={reference} onReuse={() => attachWebReference(reference)} onSave={() => props.onSaveWebReference(reference)} />)}
              {message.textNode?.nodeId && <button type="button" className="agent-message-to-canvas" onClick={() => props.onLocateCanvasNode(message.textNode!.nodeId!)}><Focus size={13} />查看整合文本节点</button>}
            </article>
            {message.imageOperation && <AgentImageOperationReview draft={message.imageOperation}
              onApply={(indices) => props.onConfirmImageOperation(message.id, indices)}
              onLocate={props.agentOnly ? undefined : props.onLocateCanvasNode} />}
            {message.canvasEditDraft && !props.agentOnly && <AgentCanvasEditReview draft={message.canvasEditDraft}
              onChange={(update) => props.onCanvasDraftChange(message.id, update)} onSave={() => props.onSaveCanvasDraft(message.id)} onApply={() => props.onConfirmCanvasDraft(message.id)}
              onRevert={() => props.onRevertCanvasDraft(message.id)} onLocate={props.onLocateCanvasNode} />}
            {message.filmPlan && (message.filmPlan.nodeId || message === props.messages.at(-1)) && (() => {
              const plan = message.filmPlan
              const info = plan.nodeId ? undefined : props.getFilmPlanInfo(plan)
              return <section className="agent-plan-card agent-film-card" aria-label="成片方案">
                <strong>{plan.nodeId ? '成片方案 · 已确认' : '成片方案'}</strong>
                <p>{plan.confirmed?.summary ?? info?.summary ?? `${plan.values.duration} 秒 · ${plan.values.ratio}`}</p>
                <details><summary>查看制作内容</summary><p>{plan.subject}</p>{plan.confirmed?.models && <p>{plan.confirmed.models}</p>}</details>
                {info && <>
                  {(['image', 'video'] as const).map((kind) => {
                    const models = kind === 'image' ? info.imageModels : info.videoModels
                    const label = kind === 'image' ? '生图模型' : '视频模型'
                    return <div key={kind} className="agent-image-plan-field"><span>{label}</span><AgentSelect
                      ariaLabel={label} value={(kind === 'image' ? info.imageModelKey : info.videoModelKey) ?? ''} placeholder={models.length ? `选择${label}` : `无可用${label}`} disabled={!models.length || props.busy || props.filmBusy}
                      options={models.map(({ key, name, connectionName }) => ({ value: key, label: name, detail: connectionName, brand: getModelBrand(name) }))} icon={kind === 'image' ? <ImagePlus size={14} /> : <Film size={14} />}
                      onChange={(key) => props.onFilmModelChange(message.id, kind, key)}
                    /></div>
                  })}
                  <p>先生成参考图和关键帧，确认关键帧后再生成视频。</p>
                </>}
                {info?.issue ? <p role="status">{info.issue}</p> : info?.cost && <p>{info.cost}</p>}
                <div className="agent-plan-actions">
                  {plan.nodeId ? <>
                    <button type="button" className="agent-plan-cancel" onClick={() => props.onLocateCanvasNode(plan.nodeId!)}><Focus size={14} />查看画布中的成片任务</button>
                    {props.canResumeFilm(plan.nodeId) && props.filmRun?.nodeId !== plan.nodeId && <button type="button" className="agent-plan-confirm" disabled={props.filmBusy || props.busy} onClick={() => props.onConfirmFilm(message.id)}>继续制作</button>}
                  </>
                    : info?.settings
                    ? <button type="button" className="agent-plan-cancel" onClick={props.onOpenApiSettings}>打开 API 设置</button>
                    : <button type="button" className="agent-plan-confirm" disabled={Boolean(info?.issue) || props.filmBusy || props.busy} onClick={() => props.onConfirmFilm(message.id)}>开始制作</button>}
                </div>
              </section>
            })()}
            {message.directions?.length && <AgentDirections directions={message.directions} disabled={props.busy || message !== latestMessage} onChoose={(direction, action) => {
              submit(action === 'generate' ? `按「${direction.title}」生成。` : `继续细化「${direction.title}」，先不要生成。`, { messageId: message.id, directionId: direction.id, action })
            }}/>}
            {renderAttachedPlans(plansByMessage.get(message.id) ?? [])}
            {renderResultGroup(videoPlansByMessage.get(message.id) ?? [], 'video')}
            {(videoPlansByMessage.get(message.id) ?? []).filter(plan => !plan.results?.length).map(renderVideoPlan)}
            {(textPlansByMessage.get(message.id) ?? []).map(renderTextPlan)}
          </Fragment>)}
          {props.busy && <div className="agent-thinking"><LoaderCircle size={14} className="is-spinning" /><span>正在理解你的创作目标...</span></div>}
          {renderAttachedPlans(orphanPlans)}
          {renderResultGroup(orphanVideoPlans, 'video')}
          {orphanVideoPlans.filter(plan => !plan.results?.length).map(renderVideoPlan)}
          {orphanTextPlans.map(renderTextPlan)}
          {props.filmReview && <AgentFilmReview key={props.filmReview.id} stage={props.filmReview.stage} onAnswer={props.filmReview.answer} />}
          {props.filmRun && <div className="agent-film-progress" role="status">
            <span>{props.filmReview ? '等你确认后继续' : props.filmRun.label}</span>
            {props.filmRun.mediaNodeId && <button type="button" className="agent-plan-cancel" onClick={() => props.onLocateCanvasNode(props.filmRun!.mediaNodeId!)}>定位当前节点</button>}
            <button type="button" className="agent-plan-cancel" onClick={props.onStopFilm}>停止制作</button>
          </div>}
        </div>
      </div>
      <div className="agent-panel-composer" hidden={skillAuthoring || Boolean(projectView)}>
        <div
          className={`agent-composer-box reference-drop-zone ${composerMode !== 'agent' ? 'is-media-mode' : ''} ${referenceDropActive ? 'is-drop-active' : ''} `}
          onDragEnter={(event) => {
            if (!Array.from(event.dataTransfer.items).some((item) => item.kind === 'file')) return
            event.preventDefault()
            event.stopPropagation()
            setReferenceDropActive(true)
          }}
          onDragOver={(event) => {
            if (!Array.from(event.dataTransfer.items).some((item) => item.kind === 'file')) return
            event.preventDefault()
            event.stopPropagation()
            event.dataTransfer.dropEffect = 'copy'
            setReferenceDropActive(true)
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setReferenceDropActive(false)
          }}
          onDrop={(event) => {
            event.preventDefault()
            event.stopPropagation()
            setReferenceDropActive(false)
            const files = Array.from(event.dataTransfer.files)
            if (files.length) void uploadReferences(files)
          }}
        >
          <span className="reference-drop-hint"><ImageUp size={15} />{acceptsVideoReference ? '松开以添加图片或视频参考' : '松开以添加参考图'}</span>
          {composerMode === 'agent' && !attachedSkill && !guidedMessage && <div className="agent-workflow-control">
            <div className="agent-action-hint"><AgentSelect className="agent-workflow-select" variant="floating" appearance="composer" minMenuWidth={272}
              ariaLabel="Agent 工作方式" value={workflow} placeholder="智能模式" icon={<BrainCircuit size={16}/>} options={AGENT_WORKFLOWS.map(item => ({...item,icon:item.value === 'smart' ? <BrainCircuit size={16}/> : item.value === 'collaborate' ? <MessagesSquare size={16}/> : <Zap size={16}/>,label:item.value === 'smart' ? '智能模式' : item.value === 'collaborate' ? '协作模式' : item.label}))}
              onChange={value => { const next=value as AgentWorkflow; setWorkflow(next); try { localStorage.setItem('disy-agent-workflow',next) } catch {} }} />
              <span className="agent-action-tooltip" role="tooltip">{AGENT_WORKFLOWS.find(item => item.value === workflow)?.label} · {AGENT_WORKFLOWS.find(item => item.value === workflow)?.detail}</span></div>
          </div>}
          {attachedSkill && <div className="agent-skill-attachment">
            <Wrench size={13} /><span title={attachedSkill.name}>{attachedSkill.name}</span>
            <button type="button" aria-label={`移除 Skill ${attachedSkill.name}`} onClick={() => { props.onRemoveSkill(); editorRef.current?.focus() }}><X size={13} /></button>
          </div>}
          <AnimatePresence initial={false} mode="wait">{webInputUrl !== undefined && <AgentWebReferenceInput key={`${props.activeConversationId}:${webInputVersion.current}`} initialUrl={webInputUrl}
            onRead={(url, signal, pastedText) => props.onReadWebReference(url, props.textModelKey, signal, pastedText)}
            onAttach={attachWebReference} onClose={() => { setWebInputUrl(undefined); editorRef.current?.focus() }} />}</AnimatePresence>
          {!!webReferences.length && <AgentWebDisclosure className="agent-web-drafts" label={`已引用 ${webReferences.length} 个网页`} open={webDraftOpen} onToggle={() => setWebDraftOpen((open) => !open)}>
            <div className="agent-web-draft-list">{webReferences.map((reference) => <AgentWebReferenceCard key={reference.url} reference={reference}
              onRemove={() => setWebReferences((current) => current.filter(({ url }) => url !== reference.url))}
              onSave={() => props.onSaveWebReference(reference)} />)}</div>
          </AgentWebDisclosure>}
          {(turnStyles.length > 0 || turnTextNodes.length > 0) && <div className="agent-turn-mentions" aria-label="本轮指定资源">
            {turnStyles.map(({ id, name }) => <button type="button" key={`style:${id}`} aria-label={`移除风格预设 ${name}`} onClick={() => setTurnStyles((current) => current.filter((item) => item.id !== id))}>风格 · {name}<X size={13} aria-hidden="true" /></button>)}
            {turnTextNodes.map(({ id, name }) => <button type="button" key={`text:${id}`} aria-label={`移除画布文本 ${name}`} onClick={() => setTurnTextNodes((current) => current.filter((item) => item.id !== id))}>文本 · {name}<X size={13} aria-hidden="true" /></button>)}
          </div>}
          {guidedMessage?.questions && <>
            <AgentQuestions key={guidedMessage.id} questions={guidedMessage.questions} onSubmit={submit} />
            <button type="button" className="agent-free-reply" onClick={() => {
              setFreeReplyMessageId(guidedMessage.id)
              window.requestAnimationFrame(() => editorRef.current?.focus())
            }}>在对话里回复</button>
          </>}
          {!guidedMessage && <button
            type="button"
            className="agent-composer-resize"
            aria-label="调整输入框高度"
            title="上下拖动调整输入框高度"
            onPointerDown={(event) => {
              if (event.button !== 0 || !editorRef.current) return
              event.preventDefault()
              editorResize.current = { y: event.clientY, height: editorRef.current.offsetHeight }
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={(event) => {
              const drag = editorResize.current
              if (drag) resizeEditor(drag.height + drag.y - event.clientY)
            }}
            onLostPointerCapture={() => { editorResize.current = null }}
            onDoubleClick={() => setEditorHeight(undefined)}
            onKeyDown={(event) => {
              if (!['ArrowUp', 'ArrowDown', 'Home'].includes(event.key) || !editorRef.current) return
              event.preventDefault()
              if (event.key === 'Home') setEditorHeight(undefined)
              else resizeEditor(editorRef.current.offsetHeight + (event.key === 'ArrowUp' ? 20 : -20))
            }}
          ><span aria-hidden="true" /></button>}
          {composerMode === 'video' && !attachedSkill && videoWorkflow === 'edit' && <div className="agent-video-source-guide" role="status"><Film size={13}/><span>{inputVideos === 1 ? `原视频：${props.references.find(reference => reference.kind === 'video')?.name}${inputImages ? ` · ${inputImages} 张辅助图` : ''}` : '添加 1 段待编辑原视频；图片只作为辅助参考'}</span></div>}
          <div
            className={`agent-composer-input ${guidedMessage ? 'is-guided' : ''}`}
            style={!guidedMessage && editorHeight !== undefined ? { height: editorHeight, maxHeight: '56cqh' } : undefined}
            ref={editorRef}
            contentEditable
            role="textbox"
            aria-multiline="true"
            aria-controls={mentionOpen ? mentionMenuId : undefined}
            aria-activedescendant={mentionOpen && mentionCandidates[mentionIndex] ? `${mentionMenuId}-${mentionIndex}` : undefined}
            aria-label={guidedMessage ? '补充素材或说明' : '对话输入'}
            tabIndex={guidedMessage && !props.references.length && !draftInvocationText ? -1 : undefined}
            aria-placeholder={guidedMessage ? undefined : composerMode === 'image' ? '描述你想生成或编辑的图像…' : composerMode === 'video' ? '描述画面、动作和视频创意…' : composerHint}
            data-placeholder={guidedMessage ? undefined : composerMode === 'image' ? '描述你想生成或编辑的图像…' : composerMode === 'video' ? '描述画面、动作和视频创意…' : composerHint}
            onInput={() => {
              rememberSelection()
              updateMentionTrigger()
              syncReferencesFromEditor()
            }}
            onPaste={(event) => {
              event.preventDefault()
              const plainText = event.clipboardData.getData('text/plain')
              insertPlainTextAtSelection(plainText)
              updateMentionTrigger()
              syncReferencesFromEditor()
            }}
            onKeyUp={rememberSelection}
            onMouseUp={rememberSelection}
            onBlur={() => {
              rememberSelection()
              setMentionOpen(false)
            }}
            onClick={(event) => {
              const target = event.target
              if (target instanceof HTMLButtonElement) {
                target.closest('.agent-inline-reference')?.remove()
                syncReferencesFromEditor()
              }
            }}
            onKeyDown={(event) => {
              if (mentionOpen && !event.nativeEvent.isComposing) {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setMentionOpen(false)
                  return
                }
                if (mentionCandidates.length && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(event.key) && !event.shiftKey) {
                  event.preventDefault()
                  if (event.key === 'Enter' || event.key === 'Tab') mentionCandidates[mentionIndex]?.choose()
                  else setMentionIndex((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + mentionCandidates.length) % mentionCandidates.length)
                  return
                }
              }
              if (event.key === 'Backspace' && !event.nativeEvent.isComposing && removeReferenceBeforeCaret()) {
                event.preventDefault()
                return
              }
              if (event.key === 'Delete' && (hasReferenceAfterCaret() || selectionTouchesReference())) {
                event.preventDefault()
                return
              }
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                if (!guidedMessage) submit()
              }
            }}
          />
          <AnimatePresence>{mentionOpen && <motion.div className="agent-mention-menu" id={mentionMenuId} role="listbox" aria-label="可引用资源"
            initial={reduceMenuMotion ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 5, pointerEvents: 'none' }}
            transition={{ duration: reduceMenuMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}>
            {mentionCandidates.map((item, index) => <button type="button" key={item.key} id={`${mentionMenuId}-${index}`} role="option" aria-selected={index === mentionIndex}
              tabIndex={-1} onMouseDown={(event) => event.preventDefault()} onClick={item.choose}>
              {item.preview ? <img src={item.preview} alt="" /> : <span className="agent-mention-icon">{item.kind === '画布视频' ? <Film size={15} /> : item.kind === '画布文本' ? <FileText size={15} /> : <Sparkles size={15} />}</span>}
              <span><strong>{item.name}</strong><small>{item.kind}{'detail' in item && item.detail ? ` · ${item.detail}` : ''}</small></span>
            </button>)}
            {!mentionCandidates.length && <p role="status">没有匹配的引用</p>}
          </motion.div>}</AnimatePresence>
          {!attachedSkill && draftOutputIntent?.message && <p className={`image-output-hint agent-image-output-hint ${draftOutputIntent.blocked ? 'is-unsupported' : ''}`} role="status">{draftOutputIntent.message}</p>}
          {promptError && <p className="agent-draft-error" role="status">{promptError}</p>}
          <AnimatePresence initial={false}>{parameterHelpOpen && !mediaModel && composerMode !== 'agent' && <motion.p className="agent-parameter-help" role="status"
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: reduceMenuMotion ? 0 : .18 }}>
            <CircleHelp size={14} aria-hidden="true"/><span>{parameterLockReason}</span>
          </motion.p>}</AnimatePresence>
          <AnimatePresence initial={false}>{optimizingPrompt && <motion.p className="agent-draft-status" role="status"
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: reduceMenuMotion ? 0 : .18 }}>正在优化提示词，原稿已保留。</motion.p>}</AnimatePresence>
          <footer className="agent-composer-footer">
            <div className="agent-composer-toolbar" ref={composerMenuRef}>
              <button type="button" className="agent-composer-add" aria-label="添加素材与工具" aria-expanded={composerMenu === 'add'} onClick={() => setComposerMenu(composerMenu === 'add' ? null : 'add')}><Plus size={20} /></button>
              <AgentSelect className="agent-mode-select" variant="floating" appearance="composer" minMenuWidth={216} ariaLabel="创作模式" value={composerMode} placeholder="Agent" icon={composerMode === 'image' ? <ImagePlus size={16} /> : composerMode === 'video' ? <Film size={16} /> : <MessageCircle size={16} />} options={[{ value: 'agent', label: 'Agent', detail: '对话、规划与自动创作' }, { value: 'image', label: '图像', detail: '生成或编辑图片' }, { value: 'video', label: '视频', detail: '选择模型与参数，规划视频' }]} onChange={(value) => { setComposerMode(value); if (value !== 'agent' && attachedSkill) props.onRemoveSkill(); setPromptError(''); setComposerMenu(null) }} />
              {composerMode !== 'agent' && <>
              <span className={`agent-parameter-control agent-action-hint ${!mediaModel ? 'is-locked' : ''} ${parameterHelpOpen ? 'is-explained' : ''}`} tabIndex={!mediaModel ? 0 : -1}
                aria-label={!mediaModel ? '参数待解锁' : undefined} aria-describedby={!mediaModel ? `${mentionMenuId}-parameter-help` : undefined}
                onClick={() => { if (!mediaModel) setParameterHelpOpen(true) }}
                onKeyDown={event => { if (!mediaModel && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setParameterHelpOpen(true) } }}>
                <motion.button ref={parameterTriggerRef} type="button" className={`agent-parameter-summary ${composerMenu === 'parameters' && mediaModel ? 'is-open' : ''}`} disabled={!mediaModel}
                  aria-label="生成参数" aria-expanded={Boolean(composerMenu === 'parameters' && mediaModel)} aria-describedby={!mediaModel ? `${mentionMenuId}-parameter-help` : undefined}
                  title={mediaModel ? `调整生成参数 · ${parameterSummary}` : parameterLockReason} whileHover={reduceMenuMotion || !mediaModel ? undefined : { y: -1 }} whileTap={reduceMenuMotion || !mediaModel ? undefined : { scale: .97 }}
                  onClick={() => { if (mediaModel) setComposerMenu(composerMenu === 'parameters' ? null : 'parameters') }}>
                  {!mediaModel && <LockKeyhole size={12} aria-hidden="true"/>}<span>{mediaModel ? parameterSummary : '参数待解锁'}</span>
                  {mediaModel && <motion.span className="agent-parameter-chevron" animate={{ rotate: composerMenu === 'parameters' ? 180 : 0 }} transition={{ duration: reduceMenuMotion ? 0 : .18 }}><ChevronDown size={12}/></motion.span>}
                </motion.button>
                {!mediaModel && <span id={`${mentionMenuId}-parameter-help`} className="agent-action-tooltip" role="tooltip">{parameterLockReason}</span>}
              </span>
              <AnimatePresence initial={false}>{composerMenu === 'parameters' && composerMode !== 'agent' && mediaModel && <AgentGenerationParameters
                key={mediaKind} kind={mediaKind} modelName={mediaModel.name} options={parameterOptions} value={generationSettings} onChange={patchGenerationSettings} inputIssue={videoInputIssue}
                onClose={() => { setComposerMenu(null); parameterTriggerRef.current?.focus() }} />}</AnimatePresence>

              </>}
              {composerMenu === 'add' && <div className="agent-composer-popover agent-add-menu">
                {!!draftInvocationText && <button type="button" className="agent-compact-prompt-action" disabled={optimizingPrompt || props.busy} onClick={() => { setComposerMenu(null); if (!props.textModelKey) props.onOpenApiSettings(); else void optimizePrompt() }}><WandSparkles size={16}/>{optimizingPrompt ? '正在优化提示词…' : '优化提示词'}</button>}
                {promptBackups.at(-1)?.conversationId === props.activeConversationId && <button type="button" className="agent-compact-prompt-action" disabled={optimizingPrompt} onClick={() => { undoPromptOptimization(); setComposerMenu(null) }}><RotateCcw size={16}/>撤回提示词优化</button>}
                <button type="button" onClick={() => { uploadInputRef.current?.click(); setComposerMenu(null) }}><ImageUp size={16} />上传素材</button>
                {!props.agentOnly && <button type="button" onClick={() => { props.onPickFromCanvas(acceptsVideoReference ? 'video' : 'image', acceptsVideoReference ? 'omni' : undefined); setComposerMenu(null) }}><MousePointer2 size={16} />从画布选择</button>}
                <button type="button" onClick={() => { setWebInputUrl(getInvocationText().match(/https?:\/\/[^\s<>"，。；！？）】]+/gi)?.[0] ?? ''); webInputVersion.current += 1; setComposerMenu(null) }}><Link2 size={16} />网页参考</button>
                <button ref={skillButtonRef} type="button" onClick={() => { setSkillMenuOpen(true); setComposerMenu(null) }}><FilePlus2 size={16} />添加 Skill</button>
              </div>}
              {composerMode === 'agent' && <>
              <button type="button" className={`agent-preferences-button ${props.imageModelKey || props.videoModelKey ? 'has-preference' : ''}`} aria-label="模型偏好" title="模型偏好" aria-expanded={composerMenu === 'models'} onClick={() => { setPreferenceTab('image'); setComposerMenu(composerMenu === 'models' ? null : 'models') }}><Box size={19} />{composerMode !== 'agent' && <span>{(composerMode === 'image' ? props.imageModels.find(m => m.key === props.imageModelKey) : props.videoModels.find(m => m.key === props.videoModelKey))?.name ?? (automaticModels ? '自动选择' : '选择模型')}</span>}</button>
              {composerMenu === 'models' && <section className="agent-composer-popover agent-preferences" aria-label="模型偏好设置">
                <header><strong>模型偏好</strong><button type="button" onClick={() => setComposerMenu(null)} aria-label="关闭模型偏好"><X size={16} /></button></header>
                <label className="agent-preferences-auto"><span>自动选择生成模型</span><input type="checkbox" role="switch" checked={automaticModels} onChange={(event) => {
                  const automatic = event.target.checked
                  setAutomaticModels(automatic)
                  props.onImageModelChange(automatic ? '' : props.imageModelKey || props.imageModels[0]?.key || '')
                  props.onVideoModelChange(automatic ? '' : props.videoModelKey || props.videoModels[0]?.key || '')
                }} /></label>
                <label className="agent-preferences-label">对话模型</label>
                <AgentSelect variant="floating" minMenuWidth={245} ariaLabel="对话模型" value={props.textModelKey} placeholder="选择对话模型" options={props.textModels.map(model => ({ value: model.key, label: model.name, brand: getModelBrand(model.name) }))} icon={<MessageCircle size={14} />} onChange={props.onTextModelChange} />
                {composerMode === 'agent' ? <div className="agent-preferences-tabs" role="tablist" aria-label="生成模型类型">{['image', 'video'].map(tab => <button type="button" role="tab" aria-selected={preferenceTab === tab} key={tab} onClick={() => setPreferenceTab(tab)}>{tab === 'image' ? '图像' : '视频'}</button>)}</div> : <span className="agent-preferences-label">{composerMode === 'image' ? '图像模型' : '视频模型'}</span>}
                {automaticModels ? <div className="agent-preferences-automatic"><Sparkles size={16} /><span>Agent 自动选择{preferenceTab === 'image' ? '图像' : '视频'}模型</span></div> : <AgentSelect variant="floating" minMenuWidth={245} ariaLabel="生成模型偏好" value={preferenceTab === 'image' ? props.imageModelKey : props.videoModelKey} placeholder={(preferenceTab === 'image' ? props.imageModels : props.videoModels).length ? '请选择具体模型' : '暂无可用模型，请先配置'} disabled={!(preferenceTab === 'image' ? props.imageModels : props.videoModels).length} options={(preferenceTab === 'image' ? props.imageModels : props.videoModels).map(model => ({ value: model.key, label: model.name, detail: model.connectionName, brand: getModelBrand(model.name) }))} icon={<Sparkles size={14} />} onChange={preferenceTab === 'image' ? props.onImageModelChange : props.onVideoModelChange} />}
                <p>{automaticModels ? '由 Agent 根据任务选择模型，可在生成确认卡中调整。' : '使用你指定的模型，生成确认卡中不再切换模型。'}</p>
              </section>}
              </>}
              <input ref={uploadInputRef} className="agent-reference-upload-input" type="file" accept={acceptsVideoReference ? 'image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime' : 'image/png,image/jpeg,image/webp'} multiple aria-label="上传 Agent 参考素材" onChange={(event) => { const files = Array.from(event.target.files ?? []); if (files.length) void uploadReferences(files); event.target.value = '' }} />
            </div>
            <div className="agent-composer-actions" ref={mediaControlsRef}>
              {composerMode !== 'agent' && <>
              {mediaModels.length ? <AgentSelect className="agent-composer-model" variant="floating" appearance="composer" menuAlign="end" minMenuWidth={280}
                ariaLabel={mediaKind === 'image' ? '生图模型' : '视频模型'}
                value={mediaModel?.key ?? ''}
                placeholder={mediaKind === 'image' ? '选择生图模型' : '选择视频模型'}
                options={mediaModels.map(model => ({ value: model.key, label: model.name, detail: model.connectionName, brand: getModelBrand(model.name) }))}
                icon={mediaKind === 'image' ? <ImagePlus size={14}/> : <Film size={14}/>}
                onChange={(key) => { (mediaKind === 'image' ? setManualImageModelKey : setManualVideoModelKey)(key); setPromptError('') }} />
                : <button type="button" className="agent-configure-model" onClick={props.onOpenApiSettings}
                  title={`配置 API 并启用${mediaKind === 'image' ? '图像' : '视频'}模型`}><SlidersHorizontal size={14}/>配置模型</button>}
              </>}
              {promptBackups.at(-1)?.conversationId === props.activeConversationId && <span className="agent-action-hint" tabIndex={optimizingPrompt ? 0 : -1}><motion.button type="button" className="agent-draft-action agent-undo-button" aria-label="撤回提示词优化" aria-describedby={`${mentionMenuId}-undo-help`} disabled={optimizingPrompt} onClick={undoPromptOptimization} whileTap={reduceMenuMotion ? undefined : { scale: .94 }}><RotateCcw size={14}/><span>撤回</span></motion.button><span id={`${mentionMenuId}-undo-help`} className="agent-action-tooltip" role="tooltip">{undoHint}</span></span>}
              {!!draftInvocationText && <span className="agent-action-hint" tabIndex={optimizingPrompt || props.busy ? 0 : -1}><motion.button type="button" className={`agent-draft-action agent-optimize-button ${optimizingPrompt ? 'is-loading' : ''}`} aria-label={optimizingPrompt ? '正在优化提示词' : '优化提示词'} aria-busy={optimizingPrompt} aria-describedby={`${mentionMenuId}-optimize-help`} disabled={optimizingPrompt || props.busy}
                whileHover={reduceMenuMotion || optimizingPrompt || props.busy ? undefined : { y: -1 }} whileTap={reduceMenuMotion ? undefined : { scale: .94 }} transition={{ type: 'spring', stiffness: 460, damping: 30 }} onClick={() => {
                  if (!props.textModelKey) { props.onOpenApiSettings(); return }
                  void optimizePrompt()
                }}>{optimizingPrompt ? <LoaderCircle size={14} className="is-spinning"/> : <WandSparkles size={14}/>}<span>{optimizingPrompt ? '优化中' : '优化'}</span></motion.button><span id={`${mentionMenuId}-optimize-help`} className="agent-action-tooltip" role="tooltip">{optimizeHint}</span></span>}
              {props.busy && <button type="button" className="agent-stop-button" onClick={props.onStop} title="中止本次对话" aria-label="中止本次对话"><X size={16} /></button>}
              {!guidedMessage && <span className={`agent-send-control ${videoInputIssue ? 'is-blocked' : ''}`} tabIndex={videoInputIssue ? 0 : -1} aria-describedby={videoInputIssue ? `${mentionMenuId}-send-help` : undefined}>
                <button type="button" className="agent-send-button" disabled={Boolean(videoInputIssue)} aria-describedby={videoInputIssue ? `${mentionMenuId}-send-help` : undefined} onClick={() => submit()} title={videoInputIssue ?? (props.busy ? '发送并调整方向' : '发送')} aria-label={props.busy ? '发送并调整方向' : '发送'}><ArrowUp size={17} /></button>
                {videoInputIssue && <span className="agent-send-requirement" id={`${mentionMenuId}-send-help`} role="tooltip">{videoInputIssue}</span>}
              </span>}
            </div>
          </footer>
          <AnimatePresence>{skillMenuOpen && <AgentSkillMenu id={skillMenuId} menuRef={skillMenuRef} activeSkill={attachedSkill}
            onAttach={attachSkill}
            onCreate={() => { setSkillMenuOpen(false); setSkillAuthoring(true) }}
            onOpenFactory={(view, skillSlug) => { setSkillMenuOpen(false); skillButtonRef.current?.focus(); props.onOpenSkillFactory(view, skillSlug) }}
            onDismiss={() => { setSkillMenuOpen(false); skillButtonRef.current?.focus() }}
          />}</AnimatePresence>
        </div>
      </div>
      {panelFloating && AGENT_PANEL_FLOAT_HANDLES.map((edge) => (
        <div key={edge} className="agent-float-resize-handle" data-edge={edge}
          role={edge === 'se' ? 'group' : undefined} tabIndex={edge === 'se' ? 0 : undefined}
          aria-hidden={edge !== 'se' ? true : undefined}
          aria-label={edge === 'se' ? '调整 Agent 浮窗大小，使用方向键' : undefined}
          onPointerDown={(event) => startPanelDrag(event, edge)} onPointerMove={dragPanel}
          onPointerUp={finishPanelDrag} onPointerCancel={finishPanelDrag} onLostPointerCapture={finishPanelDrag}
          onKeyDown={edge === 'se' ? (event) => {
            const offset = AGENT_PANEL_ARROW_OFFSETS[event.key]
            const panel = panelRef.current
            if (!offset || !panel) return
            event.preventDefault()
            event.stopPropagation()
            const rect = resizeAgentFloatingRect(panel.getBoundingClientRect(), offset, edge, getAgentFloatingBounds(panel))
            moveFloatingPanel(rect.x, rect.y, rect)
            saveFloatingGeometry(true)
          } : undefined}
        />
      ))}
    </aside>
  )
}
