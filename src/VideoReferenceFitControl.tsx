import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Crop, LoaderCircle, X } from 'lucide-react'
import { useAnchoredPopover } from './useAnchoredPopover'
import { loadHistoryMedia } from './localDb'
import { readImageSourceBlob } from './imageApi'
import type { MediaLimits, ReferenceMedia } from './referenceMediaValidation'
import { fitVideoReferenceImage, type VideoReferenceImageFit, type ReferenceImageFitPlan } from './videoReferenceImageFit'

type Props = {
  entries: Array<{ id: string; url?: string; mediaId?: string }>
  enabled: boolean
  fit: VideoReferenceImageFit
  frameMode: boolean
  ratios: Array<{ value: string; label: string }>
  limitsFor: (entry: ReferenceMedia) => MediaLimits
  onEnabledChange: (value: boolean) => void
  onRatioChange: (ratio: string) => void
}
type Preview = { id: string; original: string; result: string; plan: ReferenceImageFitPlan }

export function VideoReferenceFitControl(props: Props) {
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLElement>(null)
  const [open, setOpen] = useState(false)
  const [previews, setPreviews] = useState<Preview[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  useAnchoredPopover(open, panel, () => setOpen(false), trigger)
  const key = JSON.stringify({ entries: props.entries, fit: props.fit, enabled: props.enabled, limits: props.entries.map(entry => props.limitsFor({ ...entry, kind: 'image' })) })
  useEffect(() => {
    if (!open) return
    const controller = new AbortController(), urls: string[] = []
    const urlFor = (blob: Blob) => { const url = URL.createObjectURL(blob); urls.push(url); return url }
    setPreviews([]); setError(''); setLoading(true)
    const snapshot = JSON.parse(key) as { entries: Props['entries']; fit: VideoReferenceImageFit; enabled: boolean; limits: MediaLimits[] }
    void (async () => {
      const items: Preview[] = []
      let effectiveFit = snapshot.fit
      // Decode one at a time so opening a panel with many references stays responsive.
      for (const [index, entry] of snapshot.entries.entries()) {
        controller.signal.throwIfAborted()
        const stored = entry.mediaId ? await loadHistoryMedia(entry.mediaId) : undefined
        const blob = stored?.blob ?? (entry.url ? await readImageSourceBlob(entry.url, controller.signal) : undefined)
        if (!blob) throw new Error('参考图已丢失，请重新添加')
        const fitted = await fitVideoReferenceImage(blob, snapshot.enabled ? snapshot.limits[index] : {}, snapshot.enabled ? effectiveFit : undefined, controller.signal)
        if (index === 0 && effectiveFit.alignFrames && !effectiveFit.forceRatio) effectiveFit = { ...effectiveFit, preferredRatio: `${fitted.plan.width}:${fitted.plan.height}`, forceRatio: true }
        const original = urlFor(blob)
        items.push({ id: entry.id, original, result: fitted.plan.changed ? urlFor(fitted.blob) : original, plan: fitted.plan })
      }
      if (!controller.signal.aborted) setPreviews(items)
    })().catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '无法预览参考图') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort(); urls.forEach(url => URL.revokeObjectURL(url)) }
  }, [open, key])
  return <div className="video-reference-fit">
    <button ref={trigger} type="button" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(value => !value)}><Crop size={13}/><span>{props.enabled ? '自动适配' : '使用原图'}</span><ChevronDown size={11}/></button>
    {open && <section ref={panel} popover="auto" data-width="420" data-align="start" className="video-reference-fit-panel anchored-popover" role="dialog" aria-label="参考图适配预览">
      <header><strong>参考图尺寸适配</strong><button type="button" aria-label="关闭适配预览" onClick={() => { setOpen(false); trigger.current?.focus() }}><X size={15}/></button></header>
      <label className="reference-fit-toggle"><span>自动适配目标画幅</span><input type="checkbox" checked={props.enabled} onChange={event => props.onEnabledChange(event.target.checked)}/></label>
      <p>{props.enabled ? '参考内容居中放置，超出裁切、不足柔化补边。只有模型尺寸限制要求时，才整体等比缩小。' : '当前使用原图，未执行居中适配；画幅差异将由模型处理。'}</p>
      {props.enabled && <p className="reference-fit-intent">{props.fit.mode === 'preserve' ? '已根据提示词保留完整内容：不裁剪，只补边。' : '本次采用居中适配。提示词中说「保留完整内容」或「不要裁剪」即可自动改为完整保留。'}</p>}
      {props.frameMode ? <label className="video-reference-fit-ratio">目标画幅<select aria-label="首尾帧适配画幅" value={props.fit.forceRatio ? props.fit.preferredRatio : 'auto'} disabled={!props.enabled} onChange={event => props.onRatioChange(event.target.value)}><option value="auto">跟随首帧</option>{props.ratios.filter(ratio => ratio.value !== 'auto').map(ratio => <option key={ratio.value} value={ratio.value}>{ratio.label}</option>)}</select></label> : props.fit.preferredRatio && props.fit.preferredRatio !== 'auto' && <p>目标画幅 · {props.fit.preferredRatio}</p>}
      <small>原图保留。补边使用本地柔化背景，不是 AI 扩图。下方可预览发送画面。</small>
      {loading && <div role="status"><LoaderCircle size={14} className="is-spinning"/>正在准备适配预览…</div>}
      {error && <p role="alert">{error}</p>}
      {previews.map((item, index) => <div className="video-reference-fit-pair" key={item.id}>
        <figure><img src={item.original} alt={`参考图 ${index + 1} 原图`}/><figcaption>原图 · {item.plan.sourceWidth} × {item.plan.sourceHeight}</figcaption></figure>
        <figure><img src={item.result} alt={`参考图 ${index + 1} 发送预览`}/><figcaption>{item.plan.cropped && item.plan.padded ? '居中裁切与补边' : item.plan.cropped ? '居中裁切' : item.plan.padded ? '完整保留与补边' : item.plan.changed ? '整体缩小' : '保持原图'} · {item.plan.width} × {item.plan.height}</figcaption></figure>
      </div>)}
    </section>}
  </div>
}
