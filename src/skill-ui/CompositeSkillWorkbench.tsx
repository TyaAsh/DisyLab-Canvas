import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, Check, ChevronRight, Clapperboard, FileCheck2, GripHorizontal, Layers3, LoaderCircle, Route, Sparkles, WandSparkles, X } from 'lucide-react'
import type { CompositeWorkbenchConfig } from '../skills/compositeBlueprints'
import type { SkillManifest } from '../skills/types'
import { GlassSelect } from './GlassSelect'

type Props = {
  skill: SkillManifest | null
  onClose: () => void
  onCreate: (config: CompositeWorkbenchConfig) => void
  onOptimize: (field: string, value: string) => Promise<string>
}

const defaults = (skill: SkillManifest): CompositeWorkbenchConfig => ({
  projectName: skill.composite?.blueprint === 'commerce-campaign' ? '新品上市计划' : skill.composite?.blueprint === 'character-world' ? '未命名角色世界' : '未命名影片',
  concept: '',
  audience: '面向实际观看、购买或使用该内容的人群',
  platform: skill.composite?.blueprint === 'commerce-campaign' ? '抖音 / 小红书 / 电商平台' : '抖音 / 视频号 / Reels',
  duration: skill.composite?.blueprint === 'character-world' ? '资产包，不限制时长' : '15–30 秒',
  aspectRatio: skill.composite?.blueprint === 'character-world' ? '16:9' : '9:16',
  visualStyle: '电影级真实材质，克制光效，主体身份和结构优先',
  assetNotes: '保持主体身份、结构、服装/包装、标志物、场景关系与主光方向一致',
  pacing: '开场快速识别，中段清楚展开，结尾保留呼吸与品牌落点',
  audio: '音乐节拍、动作音效和环境声共同服务画面，不覆盖对白或信息',
  shotCount: skill.composite?.blueprint === 'idea-to-film' ? 6 : 5,
})

