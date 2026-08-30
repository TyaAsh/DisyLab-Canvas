import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, LoaderCircle, Play, Settings2, Sparkles, WandSparkles, X } from 'lucide-react'
import type { SkillManifest } from '../skills/types'
import { GlassSelect } from './GlassSelect'

type Value = string | number | boolean
type TextModelOption = { key: string; name: string; connectionName: string }
type Props = { skill: SkillManifest | null; initialSubject: string; textModels: TextModelOption[]; selectedTextModelKey: string; onSelectTextModel: (key: string) => void; onConfigureTextModels: () => void; onOptimize: (field: string, value: string, modelKey?: string) => Promise<string>; onClose: () => void; onRun: (skill: SkillManifest, subject: string, values: Record<string, Value>) => void }

function ModelMenu({ anchor, models, selectedKey, onSelect, onConfigure, onClose }: { anchor: HTMLElement; models: TextModelOption[]; selectedKey: string; onSelect: (key: string) => void; onConfigure: () => void; onClose: () => void }) {
  const [style, setStyle] = useState<React.CSSProperties>({})
  useLayoutEffect(() => {
    const place = () => {
      const rect = anchor.getBoundingClientRect()
      const width = Math.min(250, window.innerWidth - 16)
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))
      const estimatedHeight = Math.min(300, 38 + Math.max(1, models.length) * 45)
      const openBelow = rect.top < estimatedHeight + 16 && window.innerHeight - rect.bottom > rect.top
      setStyle({ position: 'fixed', zIndex: 1000, width, left, maxHeight: Math.max(120, openBelow ? window.innerHeight - rect.bottom - 12 : rect.top - 12), overflowY: 'auto', ...(openBelow ? { top: rect.bottom + 7 } : { bottom: window.innerHeight - rect.top + 7 }) })
    }
    place(); window.addEventListener('resize', place); window.addEventListener('scroll', place, true)
    const close = (event: PointerEvent) => { if (!anchor.contains(event.target as Node)) onClose() }
    document.addEventListener('pointerdown', close)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); document.removeEventListener('pointerdown', close) }
  }, [anchor, models.length, onClose])
  return createPortal(<div className="prompt-optimize-model-menu skill-optimize-model-menu" style={style} onPointerDown={(event) => event.stopPropagation()}><header><span>优化文本模型</span><small>{models.length} 个可用</small></header>{models.map((model) => <button type="button" className={model.key === selectedKey ? 'is-selected' : ''} key={model.key} onClick={() => { onSelect(model.key); onClose() }}><span><strong>{model.name}</strong><small>{model.connectionName}</small></span>{model.key === selectedKey && <Check size={13}/>}</button>)}{!models.length && <button type="button" className="is-empty" onClick={() => { onClose(); onConfigure() }}><Settings2 size={13}/><span>配置文本模型</span></button>}</div>, document.body)
}

