import { useEffect, useRef, useState } from 'react'
import { Film } from 'lucide-react'
import { loadHistoryMedia } from './localDb'

type VideoThumbnailSource = { url?: string; mediaId?: string }

export function showVideoThumbnailFrame(video: HTMLVideoElement) {
  if (video.duration > 0) video.currentTime = Math.min(0.1, video.duration / 2)
}

export async function loadVideoThumbnailSource(reference: VideoThumbnailSource) {
  const stored = reference.mediaId ? await loadHistoryMedia(reference.mediaId).catch(() => null) : null
  return stored?.blob.size ? URL.createObjectURL(stored.blob) : reference.url
}

export function VideoReferenceThumbnail({ reference, name, lazy = false }: { reference: VideoThumbnailSource; name?: string; lazy?: boolean }) {
  const [resolvedUrl, setResolvedUrl] = useState<string>()
  const [ready, setReady] = useState(false)
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
    let objectUrl: string | undefined
    setReady(false)
    setResolvedUrl(undefined)
    void loadVideoThumbnailSource({ mediaId: reference.mediaId, url: reference.url }).then((url) => {
      if (url !== reference.url) objectUrl = url
      if (disposed) {
        if (objectUrl) URL.revokeObjectURL(objectUrl)
        return
      }
      setResolvedUrl(url)
    })
    return () => {
      disposed = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [reference.mediaId, reference.url, visible])

  return <span ref={previewRef} className="video-reference-preview" aria-hidden={name ? undefined : true}>
    <Film size={13} aria-hidden="true" />
    {resolvedUrl && <video className="video-reference-thumbnail" src={resolvedUrl} aria-label={name ? `${name} 视频缩略图` : undefined}
      data-ready={ready} muted playsInline preload="auto"
      onLoadedMetadata={(event) => showVideoThumbnailFrame(event.currentTarget)}
      onLoadedData={() => setReady(true)} onError={() => setReady(false)} />}
  </span>
}
