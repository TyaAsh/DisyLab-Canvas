import { useEffect, useId, useRef } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Film, Frame, ImagePlus, X } from 'lucide-react'
import type { AgentGenerationSettings } from '../agent'
import { AGENT_VIDEO_WORKFLOWS, type ComposerParameterOptions } from '../agentComposer'
import { ImageOutputToggles } from './ImageOutputToggles'
import { ModelSpecsCard } from './ModelSpecsCard'

type Props = {
  kind: 'image' | 'video'
  modelName: string
  options: ComposerParameterOptions
  value: AgentGenerationSettings
  onChange: (patch: Partial<AgentGenerationSettings>) => void
  onClose: () => void
  inputIssue?: string
}

export function AgentGenerationParameters({ kind, modelName, options, value, onChange, onClose, inputIssue }: Props) {
  const reduced = useReducedMotion()
  const id = useId()
  const panel = useRef<HTMLElement>(null)
  useEffect(() => { panel.current?.focus({ preventScroll: true }) }, [])
  const spring = reduced ? { duration: 0 } : { type: 'spring' as const, stiffness: 440, damping: 36, mass: .7 }
  const choice = (group: string, key: string, label: string, selected: boolean, select: () => void, ratio = false) => {
    const [width, height] = key.split(':').map(Number)
    const aspectRatio = width > 0 && height > 0 ? `${width} / ${height}` : '1 / 1'
    return <motion.button key={key} type="button" className={selected ? 'is-selected' : ''} aria-pressed={selected} onClick={select}
      whileHover={reduced ? undefined : { y: -1 }} whileTap={reduced ? undefined : { scale: .96 }} transition={spring}>
      {selected && <motion.span className="agent-parameter-selection" layoutId={`${id}-${group}`} transition={spring} />}
      {ratio ? <><span className="ratio-shape" aria-hidden="true" style={{ aspectRatio,
        width: width > 0 && height > 0 ? Math.min(18, 18 * width / height) : 16,
        height: width > 0 && height > 0 ? Math.min(18, 18 * height / width) : 16,
        borderStyle: key === 'auto' ? 'dashed' : undefined }}/><small>{label}</small></> : <span className="agent-parameter-choice-label">{label}</span>}
    </motion.button>
  }
  const durations = options.durations ?? []
  const workflow = value.videoWorkflow ?? (value.generationMode === 'edit' ? 'edit' : value.generationMode === 'frames' ? 'frames' : 'generate')
  const modeHint = workflow === 'edit' ? options.editing?.detail ?? AGENT_VIDEO_WORKFLOWS[1].detail : AGENT_VIDEO_WORKFLOWS.find(option => option.value === workflow)?.detail
  const inheritsSource = kind === 'video' && workflow === 'edit' && options.editing?.inheritsSource
  const durationIndex = Math.max(0, durations.findIndex(option => Number(option.value) === value.duration))
  const summary = [value.aspectRatio, value.resolution, kind === 'image' ? options.qualities?.find(option => option.value === value.detail)?.label : value.duration ? `${value.duration} 秒` : undefined, `${value.count ?? 1} ${kind === 'image' ? '张' : '条'}`].filter(Boolean).join(' · ')
  return <motion.section ref={panel} tabIndex={-1} role="dialog" aria-label={kind === 'image' ? '图像参数' : '视频参数'}
    className={`${kind === 'image' ? 'image-parameter-menu' : 'video-parameter-menu'} agent-generation-parameters`}
    initial={reduced ? { opacity: 0 } : { opacity: 0, y: 9, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reduced ? { opacity: 0 } : { opacity: 0, y: 6, scale: .985 }} transition={spring}
    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
    <header><span>{kind === 'image' ? '图像参数' : '视频参数'}</span><button type="button" aria-label="关闭生成参数" title="关闭参数（Esc）" onClick={onClose}><X size={14}/></button></header>
    <div className="agent-generation-parameters-body">
    <ModelSpecsCard name={modelName} specs={[
      ['清晰度', inheritsSource ? '最高 720p' : options.resolutions.map(option => option.label).join(' / ')],
      kind === 'image' ? ['画质', options.qualities?.map(option => option.label).join(' / ')] : ['时长', inheritsSource ? '跟随原视频' : durations.length ? `${durations[0].label} – ${durations.at(-1)!.label}` : undefined],
    ]}/>
    <div className="parameter-request-preview"><span>本次提交</span><strong>{inheritsSource ? `视频编辑 · 比例与时长跟随原视频 · 最高 720p · ${value.count ?? 1} 条` : summary}</strong></div>
    {kind === 'image' && <ImageOutputToggles supported={options.outputs} value={value.output} onChange={output=>onChange({output})}/>}
    {kind === 'video' && <section className="agent-video-mode-section"><label>生成方式</label>
      <div className="video-generation-method-options" role="group" aria-label="视频生成方式" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        {AGENT_VIDEO_WORKFLOWS.map(option => {
          const Icon = option.value === 'generate' ? ImagePlus : option.value === 'edit' ? Film : Frame
          const unavailable = option.value === 'edit' ? !options.editing?.supported : option.value === 'frames' ? !options.modes?.some(mode => mode.value === 'frames') : !options.modes?.some(mode => mode.value !== 'edit')
          return <button type="button" key={option.value} aria-pressed={workflow === option.value} aria-describedby={`${id}-mode-hint`} className={`${workflow === option.value ? 'is-selected' : ''} ${unavailable ? 'is-unavailable' : ''}`} title={unavailable ? '此模型暂不支持，选择后可查看原因并更换模型' : option.detail} onClick={() => onChange({ videoWorkflow: option.value, generationMode: option.value === 'generate' ? undefined : option.value })}><Icon size={13} aria-hidden="true"/><span>{option.label}</span></button>
        })}
      </div>
      <p id={`${id}-mode-hint`} className="video-mode-hint" role="status">{modeHint}</p>
      {inputIssue && inputIssue !== modeHint && <p className="agent-video-input-issue" role="status">{inputIssue}</p>}
      {options.modes?.length === 0 && <p role="alert" className="video-mode-hint">当前接口尚未接通此型号的生成方式，请切换模型。</p>}
    </section>}
    {kind === 'image' && Boolean(options.qualities?.length) && <section><label>画质</label><div className="image-detail-options">{options.qualities?.map(option => choice('detail', option.value, option.label, value.detail === option.value, () => onChange({ detail: option.value })))}</div></section>}
    {!inheritsSource && options.resolutions.length > 0 && <section><label>清晰度</label><div className={kind === 'image' ? 'image-resolution-options' : 'video-quality-options'}>{options.resolutions.map(option => choice('resolution', option.value, option.label, value.resolution === option.value, () => onChange({ resolution: option.value })))}</div></section>}
    {kind === 'video' && !inheritsSource && durations.length > 0 && <section><label>视频时长</label>{durations.length > 8 ? <div className="video-duration-control"><input type="range" aria-label="视频时长" aria-valuetext={`${value.duration} 秒`} min={0} max={durations.length - 1} step={1} value={durationIndex} onChange={event => onChange({ duration: Number(durations[Number(event.target.value)].value) })}/><b>{value.duration} 秒</b></div>
      : <div className="video-quality-options">{durations.map(option => choice('duration', option.value, option.label, value.duration === Number(option.value), () => onChange({ duration: Number(option.value) })))}</div>}</section>}
    {!inheritsSource && options.ratios.length > 0 && <section><label>比例</label><div className={kind === 'image' ? 'image-ratio-options' : 'video-ratio-options'}>{options.ratios.map(option => choice('ratio', option.value, option.label, value.aspectRatio === option.value, () => onChange({ aspectRatio: option.value }), true))}</div></section>}
    <section><label>{kind === 'image' ? '生成张数' : '生成数量'}</label><div className={kind === 'image' ? 'image-resolution-options' : 'video-quality-options'}>{[1,2,3,4].map(count => choice('count', String(count), `${count} ${kind === 'image' ? '张' : '条'}`, value.count === count, () => onChange({ count })))}</div></section>
    </div>
  </motion.section>
}
