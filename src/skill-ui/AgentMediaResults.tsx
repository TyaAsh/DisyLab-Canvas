import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronLeft, ChevronRight, Download, Film, Focus, ImagePlus, LoaderCircle, Play, RefreshCw, X } from 'lucide-react'
import { loadHistoryMedia } from '../localDb'
import { downloadGeneratedVideoBlob } from '../imageApi'
import { triggerBlobDownload } from '../workspaceBundle'
import { VideoReferenceThumbnail } from '../VideoReferenceThumbnail'

export type AgentMediaItem = { id: string; url?: string; mediaId?: string; fileName: string; nodeId?: string; label?: string }
type Props = {
  kind: 'image' | 'video'
  items: AgentMediaItem[]
  expected: number
  running?: boolean
  meta?: string
  issues?: string[]
  onLocate?: (nodeId: string) => void
  onDownloadImage: (url: string, fileName: string) => void | Promise<void>
}

/** Always prefer the durable project file to an expired CDN or old blob URL. */
function useMediaSource(item?: AgentMediaItem) {
  const key = `${item?.mediaId ?? ''}:${item?.url ?? ''}`
  const [state, setState] = useState<{ key?: string; url?: string; loading: boolean; error?: string }>({ loading: true })
  useEffect(() => {
    let disposed = false, ownedUrl: string | undefined
    setState({ key, loading: true })
    void (async () => {
      const stored = item?.mediaId ? await loadHistoryMedia(item.mediaId).catch(() => null) : null
      const url = stored?.blob.size ? (ownedUrl = URL.createObjectURL(stored.blob)) : item?.url
      if (!disposed) setState(url ? { key, url, loading: false } : { key, loading: false, error: '本地文件不可用，请到画布取回原结果。' })
      else if (ownedUrl) URL.revokeObjectURL(ownedUrl)
    })()
    return () => { disposed = true; if (ownedUrl) URL.revokeObjectURL(ownedUrl) }
  }, [item?.mediaId, item?.url])
  return state.key === key ? state : { loading: true }
}

function ResultImage({ item }: { item: AgentMediaItem }) {
  const source = useMediaSource(item)
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [source.url])
  return source.loading ? <LoaderCircle size={18} className="is-spinning"/> : source.error || broken
    ? <span className="agent-media-unavailable"><ImagePlus size={21}/><small>预览不可用，点击查看</small></span>
    : <img src={source.url} alt={item.label || item.fileName} loading="lazy" draggable={false} onError={() => setBroken(true)}/>
}

