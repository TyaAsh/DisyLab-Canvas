import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { Download, Eye, Link2, LoaderCircle, Pause, Play, Plus, Trash2, Upload } from 'lucide-react'
import { ToolboxDropZone } from './ToolboxDropZone'
import { WatermarkLinkInput } from './WatermarkLinkInput'
import { mediaKind, type MediaKind } from './sharedMedia'
import { drawWatermarkFrame, exportWatermarkImage, exportWatermarkVideo, sampleWatermarkFrame, suggestWatermarkRegion, type WatermarkRegion } from './videoWatermark'

export const WATERMARK_VIDEO_ACCEPT = '.mp4,.mov,.webm,.m4v,.mkv,.avi,.ogv,video/*'
export const WATERMARK_IMAGE_ACCEPT = '.jpg,.jpeg,.png,.webp,.avif,.bmp,image/jpeg,image/png,image/webp,image/avif,image/bmp'

type Region = WatermarkRegion & { id: string }
type Point = { x: number; y: number }
type Drag = { start: Point; region?: Region; resize?: boolean }
const minSize = .012
const limit = 12
const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value))
const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

export function WatermarkTool({ initialKind, onKindChange }: { initialKind: MediaKind; onKindChange: (kind: MediaKind) => void }) {
  const [source, setSource] = useState<{ url: string; name: string; kind: MediaKind; fromLink: boolean } | null>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [duration, setDuration] = useState(0)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [regions, setRegions] = useState<Region[]>([])
  const [selected, setSelected] = useState('')
  const [draft, setDraft] = useState<WatermarkRegion | null>(null)
  const [preview, setPreview] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [status, setStatus] = useState('')
  const [showLink, setShowLink] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [result, setResult] = useState<{ url: string; name: string } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const image = useRef<HTMLImageElement>(null)
  const previewCanvas = useRef<HTMLCanvasElement>(null)
  const drag = useRef<Drag | null>(null)
  const controller = useRef<AbortController | null>(null)
  const kind = source?.kind ?? initialKind
  const noun = kind === 'image' ? '图片' : '视频'
  const busy = progress !== null
  const locked = busy || detecting

  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => () => { if (source) URL.revokeObjectURL(source.url) }, [source])
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url) }, [result])
  useEffect(() => {
    const player = video.current
    const still = image.current
    const canvas = previewCanvas.current
    if ((!player && !still) || !canvas || !preview || !size) return
    const scale = Math.min(1, 960 / Math.max(size.width, size.height))
    canvas.width = Math.max(1, Math.round(size.width * scale))
    canvas.height = Math.max(1, Math.round(size.height * scale))
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return
    if (still) { drawWatermarkFrame(context, still, regions); return }
    if (!player) return
    let frame = 0
    const paint = () => {
      if (player.readyState >= 2 && !player.seeking) drawWatermarkFrame(context, player, regions)
    }
    const tick = () => {
      paint()
      if (!player.paused && !player.ended) frame = requestAnimationFrame(tick)
    }
    const start = () => { cancelAnimationFrame(frame); tick() }
    const events = ['play', 'pause', 'seeked', 'loadeddata'] as const
    for (const event of events) player.addEventListener(event, start)
    start()
    return () => {
      cancelAnimationFrame(frame)
      for (const event of events) player.removeEventListener(event, start)
    }
  }, [preview, size, regions, source])

  const chooseFile = (file: File | undefined, fromLink = false) => {
    if (!file || locked) return
    const picked = mediaKind(file.type) ?? (/\.(mp4|mov|webm|m4v|mkv|avi|ogv)$/i.test(file.name) ? 'video' : /\.(jpe?g|png|webp|avif|bmp)$/i.test(file.name) ? 'image' : undefined)
    if (!picked || (!fromLink && picked !== kind)) {
      setStatus(`请选择${noun}文件`)
      return
    }
    setSource({ url: URL.createObjectURL(file), name: file.name, kind: picked, fromLink })
    onKindChange(picked)
    setShowLink(false)
    setSize(null)
    setDuration(0)
    setTime(0)
    setPlaying(false)
    setRegions([])
    setSelected('')
    setDraft(null)
    setPreview(false)
    setResult(null)
    setStatus('')
  }
  const pointAt = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) }
  }
  const newBounds = (start: Point, end: Point) => ({
    x: Math.min(start.x, end.x), y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y),
  })
  const adjustRegion = (region: Region, delta: Point, resize = false) => {
    const next = resize
      ? { ...region, width: clamp(region.width + delta.x, minSize, 1 - region.x), height: clamp(region.height + delta.y, minSize, 1 - region.y) }
      : { ...region, x: clamp(region.x + delta.x, 0, 1 - region.width), y: clamp(region.y + delta.y, 0, 1 - region.height) }
    if (next.width > .985 && next.height > .985) return
    setRegions((current) => current.map((item) => item.id === region.id ? next : item))
  }
  const addRegion = (bounds: WatermarkRegion) => {
    if (regions.length >= limit) return
    if (bounds.width < minSize || bounds.height < minSize) return
    if (bounds.width > .985 && bounds.height > .985) {
      setStatus('请把选框缩到水印附近，保留周围画面')
      return
    }
    const id = crypto.randomUUID()
    setRegions((current) => [...current, { ...bounds, id }])
    setSelected(id)
    setPreview(false)
    setResult(null)
    setStatus('')
  }
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!size || locked || preview || event.button !== 0) return
    const target = event.target as Element
    const id = target.closest<HTMLElement>('[data-region-id]')?.dataset.regionId
    const region = regions.find((item) => item.id === id)
    if (!region && regions.length >= limit) return
    video.current?.pause()
    const start = pointAt(event)
    if (region) setSelected(region.id)
    else setDraft(newBounds(start, start))
    drag.current = { start, region, resize: Boolean(target.closest('.watermark-resize')) }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current) return
    const point = pointAt(event)
    if (current.region) {
      adjustRegion(current.region, { x: point.x - current.start.x, y: point.y - current.start.y }, current.resize)
      setResult(null)
    } else setDraft(newBounds(current.start, point))
  }
  const finishPointer = (event: PointerEvent<HTMLDivElement>, cancelled = false) => {
    const current = drag.current
    drag.current = null
    setDraft(null)
    if (!current) return
    const { region } = current
    if (cancelled && region) {
      setRegions((items) => items.map((item) => item.id === region.id ? region : item))
      return
    }
    if (!cancelled && !current.region) addRegion(newBounds(current.start, pointAt(event)))
  }
  const removeRegion = () => {
    const remaining = regions.filter((region) => region.id !== selected)
    setRegions(remaining)
    setSelected(remaining.at(-1)?.id ?? '')
    setResult(null)
    if (!remaining.length) setPreview(false)
  }
  const run = async (selection: WatermarkRegion[]) => {
    if (!source || !selection.length || controller.current) return
    const task = new AbortController()
    controller.current = task
    video.current?.pause()
    setResult(null)
    setProgress(0)
    try {
      const output = source.kind === 'image' && image.current
        ? await exportWatermarkImage(image.current, selection)
        : await exportWatermarkVideo(source.url, selection, task.signal, setProgress)
      if (task.signal.aborted) return
      setResult({ url: URL.createObjectURL(output.blob), name: `${source.name.replace(/\.[^.]+$/, '')}-watermark-removed.${output.extension}` })
    } catch (error) {
      if (!task.signal.aborted) setStatus(error instanceof Error ? error.message : '处理失败，请重试')
    } finally {
      controller.current = null
      setProgress(null)
    }
  }

  useEffect(() => {
    if (!source?.fromLink || !size) return
    let cancelled = false
    const task = new AbortController()
    setDetecting(true)
    const detect = async () => {
      try {
        const player = video.current
        const still = image.current
        const sample = (element: CanvasImageSource) => sampleWatermarkFrame(element, size.width, size.height)
        const waitForFrame = (element: HTMLVideoElement, event: 'loadeddata' | 'seeked') => new Promise<void>((resolve, reject) => {
          const done = () => { cleanup(); resolve() }
          const abort = () => { cleanup(); reject(task.signal.reason) }
          const timeout = window.setTimeout(() => { cleanup(); reject(new Error('读取预览超时')) }, 4500)
          const cleanup = () => { clearTimeout(timeout); element.removeEventListener(event, done); task.signal.removeEventListener('abort', abort) }
          element.addEventListener(event, done, { once: true })
          task.signal.addEventListener('abort', abort, { once: true })
        })
        const frames = []
        if (still) frames.push(sample(still))
        else if (player) {
          if (player.readyState < 2) await waitForFrame(player, 'loadeddata')
          frames.push(sample(player))
          if (Number.isFinite(player.duration) && player.duration > .35) {
            const seek = waitForFrame(player, 'seeked')
            player.currentTime = player.duration * .55
            await seek
            frames.push(sample(player))
            player.currentTime = 0
          }
        }
        if (cancelled) return
        const suggestion = suggestWatermarkRegion(frames)
        if (!suggestion) { setStatus('已读取文件，未识别到明确的固定水印。可直接下载原素材，或手动框选修补。'); return }
        const id = crypto.randomUUID()
        setRegions([{ ...suggestion, id }])
        setSelected(id)
        setPreview(true)
        setStatus('已框出疑似固定水印，下载前可以先看预览，或返回编辑调整。')
        void run([suggestion])
      } catch {
        if (!cancelled) setStatus('无法自动识别水印，可以在画面上手动框选。')
      } finally { if (!cancelled) setDetecting(false) }
    }
    void detect()
    return () => { cancelled = true; task.abort() }
  // Detect once per linked source, after its dimensions become available.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, size])
  const boundsStyle = (region: WatermarkRegion): CSSProperties => ({
    left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%`,
  })

  return <div className="watermark-tool">
    <input type="file" ref={input} hidden accept={kind === 'image' ? WATERMARK_IMAGE_ACCEPT : WATERMARK_VIDEO_ACCEPT}
      onChange={(event) => { chooseFile(event.target.files?.[0]); event.currentTarget.value = '' }} />
    {!source ? <>
      <ToolboxDropZone detail={`选择一${kind === 'image' ? '张图片' : '个视频'}，框出位置固定的水印`} onPick={() => input.current?.click()} onDrop={(files) => chooseFile(files[0])} />
      <WatermarkLinkInput disabled={locked} onLoad={(file) => chooseFile(file, true)} />
    </> : <>
      <div className="watermark-file">
        <strong title={source.name}>{source.name}</strong>
        <div><button type="button" disabled={locked} aria-expanded={showLink} onClick={() => setShowLink(!showLink)}><Link2 size={14} />从链接导入</button>
        <button type="button" disabled={locked} onClick={() => input.current?.click()}><Upload size={14} />更换{noun}</button></div>
      </div>
      {showLink && <WatermarkLinkInput disabled={locked} onLoad={(file) => chooseFile(file, true)} />}
      <div className="watermark-stage" data-ready={Boolean(size)} data-preview={preview}
        style={{ '--video-ratio': size ? size.width / size.height : 16 / 9 } as CSSProperties}
        onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={finishPointer}
        onPointerCancel={(event) => finishPointer(event, true)} onLostPointerCapture={(event) => finishPointer(event, true)}>
        {kind === 'image' ? <img key={source.url} ref={image} src={source.url} alt="原图片" draggable={false}
          onLoad={(event) => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
          onError={() => setStatus('无法读取此图片，请换一个浏览器可打开的文件')} /> : <video key={source.url} ref={video} src={source.url} preload="auto" playsInline
          onLoadedMetadata={(event) => {
            const player = event.currentTarget
            setSize({ width: player.videoWidth, height: player.videoHeight })
            setDuration(Number.isFinite(player.duration) ? player.duration : 0)
          }}
          onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
          onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
          onError={() => setStatus('无法读取此视频，请换一个浏览器可播放的文件')} />}
        {preview && <canvas ref={previewCanvas} aria-hidden="true" />}
        {size && !preview && regions.map((region, index) => <button key={region.id} type="button" data-region-id={region.id}
          className={`watermark-region ${region.id === selected ? 'is-selected' : ''}`} style={boundsStyle(region)}
          aria-label={`水印区域 ${index + 1}`} aria-pressed={region.id === selected} disabled={locked}
          onClick={() => setSelected(region.id)}
          onKeyDown={(event) => {
            const step = event.shiftKey ? .02 : .005
            const direction: Record<string, Point> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } }
            const delta = direction[event.key]
            if (!delta) return
            event.preventDefault()
            adjustRegion(region, delta)
            setResult(null)
          }}>
          <span>{index + 1}</span><i className="watermark-resize" aria-hidden="true" />
        </button>)}
        {draft && <span className="watermark-region is-draft" style={boundsStyle(draft)} />}
      </div>
      {size && <>
        {kind === 'video' && <div className="watermark-player-controls">
          <button type="button" aria-label={playing ? '暂停原视频' : '播放原视频'} disabled={locked} onClick={() => {
            const player = video.current
            if (!player) return
            if (player.paused) void player.play().catch(() => setStatus('视频播放失败'))
            else player.pause()
          }}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
          <input type="range" aria-label="预览进度" min={0} max={duration || 1} step=".01" value={duration ? Math.min(duration, time) : 0}
            disabled={!duration || locked} onChange={(event) => { if (video.current) video.current.currentTime = Number(event.target.value) }} />
          <span>{formatTime(time)} / {duration ? formatTime(duration) : '—'}</span>
        </div>}
        <div className="watermark-options">
          <p>{preview ? '正在查看处理效果' : regions.length ? `已框选 ${regions.length} 个区域，可拖动选框或右下角手柄` : '在画面上拖动，框住水印'}</p>
          <div>
            <button type="button" disabled={locked || regions.length >= limit} onClick={() => addRegion({ x: .66, y: .78, width: .26, height: .13 })}><Plus size={15} />添加区域</button>
            <button type="button" disabled={locked || !selected || preview} onClick={removeRegion}><Trash2 size={15} />删除选区</button>
            <button type="button" aria-pressed={preview} disabled={!regions.length || locked} onClick={() => setPreview(!preview)}><Eye size={15} />{preview ? '返回编辑' : '预览效果'}</button>
          </div>
        </div>
        <div className="watermark-export">
          <small>适合固定角标或 Logo · {kind === 'video' ? '保留原声' : '保留原图尺寸'}</small>
          {detecting ? <div role="status"><LoaderCircle className="is-spinning" size={15} />正在识别水印</div> : busy ? <div role="status"><LoaderCircle className="is-spinning" size={15} /> 正在处理 {progress}%
            <button type="button" onClick={() => { controller.current?.abort(); setStatus('已取消处理') }}>取消</button>
          </div> : <div>{source.fromLink && !regions.length && <a className="watermark-original" href={source.url} download={source.name}>下载原素材</a>}
            <button className="watermark-primary" type="button" disabled={!regions.length} onClick={() => { setStatus(''); void run(regions) }}>处理{noun}</button></div>}
        </div>
      </>}
    </>}
    {status && <p className="watermark-status" role="status">{status}</p>}
    {result && <section className="watermark-result" aria-label="处理结果">
      {kind === 'image' ? <img src={result.url} alt="修补结果" /> : <video src={result.url} preload="metadata" controls playsInline />}
      <a className="watermark-primary" href={result.url} download={result.name}><Download size={16} />下载 {result.name.split('.').pop()?.toUpperCase()}</a>
    </section>}
  </div>
}