export function CompositeSkillWorkbench({ skill, onClose, onCreate, onOptimize }: Props) {
  const [step, setStep] = useState(0)
  const [config, setConfig] = useState<CompositeWorkbenchConfig | null>(skill ? defaults(skill) : null)
  const [position, setPosition] = useState({ x: Math.max(18, window.innerWidth - 760), y: 44 })
  const [size, setSize] = useState({ width: Math.min(720, window.innerWidth - 36), height: Math.min(720, window.innerHeight - 88) })
  const [optimizingField, setOptimizingField] = useState('')
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const resizeRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null)
  useEffect(() => { if (skill) { setStep(0); setConfig(defaults(skill)) } }, [skill])
  const stages = skill?.composite?.stages ?? []
  const patch = (next: Partial<CompositeWorkbenchConfig>) => setConfig((current) => current ? { ...current, ...next } : current)
  const optimize = async (key: keyof CompositeWorkbenchConfig, label: string) => {
    const value = String(config?.[key] ?? '').trim()
    if (!value || optimizingField) return
    setOptimizingField(String(key))
    try { patch({ [key]: await onOptimize(label, value) }) } finally { setOptimizingField('') }
  }
  const optimizeButton = (key: keyof CompositeWorkbenchConfig, label: string) => <button type="button" className="composite-field-optimize" disabled={!String(config?.[key] ?? '').trim() || Boolean(optimizingField)} title={`优化${label}`} aria-label={`优化${label}`} onClick={() => void optimize(key, label)}>{optimizingField === key ? <LoaderCircle className="is-spinning" size={13}/> : <WandSparkles size={13}/>}<span>优化</span></button>
  const canContinue = useMemo(() => {
    if (!config) return false
    if (step === 0) return Boolean(config.projectName.trim() && config.concept.trim())
    if (step === 1) return Boolean(config.audience.trim() && config.assetNotes.trim())
    if (step === 2) return Boolean(config.visualStyle.trim() && config.shotCount >= 3)
    if (step === 3) return Boolean(config.platform.trim() && config.duration.trim())
    return true
  }, [config, step])

  if (!skill || !config || !skill.composite) return null

  const startDrag = (event: React.PointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button')) return
    if (window.innerWidth < 680) return
    dragRef.current = { x: event.clientX, y: event.clientY, left: position.x, top: position.y }
    const move = (next: PointerEvent) => {
      const drag = dragRef.current; if (!drag) return
      setPosition({
        x: Math.max(8, Math.min(window.innerWidth - size.width - 8, drag.left + next.clientX - drag.x)),
        y: Math.max(8, Math.min(window.innerHeight - 100, drag.top + next.clientY - drag.y)),
      })
    }
    const up = () => { dragRef.current = null; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault(); event.stopPropagation()
    if (window.innerWidth < 680) return
    resizeRef.current = { x: event.clientX, y: event.clientY, width: size.width, height: size.height }
    const move = (next: PointerEvent) => {
      const resize = resizeRef.current; if (!resize) return
      setSize({
        width: Math.max(520, Math.min(window.innerWidth - position.x - 8, resize.width + next.clientX - resize.x)),
        height: Math.max(520, Math.min(window.innerHeight - position.y - 8, resize.height + next.clientY - resize.y)),
      })
    }
    const up = () => { resizeRef.current = null; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }

  return createPortal(<div className="composite-workbench-layer">
    <section className="composite-workbench nodrag nowheel" style={{ left: position.x, top: position.y, width: size.width, height: size.height }} role="dialog" aria-modal="false" aria-labelledby="composite-workbench-title" onPointerDown={(event) => event.stopPropagation()}>
      <header className="composite-workbench-header" onPointerDown={startDrag}>
        <div className="composite-workbench-brand"><span><Route size={19}/></span><div><small>{skill.composite.eyebrow}</small><h2 id="composite-workbench-title">{skill.name}</h2></div></div>
        <div className="composite-workbench-meta"><GripHorizontal size={16}/><span>{stages.length} 阶段</span><span>{config.aspectRatio}</span><button type="button" aria-label={`关闭 ${skill.name}`} title="关闭" onClick={onClose}><X size={18}/></button></div>
      </header>
      <div className="composite-workbench-stagebar">{stages.map((stage, index) => <button type="button" key={stage.id} className={index === step ? 'is-active' : index < step ? 'is-done' : ''} disabled={index > step} onClick={() => index < step && setStep(index)}><i>{index < step ? <Check size={12}/> : String(index + 1).padStart(2, '0')}</i><span>{stage.label}</span></button>)}</div>
      <main className="composite-workbench-main">
        <div className="composite-workbench-intro"><small>{String(step + 1).padStart(2, '0')} / {stages[step]?.id.toUpperCase()}</small><h3>{stages[step]?.label}</h3><p>{stages[step]?.description}</p></div>
        {step === 0 && <div className="composite-workbench-form"><label><span>项目名称</span><input autoFocus value={config.projectName} onChange={(e) => patch({ projectName: e.target.value })}/></label><label className="is-wide"><span>核心想法 / 项目目标</span><div className="composite-field-control"><textarea value={config.concept} placeholder="一句话也可以。说明你想拍什么、希望观众感受到什么。" onChange={(e) => patch({ concept: e.target.value })}/>{optimizeButton('concept', '核心想法与项目目标')}</div></label><div className="composite-workbench-note"><Sparkles size={18}/><span><b>{skill.composite.promise}</b><small>系统不会在这一阶段生成昂贵素材。</small></span></div></div>}
        {step === 1 && <div className="composite-workbench-form"><label className="is-wide"><span>目标受众</span><input value={config.audience} onChange={(e) => patch({ audience: e.target.value })}/></label><label className="is-wide"><span>角色 / 产品 / 场景不可变要求</span><div className="composite-field-control"><textarea value={config.assetNotes} onChange={(e) => patch({ assetNotes: e.target.value })}/>{optimizeButton('assetNotes', '不可变要求')}</div></label><div className="composite-workbench-note"><Layers3 size={18}/><span><b>母版是下游唯一事实来源</b><small>修改母版后，受影响的分镜和视频会重新进入待审核状态。</small></span></div></div>}
        {step === 2 && <div className="composite-workbench-form is-grid"><label><span>画幅</span><GlassSelect ariaLabel="复合 Skill 画幅" value={config.aspectRatio} options={['9:16','16:9','3:4','1:1'].map((value) => ({ value, label: value }))} onChange={(aspectRatio) => patch({ aspectRatio })}/></label><label><span>计划镜头数</span><input type="number" min={3} max={12} value={config.shotCount} onChange={(e) => patch({ shotCount: Math.max(3, Math.min(12, Number(e.target.value) || 3)) })}/></label><label className="is-wide"><span>视觉风格与材质方向</span><div className="composite-field-control"><textarea value={config.visualStyle} onChange={(e) => patch({ visualStyle: e.target.value })}/>{optimizeButton('visualStyle', '视觉风格与材质方向')}</div></label><div className="composite-workbench-note"><Clapperboard size={18}/><span><b>先确认静态分镜与首尾帧</b><small>不直接从剧本跳到视频，避免把结构错误带入高成本生成。</small></span></div></div>}
        {step === 3 && <div className="composite-workbench-form is-grid"><label><span>发布平台</span><input value={config.platform} onChange={(e) => patch({ platform: e.target.value })}/></label><label><span>目标时长</span><input value={config.duration} onChange={(e) => patch({ duration: e.target.value })}/></label><label className="is-wide"><span>节奏</span><div className="composite-field-control"><textarea value={config.pacing} onChange={(e) => patch({ pacing: e.target.value })}/>{optimizeButton('pacing', '叙事节奏')}</div></label><label className="is-wide"><span>对白、音乐与声音</span><div className="composite-field-control"><textarea value={config.audio} onChange={(e) => patch({ audio: e.target.value })}/>{optimizeButton('audio', '对白音乐与声音')}</div></label></div>}
        {step === 4 && <div className="composite-workbench-review"><header><FileCheck2 size={22}/><span><b>准备建立生产工作流</b><small>工作台会在画布生成真实节点与连线，不是静态说明页。</small></span></header><dl><div><dt>项目</dt><dd>{config.projectName}</dd></div><div><dt>目标</dt><dd>{config.concept}</dd></div><div><dt>交付</dt><dd>{config.platform} · {config.duration} · {config.aspectRatio}</dd></div><div><dt>规模</dt><dd>{config.shotCount} 个镜头 · {stages.length} 个阶段门</dd></div></dl><ol>{stages.map((stage, index) => <li key={stage.id}><i>{String(index + 1).padStart(2, '0')}</i><span><b>{stage.label}</b><small>{stage.output}</small></span><em>{index === 0 ? '先执行' : '审核后解锁'}</em></li>)}</ol><p>批量执行也会在每个阶段门暂停；视频镜头逐条串行，上一条审核通过后才继续。</p></div>}
      </main>
      <footer className="composite-workbench-footer"><button type="button" disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))}><ArrowLeft size={15}/>返回上一步</button><div><span>自动保存配置 · 节点结果保留在项目中</span>{step < 4 ? <button type="button" className="is-primary" disabled={!canContinue} onClick={() => setStep((value) => Math.min(4, value + 1))}>确认并继续<ChevronRight size={15}/></button> : <button type="button" className="is-primary" onClick={() => onCreate(config)}>建立完整工作流<Route size={15}/></button>}</div></footer>
      <div className="skill-workbench-resize" role="separator" aria-label="调整工作台大小" onPointerDown={startResize}/>
    </section>
  </div>, document.body)
}
