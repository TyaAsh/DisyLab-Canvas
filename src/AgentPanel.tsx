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
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowUp, Brain, Check, CircleHelp, Download, FilePlus2, FileText, Film, Focus, ImagePlus, ImageUp, KeyRound, ListTodo, LoaderCircle, Maximize2, MessageCircle, MousePointer2, PanelRight, PictureInPicture2, Plus, SlidersHorizontal, Sparkles, Trash2, UsersRound, Wrench, X } from 'lucide-react'
import { compactReferenceName, normalizeAgentMessageContent, reconcileAgentImagePlanSpecs, type AgentContextReference, type AgentImagePlan, type AgentImageReference, type AgentMessage, type AgentTextPlan, type AgentVideoPlan } from './agent'
import { resolveImageModelOptions, type ImageOutput, type ImageGenerationOptions } from './imageApi'
import { imageOutputIntent } from './imageOutputIntent'
import { AgentSkillCreator } from './skill-ui/AgentSkillCreator'
import { AgentSkillMenu } from './skill-ui/AgentSkillMenu'
import { AgentFilmReview } from './skill-ui/AgentFilmReview'
import { AgentQuestions } from './skill-ui/AgentQuestions'
import { AgentCanvasEditReview } from './skill-ui/AgentCanvasEditReview'
import { AgentSelect, getModelBrand, type SelectOption } from './skill-ui/AgentSelect'
import { AgentMemory, AgentProjectGuide, AgentTasks, AgentTeam, type AgentProjectView } from './skill-ui/AgentProjectPane'
import { activeAgentTeamRoles, getAgentTeamTemplate, PROJECT_MEMORY_LENGTH, type AgentProjectSettings, type AgentTask } from './agentProject'
import type { AgentCanvasEditDraft } from './agentCanvasEdits'
import { skillOpening } from './skills/conversation'
import type { FilmReview, FilmReviewAnswer } from './skills/filmProduction'
import type { SkillManifest } from './skills/types'

export type AgentModelOption = {
  key: string; name: string; connectionName: string; outputs?: readonly ImageOutput[]
  imageParameters?: { baseUrl: string; modelId: string; ratios: SelectOption[]; resolutions: SelectOption[]; qualities: SelectOption[] }
}
export type AgentConversationOption = { id: string; title: string; updatedAt: string }

