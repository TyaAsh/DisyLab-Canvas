import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, Check, ChevronDown, ChevronRight, Download, FileImage, FileUp, FolderArchive, GripHorizontal, Grid3X3, ImagePlus, Layers3, LoaderCircle, PackageCheck, Plus, Settings2, Sparkles, Trash2, WandSparkles, X } from 'lucide-react'
import {
  COMIC_ASSET_LABELS, COMIC_LAYOUTS, COMIC_STYLE_LABELS, buildAssetPlan, buildAssetRequests, buildCompositionRequests, buildSketchRequests,
  createComicSection, createComicWorkflow, estimatePanelCount, normalizeComicWorkflow, type ComicAssetCategory, type ComicGeneratedResult, type ComicGenerationRequest,
  type ComicComposition, type ComicLayout, type ComicStyle, type ComicWorkflowState,
} from '../skills/storyboard'
import { GlassSelect } from './GlassSelect'
import { exportComicKit } from '../skills/comicExport'
import { applyNiuniuInvokeImport, parseNiuniuInvokeText } from '../skills/niuniuInvoke'

type TextModelOption = { key: string; name: string; connectionName: string }
type Props = {
  open: boolean
  initialContent: string
  initialState?: ComicWorkflowState
  requestedViewStage?: number
  imageModels: Array<{ key: string; label: string }>
  imageModelKey: string
  onImageModelChange: (key: string) => void
  textModels: TextModelOption[]
  selectedTextModelKey: string
  onSelectTextModel: (key: string) => void
  onConfigureTextModels: () => void
  recoveredCompositions?: ComicComposition[]
  generating: boolean
  onClose: () => void
  onUpdate: (state: ComicWorkflowState) => void
  onFork: (state: ComicWorkflowState) => ComicWorkflowState
  onGenerate: (requests: ComicGenerationRequest[]) => Promise<ComicGeneratedResult[]>
  onOptimize: (field: string, value: string, modelKey?: string) => Promise<string>
}

function OptimizeModelMenu({ anchor, models, selectedKey, onSelect, onConfigure, onClose }: { anchor: HTMLElement; models: TextModelOption[]; selectedKey: string; onSelect: (key: string) => void; onConfigure: () => void; onClose: () => void }) {
  const [style, setStyle] = useState<React.CSSProperties>({})
  useLayoutEffect(() => {
    const place = () => {
      const rect = anchor.getBoundingClientRect()
      const width = Math.min(250, window.innerWidth - 16)
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))
      const estimatedHeight = Math.min(300, 38 + Math.max(1, models.length) * 45)
      const openBelow = rect.top < estimatedHeight + 16 && window.innerHeight - rect.bottom > rect.top
      setStyle({ position: 'fixed', zIndex: 1200, width, left, maxHeight: Math.max(120, openBelow ? window.innerHeight - rect.bottom - 12 : rect.top - 12), overflowY: 'auto', ...(openBelow ? { top: rect.bottom + 7 } : { bottom: window.innerHeight - rect.top + 7 }) })
    }
    place(); window.addEventListener('resize', place); window.addEventListener('scroll', place, true)
    const close = (event: PointerEvent) => { if (!anchor.contains(event.target as Node)) onClose() }
    document.addEventListener('pointerdown', close)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); document.removeEventListener('pointerdown', close) }
  }, [anchor, models.length, onClose])
  return createPortal(<div className="prompt-optimize-model-menu skill-optimize-model-menu" style={style} onPointerDown={(event) => event.stopPropagation()}><header><span>优化对话模型</span><small>{models.length} 个可用</small></header>{models.map((model) => <button type="button" className={model.key === selectedKey ? 'is-selected' : ''} key={model.key} onClick={() => { onSelect(model.key); onClose() }}><span><strong>{model.name}</strong><small>{model.connectionName}</small></span>{model.key === selectedKey && <Check size={13}/>}</button>)}{!models.length && <button type="button" className="is-empty" onClick={() => { onClose(); onConfigure() }}><Settings2 size={13}/><span>配置对话模型</span></button>}</div>, document.body)
}

const STEPS = [
  { key: 'content', label: '内容', hint: '区块脚本' }, { key: 'visual', label: '画面', hint: '版式风格' }, { key: 'sketches', label: '骨架', hint: '黑白 A / B / C' },
  { key: 'composition', label: '构图', hint: '确认构图' }, { key: 'assets', label: '素材', hint: '分层生产' }, { key: 'delivery', label: '交付', hint: '素材包' },
] as const