export function AgentMediaResults({ kind, items, expected, running, meta, issues = [], onLocate, onDownloadImage }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [downloadId, setDownloadId] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState('')
  const [playbackError, setPlaybackError] = useState(false)
  const [reload, setReload] = useState(0)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const filmstripRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const previewIndex = items.findIndex(item => item.id === activeId)
  const active = items[previewIndex]
  const source = useMediaSource(active)
  const isVideo = kind === 'video', noun = isVideo ? '视频' : '图片', unit = isVideo ? '段' : '张'
  const shown = expanded ? items : items.slice(0, 6)
  const total = Math.max(items.length, expected)
  const close = () => setActiveId(null)
  const move = (step: number) => setActiveId(items[(previewIndex + step + items.length) % items.length].id)
  useEffect(() => { setPlaybackError(false); setReload(0) }, [activeId])
  useEffect(() => {
    if (!activeId || !dialogRef.current) return
    const dialog = dialogRef.current
    dialog.showModal()
    closeRef.current?.focus()
    return () => { dialog.close(); triggerRef.current?.focus() }
  }, [Boolean(activeId)])
  useEffect(() => {
    if (activeId && !items.some(item => item.id === activeId)) close()
  }, [activeId, items])
  useEffect(() => {
    filmstripRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [activeId])
  const download = async (item: AgentMediaItem) => {
    setDownloadError(''); setDownloadId(item.id)
    try {
      const stored = item.mediaId ? await loadHistoryMedia(item.mediaId) : null
      if (isVideo) {
        const blob = stored?.blob ?? (item.url ? await downloadGeneratedVideoBlob(item.url) : undefined)
        if (!blob) throw new Error('本地视频不可用，请到画布取回原结果。')
        await triggerBlobDownload(blob, item.fileName)
      } else {
        const url = stored ? URL.createObjectURL(stored.blob) : item.url
        if (!url) throw new Error('本地图片不可用，请到画布查看。')
        try { await onDownloadImage(url, item.fileName) }
        finally { if (stored) URL.revokeObjectURL(url) }
      }
    } catch (error) { setDownloadError(error instanceof Error ? error.message : '保存失败，请重试。') }
    finally { setDownloadId(null) }
  }
  const open = (item: AgentMediaItem, trigger: HTMLButtonElement) => { triggerRef.current = trigger; setActiveId(item.id) }
  if (!items.length) return null
  return <>
    <section className="agent-plan-card agent-media-results" aria-label={`${noun}生成结果`}>
      <header><span>{isVideo ? <Film size={15}/> : <ImagePlus size={15}/>}<strong>{noun}结果</strong></span><small>{items.length < total ? `已就绪 ${items.length}/${total}` : `${items.length} ${unit}`}</small></header>
      {meta && <p className="agent-media-meta">{meta}</p>}
      <div className={`agent-media-grid ${items.length === 1 ? 'is-single' : ''}`}>
        {shown.map((item, index) => <figure key={item.id}>
          <button type="button" className="agent-media-open" aria-label={`预览第 ${index + 1} ${unit}${noun}`} onClick={event => open(item, event.currentTarget)}>
            {isVideo ? <VideoReferenceThumbnail reference={item} name={item.label || item.fileName} lazy/> : <ResultImage item={item}/>}
            <span className="agent-media-number">{index + 1}</span>
            {isVideo && <span className="agent-media-play"><Play size={17}/></span>}
          </button>
          <figcaption><span title={item.label || item.fileName}>{item.label || `${noun} ${index + 1}`}</span><button type="button" disabled={downloadId === item.id} aria-label={`保存第 ${index + 1} ${unit}${noun}`} title="保存原文件" onClick={() => void download(item)}>{downloadId === item.id ? <LoaderCircle size={13} className="is-spinning"/> : <Download size={13}/>}</button></figcaption>
        </figure>)}
      </div>
      {items.length > 6 && <button type="button" className="agent-media-expand" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? '收起结果' : `展开全部 ${items.length} ${unit}`}<ChevronDown size={13} className={expanded ? 'is-expanded' : ''}/></button>}
      {running && <p className="agent-media-progress" role="status"><LoaderCircle size={13} className="is-spinning"/>其余结果仍在生成，已完成的可以先查看</p>}
      {issues.length > 0 && <details className="agent-media-issues"><summary>查看未完成原因</summary>{issues.map((issue, index) => <p key={index}>{issue}</p>)}</details>}
      {downloadError && <p className="agent-plan-error" role="alert">{downloadError}</p>}
      {onLocate && items[0]?.nodeId && <button type="button" className="agent-media-locate" onClick={() => onLocate(items[0].nodeId!)}><Focus size={13}/>查看画布</button>}
    </section>
    {active && createPortal(<dialog ref={dialogRef} className="agent-media-viewer" aria-label={`${noun}结果预览`} onCancel={event => { event.preventDefault(); close() }} onClick={event => { if (event.target === event.currentTarget) close() }} onKeyDown={event => {
      if (event.target instanceof HTMLVideoElement) return
      if (event.key === 'ArrowLeft' && items.length > 1) { event.preventDefault(); move(-1) }
      if (event.key === 'ArrowRight' && items.length > 1) { event.preventDefault(); move(1) }
    }}>
      <header><div><strong>{active.label || `${noun} ${previewIndex + 1}`}</strong><span>{previewIndex + 1} / {items.length}</span></div><nav aria-label="结果预览操作">
        {onLocate && active.nodeId && <button type="button" title="定位当前结果" aria-label="定位当前结果到画布" onClick={() => { onLocate(active.nodeId!); close() }}><Focus size={17}/></button>}
        <button type="button" title="保存原文件" aria-label={`保存当前${noun}`} disabled={downloadId === active.id} onClick={() => void download(active)}>{downloadId === active.id ? <LoaderCircle size={17} className="is-spinning"/> : <Download size={17}/>}</button>
        <button ref={closeRef} type="button" aria-label="关闭结果预览" onClick={close}><X size={19}/></button>
      </nav></header>
      <div className="agent-media-stage">
        {source.loading ? <LoaderCircle size={25} className="is-spinning"/> : source.error || playbackError ? <div className="agent-media-load-error" role="alert"><strong>暂时无法预览{noun}</strong><p>{source.error || '文件无法播放或链接已失效，原结果不会因此被删除。'}</p>{source.url && <button type="button" onClick={() => { setPlaybackError(false); setReload(value => value + 1) }}><RefreshCw size={14}/>重新加载</button>}{onLocate && active.nodeId && <button type="button" onClick={() => { onLocate(active.nodeId!); close() }}><Focus size={14}/>到画布取回</button>}</div>
        : isVideo ? <video key={`${active.id}-${reload}`} src={source.url} controls playsInline preload="metadata" onError={() => setPlaybackError(true)} aria-label={`第 ${previewIndex + 1} 段视频播放器`}/>
        : <img key={`${active.id}-${reload}`} src={source.url} alt={active.label || `生成图片 ${previewIndex + 1}`} onError={() => setPlaybackError(true)}/>}
      </div>
      {downloadError && <p className="agent-plan-error" role="alert">{downloadError}</p>}
      {items.length > 1 && <footer><button type="button" aria-label={isVideo ? '上一段视频' : '上一张图片'} onClick={() => move(-1)}><ChevronLeft size={20}/></button><div ref={filmstripRef} className="agent-media-filmstrip" aria-label="切换结果">{items.map((item, index) => <button type="button" key={item.id} aria-label={`查看第 ${index + 1} ${unit}${noun}`} aria-pressed={item.id === activeId} onClick={() => setActiveId(item.id)}>{isVideo ? <VideoReferenceThumbnail reference={item} lazy/> : <ResultImage item={item}/>}<span>{index + 1}</span></button>)}</div><button type="button" aria-label={isVideo ? '下一段视频' : '下一张图片'} onClick={() => move(1)}><ChevronRight size={20}/></button></footer>}
    </dialog>, document.body)}
  </>
}