function conversationDate(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return undefined
  return date.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
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
  projectId: string
  projectSettings: AgentProjectSettings
  onSaveProjectSettings: (update: (settings: AgentProjectSettings) => AgentProjectSettings) => Promise<void>
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
  conversations: AgentConversationOption[]
  activeConversationId: string
  skillSelection?: { id: string; skill: SkillManifest }
  skillDraft: string
  onSkillDraftConsumed: () => void
  startSkillAuthoring: boolean
  onSkillAuthoringStarted: () => void
  onAttachSkill: (skill: SkillManifest) => void
  onRemoveSkill: () => void
  filmRun: { nodeId: string; label: string } | null
  filmReview: { id: string; stage: FilmReview; answer: (value: FilmReviewAnswer) => void } | null
  filmBusy: boolean
  onStopFilm: () => void
  getFilmPlanInfo: (plan: NonNullable<AgentMessage['filmPlan']>) => { summary?: string; models?: string; cost?: string; issue?: string; settings?: boolean }
  onConfirmFilm: (messageId: string) => void
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
  imageDefaults: { aspectRatio: string; resolution: string; detail: string; count: number }
  videoDefaults: { aspectRatio: string; resolution: string; duration: number; count: number }
  busy: boolean
  backgroundRunCount: number
  agentOnly: boolean
  onStop: () => void
  onClose: () => void
  onOpenApiSettings: () => void
  onOpenSkillFactory: (view: 'browse' | 'manage', skillSlug?: string) => void
  getSkillCanvasContext?: () => string
  onSkillAuthorReply: (prompt: string, signal: AbortSignal) => Promise<string>
  onDownloadImage: (url: string, fileName: string) => void
  onNewConversation: () => void
  onDeleteConversation: () => void
  onSelectConversation: (id: string) => void
  onTextModelChange: (key: string) => void
  onImageModelChange: (key: string) => void
  onVideoModelChange: (key: string) => void
  onImageDefaultsChange: (patch: Partial<{ aspectRatio: string; resolution: string; detail: string; count: number }>) => void
  onVideoDefaultsChange: (patch: Partial<{ aspectRatio: string; resolution: string; duration: number; count: number }>) => void
  onReferencesChange: (references: AgentImageReference[]) => void
  onCreateUploadedReference: (reference: Omit<AgentImageReference, 'nodeId'>) => AgentImageReference
  onUploadNotice: (message: string) => void
  onPendingReferenceConsumed: () => void
  onPickFromCanvas: (mediaKind?: 'image' | 'video', videoGenerationMode?: 'text' | 'image' | 'frames' | 'reference' | 'omni') => void
  onSend: (message: string, invocationText: string, references: AgentImageReference[], videoGenerationMode?: 'text' | 'image' | 'frames' | 'reference' | 'omni', team?: boolean) => void
  onPlanChange: (id: string, patch: Partial<Pick<AgentImagePlan, 'prompt' | 'aspectRatio' | 'resolution' | 'detail' | 'count' | 'imageConnectionId' | 'imageModelId'>>) => void
  onSelectPlanOptions: (groupPlanIds: string[], selectedPlanIds: string[]) => void
  onConfirmPlan: (id: string) => void
  getImagePlanCostLabel?: (plan: AgentImagePlan) => string | null
  onCancelPlan: (id: string) => void
  onRemovePlanContextReference: (planId: string, nodeId: string) => void
  onVideoPlanChange: (id: string, patch: Partial<Pick<AgentVideoPlan, 'prompt' | 'aspectRatio' | 'resolution' | 'duration' | 'count' | 'videoConnectionId' | 'videoModelId'>>) => void
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
  const [projectView, setProjectView] = useState<AgentProjectView | null>(null)
  const [memorySeed, setMemorySeed] = useState<{ id: string; content: string }>()
  const [teamConversations, setTeamConversations] = useState<Set<string>>(() => new Set())
  const teamEnabled = teamConversations.has(props.activeConversationId)
  const changeProjectView = (view: AgentProjectView | null) => {
    setMemorySeed(undefined)
    setProjectView(view)
    props.onTaskCenterOpen(view === 'tasks')
  }
  const [skillMenuOpen, setSkillMenuOpen] = useState(false)
  const [skillAuthoring, setSkillAuthoring] = useState(false)
  const attachedSkill = props.skillSelection?.skill ?? null
  const composerHint = attachedSkill ? skillOpening(attachedSkill) : '和 Disy 对话，或选中画布文本，请 Disy 帮你修改'
  const latestMessage = props.messages.at(-1)
  const guidedMessage = !props.busy && !skillAuthoring && latestMessage?.role === 'assistant'
    && latestMessage.skillUseId === props.skillSelection?.id && latestMessage.questions?.length ? latestMessage : undefined
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
  const [draftInvocationText, setDraftInvocationText] = useState('')
  const [activeReadyPlanId, setActiveReadyPlanId] = useState<string | null>(null)
  const [imageSettingsOpen, setImageSettingsOpen] = useState(false)
  const [customAspectRatioOpen, setCustomAspectRatioOpen] = useState(false)
  const [customAspectWidth, setCustomAspectWidth] = useState('1')
  const [customAspectHeight, setCustomAspectHeight] = useState('1')
  const [mediaKind, setMediaKind] = useState<'choose' | 'image' | 'video'>('choose')
  const [imageModelChosen, setImageModelChosen] = useState(false)
  const [videoSettingsOpen, setVideoSettingsOpen] = useState(false)
  const [videoModelChosen, setVideoModelChosen] = useState(false)
  const [videoGenerationMode, setVideoGenerationMode] = useState<'text' | 'image' | 'frames' | 'reference' | 'omni'>('text')
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
  const [previewResult, setPreviewResult] = useState<{ url: string; fileName: string } | null>(null)
  const previewCloseRef = useRef<HTMLButtonElement>(null)
  const previewDialogRef = useRef<HTMLDivElement>(null)
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const messagesRef = useRef<HTMLDivElement>(null)
  const pinnedToBottomRef = useRef(true)
  const savedRangeRef = useRef<Range | null>(null)
  const referenceRegistryRef = useRef(new Map<string, AgentImageReference>())
  const readyPlanIdsRef = useRef<string[]>([])
  const resizeStartRef = useRef({ pointerX: 0, width: AGENT_PANEL_DEFAULT_WIDTH })
  const readyPlans = props.plans.filter((plan) => plan.status === 'ready')
  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null
      if (!target) return
      if (!target.closest('.agent-image-settings-button,.agent-image-parameter-popover')) {
        setImageSettingsOpen(false)
        setVideoSettingsOpen(false)
      }
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [])
  const activeReadyPlan = readyPlans.find((plan) => plan.id === activeReadyPlanId) ?? readyPlans[readyPlans.length - 1]
  const imageSettingLabel = (options: SelectOption[], value: string) => options.find((option) => option.value === value)?.label ?? value
  const draftImageModel = mediaKind === 'image' && imageModelChosen ? props.imageModels.find((model) => model.key === props.imageModelKey) : undefined
  const draftOutputIntent = draftImageModel ? imageOutputIntent(draftInvocationText, draftImageModel.outputs) : undefined
  const imageSettingsSummary = [
    imageSettingLabel(props.aspectOptions, props.imageDefaults.aspectRatio),
    imageSettingLabel(props.resolutionOptions, props.imageDefaults.resolution),
    props.detailOptions.find((option) => option.value === props.imageDefaults.detail)?.label ?? props.detailOptions[0]?.label,
    `${props.imageDefaults.count}张`,
  ].filter(Boolean).join(' · ')
  const videoSettingsSummary = [
    ({ text: '文生视频', image: '图生视频', frames: '首尾帧', reference: '图片参考', omni: '全能参考' } as Record<string, string>)[videoGenerationMode],
    imageSettingLabel(props.videoAspectOptions, props.videoDefaults.aspectRatio),
    imageSettingLabel(props.videoResolutionOptions, props.videoDefaults.resolution),
    `${props.videoDefaults.duration}秒`,
    `${props.videoDefaults.count}条`,
  ].join(' · ')
  const referencesDisabled = !attachedSkill && mediaKind === 'video' && videoGenerationMode === 'text'
  const acceptsVideoReference = attachedSkill ? attachedSkill.kind === 'video' : mediaKind === 'video' && videoGenerationMode === 'omni'
  const modeAcceptsReference = (reference: AgentImageReference) => {
    if (attachedSkill) return reference.kind !== 'video' || attachedSkill.kind === 'video'
    if (mediaKind !== 'video') return reference.kind !== 'video'
    if (videoGenerationMode === 'text') return false
    return videoGenerationMode === 'omni' || reference.kind !== 'video'
  }
  const mentionCandidates = props.candidates.filter(modeAcceptsReference)
  const applyCustomAspectRatio = () => {
    const width = Number(customAspectWidth)
    const height = Number(customAspectHeight)
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return
    props.onImageDefaultsChange({ aspectRatio: `${Math.round(width * 100) / 100}:${Math.round(height * 100) / 100}` })
    setCustomAspectRatioOpen(false)
  }

  useEffect(() => {
    if (!previewResult) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewResult(null)
      if (event.key === 'Tab') {
        const buttons = [...(previewDialogRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
        if (!buttons.length) return
        const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const nextIndex = event.shiftKey
          ? (currentIndex <= 0 ? buttons.length - 1 : currentIndex - 1)
          : (currentIndex < 0 || currentIndex >= buttons.length - 1 ? 0 : currentIndex + 1)
        event.preventDefault()
        buttons[nextIndex]?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.requestAnimationFrame(() => previewCloseRef.current?.focus())
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      previewTriggerRef.current?.focus()
    }
  }, [previewResult])

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
    if (event.target instanceof Element && event.target.closest('button')) return
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
    if (!props.imageModelKey) setImageSettingsOpen(false)
  }, [props.imageModelKey])

  useEffect(() => {
    if (!props.videoModelKey) setVideoSettingsOpen(false)
  }, [props.videoModelKey])

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
  const hasTypedMentionTrigger = () => {
    const editor = editorRef.current
    const selection = window.getSelection()
    if (!editor || !selection?.rangeCount) return false
    const range = selection.getRangeAt(0)
    if (!editor.contains(range.endContainer)) return false
    const prefix = range.cloneRange()
    prefix.selectNodeContents(editor)
    prefix.setEnd(range.endContainer, range.endOffset)
    const holder = document.createElement('div')
    holder.append(prefix.cloneContents())
    holder.querySelectorAll('.agent-inline-reference').forEach((chip) => chip.replaceWith(document.createTextNode(' ')))
    const beforeCaret = holder.innerText.replace(/\u00a0/g, ' ')
    return /@[^\s@]*$/.test(beforeCaret)
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
    const image = document.createElement(isVideo ? 'video' : 'img')
    image.src = reference.url
    image.setAttribute('aria-label', '')
    if (image instanceof HTMLVideoElement) {
      image.className = 'video-reference-thumbnail'
      image.muted = true
      image.defaultMuted = true
      image.playsInline = true
      image.preload = 'auto'
      image.addEventListener('loadedmetadata', () => {
        if (image.duration > 0) image.currentTime = Math.min(0.05, image.duration / 2)
      }, { once: true })
    }
    const label = document.createElement('b')
    const existingIndex = props.references.findIndex((item) => item.nodeId === reference.nodeId)
    label.textContent = `${isVideo ? '视频' : '图'}${existingIndex >= 0 ? existingIndex + 1 : props.references.length + 1} · ${compactReferenceName(reference.name)}`
    label.title = reference.name
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.setAttribute('aria-label', '移除引用')
    remove.textContent = 'x'
    chip.append(image, label, remove)
    return chip
  }
  const clearMentionTrigger = () => {
    const selection = window.getSelection()
    if (!selection?.rangeCount) return
    const range = selection.getRangeAt(0)
    const textNode = range.startContainer
    if (textNode.nodeType !== Node.TEXT_NODE) return
    const value = textNode.textContent ?? ''
    const before = value.slice(0, range.startOffset)
    const match = before.match(/@[^\s@]*$/)
    if (!match) return
    textNode.textContent = `${value.slice(0, before.length - match[0].length)}${value.slice(range.startOffset)}`
    range.setStart(textNode, before.length - match[0].length)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
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
  const addReference = (reference: AgentImageReference) => {
    referenceRegistryRef.current.set(reference.nodeId, reference)
    restoreSelection()
    clearMentionTrigger()
    const editorReferences = getEditorReferences()
    if (editorReferences.some((item) => item.nodeId === reference.nodeId)) {
      setMentionOpen(false)
      return
    }
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
    setMentionOpen(false)
  }
  const uploadReferences = async (files: File[]) => {
    if (referencesDisabled) {
      props.onUploadNotice('文生视频不接收参考素材，请切换生成模式后再上传')
      return
    }
    const videoFiles = files.filter((file) => file.type.startsWith('video/'))
    if (videoFiles.length) {
      props.onUploadNotice(acceptsVideoReference ? '当前视频已识别为参考素材' : '当前对话只接收图片参考')
    }
    const supported = files.filter((file) => ['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || (acceptsVideoReference && file.type.startsWith('video/')))
    const remaining = Math.max(0, 16 - props.references.length)
    if (!supported.length) {
      props.onUploadNotice(acceptsVideoReference ? '支持 PNG、JPG/JPEG、WebP 图片或视频文件' : '当前模式仅支持 PNG、JPG/JPEG 和 WebP 图片')
      return
    }
    if (!remaining) {
      props.onUploadNotice('参考图最多 16 张，请先移除部分图片')
      return
    }
    const seenUrls = new Set(props.references.map((reference) => reference.url))
    let added = 0
    let duplicates = 0
    for (const file of supported.slice(0, remaining)) {
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('文件读取失败'))
        reader.onerror = () => reject(reader.error ?? new Error('文件读取失败'))
        reader.readAsDataURL(file)
      }).catch(() => '')
      if (!url) continue
      if (seenUrls.has(url)) {
        duplicates += 1
        continue
      }
      seenUrls.add(url)
      addReference(props.onCreateUploadedReference({ name: file.name, url, kind: file.type.startsWith('video/') ? 'video' : 'image' }))
      added += 1
    }
    const rejected = files.length - supported.length
    const overLimit = Math.max(0, supported.length - remaining)
    const notes = [rejected ? `${rejected} 个格式不支持` : '', duplicates ? `${duplicates} 张重复` : '', overLimit ? `${overLimit} 张超出上限` : ''].filter(Boolean)
    props.onUploadNotice(added ? `已添加 ${added} 张参考图${notes.length ? `，跳过${notes.join('、')}` : ''}` : `没有添加图片${notes.length ? `：${notes.join('、')}` : ''}`)
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
    setImageSettingsOpen(false)
    setVideoSettingsOpen(false)
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
        label.textContent = `${reference.kind === 'video' ? '视频' : '图'}${number} · ${compactReferenceName(reference.name)}`
        label.title = reference.name
      }
    })
  }, [props.references])
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
      container.scrollTop = container.scrollHeight
      pinnedToBottomRef.current = true
    })
    return () => window.cancelAnimationFrame(frame)
  }, [props.activeConversationId])
  useEffect(() => {
    const container = messagesRef.current
    if (!container || !pinnedToBottomRef.current) return
    const frame = window.requestAnimationFrame(() => container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' }))
    return () => window.cancelAnimationFrame(frame)
  }, [props.messages.length, props.plans.length, props.videoPlans.length, props.textPlans.length, props.busy, props.filmRun?.nodeId])
  useEffect(() => {
    if (!props.filmReview) return
    const frame = window.requestAnimationFrame(() => messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: 'instant' }))
    return () => window.cancelAnimationFrame(frame)
  }, [props.filmReview?.id])
  const submit = (answers?: string) => {
    const value = [answers, getEditorText()].filter(Boolean).join('\n\n')
    if (!value) return
    if (!props.textModelKey) { props.onOpenApiSettings(); return }
    const invocationText = [answers, getInvocationText()].filter(Boolean).join('\n\n')
    props.onSend(value, invocationText, getEditorReferences().filter(modeAcceptsReference), !attachedSkill && mediaKind === 'video' ? videoGenerationMode : undefined, teamEnabled && !attachedSkill)
    if (editorRef.current) editorRef.current.innerHTML = ''
    setDraftInvocationText('')
    setMentionOpen(false)
  }
  const attachSkill = (skill: SkillManifest) => {
    props.onAttachSkill(skill)
    setSkillMenuOpen(false)
    setSkillAuthoring(false)
    window.requestAnimationFrame(() => editorRef.current?.focus())
  }
  const renderPlan = (storedPlan: AgentImagePlan) => {
    const plan = reconcileAgentImagePlanSpecs(storedPlan)
    const statusLabel = plan.status === 'ready' ? '待确认' : plan.status === 'running' ? '生成中' : plan.status === 'completed' ? '已完成' : plan.status === 'cancelled' ? '已取消' : '失败'
    const isCompact = plan.status === 'completed' || plan.status === 'cancelled' || Boolean(plan.results?.length)
    const disabled = plan.status !== 'ready'
    const imageModelKey = `${plan.imageConnectionId ?? ''}::${plan.imageModelId ?? ''}`
    const imageModel = props.imageModels.find((model) => model.key === imageModelKey)
    const imageModelAvailable = Boolean(imageModel)
    const outputIntent = imageOutputIntent(plan.prompt, imageModel?.outputs)
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
        return (
          <section key={plan.id} className="agent-plan-card agent-result-card is-completed">
            <header><span><ImagePlus size={15} />{plan.status === 'completed' ? '图像已生成' : '已保留生成结果'}</span><em>{plan.results.length} 张</em></header>
            <div className={`agent-result-grid ${plan.results.length === 1 ? 'is-single' : ''}`}>
              {plan.results.map((result, index) => <figure key={result.id}>
                <button type="button" className="agent-result-preview" onClick={(event) => { previewTriggerRef.current = event.currentTarget; setPreviewResult(result) }} aria-label={`放大查看生成图片 ${index + 1}`}>
                  <img src={result.url} alt={`生成结果 ${index + 1}`} />
                  <span><Maximize2 size={15} />放大</span>
                </button>
                <button type="button" className="agent-result-download" onClick={() => props.onDownloadImage(result.url, result.fileName)}><Download size={14} />保存</button>
              </figure>)}
            </div>
            <footer className="agent-result-meta">
              <span>{plan.aspectRatio} · {plan.resolution}</span>
              {!props.agentOnly && plan.nodeId && <button type="button" onClick={() => props.onLocateCanvasNode(plan.nodeId!)}><Focus size={13} />定位画布</button>}
            </footer>
            {plan.error && <p className="agent-plan-error">{plan.error}</p>}
          </section>
        )
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
        <header><span><ImagePlus size={15} />图像生成确认</span><em>{statusLabel}</em></header>
        <div className="agent-image-plan-field agent-image-plan-model">
          <span>图像模型</span>
          <AgentSelect variant="floating" ariaLabel="选择本次图像模型" disabled={disabled} value={imageModelAvailable ? imageModelKey : ''} placeholder="选择图像模型" options={props.imageModels.map((model) => ({ value: model.key, label: model.name, detail: model.connectionName, brand: getModelBrand(model.name) }))} icon={<ImagePlus size={14} />} onChange={(key) => { const [imageConnectionId = '', imageModelId = ''] = key.split('::'); props.onPlanChange(plan.id, { imageConnectionId, imageModelId }) }} />
        </div>
        {!imageModelAvailable && <p className="agent-image-plan-notice">请选择可用的图像模型。</p>}
        <label className="agent-image-plan-field"><span>提示词</span><textarea value={plan.prompt} disabled={disabled} onChange={(event) => props.onPlanChange(plan.id, { prompt: event.target.value })} aria-label="编辑图像方案提示词" /></label>
        {plan.status === 'ready' && <div className="agent-image-plan-specs" role="group" aria-label="确认本次生成规格">
          <div className="agent-image-plan-field"><span>生成张数</span><AgentSelect variant="floating" ariaLabel="生成张数" value={String(plan.count)} placeholder="张数" options={[1, 2, 3, 4].map((count) => ({ value: String(count), label: `${count} 张` }))} icon={null} onChange={(value) => props.onPlanChange(plan.id, { count: Number(value) })} /></div>
          <div className="agent-image-plan-field"><span>画面比例</span><AgentSelect variant="floating" ariaLabel="画面比例" disabled={!imageModelAvailable} value={shown.aspectRatio ?? ''} placeholder="比例" options={parameters?.ratios ?? props.aspectOptions} icon={null} onChange={(aspectRatio) => props.onPlanChange(plan.id, { aspectRatio })} /></div>
          {(parameters?.resolutions ?? props.resolutionOptions).length > 0 && <div className="agent-image-plan-field"><span>清晰度</span><AgentSelect variant="floating" ariaLabel="清晰度" disabled={!imageModelAvailable} value={shown.resolution ?? ''} placeholder="清晰度" options={parameters?.resolutions ?? props.resolutionOptions} icon={null} onChange={(resolution) => props.onPlanChange(plan.id, { resolution })} /></div>}
          {(parameters?.qualities ?? props.detailOptions).length > 0 && <div className="agent-image-plan-field"><span>画质</span><AgentSelect variant="floating" ariaLabel="画质" disabled={!imageModelAvailable} value={shown.detail ?? ''} placeholder="画质" options={parameters?.qualities ?? props.detailOptions} icon={null} onChange={(detail) => props.onPlanChange(plan.id, { detail })} /></div>}
        </div>}
        {plan.status === 'ready' && imageModelAvailable && shown.aspectRatio !== plan.aspectRatio && <p className="agent-image-plan-notice" role="status">当前模型不支持 {plan.aspectRatio}，将使用 {shown.aspectRatio}。可换模型或修改比例。</p>}
        {plan.status === 'ready' && imageModelAvailable && outputIntent.message && <p className={`image-output-hint ${outputIntent.blocked ? 'is-unsupported' : ''}`} role="status">{outputIntent.message}</p>}
        {!!displayedContextReferences.length && renderContextReferences(displayedContextReferences, (nodeId) => props.onRemovePlanContextReference(plan.id, nodeId))}
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
        {plan.error && <p className="agent-plan-error">{plan.error}</p>}
        {plan.status === 'ready' && <footer className="agent-plan-actions">
          <span className="agent-image-plan-confirm-note">{costLabel ? `预计 ${costLabel}` : '确认后才开始生成'}</span>
          <button type="button" className="agent-plan-cancel" onClick={() => props.onCancelPlan(plan.id)}>取消</button>
          <button type="button" className="agent-plan-confirm" disabled={!imageModelAvailable || outputIntent.blocked || !plan.prompt.trim()} title={outputIntent.blocked ? outputIntent.message : undefined} onClick={() => props.onConfirmPlan(plan.id)}><Check size={15} />确认生成 {plan.count} 张</button>
        </footer>}
      </section>
    )
  }
  const renderContextReferences = (references: AgentContextReference[], onRemove?: (nodeId: string) => void) => (
    <div className="agent-plan-context-references">
      <div className="agent-plan-context-heading"><span>关联素材</span>{references.some((reference) => reference.autoResolved) && <em><Sparkles size={11} />Agent 自动关联</em>}</div>
      <div>{references.map((reference, index) => <div className={`agent-plan-context-reference is-${reference.kind}`} key={`${reference.kind}-${reference.nodeId}`}>
        <button type="button" className="agent-context-locate" title={`${reference.name}${reference.resolutionReason ? ` · ${reference.resolutionReason}` : ''}`} onClick={() => props.onLocateCanvasNode(reference.nodeId)}>
          {reference.url ? (reference.kind === 'video' ? <video src={reference.url} muted playsInline preload="metadata" aria-label={reference.name} /> : <img src={reference.url} alt="" />) : <span className="agent-context-text-icon"><FileText size={14} /></span>}
          <span><strong>{reference.kind === 'image' ? `图${index + 1} · ` : reference.kind === 'video' ? `视频${index + 1} · ` : ''}{compactReferenceName(reference.name, 14)}</strong>{reference.excerpt && <small>{reference.excerpt}</small>}{reference.autoResolved && <small>{reference.resolutionReason || '根据上下文自动关联'}</small>}</span>
          <Focus size={12} />
        </button>
        {onRemove && <button type="button" className="agent-context-remove" aria-label={`移除关联 ${reference.name}`} title="从本次确认卡移除" onClick={() => onRemove(reference.nodeId)}><X size={12} /></button>}
      </div>)}</div>
    </div>
  )
  const renderVideoPlan = (plan: AgentVideoPlan) => {
    const statusLabel = plan.status === 'ready' ? '待确认' : plan.status === 'running' ? '生成中' : plan.status === 'completed' ? '已完成' : plan.status === 'cancelled' ? '已取消' : '失败'
    if (plan.status !== 'ready') return <button type="button" key={plan.id} className={`agent-plan-card agent-video-plan-card is-${plan.status} is-collapsed`} disabled={!plan.nodeId} onClick={() => !props.agentOnly && plan.nodeId && props.onLocateCanvasNode(plan.nodeId)}>
      <span><Film size={15} /><strong>{plan.status === 'completed' ? '视频已生成' : plan.status === 'running' ? '视频生成中' : plan.status === 'failed' ? '视频生成失败' : '视频方案已取消'}</strong></span>
      <span className="agent-plan-collapsed-meta">{plan.aspectRatio} · {plan.resolution} · {plan.duration} 秒 · {plan.count} 条</span>
      {plan.error && <span className="agent-plan-error">{plan.error}</span>}
      {!props.agentOnly && plan.nodeId && <span className="agent-plan-locate"><Focus size={14} />定位画布</span>}
    </button>
    const displayedContextReferences = plan.contextReferences?.length
      ? plan.contextReferences
      : (plan.references ?? []).map((reference) => ({ ...reference, kind: reference.kind ?? 'image' as const }))
    const videoModelKey = `${plan.videoConnectionId ?? ''}::${plan.videoModelId ?? ''}`
    const videoModelAvailable = props.videoModels.some((model) => model.key === videoModelKey)
    return <section className="agent-plan-card agent-video-plan-card is-ready" key={plan.id}>
      <header><span><Film size={15} />视频生成确认</span><em>{statusLabel}</em></header>
      <div className="mb-2 grid gap-1"><span className="text-[10px] text-[color:var(--muted)]">视频模型</span><AgentSelect className="w-full" ariaLabel="选择本次视频模型" value={videoModelAvailable ? videoModelKey : ''} placeholder="选择视频模型" options={props.videoModels.map((model) => ({ value: model.key, label: `${model.name} · ${model.connectionName}`, brand: getModelBrand(model.name) }))} icon={<Film size={13} />} onChange={(key) => { const [videoConnectionId = '', videoModelId = ''] = key.split('::'); props.onVideoPlanChange(plan.id, { videoConnectionId, videoModelId }) }} /></div>
      {!videoModelAvailable && <p className="mb-2 text-[11px] text-amber-300">原视频模型已不可用，请重新选择。</p>}
      <textarea value={plan.prompt} onChange={(event) => props.onVideoPlanChange(plan.id, { prompt: event.target.value })} aria-label="编辑视频方案提示词" />
      <div className="agent-video-plan-settings">
        <AgentSelect ariaLabel="视频比例" value={plan.aspectRatio} placeholder="比例" options={props.videoAspectOptions} icon={<SlidersHorizontal size={13} />} onChange={(aspectRatio) => props.onVideoPlanChange(plan.id, { aspectRatio })} />
        <AgentSelect ariaLabel="视频清晰度" value={plan.resolution} placeholder="清晰度" options={props.videoResolutionOptions} icon={<SlidersHorizontal size={13} />} onChange={(resolution) => props.onVideoPlanChange(plan.id, { resolution })} />
        <AgentSelect ariaLabel="视频时长" value={String(plan.duration)} placeholder="时长" options={props.videoDurationOptions} icon={<SlidersHorizontal size={13} />} onChange={(duration) => props.onVideoPlanChange(plan.id, { duration: Number(duration) })} />
        <AgentSelect ariaLabel="视频数量" value={String(plan.count)} placeholder="数量" options={[1, 2, 3, 4].map((count) => ({ value: String(count), label: `${count} 条` }))} icon={<SlidersHorizontal size={13} />} onChange={(count) => props.onVideoPlanChange(plan.id, { count: Number(count) })} />
      </div>
      {!!displayedContextReferences.length && renderContextReferences(displayedContextReferences, (nodeId) => props.onRemoveVideoPlanContextReference(plan.id, nodeId))}
      {!!(plan.invokedStylePresets?.length || plan.invokedStyleReferences?.length) && <div className="agent-plan-invoked-styles">
        {(plan.invokedStylePresets?.length ? plan.invokedStylePresets : [{ id: 'legacy-video-style', name: '风格设定', keyword: plan.styleInvocationWord || '', references: plan.invokedStyleReferences ?? [] }]).map((preset) => <div className="agent-plan-invoked-style" key={preset.id}><span><Sparkles size={12} />{preset.name}{preset.keyword ? ` · ${preset.keyword}` : ''}</span><div>{preset.references.map((reference) => <img src={reference.url} alt={reference.name} title={reference.name} key={reference.id} />)}</div></div>)}
      </div>}
      {plan.error && <p className="agent-plan-error">{plan.error}</p>}
      <footer className="agent-plan-actions"><button type="button" className="agent-plan-cancel" onClick={() => props.onCancelVideoPlan(plan.id)}>取消</button><button type="button" className="agent-plan-confirm" disabled={!videoModelAvailable} title={videoModelAvailable ? '使用所选模型生成视频' : '请先选择可用的视频模型'} onClick={() => props.onConfirmVideoPlan(plan.id)}><Check size={15} />确认生成视频</button></footer>
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
    const selectablePlans = plans.filter((plan) => plan.status === 'proposed' || plan.status === 'ready')
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
  const renderAttachedPlans = (plans: AgentImagePlan[]) => (
    <>
      {renderDirectionChoices(plans)}
      {plans.filter((plan) => plan.status !== 'proposed' && plan.status !== 'ready').map(renderPlan)}
      {plans.filter((plan) => plan.status === 'ready').map(renderPlan)}
    </>
  )
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
        <div className="agent-panel-title"><span className="disy-agent-avatar agent-panel-avatar" aria-hidden="true"><img className="agent-panel-logo" src="/disy-logo.png" alt="" /></span><span><strong>Disy Agent</strong><small>和你一起构思，并在确认后生成</small></span>{props.backgroundRunCount > 0 && <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2 py-1 text-[10px] text-cyan-200" title="其他画布中的 Agent 正在后台运行"><LoaderCircle size={11} className="is-spinning" />后台 {props.backgroundRunCount}</span>}</div>
        <div className="agent-panel-header-actions">
          <div className="agent-project-buttons" aria-label="项目工具">
            <button type="button" aria-label="任务中心" title="任务中心" aria-pressed={projectView === 'tasks'} onClick={() => changeProjectView(projectView === 'tasks' ? null : 'tasks')}><ListTodo size={16} /></button>
            <button type="button" aria-label="项目记忆" title="项目记忆" aria-pressed={projectView === 'memory'} onClick={() => changeProjectView(projectView === 'memory' ? null : 'memory')}><Brain size={16} /></button>
            <button type="button" aria-label="团队协作" title={teamEnabled ? '团队协作已启用' : '团队协作'} aria-pressed={projectView === 'team'} data-team-active={teamEnabled} onClick={() => changeProjectView(projectView === 'team' ? null : 'team')}><UsersRound size={16} /></button>
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
        <strong>{{ tasks: '任务中心', memory: '项目记忆', team: '团队协作', guide: '使用指南' }[projectView]}</strong>
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
      {previewResult && createPortal(<div ref={previewDialogRef} className="agent-result-lightbox" role="dialog" aria-modal="true" aria-label="生成图片预览" onClick={() => setPreviewResult(null)}>
        <header onClick={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => props.onDownloadImage(previewResult.url, previewResult.fileName)}><Download size={16} />保存图片</button>
          <button ref={previewCloseRef} type="button" onClick={() => setPreviewResult(null)} aria-label="关闭预览"><X size={18} /></button>
        </header>
        <img src={previewResult.url} alt="生成图片大图预览" onClick={(event) => event.stopPropagation()} />
      </div>, document.body)}
      {projectView === 'tasks' && <AgentTasks key={props.projectId} tasks={props.tasks} onStop={props.onStopTask} onOpen={async (task) => {
        const opened = await props.onOpenTask(task)
        if (opened) changeProjectView(null)
        return opened
      }} />}
      {projectView === 'memory' && <AgentMemory key={`${props.projectId}:${memorySeed?.id ?? ''}`} settings={props.projectSettings} save={props.onSaveProjectSettings} seed={memorySeed?.content} />}
      {projectView === 'guide' && <AgentProjectGuide open={changeProjectView} />}
      {projectView === 'team' && <AgentTeam key={props.projectId} settings={props.projectSettings} save={props.onSaveProjectSettings} models={props.textModels} enabled={teamEnabled} onEnabled={(enabled) => {
        setTeamConversations((current) => {
          const next = new Set(current)
          if (enabled) next.add(props.activeConversationId)
          else next.delete(props.activeConversationId)
          return next
        })
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
          {!props.messages.length && !attachedSkill && <div className="agent-empty"><span><Sparkles size={19} /></span><strong>今天想创造什么？</strong><p>聊灵感、梳理画面，或让我准备一份可确认的图像方案。</p></div>}
          {props.messages.map((message) => <Fragment key={message.id}>
            <article className={`agent-message is-${message.role}`}>
              <p>{message.role === 'assistant' ? normalizeAgentMessageContent(message.content) : message.content}</p>
              {message.role === 'user' && message.content.trim() && <button className="agent-message-memory" type="button" aria-label="将这条消息存为项目记忆" title="存为项目记忆" onClick={() => {
                changeProjectView('memory')
                setMemorySeed({ id: message.id, content: message.content.trim().slice(0, PROJECT_MEMORY_LENGTH) })
              }}><Brain size={14} aria-hidden="true" /></button>}
              {!!message.references?.length && <div className="agent-message-references">{message.references.map((reference, index) => <button type="button" key={reference.nodeId} onClick={() => props.onLocateCanvasNode(reference.nodeId)} title={`${reference.name} · 定位到画布节点`}>{reference.kind === 'video' ? <video className="video-reference-thumbnail" src={reference.url} muted playsInline preload="metadata" /> : <img src={reference.url} alt="" />}<span>{reference.kind === 'video' ? '视频' : '图'}{index + 1} · {compactReferenceName(reference.name)}</span><Focus size={12} /></button>)}</div>}
              {message.textNode?.nodeId && <button type="button" className="agent-message-to-canvas" onClick={() => props.onLocateCanvasNode(message.textNode!.nodeId!)}><Focus size={13} />查看整合文本节点</button>}
            </article>
            {message.canvasEditDraft && !props.agentOnly && <AgentCanvasEditReview draft={message.canvasEditDraft}
              onChange={(update) => props.onCanvasDraftChange(message.id, update)} onSave={() => props.onSaveCanvasDraft(message.id)} onApply={() => props.onConfirmCanvasDraft(message.id)}
              onRevert={() => props.onRevertCanvasDraft(message.id)} onLocate={props.onLocateCanvasNode} />}
            {message.filmPlan?.nodeId && <button type="button" className="agent-plan-card is-collapsed" onClick={() => props.onLocateCanvasNode(message.filmPlan!.nodeId!)}>
              <span><Focus size={14} />查看画布中的成片任务</span>
            </button>}
            {message.filmPlan && !message.filmPlan.nodeId && message === props.messages.at(-1) && (() => {
              const info = props.getFilmPlanInfo(message.filmPlan)
              return <section className="agent-plan-card agent-film-card" aria-label="成片方案">
                <strong>成片方案</strong>
                <p>{info.summary ?? `${message.filmPlan.values.duration} 秒 · ${message.filmPlan.values.ratio}`}</p>
                <details><summary>查看制作内容</summary><p>{message.filmPlan.subject}</p>{info.models && <p>{info.models}</p>}</details>
                {info.issue ? <p role="status">{info.issue}</p> : <p>{info.cost}</p>}
                <div className="agent-plan-actions">
                  {info.settings
                    ? <button type="button" className="agent-plan-cancel" onClick={props.onOpenApiSettings}>打开 API 设置</button>
                    : <button type="button" className="agent-plan-confirm" disabled={Boolean(info.issue) || props.filmBusy || props.busy} onClick={() => props.onConfirmFilm(message.id)}>开始制作</button>}
                </div>
              </section>
            })()}
            {renderAttachedPlans(plansByMessage.get(message.id) ?? [])}
            {(videoPlansByMessage.get(message.id) ?? []).map(renderVideoPlan)}
            {(textPlansByMessage.get(message.id) ?? []).map(renderTextPlan)}
          </Fragment>)}
          {props.busy && <div className="agent-thinking"><LoaderCircle size={14} className="is-spinning" /><span>正在理解你的创作目标...</span></div>}
          {renderAttachedPlans(orphanPlans)}
          {orphanVideoPlans.map(renderVideoPlan)}
          {orphanTextPlans.map(renderTextPlan)}
          {props.filmReview && <AgentFilmReview key={props.filmReview.id} stage={props.filmReview.stage} onAnswer={props.filmReview.answer} />}
          {props.filmRun && <div className="agent-film-progress" role="status">
            <span>{props.filmReview ? '等你确认后继续' : props.filmRun.label}</span>
            <button type="button" className="agent-plan-cancel" onClick={props.onStopFilm}>停止制作</button>
          </div>}
        </div>
      </div>
      <div className="agent-panel-composer" hidden={skillAuthoring || Boolean(projectView)}>
        {teamEnabled && !attachedSkill && <button type="button" className="agent-team-indicator" onClick={() => changeProjectView('team')}><UsersRound size={14} aria-hidden="true" />{getAgentTeamTemplate(props.projectSettings.team.template).label} · {activeAgentTeamRoles(props.projectSettings.team).length} 个角色</button>}
        <div
          className={`agent-composer-box reference-drop-zone ${referenceDropActive ? 'is-drop-active' : ''} ${referencesDisabled ? 'references-disabled' : ''}`}
          onDragEnter={(event) => {
            if (referencesDisabled || !Array.from(event.dataTransfer.items).some((item) => item.kind === 'file')) return
            event.preventDefault()
            event.stopPropagation()
            setReferenceDropActive(true)
          }}
          onDragOver={(event) => {
            if (referencesDisabled || !Array.from(event.dataTransfer.items).some((item) => item.kind === 'file')) return
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
          {attachedSkill && <div className="agent-skill-attachment">
            <Wrench size={13} /><span title={attachedSkill.name}>{attachedSkill.name}</span>
            <button type="button" aria-label={`移除 Skill ${attachedSkill.name}`} onClick={() => { props.onRemoveSkill(); editorRef.current?.focus() }}><X size={13} /></button>
          </div>}
          {guidedMessage?.questions && <AgentQuestions key={guidedMessage.id} questions={guidedMessage.questions} onSubmit={submit} />}
          <div
            className={`agent-composer-input ${guidedMessage ? 'is-guided' : ''}`}
            ref={editorRef}
            contentEditable
            role="textbox"
            aria-multiline="true"
            aria-label={guidedMessage ? '补充素材或说明' : '对话输入'}
            tabIndex={guidedMessage && !props.references.length && !draftInvocationText ? -1 : undefined}
            aria-placeholder={guidedMessage ? undefined : composerHint}
            data-placeholder={guidedMessage ? undefined : composerHint}
            onInput={() => {
              rememberSelection()
              setMentionOpen(hasTypedMentionTrigger())
              syncReferencesFromEditor()
            }}
            onPaste={(event) => {
              event.preventDefault()
              const plainText = event.clipboardData.getData('text/plain')
              insertPlainTextAtSelection(plainText)
              setMentionOpen(hasTypedMentionTrigger())
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
          {mentionOpen && <div className="agent-mention-menu">{mentionCandidates.map((reference) => <button key={reference.nodeId} onMouseDown={(event) => event.preventDefault()} onClick={() => addReference(reference)}>{reference.kind === 'video' ? <video className="video-reference-thumbnail" src={reference.url} muted playsInline preload="auto" onLoadedMetadata={(event) => { const video = event.currentTarget; if (video.duration > 0) video.currentTime = Math.min(.05, video.duration / 2) }} /> : <img src={reference.url} alt="" />}<span>{reference.name}</span></button>)}{!mentionCandidates.length && <p>{referencesDisabled ? '文生视频无需引用参考素材' : '画布上还没有可引用的素材'}</p>}</div>}
          {!attachedSkill && draftOutputIntent?.message && <p className={`image-output-hint agent-image-output-hint ${draftOutputIntent.blocked ? 'is-unsupported' : ''}`} role="status">{draftOutputIntent.message}</p>}
          {!guidedMessage && <div className="agent-composer-models">
            <AgentSelect
              className="agent-model-select"
              ariaLabel="对话模型"
              value={props.textModelKey}
              placeholder="选择对话模型"
              options={props.textModels.map((model) => ({ value: model.key, label: model.name, brand: getModelBrand(model.name) }))}
              icon={<MessageCircle size={14} />}
              onChange={props.onTextModelChange}
            />
            {!attachedSkill && (mediaKind === 'choose' ? <AgentSelect
              className="agent-model-select"
              ariaLabel="选择生成类型"
              value=""
              placeholder="请选择"
              options={[{ value: 'image', label: '图像' }, { value: 'video', label: '视频' }]}
              icon={<Plus size={14} />}
              onChange={(value) => {
                if (value === 'video') {
                  props.onVideoModelChange('')
                  setVideoModelChosen(false)
                  setMediaKind('video')
                  return
                }
                props.onImageModelChange('')
                setImageModelChosen(false)
                setMediaKind('image')
              }}
            /> : mediaKind === 'image' ? <AgentSelect
              className="agent-model-select"
              ariaLabel="生图模型"
              value={imageModelChosen ? props.imageModelKey : ''}
              placeholder="选择生图模型"
              options={[
                { value: '__choose_type__', label: '返回生成类型' },
                ...props.imageModels.map((model) => ({ value: model.key, label: model.name, brand: getModelBrand(model.name) })),
              ]}
              icon={<ImagePlus size={14} />}
              onChange={(value) => {
                if (value === '__choose_type__') {
                  setMediaKind('choose')
                  setImageModelChosen(false)
                  setImageSettingsOpen(false)
                  return
                }
                props.onImageModelChange(value)
                setImageModelChosen(true)
              }}
            /> : <AgentSelect
              className="agent-model-select"
              ariaLabel="视频模型"
              value={videoModelChosen ? props.videoModelKey : ''}
              placeholder="选择视频模型"
              options={[
                { value: '__choose_type__', label: '返回生成类型' },
                ...props.videoModels.map((model) => ({ value: model.key, label: model.name, brand: getModelBrand(model.name) })),
              ]}
              icon={<Film size={14} />}
              onChange={(value) => {
                if (value === '__choose_type__') {
                  setMediaKind('choose')
                  setVideoModelChosen(false)
                  setVideoSettingsOpen(false)
                  return
                }
                props.onVideoModelChange(value)
                setVideoModelChosen(true)
              }}
            />)}
          </div>}
          <footer className="agent-composer-footer">
            <div className="agent-composer-reference-bar">
              {!props.agentOnly && <button type="button" disabled={referencesDisabled} onMouseDown={rememberSelection} onClick={() => attachedSkill
                ? props.onPickFromCanvas(acceptsVideoReference ? 'video' : 'image', acceptsVideoReference ? 'omni' : undefined)
                : props.onPickFromCanvas(mediaKind === 'video' ? 'video' : 'image', mediaKind === 'video' ? videoGenerationMode : undefined)} title={referencesDisabled ? '文生视频不接收参考素材' : '从画布选择参考素材'} aria-label="从画布选择参考素材"><MousePointer2 size={15} /><span>画布选择</span></button>}
              <button type="button" disabled={referencesDisabled} onMouseDown={rememberSelection} onClick={() => uploadInputRef.current?.click()} title={referencesDisabled ? '文生视频不接收参考素材' : '从本地上传参考素材'} aria-label="从本地上传参考素材"><ImageUp size={15} /><span>上传素材</span></button>
              <button ref={skillButtonRef} type="button" aria-label="Skill" title="Skill" aria-expanded={skillMenuOpen} aria-controls={skillMenuOpen ? skillMenuId : undefined} onClick={() => { setImageSettingsOpen(false); setVideoSettingsOpen(false); setSkillMenuOpen((open) => !open) }}><FilePlus2 size={16} /></button>
              {!attachedSkill && mediaKind === 'image' && imageModelChosen && props.imageModelKey && <button type="button" className={`agent-image-settings-button ${imageSettingsOpen ? 'is-open' : ''}`} onClick={() => setImageSettingsOpen((open) => !open)} title={`图像参数：${imageSettingsSummary}`} aria-label={`图像参数，当前参数：${imageSettingsSummary}`} aria-expanded={imageSettingsOpen}><SlidersHorizontal size={15} /><em>{imageSettingsSummary}</em></button>}
              {!attachedSkill && mediaKind === 'video' && videoModelChosen && props.videoModelKey && <button type="button" className={`agent-image-settings-button ${videoSettingsOpen ? 'is-open' : ''}`} onClick={() => setVideoSettingsOpen((open) => !open)} title={`视频参数：${videoSettingsSummary}`} aria-label={`视频参数，当前参数：${videoSettingsSummary}`} aria-expanded={videoSettingsOpen}><SlidersHorizontal size={15} /><em>{videoSettingsSummary}</em></button>}
              <input ref={uploadInputRef} className="agent-reference-upload-input" type="file" disabled={referencesDisabled} accept={acceptsVideoReference ? 'image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime' : 'image/png,image/jpeg,image/webp'} multiple aria-label="上传 Agent 参考素材" onChange={(event) => { const files = Array.from(event.target.files ?? []); if (files.length) void uploadReferences(files); event.target.value = '' }} />
            </div>
            <div className="agent-composer-actions">
              {props.busy && <button type="button" className="agent-stop-button" onClick={props.onStop} title="中止本次对话" aria-label="中止本次对话"><X size={16} /></button>}
              {!guidedMessage && <button type="button" className="agent-send-button" onClick={() => submit()} title={props.busy ? '发送并调整方向' : '发送'} aria-label={props.busy ? '发送并调整方向' : '发送'}><ArrowUp size={17} /></button>}
            </div>
          </footer>
          {skillMenuOpen && <AgentSkillMenu id={skillMenuId} menuRef={skillMenuRef} activeSkill={attachedSkill}
            onAttach={attachSkill}
            onCreate={() => { setSkillMenuOpen(false); setSkillAuthoring(true) }}
            onOpenFactory={(view, skillSlug) => { setSkillMenuOpen(false); skillButtonRef.current?.focus(); props.onOpenSkillFactory(view, skillSlug) }}
            onDismiss={() => { setSkillMenuOpen(false); skillButtonRef.current?.focus() }}
          />}
          {imageSettingsOpen && mediaKind === 'image' && imageModelChosen && props.imageModelKey && <div className="agent-image-parameter-popover" role="dialog" aria-label="图像参数">
            <header><strong>图像参数</strong><button type="button" className="agent-parameter-close" onClick={() => setImageSettingsOpen(false)} title="关闭图像参数" aria-label="关闭图像参数"><X size={16} strokeWidth={1.8} /></button></header>
            {props.detailOptions.length > 0 && <div className="agent-image-parameter-section"><span>画质</span><div>{props.detailOptions.map((option) => <button type="button" className={(props.detailOptions.some((item) => item.value === props.imageDefaults.detail) ? props.imageDefaults.detail : props.detailOptions[0]?.value) === option.value ? 'is-selected' : ''} key={option.value} onClick={() => props.onImageDefaultsChange({ detail: option.value })}>{option.label}</button>)}</div></div>}
            <div className="agent-image-parameter-section"><span>清晰度</span><div>{props.resolutionOptions.map((option) => <button type="button" className={props.imageDefaults.resolution === option.value ? 'is-selected' : ''} key={option.value} onClick={() => props.onImageDefaultsChange({ resolution: option.value })}>{option.label}</button>)}</div></div>
            <div className="agent-image-parameter-section is-aspect">
              <span>比例</span>
              <div>
                {props.aspectOptions.map((option) => <button type="button" data-aspect={option.value} className={props.imageDefaults.aspectRatio === option.value ? 'is-selected' : ''} key={option.value} onClick={() => props.onImageDefaultsChange({ aspectRatio: option.value })}><i aria-hidden="true" /><span>{option.label}</span></button>)}
                <button type="button" className={`is-custom ${customAspectRatioOpen ? 'is-selected' : ''}`} onClick={() => setCustomAspectRatioOpen((open) => !open)}><i aria-hidden="true">+</i><span>自定义</span></button>
              </div>
              {customAspectRatioOpen && <form className="agent-custom-aspect-ratio" onSubmit={(event) => { event.preventDefault(); applyCustomAspectRatio() }}>
                <label>宽<input aria-label="自定义比例宽度" inputMode="decimal" min="0.01" step="0.01" type="number" value={customAspectWidth} onChange={(event) => setCustomAspectWidth(event.target.value)} /></label>
                <span>:</span>
                <label>高<input aria-label="自定义比例高度" inputMode="decimal" min="0.01" step="0.01" type="number" value={customAspectHeight} onChange={(event) => setCustomAspectHeight(event.target.value)} /></label>
                <button type="submit">应用</button>
              </form>}
            </div>
            <div className="agent-image-parameter-section"><span>数量</span><div>{[1, 2, 3, 4].map((count) => <button type="button" className={props.imageDefaults.count === count ? 'is-selected' : ''} key={count} onClick={() => props.onImageDefaultsChange({ count })}>{count} 张</button>)}</div></div>
          </div>}
          {videoSettingsOpen && mediaKind === 'video' && videoModelChosen && props.videoModelKey && <div className="agent-image-parameter-popover" role="dialog" aria-label="视频参数">
            <header><strong>视频参数</strong><button type="button" className="agent-parameter-close" onClick={() => setVideoSettingsOpen(false)} title="关闭视频参数" aria-label="关闭视频参数"><X size={16} strokeWidth={1.8} /></button></header>
            <div className="agent-image-parameter-section agent-video-mode-section"><span>生成模式</span><div>{([['text', '文生视频', '仅使用文字描述生成视频，不接收图片或视频参考'], ['omni', '全能参考', '可同时使用图片与视频作为角色、动作和风格参考'], ['image', '图生视频', '使用一张图片作为视频首帧'], ['frames', '首尾帧', '使用前两张图片分别作为首帧和尾帧'], ['reference', '图片参考', '使用最多四张图片作为主体与风格参考']] as const).map(([value, label, tip]) => <button type="button" data-tooltip={tip} aria-label={`${label}：${tip}`} className={videoGenerationMode === value ? 'is-selected' : ''} key={value} onClick={() => setVideoGenerationMode(value)}>{label}</button>)}</div></div>
            <div className="agent-image-parameter-section"><span>清晰度</span><div>{props.videoResolutionOptions.map((option) => <button type="button" className={props.videoDefaults.resolution === option.value ? 'is-selected' : ''} key={option.value} onClick={() => props.onVideoDefaultsChange({ resolution: option.value })}>{option.label}</button>)}</div></div>
            <div className="agent-image-parameter-section is-aspect"><span>比例</span><div>{props.videoAspectOptions.map((option) => <button type="button" data-aspect={option.value} className={props.videoDefaults.aspectRatio === option.value ? 'is-selected' : ''} key={option.value} onClick={() => props.onVideoDefaultsChange({ aspectRatio: option.value })}><i aria-hidden="true" /><span>{option.label}</span></button>)}</div></div>
            <div className="agent-image-parameter-section agent-video-duration-section"><span>时长</span><div><input type="range" min="4" max="15" step="1" value={props.videoDefaults.duration} aria-label="视频时长" onChange={(event) => props.onVideoDefaultsChange({ duration: Number(event.target.value) })} /><label><input type="number" min="4" max="15" step="1" value={props.videoDefaults.duration} aria-label="手动输入视频时长" onChange={(event) => props.onVideoDefaultsChange({ duration: Math.max(4, Math.min(15, Number(event.target.value) || 4)) })} /><span>秒</span></label></div></div>
            <div className="agent-image-parameter-section"><span>数量</span><div>{[1, 2, 3, 4].map((count) => <button type="button" className={props.videoDefaults.count === count ? 'is-selected' : ''} key={count} onClick={() => props.onVideoDefaultsChange({ count })}>{count} 条</button>)}</div></div>
          </div>}
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