export function SkillConfigPanel({ skill, initialSubject, textModels, selectedTextModelKey, onSelectTextModel, onConfigureTextModels, onOptimize, onClose, onRun }: Props) {
  const [subject, setSubject] = useState(initialSubject)
  const [values, setValues] = useState<Record<string, Value>>({})
  const [position, setPosition] = useState({ x: Math.max(12, window.innerWidth - 486), y: 88 })
  const [size, setSize] = useState({ width: Math.min(460, window.innerWidth - 24), height: Math.min(500, window.innerHeight - 24) })
  const [optimizingField, setOptimizingField] = useState('')
  const [modelMenuField, setModelMenuField] = useState('')
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const resizeRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null)
  const modelAnchorRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!skill) return
    setSubject(initialSubject)
    setValues(Object.fromEntries(skill.parameters.filter((p) => p.bind !== 'prompt' && p.default !== undefined).map((p) => [p.name, p.default as Value])))
  }, [skill, initialSubject])
  useEffect(() => {
    const keepInViewport = () => {
      const maxWidth = Math.max(240, window.innerWidth - 24)
      const maxHeight = Math.max(240, window.innerHeight - 24)
      setSize((current) => ({ width: Math.min(current.width, maxWidth), height: Math.min(current.height, maxHeight) }))
      setPosition((current) => ({ x: Math.max(8, Math.min(current.x, window.innerWidth - Math.min(size.width, maxWidth) - 8)), y: Math.max(8, Math.min(current.y, window.innerHeight - Math.min(size.height, maxHeight) - 8)) }))
    }
    keepInViewport(); window.addEventListener('resize', keepInViewport)
    return () => window.removeEventListener('resize', keepInViewport)
  }, [size.width, size.height])
  const fields = useMemo(() => skill?.parameters.filter((p) => p.bind !== 'prompt') ?? [], [skill])
  if (!skill) return null
  const optimizeField = async (key: string, label: string, value: string, apply: (next: string) => void) => {
    const source = value.trim(); if (!source || optimizingField) return
    setOptimizingField(key); setModelMenuField('')
    try { apply(await onOptimize(label, source, selectedTextModelKey)) } finally { setOptimizingField('') }
  }
  const optimizeControl = (key: string, label: string, value: string, apply: (next: string) => void) => <div className="skill-field-optimize prompt-optimize-control">
    <button type="button" className="prompt-optimize-button" disabled={!value.trim() || Boolean(optimizingField)} onClick={() => void optimizeField(key, label, value, apply)}>{optimizingField === key ? <LoaderCircle className="is-spinning" size={14}/> : <WandSparkles size={14}/>}<span>优化</span></button>
    <button type="button" className={`prompt-optimize-model-trigger ${modelMenuField === key ? 'is-open' : ''}`} aria-label={`选择${label}优化模型`} aria-expanded={modelMenuField === key} onClick={(event) => { modelAnchorRef.current = event.currentTarget; setModelMenuField((current) => current === key ? '' : key) }}><ChevronDown size={12}/></button>
    {modelMenuField === key && modelAnchorRef.current && <ModelMenu anchor={modelAnchorRef.current} models={textModels} selectedKey={selectedTextModelKey} onSelect={onSelectTextModel} onConfigure={onConfigureTextModels} onClose={() => setModelMenuField('')} />}
  </div>
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault(); event.stopPropagation()
    if (window.innerWidth < 640) return
    resizeRef.current = { x: event.clientX, y: event.clientY, width: size.width, height: size.height }
    const move = (nextEvent: PointerEvent) => {
      const resize = resizeRef.current; if (!resize) return
      setSize({
        width: Math.min(window.innerWidth - position.x - 8, Math.max(360, resize.width + nextEvent.clientX - resize.x)),
        height: Math.min(window.innerHeight - position.y - 8, Math.max(360, resize.height + nextEvent.clientY - resize.y)),
      })
    }
    const up = () => { resizeRef.current = null; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }
  return createPortal(<section className="skill-config-panel nodrag nowheel" style={{ left: position.x, top: position.y, width: size.width, height: size.height }} onPointerDown={(e) => e.stopPropagation()}>
    <header onPointerDown={(event) => {
      if ((event.target as HTMLElement).closest('button')) return
      dragRef.current = { x: event.clientX, y: event.clientY, left: position.x, top: position.y }
      const move = (e: PointerEvent) => { const d = dragRef.current; if (!d) return; setPosition({ x: Math.max(8, Math.min(window.innerWidth - size.width - 8, d.left + e.clientX - d.x)), y: Math.max(8, Math.min(window.innerHeight - size.height - 8, d.top + e.clientY - d.y)) }) }
      const up = () => { dragRef.current = null; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
    }}><div><span><Sparkles size={17} /></span><div><small>CONFIGURED SKILL</small><strong>{skill.name}</strong></div></div><button type="button" aria-label="关闭 Skill 配置" onClick={onClose}><X size={16} /></button></header>
    <main><div className="comic-stage-title"><small>执行前配置</small><h3>补齐任务框架</h3><p>{skill.description} 确认后会自动写入节点并调用当前模型。</p></div>
      <label className="skill-config-subject"><span>{skill.parameters.find((p) => p.bind === 'prompt')?.label ?? '内容'}</span><div className="skill-config-text-control"><textarea value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="填写主题、内容、约束和希望得到的结果…" autoFocus />{optimizeControl('subject', skill.parameters.find((p) => p.bind === 'prompt')?.label ?? '内容', subject, setSubject)}</div></label>
      <div className="skill-config-fields">{fields.map((field) => <label key={field.name}><span>{field.label}</span>{field.type === 'enum' ? <GlassSelect ariaLabel={field.label} value={String(values[field.name] ?? '')} options={(field.enum ?? []).map((item) => ({ value: item, label: item }))} onChange={(value) => setValues((v) => ({ ...v, [field.name]: value }))} /> : field.type === 'boolean' ? <input type="checkbox" checked={Boolean(values[field.name])} onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.checked }))} /> : field.type === 'string' ? <input type="text" value={String(values[field.name] ?? '')} onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}/> : <input type="number" value={String(values[field.name] ?? '')} onChange={(e) => setValues((v) => ({ ...v, [field.name]: Number(e.target.value) }))} />}</label>)}</div>
    </main><footer><span>配置后自动执行 · 使用当前节点模型</span><button type="button" disabled={!subject.trim()} onClick={() => onRun(skill, subject.trim(), values)}><Play size={14} />确认并执行</button></footer>
    <div className="skill-workbench-resize" role="separator" aria-label="调整工作台大小" onPointerDown={startResize}/>
  </section>, document.body)
}