function stageIndex(status: ComicWorkflowState['status']) { return status === 'completed' ? 5 : Math.max(0, STEPS.findIndex((step) => step.key === status)) }
function safeFileName(value: string) { return value.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').slice(0, 72) || 'comic-kit' }
function resultMap(results: ComicGeneratedResult[]) { return new Map(results.map((result) => [result.requestId, result])) }
function mergeCompositions(existing: ComicComposition[], incoming: ComicComposition[]) {
  const byRequestId = new Map<string, ComicComposition>()
  for (const composition of existing) byRequestId.set(composition.requestId, composition)
  for (const composition of incoming) byRequestId.set(composition.requestId, composition)
  return Array.from(byRequestId.values())
}

export function StoryboardComicWorkflow({ open, initialContent, initialState, requestedViewStage, imageModels, imageModelKey, onImageModelChange, textModels, selectedTextModelKey, onSelectTextModel, onConfigureTextModels, recoveredCompositions = [], generating, onClose, onUpdate, onFork, onGenerate, onOptimize }: Props) {
  const isComicWorkflow = (workflow?: ComicWorkflowState): workflow is ComicWorkflowState => Boolean(workflow?.skillKey?.includes('storyboard-comic') || workflow?.skillKey?.includes('niuniu-comic'))
  const [state, setState] = useState<ComicWorkflowState>(() => isComicWorkflow(initialState) ? normalizeComicWorkflow(initialState) : createComicWorkflow(initialContent))
  const [viewStage, setViewStage] = useState(() => requestedViewStage ?? stageIndex(isComicWorkflow(initialState) ? initialState.status : 'content'))
  const [busy, setBusy] = useState(false)
  const [runLabel, setRunLabel] = useState('')
  const [modelMenuField, setModelMenuField] = useState('')
  const modelAnchorRef = useRef<HTMLElement | null>(null)
  const [exportLabel, setExportLabel] = useState('')
  const [optimizingField, setOptimizingField] = useState('')
  const [importNotice, setImportNotice] = useState('')
  const [briefOpen, setBriefOpen] = useState(false)
  const [briefInput, setBriefInput] = useState('')
  const [structuredDraft, setStructuredDraft] = useState('')
  const [briefBusy, setBriefBusy] = useState(false)
  const [briefNotice, setBriefNotice] = useState('')
  const [position, setPosition] = useState({ x: Math.max(12, window.innerWidth - 480), y: 146 })
  const [size, setSize] = useState({ width: Math.min(462, window.innerWidth - 36), height: Math.min(560, window.innerHeight - 164) })
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const resizeRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null)
  const layoutFileRef = useRef<HTMLInputElement>(null)
  const invokeFileRef = useRef<HTMLInputElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const onUpdateRef = useRef(onUpdate)
  onUpdateRef.current = onUpdate
  useEffect(() => {
    if (!open) return
    let next = isComicWorkflow(initialState) ? normalizeComicWorkflow(initialState) : createComicWorkflow(initialContent)
    const recovered = recoveredCompositions.filter((composition) => !next.compositions.some((item) => item.requestId === composition.requestId))
    if (recovered.length) {
      next = { ...next, compositions: mergeCompositions(next.compositions, recovered), updatedAt: Date.now() }
      onUpdateRef.current(next)
    }
    setState(next)
    setViewStage(Math.min(stageIndex(next.status), requestedViewStage ?? stageIndex(next.status)))
  }, [open])
  useEffect(() => {
    if (!open) return
    setState((current) => {
      if (current.compositions.length) {
        const fromState = initialState?.compositions ?? []
        if (!fromState.length) return current
        const knownIds = new Set(current.compositions.map((composition) => composition.requestId))
        const missing = fromState.filter((composition) => !knownIds.has(composition.requestId))
        if (!missing.length) return current
        const next = { ...current, compositions: [...current.compositions, ...missing], updatedAt: Date.now() }
        onUpdateRef.current(next)
        return next
      }
      const incoming = mergeCompositions(initialState?.compositions ?? [], recoveredCompositions)
      if (!incoming.length) return current
      const next = {
        ...current,
        compositions: incoming,
        status: current.status === 'sketches' || current.status === 'composition' ? 'composition' as const : current.status,
        updatedAt: Date.now(),
      }
      onUpdateRef.current(next)
      return next
    })
  }, [open, initialState?.updatedAt, initialState?.compositions, recoveredCompositions])
  useEffect(() => {
    if (!open || requestedViewStage === undefined) return
    setViewStage(Math.min(stageIndex(state.status), requestedViewStage))
  }, [open, requestedViewStage])
  useEffect(() => { mainRef.current?.scrollTo({ top: 0 }) }, [viewStage])
  const save = (next: ComicWorkflowState) => {
    const stamped = { ...next, updatedAt: Date.now() }
    const nextStage = stageIndex(stamped.status)
    setState(stamped)
    setViewStage((current) => nextStage !== stageIndex(state.status) ? nextStage : current)
    onUpdate(stamped)
  }
  const currentStage = stageIndex(state.status)
  const reviewingPreviousStage = viewStage < currentStage
  const running = busy || generating
  const patch = (value: Partial<ComicWorkflowState>) => {
    if (running) return
    if (!reviewingPreviousStage) { save({ ...state, ...value }); return }
    // 回看时首次修改即 Fork 任务：旧任务可继续，新任务从修改步骤重新推进。
    save(onFork({ ...state, ...value, status: STEPS[viewStage].key }))
  }
  const panelCount = estimatePanelCount(state)
  const enabledAssetTasks = state.assetTasks.filter((task) => task.enabled)
  const completedAssetTasks = state.assetTasks.filter((task) => task.status === 'completed')
  const layoutReferences = state.layoutReferences?.length ? state.layoutReferences : state.layoutReference ? [state.layoutReference] : []
  const groupedAssets = useMemo(() => (Object.keys(COMIC_ASSET_LABELS) as ComicAssetCategory[]).map((category) => ({ category, tasks: state.assetTasks.filter((task) => task.category === category) })), [state.assetTasks])
  const isNiuniu = state.profile === 'niuniu' || state.skillKey.includes('niuniu-comic')

  if (!open) return null

  const generateSketches = async () => {
    setBusy(true); setRunLabel('正在生成 A / B / C 三版黑白阅读骨架')
    try {
      const requests = buildSketchRequests(state); const results = resultMap(await onGenerate(requests))
      const sketches = requests.flatMap((request) => { const result = results.get(request.id); const layout = request.meta.layout; if (!result || !layout) return []; const info = COMIC_LAYOUTS.find((item) => item.id === layout)!; return [{ ...result, layout, name: info.name, detail: info.detail }] })
      save({ ...state, sketches, selectedLayouts: [], compositions: [], selectedCompositionIds: [], assetTasks: [], kits: [], status: 'sketches' })
    } finally { setBusy(false); setRunLabel('') }
  }

  const generateCompositions = async () => {
    if (!state.selectedLayouts.length) return
    setBusy(true); setRunLabel('正在生成构图粗稿')
    let failed = false
    try {
      const requests = buildCompositionRequests(state); const results = resultMap(await onGenerate(requests))
      const compositions = requests.flatMap((request) => { const result = results.get(request.id); const { layout, style } = request.meta; return result && layout && style ? [{ ...result, layout, style }] : [] })
      if (!compositions.length) {
        failed = true
        setRunLabel('构图生成失败，请重试')
        return
      }
      save({ ...state, compositions: mergeCompositions([], compositions), selectedCompositionIds: [], assetTasks: [], kits: [], status: 'composition' })
    } finally {
      setBusy(false)
      if (!failed) setRunLabel('')
    }
  }

  const prepareAssets = () => {
    if (!state.selectedCompositionIds.length) return
    save({ ...state, assetTasks: buildAssetPlan(state), kits: [], status: 'assets' })
  }

  const generateAssets = async () => {
    const selected = state.compositions.filter((item) => state.selectedCompositionIds.includes(item.id))
    if (!selected.length || !enabledAssetTasks.length) return
    const generatingTasks = state.assetTasks.map((task) => task.enabled && task.status !== 'completed' ? { ...task, status: 'generating' as const } : task)
    const runningState = { ...state, assetTasks: generatingTasks }
    save(runningState); setBusy(true); setRunLabel(`正在生产 ${enabledAssetTasks.length} 项分层素材`)
    try {
      const requests = selected.flatMap((composition) => buildAssetRequests(runningState, composition))
      const results = resultMap(await onGenerate(requests))
      const assetTasks = generatingTasks.map((task) => {
        if (!task.enabled || task.status === 'completed') return task
        const result = results.get(`request-${task.id}`)
        return result ? { ...task, status: 'completed' as const, result } : { ...task, status: 'failed' as const }
      })
      const kits = selected.map((composition) => ({ id: `kit-${crypto.randomUUID()}`, name: `${COMIC_LAYOUTS.find((item) => item.id === composition.layout)?.shortName.toLowerCase()}_${composition.style}`, layout: composition.layout, style: composition.style, compositionId: composition.id, assetTaskIds: assetTasks.filter((task) => task.compositionId === composition.id && task.status === 'completed').map((task) => task.id), createdAt: Date.now() }))
      save({ ...runningState, assetTasks, kits, status: 'delivery' })
    } finally { setBusy(false); setRunLabel('') }
  }

  const previous = () => {
    if (viewStage === 0 || running) return
    setViewStage((current) => Math.max(0, current - 1))
  }

  const startDrag = (event: React.PointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button')) return
    if (window.innerWidth < 640) return
    dragRef.current = { x: event.clientX, y: event.clientY, left: position.x, top: position.y }
    const move = (nextEvent: PointerEvent) => {
      const drag = dragRef.current; if (!drag) return
      setPosition({ x: Math.max(8, Math.min(window.innerWidth - size.width - 8, drag.left + nextEvent.clientX - drag.x)), y: Math.max(8, Math.min(window.innerHeight - 120, drag.top + nextEvent.clientY - drag.y)) })
    }
    const up = () => { dragRef.current = null; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault(); event.stopPropagation()
    if (window.innerWidth < 640) return
    resizeRef.current = { x: event.clientX, y: event.clientY, width: size.width, height: size.height }
    const move = (nextEvent: PointerEvent) => {
      const resize = resizeRef.current; if (!resize) return
      setSize({
        width: Math.max(400, Math.min(window.innerWidth - position.x - 8, resize.width + nextEvent.clientX - resize.x)),
        height: Math.max(420, Math.min(window.innerHeight - position.y - 8, resize.height + nextEvent.clientY - resize.y)),
      })
    }
    const up = () => { resizeRef.current = null; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }
  const runExport = async () => {
    setExportLabel('正在整理图片与联系表…')
    try { const result = await exportComicKit(state); setExportLabel(`已交付 ${result.count} 个文件 · ${result.fileName}`) } catch (error) { setExportLabel(error instanceof Error ? error.message : '导出失败，请重试') }
  }
  const optimizeSectionField = async (sectionId: string, field: 'body' | 'visualNote' | 'point', index?: number) => {
    const section = state.sections.find((item) => item.id === sectionId)
    const value = field === 'point' ? section?.points[index ?? -1] ?? '' : section?.[field] ?? ''
    if (!value.trim() || optimizingField || running) return
    const key = `${sectionId}-${field}-${index ?? ''}`
    setOptimizingField(key)
    setModelMenuField('')
    try {
      const label = field === 'body' ? '区块主要内容' : field === 'visualNote' ? '区块画面要求' : `区块要点 ${Number(index) + 1}`
      const optimized = await onOptimize(label, value, selectedTextModelKey)
      patch({ sections: state.sections.map((item) => item.id !== sectionId ? item : field === 'point' ? { ...item, points: item.points.map((point, pointIndex) => pointIndex === index ? optimized : point) } : { ...item, [field]: optimized }) })
    } finally { setOptimizingField('') }
  }
  const selectedTextModelLabel = textModels.find((model) => model.key === selectedTextModelKey)?.name
  const optimizeControl = (key: string, disabled: boolean, loading: boolean, onRun: () => void, ariaLabel = '优化') => (
    <div className="comic-field-optimize prompt-optimize-control">
      <button type="button" className="prompt-optimize-button" disabled={disabled} title={selectedTextModelLabel ? `使用 ${selectedTextModelLabel} 优化` : '选择对话模型后优化'} onClick={onRun}>
        {loading ? <LoaderCircle className="is-spinning" size={13}/> : <WandSparkles size={13}/>}<span>{ariaLabel}</span>
      </button>
      <button type="button" className={`prompt-optimize-model-trigger ${modelMenuField === key ? 'is-open' : ''}`} title={selectedTextModelLabel ? `对话模型：${selectedTextModelLabel}` : '选择对话模型'} aria-label="选择优化对话模型" aria-expanded={modelMenuField === key} onClick={(event) => { modelAnchorRef.current = event.currentTarget; setModelMenuField((current) => current === key ? '' : key) }}><ChevronDown size={12}/></button>
      {modelMenuField === key && modelAnchorRef.current && <OptimizeModelMenu anchor={modelAnchorRef.current} models={textModels} selectedKey={selectedTextModelKey} onSelect={onSelectTextModel} onConfigure={onConfigureTextModels} onClose={() => setModelMenuField('')} />}
    </div>
  )
  const importInvokeText = async (file?: File) => {
    if (!file) return
    if (!/\.txt$/i.test(file.name)) { setImportNotice('请选择 .txt 调用词文件'); return }
    if (file.size > 512 * 1024) { setImportNotice('TXT 超过 512KB，请精简后再导入'); return }
    try {
      const imported = parseNiuniuInvokeText(await file.text())
      if (!imported.sections.length) { setImportNotice(imported.warnings.join('；')); return }
      save(applyNiuniuInvokeImport(state, imported))
      setImportNotice(`已导入 ${file.name} · ${imported.sections.length} 个区块${imported.warnings.length ? `；${imported.warnings.join('；')}` : ''}`)
    } catch (error) { setImportNotice(error instanceof Error ? error.message : '调用词解析失败') }
  }
  const optimizeBrief = async () => {
    if (!briefInput.trim() || briefBusy) return
    setBriefBusy(true); setBriefNotice(''); setModelMenuField('')
    try {
      const optimized = await onOptimize('牛牛漫画调用词结构化', briefInput, selectedTextModelKey)
      setStructuredDraft(optimized)
      const parsed = parseNiuniuInvokeText(optimized)
      setBriefNotice(parsed.sections.length ? `已整理为 ${parsed.sections.length} 个区块，请审核后应用` : '模型结果未识别到区块，请修改后重试')
    } finally { setBriefBusy(false) }
  }
  const applyStructuredBrief = () => {
    const imported = parseNiuniuInvokeText(structuredDraft)
    if (!imported.sections.length) { setBriefNotice(imported.warnings.join('；')); return }
    save(applyNiuniuInvokeImport(state, imported)); setImportNotice(`已应用一句话需求 · ${imported.sections.length} 个区块`); setBriefOpen(false)
  }

  return createPortal(<div className="comic-studio-backdrop">
    <section className="comic-studio nodrag nowheel" style={{ left: position.x, right: 'auto', top: position.y, width: size.width, height: size.height }} role="dialog" aria-modal="false" aria-labelledby="comic-studio-title" onPointerDown={(event) => event.stopPropagation()}>
      <header className="comic-studio-header" onPointerDown={startDrag}>
        <div className="comic-studio-brand"><span><Sparkles size={19}/></span><div><small>{state.status === 'completed' ? '已完成' : `进行中 · 第 ${currentStage + 1} 步`}</small><h2 id="comic-studio-title">{isNiuniu ? '牛牛漫画素材工厂' : '漫画分镜素材工厂'}</h2></div></div>
        <div className="comic-studio-meta"><GripHorizontal className="comic-drag-grip" size={16}/><span>{panelCount} 格</span><span>{state.aspectRatio}</span><button type="button" aria-label="关闭" disabled={running} onClick={onClose}><X size={18}/></button></div>
      </header>
      <div className="comic-studio-shell">
        <aside className="comic-studio-steps">
          <div className="comic-studio-project-mark"><i>{safeFileName(state.projectName).slice(0, 2).toUpperCase()}</i><span><b>{state.projectName}</b><small>素材工厂 · 自动保存</small></span></div>
          <nav>{STEPS.map((step, index) => <button type="button" key={step.key} className={`${index === viewStage ? 'is-active ' : ''}${index < currentStage ? 'is-done ' : ''}${index === currentStage ? 'is-current' : ''}`.trim()} disabled={index > currentStage} onClick={() => index <= currentStage && setViewStage(index)} title={index < currentStage ? `查看第 ${index + 1} 步，不会中断当前工作` : index === currentStage ? '返回当前进行中的步骤' : undefined}><i>{index < currentStage ? <Check size={13}/> : String(index + 1).padStart(2, '0')}</i><span><b>{step.label}</b><small>{index === currentStage && reviewingPreviousStage ? '进行中' : step.hint}</small></span>{index === viewStage && <ChevronRight size={14}/>}</button>)}</nav>
          <div className="comic-studio-rule"><Layers3 size={16}/><p><b>{isNiuniu ? '牛牛 IP 已锁定' : '内容守恒已开启'}</b><span>{isNiuniu ? '完整身高与纵向轮廓复制母版；禁止压矮、缩腿和加宽。' : '大标签、小标签、正文与要点不会跨区块拆散。'}</span></p></div>
        </aside>

        <main ref={mainRef} className={`comic-studio-main ${reviewingPreviousStage ? 'is-reviewing' : ''}`}>
          <fieldset disabled={running} style={{ border: 0, margin: 0, minWidth: 0, padding: 0 }}>
          {reviewingPreviousStage && <div className="comic-reviewing-banner"><span>正在查看第 {viewStage + 1} 步</span><small>引导式 Skill 仍停留在第 {currentStage + 1} 步，当前工作不会中断。</small><button type="button" onClick={() => setViewStage(currentStage)}>返回进行中的步骤</button></div>}
          {viewStage === 0 && <>
            <div className="comic-studio-title"><small>第 1 步</small><h3>把脚本变成不会散架的区块</h3><p>每个区块是一组必须连续呈现的信息。你可以增删区块和要点，系统不会擅自重排或编号。</p>{isNiuniu && <div className="comic-invoke-actions"><button className="comic-demo-button" type="button" onClick={() => invokeFileRef.current?.click()}><FileUp size={13}/>导入调用词 TXT</button><button className="comic-demo-button" type="button" onClick={() => setBriefOpen(true)}><WandSparkles size={13}/>一句话写需求</button><input hidden ref={invokeFileRef} type="file" accept=".txt,text/plain" onChange={(event) => { void importInvokeText(event.target.files?.[0]); event.currentTarget.value = '' }}/>{importNotice && <span>{importNotice}</span>}</div>}</div>
            <div className="comic-studio-form-grid"><label><span>项目名称</span><input value={state.projectName} onChange={(e) => patch({ projectName: e.target.value })}/></label><label><span>主题 / 脚本</span><input value={state.theme} placeholder="例如：SPX 与 VIX 入门" onChange={(e) => patch({ theme: e.target.value })}/></label></div>
            <div className="comic-section-stack">{state.sections.map((section, sectionIndex) => <article className="comic-section-card" key={section.id}>
              <header><span><i>{String(sectionIndex + 1).padStart(2, '0')}</i><b>{section.name || `区块 ${sectionIndex + 1}`}</b></span>{state.sections.length > 1 && <button type="button" aria-label="删除区块" onClick={() => patch({ sections: state.sections.filter((item) => item.id !== section.id) })}><Trash2 size={15}/></button>}</header>
              <div className="comic-section-fields"><label><span>区块</span><input value={section.name} placeholder="如 SPX" onChange={(e) => patch({ sections: state.sections.map((item) => item.id === section.id ? { ...item, name: e.target.value } : item) })}/></label><label><span>大标签</span><input value={section.headline ?? ''} placeholder="如 SPX 全球成交量最大的指數期權" onChange={(e) => patch({ sections: state.sections.map((item) => item.id === section.id ? { ...item, headline: e.target.value } : item) })}/></label><label><span>小标签</span><input value={section.label} placeholder="如 適合場景" onChange={(e) => patch({ sections: state.sections.map((item) => item.id === section.id ? { ...item, label: e.target.value } : item) })}/></label><label className="is-wide"><span>主要内容</span><div className="comic-section-text-control"><textarea value={section.body} placeholder="这一部分需要说明什么？" onChange={(e) => patch({ sections: state.sections.map((item) => item.id === section.id ? { ...item, body: e.target.value } : item) })}/>{optimizeControl(`${section.id}-body`, !section.body.trim() || Boolean(optimizingField), optimizingField === `${section.id}-body-`, () => void optimizeSectionField(section.id, 'body'))}</div></label></div>
              <div className="comic-point-list"><span>要点</span>{section.points.map((point, pointIndex) => <label className="comic-point-field" key={`${section.id}-${pointIndex}`}><div className="comic-section-text-control"><textarea value={point} placeholder={`要点 ${pointIndex + 1}`} onChange={(e) => patch({ sections: state.sections.map((item) => item.id === section.id ? { ...item, points: item.points.map((value, index) => index === pointIndex ? e.target.value : value) } : item) })}/>{optimizeControl(`${section.id}-point-${pointIndex}`, !point.trim() || Boolean(optimizingField), optimizingField === `${section.id}-point-${pointIndex}`, () => void optimizeSectionField(section.id, 'point', pointIndex))}</div>{section.points.length > 1 && <button className="comic-point-remove" type="button" aria-label={`删除要点 ${pointIndex + 1}`} onClick={() => patch({ sections: state.sections.map((item) => item.id === section.id ? { ...item, points: item.points.filter((_, index) => index !== pointIndex) } : item) })}><X size={13}/></button>}</label>)}<button type="button" onClick={() => patch({ sections: state.sections.map((item) => item.id === section.id ? { ...item, points: [...item.points, ''] } : item) })}><Plus size={13}/>添加要点</button></div>
              <label className="comic-visual-note"><span>本区块画面要求</span><div className="comic-section-text-control"><textarea value={section.visualNote} placeholder="可选：场景、情绪、动作或不要出现的元素" onChange={(e) => patch({ sections: state.sections.map((item) => item.id === section.id ? { ...item, visualNote: e.target.value } : item) })}/>{optimizeControl(`${section.id}-visualNote`, !section.visualNote.trim() || Boolean(optimizingField), optimizingField === `${section.id}-visualNote-`, () => void optimizeSectionField(section.id, 'visualNote'))}</div></label>
            </article>)}</div>
            <button className="comic-add-section" type="button" onClick={() => patch({ sections: [...state.sections, createComicSection(state.sections.length)] })}><Plus size={16}/><span><b>添加内容区块</b><small>大标签、小标签、正文与要点将作为一个整体</small></span></button>
          </>}

          {viewStage === 1 && <>
            <div className="comic-studio-title"><small>第 2 步</small><h3>把画面规则和交付方式一次说清</h3><p>排版、画风和角色参考彼此独立；排版参考只影响切割与留白。</p></div>
            <div className="comic-visual-grid"><section><header><Grid3X3 size={17}/><span><b>版式</b><small>FORMAT</small></span></header><div className="comic-field-pair"><label><span>画幅</span><GlassSelect ariaLabel="画幅" value={state.aspectRatio} options={['1:1','9:16','16:9','3:4','4:3'].map((value) => ({ value, label: value }))} onChange={(value) => patch({ aspectRatio: value })}/></label><label><span>格数</span><GlassSelect ariaLabel="格数" value={state.gridMode} options={[{value:'auto',label:`自动 · 建议 ${panelCount} 格`},{value:'manual',label:'手动指定'}]} onChange={(value) => patch({ gridMode: value as 'auto' | 'manual' })}/></label></div>{state.gridMode === 'manual' && <label className="comic-inline-field"><span>手动格数</span><input type="number" min={1} max={24} value={state.gridCount ?? panelCount} onChange={(e) => patch({ gridCount: Number(e.target.value) })}/></label>}<div className={`comic-reference-upload ${layoutReferences.length ? 'has-reference' : ''}`}>{layoutReferences.length ? <div className="comic-reference-thumbnails">{layoutReferences.map((reference, index) => <span key={`${reference.name}-${index}`}><img src={reference.url} alt={`排版参考图 ${index + 1}`}/><button type="button" aria-label={`移除参考图 ${reference.name}`} onClick={() => patch({ layoutReferences: layoutReferences.filter((_, itemIndex) => itemIndex !== index), layoutReference: undefined })}><X size={11}/></button></span>)}</div> : <ImagePlus size={18}/>}<button type="button" className="comic-reference-add" onClick={() => layoutFileRef.current?.click()}><span><b>{layoutReferences.length ? `${layoutReferences.length} 张排版参考图` : '上传排版参考图'}</b><small>{layoutReferences.length ? '继续添加或重新选择 · 完整学习切割与构图' : '可多选 · 完整学习切割、比例、动线与构图'}</small></span><em>{layoutReferences.length ? '继续上传' : '选择图片'}</em></button></div><input hidden multiple ref={layoutFileRef} type="file" accept="image/*" onChange={(event) => { const files = Array.from(event.target.files ?? []).slice(0, Math.max(0, 16 - layoutReferences.length)); if (!files.length) return; Promise.all(files.map((file) => new Promise<{name:string;url:string}>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve({ name: file.name, url: reader.result }) : reject(new Error('图片读取失败')); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file) }))).then((references) => patch({ layoutReferences: [...layoutReferences, ...references], layoutReference: undefined })); event.currentTarget.value = '' }}/></section>
              <section><header><Sparkles size={17}/><span><b>风格</b><small>STYLE</small></span></header><div className="comic-style-choices">{(['2d','3d'] as ComicStyle[]).map((style) => <button type="button" key={style} className={state.style === style ? 'is-selected' : ''} onClick={() => patch({ style })}><i className={`is-${style}`}/><b>{COMIC_STYLE_LABELS[style]}</b></button>)}</div><label className="comic-toggle"><input type="checkbox" checked={state.styleCompare} onChange={(e) => patch({ styleCompare: e.target.checked })}/><span><b>构图阶段生成两种风格对比</b><small>会按所选骨架分别生成 2D 与 3D</small></span></label><label className="comic-model-field"><span>黑白骨架生图模型</span><GlassSelect ariaLabel="黑白骨架生图模型" value={imageModelKey} options={imageModels.map((model) => ({ value: model.key, label: model.label }))} onChange={onImageModelChange}/><small>模型可自由选择；牛牛身份参考始终强制附带，不能被模型选择关闭。</small></label></section>
              <section className="is-wide"><header><FileImage size={17}/><span><b>全局画面约束</b><small>VISUAL NOTES</small></span></header>{isNiuniu && <div className="comic-profile-lock"><Check size={14}/><span><b>10 张牛牛身份母版已强制载入</b><small>2D 与 3D 母版按风格隔离调用；完整站立高度、纵向轮廓、五官、躯干和腿长直接以对应母版为准，禁止压矮、缩腿和加宽。</small></span></div>}<textarea value={state.globalVisualNote} onChange={(e) => patch({ globalVisualNote: e.target.value })}/><label className="comic-toggle"><input type="checkbox" checked={state.allowSceneOnly} onChange={(e) => patch({ allowSceneOnly: e.target.checked })}/><span><b>允许个别区块只有场景与元素</b><small>不强制角色出现在每个区块</small></span></label></section>
              <section className="is-wide comic-delivery-settings"><header><FolderArchive size={17}/><span><b>交付方式</b><small>DELIVERY</small></span></header><div className="comic-field-pair"><label><span>输出</span><GlassSelect ariaLabel="输出方式" value={state.outputTarget} options={[{value:'download',label:'ZIP 下载'},{value:'folder',label:'选择本地文件夹'},{value:'project',label:'项目 + ZIP'}]} onChange={(value) => patch({ outputTarget: value as ComicWorkflowState['outputTarget'] })}/></label><label><span>文件名前缀</span><input autoComplete="off" spellCheck={false} value={state.filePrefix} placeholder="例如 comic" onChange={(e) => patch({ filePrefix: e.target.value })}/></label></div><p>用于导出文件夹和 ZIP 命名，可使用中文、英文、数字、短横线。</p></section>
            </div>
          </>}

          {viewStage === 2 && <>
            <div className="comic-studio-title"><small>第 3 步</small><h3>比较 A / B / C 三种黑白阅读骨架</h3><p>{isNiuniu ? '纯黑粗实线稿 + 纯白底；牛牛完整身高、纵向轮廓、五官、躯干和腿长直接复制 2D 母版。' : '这里只比较分格、切割、构图和阅读动线；彩色成片效果在下一步构图阶段生成。'}</p></div>
            <section className="comic-generation-settings"><header><Sparkles size={16}/><span><b>彩色成片生成设置</b><small>GENERATION</small></span></header><div><label><span>生图模型</span><GlassSelect ariaLabel="彩色成片生图模型" value={imageModelKey} options={imageModels.map((model) => ({ value: model.key, label: model.label }))} onChange={onImageModelChange}/></label><label><span>每种构图数量</span><div className="comic-count-choices">{[1,2,3,4].map((count) => <button type="button" key={count} className={(state.compositionCount ?? 1) === count ? 'is-selected' : ''} onClick={() => patch({ compositionCount: count })}>{count}×</button>)}</div></label></div><p>数量按“已选骨架 × 风格”计算；牛牛 2D / 3D 身份参考会按风格自动强制附带。</p></section>
            <div className="comic-result-grid is-sketches">{state.sketches.map((sketch) => <button type="button" key={sketch.id} className={state.selectedLayouts.includes(sketch.layout) ? 'is-selected' : ''} onClick={() => patch({ selectedLayouts: state.selectedLayouts.includes(sketch.layout) ? state.selectedLayouts.filter((item) => item !== sketch.layout) : [...state.selectedLayouts, sketch.layout] })}><figure><img src={sketch.url} alt={sketch.name}/><i>{COMIC_LAYOUTS.find((item) => item.id === sketch.layout)?.shortName}</i>{state.selectedLayouts.includes(sketch.layout) && <em><Check size={14}/></em>}</figure><span><b>{sketch.name}</b><small>{sketch.detail}</small></span></button>)}</div>
          </>}

          {viewStage === 3 && <>
            <div className="comic-studio-title"><small>第 4 步</small><h3>确认真正用于生产的构图</h3><p>{isNiuniu ? '成片保持专业可信，同时具备鲜明色彩、视觉焦点、镜头节奏与跨格设计；可批准一个或多个构图形成素材包。' : '可以批准一个或多个构图，每个批准项会形成独立素材包。没有明确确认前，不会生成任何素材。'}</p></div>
            {state.compositions.length ? (
              <div className="comic-result-grid is-compositions">{state.compositions.map((composition) => <button type="button" key={composition.id} className={state.selectedCompositionIds.includes(composition.id) ? 'is-selected' : ''} onClick={() => patch({ selectedCompositionIds: state.selectedCompositionIds.includes(composition.id) ? state.selectedCompositionIds.filter((id) => id !== composition.id) : [...state.selectedCompositionIds, composition.id] })}><figure><img src={composition.url} alt="构图粗稿"/>{state.selectedCompositionIds.includes(composition.id) && <em><Check size={14}/></em>}</figure><span><b>{COMIC_LAYOUTS.find((item) => item.id === composition.layout)?.name}</b><small>{COMIC_STYLE_LABELS[composition.style]}</small></span></button>)}</div>
            ) : (
              <div className="comic-empty-compositions">
                <b>还没有可确认的构图</b>
                <small>{state.selectedLayouts.length ? '若画布上已有彩色成片节点，稍等回填；也可直接重新生成。' : '请先返回上一步选择至少一种黑白骨架。'}</small>
              </div>
            )}
            <label className="comic-feedback"><span>构图修改反馈 <em>选填</em></span><textarea value={state.compositionFeedback} placeholder="非必填；需要重做时再填写，例如：第三格不要角色，只保留场景……" onChange={(e) => patch({ compositionFeedback: e.target.value })}/></label>
          </>}

          {viewStage === 4 && <>
            <div className="comic-studio-title"><small>第 5 步</small><h3>把构图拆成可复用的生产任务</h3><p>每项素材独立生成、独立失败、独立重试。取消勾选即可跳过不需要的类别或区块。</p></div>
            <div className="comic-asset-summary"><span><b>{enabledAssetTasks.length}</b><small>待生产素材</small></span><span><b>{completedAssetTasks.length}</b><small>已完成</small></span><span><b>{state.selectedCompositionIds.length}</b><small>Kit 方案</small></span><button type="button" onClick={() => patch({ assetTasks: state.assetTasks.map((task) => ({ ...task, enabled: !state.assetTasks.every((item) => item.enabled) })) })}>{state.assetTasks.every((task) => task.enabled) ? '全部取消' : '全部选择'}</button></div>
            <div className="comic-asset-groups">{groupedAssets.map(({ category, tasks }) => <section key={category}><header><span><i className={`is-${category}`}><Layers3 size={15}/></i><b>{COMIC_ASSET_LABELS[category]}</b></span><small>{tasks.filter((task) => task.enabled).length} / {tasks.length}</small></header><div>{tasks.map((task) => <label key={task.id} className={`is-${task.status}`}><input type="checkbox" checked={task.enabled} disabled={task.status === 'completed' || running} onChange={(e) => patch({ assetTasks: state.assetTasks.map((item) => item.id === task.id ? { ...item, enabled: e.target.checked, status: e.target.checked ? 'pending' : 'skipped' } : item) })}/>{task.result ? <img src={task.result.url} alt=""/> : <i>{task.panelIndex}</i>}<span><b>{task.name}</b><small>{task.sectionName} · {task.status === 'completed' ? '已完成' : task.status === 'failed' ? '失败，可重试' : '等待生成'}</small></span></label>)}</div></section>)}</div>
          </>}

          {viewStage === 5 && <>
            <div className="comic-studio-title"><small>第 6 步</small><h3>素材包已整理完成</h3><p>结果已保存在当前项目和生成历史。导出清单记录构图、分层素材、来源区块与叠层顺序。</p></div>
            <div className="comic-delivery-hero"><PackageCheck size={34}/><span><b>{state.kits.length} 个 Kit · {completedAssetTasks.length} 项素材</b><small>backgrounds → scenes / props → cutouts → 可编辑正式文案</small></span></div>
            <div className="comic-kit-list">{state.kits.map((kit) => <article key={kit.id}><header><FolderArchive size={20}/><span><b>kits/{kit.name}/</b><small>{COMIC_LAYOUTS.find((item) => item.id === kit.layout)?.name} · {COMIC_STYLE_LABELS[kit.style]}</small></span><em>{kit.assetTaskIds.length} assets</em></header><div>{['comp/','cutouts/','props/','scenes/','backgrounds/','contacts/','kit.json','script.md'].map((item) => <span key={item}>{item}</span>)}</div></article>)}</div>
            <div className="comic-delivery-actions"><button type="button" onClick={() => void runExport()}><Download size={16}/><span><b>{state.outputTarget === 'folder' ? '写入完整素材文件夹' : '导出完整 ZIP 素材包'}</b><small>图片、联系表、脚本、Kit 清单与目录树</small></span></button><button type="button" className="is-primary" onClick={() => { patch({ status: 'completed' }); onClose() }}><PackageCheck size={16}/><span><b>完成并返回画布</b><small>素材已保留在当前节点与历史</small></span></button></div>
            {exportLabel && <p className="comic-export-status">{exportLabel}</p>}
          </>}
          </fieldset>
        </main>
      </div>

      <footer className="comic-studio-footer">
        <button type="button" disabled={viewStage === 0 || running} onClick={previous}><ArrowLeft size={15}/>查看上一步</button>
        <div>{running && <span><LoaderCircle size={14} className="is-spinning"/>{runLabel}</span>}
          {reviewingPreviousStage && <button className="is-primary" onClick={() => setViewStage(currentStage)}>返回第 {currentStage + 1} 步继续<ChevronRight size={15}/></button>}
          {!reviewingPreviousStage && currentStage === 0 && <button className="is-primary" disabled={!state.theme.trim() || !state.sections.some((section) => section.name.trim() && section.body.trim())} onClick={() => patch({ status: 'visual' })}>确认内容结构<ChevronRight size={15}/></button>}
          {!reviewingPreviousStage && currentStage === 1 && <button className="is-primary" disabled={running} onClick={() => void generateSketches()}>生成 A / B / C 三版黑白骨架<ChevronRight size={15}/></button>}
          {!reviewingPreviousStage && currentStage === 2 && <button className="is-primary" disabled={!state.selectedLayouts.length || running} onClick={() => void generateCompositions()}>生成 {state.selectedLayouts.length * (state.styleCompare ? 2 : 1) * (state.compositionCount ?? 1)} 张彩色成片构图<ChevronRight size={15}/></button>}
          {!reviewingPreviousStage && currentStage === 3 && <><button disabled={running || !state.selectedLayouts.length || (state.compositions.length > 0 && !state.compositionFeedback.trim())} onClick={() => void generateCompositions()}>{state.compositions.length ? '按反馈重做构图' : '重新生成构图'}</button><button className="is-primary" disabled={!state.selectedCompositionIds.length || running} onClick={prepareAssets}>确认 comp，建立素材计划<ChevronRight size={15}/></button></>}
          {!reviewingPreviousStage && currentStage === 4 && <button className="is-primary" disabled={!enabledAssetTasks.length || running} onClick={() => void generateAssets()}>确认生成 {enabledAssetTasks.length} 项素材<ChevronRight size={15}/></button>}
        </div>
      </footer>
      <div className="skill-workbench-resize" role="separator" aria-label="调整工作台大小" onPointerDown={startResize}/>
    </section>
    {briefOpen && <div className="comic-brief-layer" role="presentation" onPointerDown={(event) => event.stopPropagation()}><section className="comic-brief-dialog" role="dialog" aria-modal="true" aria-labelledby="comic-brief-title"><header><div><small>自然语言 → 标准调用词</small><h3 id="comic-brief-title">一句话写牛牛漫画需求</h3></div><button type="button" aria-label="关闭一句话需求" disabled={briefBusy} onClick={() => setBriefOpen(false)}><X size={17}/></button></header><main><label><span>你的需求</span><textarea value={briefInput} placeholder="例如：做一篇繁体中文的牛牛漫画，解释 SPX 和 VIX 的区别，9:16，先给我看 2D 和 3D 两种构图。" onChange={(event) => setBriefInput(event.target.value)}/></label><div className="comic-brief-optimize-control">{optimizeControl('brief', !briefInput.trim() || briefBusy, briefBusy, () => void optimizeBrief(), '优化并整理成调用词')}</div><label><span>结构化调用词 · 可继续编辑</span><textarea className="is-structured" value={structuredDraft} placeholder="优化结果会显示在这里，审核后再应用到素材工厂。" onChange={(event) => setStructuredDraft(event.target.value)}/></label>{briefNotice && <p>{briefNotice}</p>}</main><footer><button type="button" disabled={briefBusy} onClick={() => setBriefOpen(false)}>取消</button><button className="is-primary" type="button" disabled={!structuredDraft.trim() || briefBusy} onClick={applyStructuredBrief}>应用到素材工厂</button></footer></section></div>}
  </div>, document.body)
}
