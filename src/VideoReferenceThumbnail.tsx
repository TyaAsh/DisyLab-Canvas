import { useEffect, useRef, useState } from 'react'
import { Film, LoaderCircle } from 'lucide-react'
import { loadHistoryMedia } from './localDb'

type VideoThumbnailSource = { url?: string; mediaId?: string }

const posterCache = new Map<string, Promise<string>>()

/** A still image also renders reliably inside Chromium contenteditable chips. */
export function loadVideoThumbnailPoster(reference: VideoThumbnailSource): Promise<string> {
  const key = reference.mediaId || reference.url || ''
  if (!key) return Promise.reject(new Error('视频来源已丢失'))
  const cached = posterCache.get(key)
  if (cached) return cached
  const task = (async () => {
    const source = await loadVideoThumbnailSource(reference)
    if (!source) throw new Error('视频来源已丢失')
    const video = document.createElement('video')
    video.muted = true; video.playsInline = true; video.preload = 'auto'; video.crossOrigin = 'anonymous'
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await new Promise<string>((resolve, reject) => {
        let seekingFrame = false, finished = false
        const fail = () => { if (!finished) { finished = true; reject(new Error('无法读取视频画面，请检查视频是否可播放')) } }
        const draw = () => {
          if (finished || !video.videoWidth || !video.videoHeight) return
          try {
            const canvas = document.createElement('canvas')
            const scale = Math.min(1, 160 / Math.max(video.videoWidth, video.videoHeight))
            canvas.width = Math.max(1, Math.round(video.videoWidth * scale)); canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
            const context = canvas.getContext('2d')
            if (!context) return fail()
            context.drawImage(video, 0, 0, canvas.width, canvas.height)
            const poster = canvas.toDataURL('image/jpeg', .82)
            finished = true; resolve(poster)
          } catch { fail() }
        }
        video.onloadedmetadata = () => {
          const time = Number.isFinite(video.duration) && video.duration > 0 ? Math.min(.2, video.duration / 2) : 0
          if (time > 0) { seekingFrame = true; video.currentTime = time }
        }
        video.onloadeddata = () => { if (!seekingFrame) draw() }
        video.onseeked = draw
        video.onerror = fail
        timer = setTimeout(fail, 8000)
        // Install listeners before assigning src: cached/local videos may load immediately.
        video.src = source
        video.load()
      })
    } finally {
      clearTimeout(timer)
      video.onloadedmetadata = video.onloadeddata = video.onseeked = video.onerror = null
      video.removeAttribute('src'); video.load()
      if (source !== reference.url && source.startsWith('blob:')) URL.revokeObjectURL(source)
    }
  })()
  posterCache.set(key, task)
  if (posterCache.size > 48) posterCache.delete(posterCache.keys().next().value!)
  void task.catch(() => { if (posterCache.get(key) === task) posterCache.delete(key) })
  return task
}

export function showVideoThumbnailFrame(video: HTMLVideoElement) {
  if (video.duration > 0) video.currentTime = Math.min(0.1, video.duration / 2)
}

export async function loadVideoThumbnailSource(reference: VideoThumbnailSource) {
  const stored = reference.mediaId ? await loadHistoryMedia(reference.mediaId).catch(() => null) : null
  return stored?.blob.size ? URL.createObjectURL(stored.blob) : reference.url
}

export function VideoReferenceThumbnail({ reference, name, lazy = false }: { reference: VideoThumbnailSource; name?: string; lazy?: boolean }) {
  const [resolvedUrl, setResolvedUrl] = useState<string>()
  const [error, setError] = useState('')
  const [visible, setVisible] = useState(!lazy)
  const previewRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (visible || !previewRef.current) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) setVisible(true)
    })
    observer.observe(previewRef.current)
    return () => observer.disconnect()
  }, [visible])
  useEffect(() => {
    if (!visible) return
    let disposed = false
    setError('')
    setResolvedUrl(undefined)
    void loadVideoThumbnailPoster(reference).then(url => { if (!disposed) setResolvedUrl(url) })
      .catch(reason => { if (!disposed) setError(reason instanceof Error ? reason.message : '无法读取视频缩略图') })
    return () => { disposed = true }
  }, [reference.mediaId, reference.url, visible])

  return <span ref={previewRef} className="video-reference-preview" title={error || (!resolvedUrl ? '正在读取视频画面…' : name)} aria-label={name ? `${name} 视频缩略图${error ? '，' + error : ''}` : undefined} aria-hidden={name ? undefined : true}>
    {!resolvedUrl && !error && visible ? <LoaderCircle size={13} className="is-spinning" aria-hidden="true"/> : <Film size={13} aria-hidden="true" />}
    {resolvedUrl && <img className="video-reference-thumbnail" src={resolvedUrl} alt="" draggable={false}/>}
  </span>
}
