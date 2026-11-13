import { useEffect, useState, type ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import { loadHistoryMedia } from './localDb'
import { checkVideoReferences, readVideoMetadata, unreadableVideoReferenceIssue, type VideoReferenceRules, type VideoReferenceSource } from './videoReference'

const isLocalVideo = (url?: string) => !/^(?:https?:\/\/|asset:\/\/)/i.test(url ?? '')

const metadataCache = new Map<string, ReturnType<typeof inspectVideo>>()

async function inspectVideo(reference: VideoReferenceSource) {
  const local = isLocalVideo(reference.url)
  const saved = reference.mediaId ? await loadHistoryMedia(reference.mediaId).catch(() => undefined) : undefined
  const blob = saved?.blob ?? (local && reference.url
    ? await fetch(reference.url).then((response) => response.ok ? response.blob() : undefined).catch(() => undefined)
    : undefined)
  const source = blob ?? reference.url
  const metadata = source && !(typeof source === 'string' && source.startsWith('asset://'))
    ? await readVideoMetadata(source, saved?.fileName ?? reference.name)
    : undefined
  return { metadata, local }
}

export async function inspectVideoReferences(references: VideoReferenceSource[]) {
  const unique = new Map<string, VideoReferenceSource>()
  for (const reference of references) {
    const key = reference.mediaId || reference.url
    if (key && !unique.has(key)) unique.set(key, reference)
  }
  return Promise.all(Array.from(unique, async ([key, reference]) => {
    let pending = metadataCache.get(key)
    if (!pending) {
      pending = inspectVideo(reference)
      metadataCache.set(key, pending)
      if (metadataCache.size > 100) {
        const oldest = metadataCache.keys().next().value
        if (oldest) metadataCache.delete(oldest)
      }
    }
    const result = await pending.catch(() => ({ metadata: undefined, local: isLocalVideo(reference.url) }))
    if (!result.metadata && metadataCache.get(key) === pending) metadataCache.delete(key)
    return { name: reference.name, ...result }
  }))
}

export function useVideoReferenceCheck(rules: VideoReferenceRules | undefined, references: VideoReferenceSource[]) {
  const unique = Array.from(new Map(references.map(({ name, url, mediaId }) => [mediaId || url, { name, url, mediaId }])).values())
  const key = JSON.stringify(rules && rules.maxCount !== 0 ? unique : [])
  const [result, setResult] = useState<{ key: string; videos: Awaited<ReturnType<typeof inspectVideoReferences>> }>()
  useEffect(() => {
    if (key === '[]') return
    let current = true
    void inspectVideoReferences(JSON.parse(key) as VideoReferenceSource[]).then((videos) => {
      if (current) setResult({ key, videos })
    })
    return () => { current = false }
  }, [key])
  const videos = result?.key === key ? result.videos : []
  const pending = key !== '[]' && result?.key !== key
  const issues = checkVideoReferences(rules, videos.length ? videos : unique)
  const localIssue = unreadableVideoReferenceIssue(videos)
  if (localIssue) issues.push(localIssue)
  return {
    issues,
    pending,
    unreadable: videos.filter(({ metadata, local }) => !metadata && !local).map(({ name }) => name),
  }
}

export function VideoPlanReferenceCheck({ rules, references, children }: {
  rules?: VideoReferenceRules
  references: VideoReferenceSource[]
  children: (check: ReturnType<typeof useVideoReferenceCheck>) => ReactNode
}) {
  return children(useVideoReferenceCheck(rules, references))
}

export function VideoReferenceNotice({ check, hint }: { check: ReturnType<typeof useVideoReferenceCheck>; hint?: string }) {
  const messages = [...check.issues]
  if (hint) messages.push(hint)
  if (check.pending) messages.push('正在读取参考视频规格…')
  else if (check.unreadable.length) messages.push(`无法读取“${check.unreadable.join('、')}”的完整规格。可重新上传本地文件以便检查。`)
  if (!messages.length) return null
  return <div className="video-reference-notice" data-invalid={check.issues.length > 0} role="status">
    <AlertCircle size={15} aria-hidden="true" />
    <div>{messages.map((message) => <div key={message}>{message}</div>)}</div>
  </div>
}
