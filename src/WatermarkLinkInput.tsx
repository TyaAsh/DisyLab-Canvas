import { useEffect, useRef, useState } from 'react'
import { Link2, LoaderCircle } from 'lucide-react'
import { isDesktopApp } from './providerTransport'
import { fetchSharedMedia, limitedBody, MAX_LINK_MEDIA, mediaKind, parseSharedMediaUrl, resolveSharedPost, sharedPlatform, type MediaLink } from './sharedMedia'

const extensionByMime: Record<string, string> = { 'image/jpeg': 'jpg', 'video/quicktime': 'mov', 'video/x-matroska': 'mkv', 'video/x-msvideo': 'avi', 'video/x-m4v': 'm4v' }
const relay = (action: 'post' | 'file', url: string, signal: AbortSignal) => fetch(`/toolbox/media?${new URLSearchParams({ action, url })}`, { signal, credentials: 'omit' })
const relayError = async (response: Response) => new Error((await response.json().catch(() => null))?.error || '当前站点暂时不能读取此分享链接，请改用本地文件')

export function WatermarkLinkInput({ onLoad, disabled }: { onLoad: (file: File) => void; disabled: boolean }) {
  const [text, setText] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [links, setLinks] = useState<MediaLink[]>([])
  const [selected, setSelected] = useState(0)
  const task = useRef<AbortController | null>(null)
  useEffect(() => () => task.current?.abort(), [])

  const run = async (pick?: number) => {
    if (task.current || !text.trim()) return
    const request = new AbortController()
    task.current = request
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(50000)])
    setBusy(true)
    setNotice('')
    try {
      const url = parseSharedMediaUrl(text)
      const platform = sharedPlatform(url)
      if (platform === 'youtube') {
        setNotice('YouTube 分享页无法直接读取视频文件。可以从 YouTube Studio 下载自己上传的视频，再拖入这里。')
        return
      }
      const transport = isDesktopApp() ? (await import('@tauri-apps/plugin-http')).fetch : undefined
      let response: Response
      let fileName = ''
      if (platform) {
        let media = pick === undefined ? undefined : links[pick]
        if (!media) {
          let candidates: MediaLink[]
          if (transport) candidates = await resolveSharedPost(url.href, (target, options) => transport(target, { ...options, maxRedirections: 0 }), signal)
          else {
            const post = await relay('post', url.href, signal)
            if (!post.ok || !post.headers.get('content-type')?.includes('application/json')) throw await relayError(post)
            candidates = await post.json()
          }
          if (candidates.length > 1) { setLinks(candidates); setSelected(0); return }
          media = candidates[0]
          if (!media) throw new Error('没有读到公开的图片或视频')
        }
        fileName = media.name
        response = transport ? await fetchSharedMedia(media.url, (target, options) => transport(target, { ...options, maxRedirections: 0 }), signal) : await relay('file', media.url, signal)
        if (!response.ok) throw await relayError(response)
      } else {
        response = await fetch(url.href, { credentials: 'omit', referrerPolicy: 'no-referrer', signal }).catch(() => {
          throw new Error('这个链接无法直接读取。请使用可公开访问的图片或视频直链，或先保存为本地文件。')
        })
        fileName = url.pathname.split('/').filter(Boolean).at(-1)?.replace(/\.[a-z0-9]{2,6}$/i, '') || 'media'
      }
      const type = response.headers.get('content-type')?.split(';')[0].toLowerCase() || ''
      if (!response.ok || !mediaKind(type)) { void response.body?.cancel(); throw new Error('链接返回的是网页或不支持的文件。请粘贴分享链接或图片、视频直链。') }
      const data = await new Response(await limitedBody(response, MAX_LINK_MEDIA, signal)).blob()
      signal.throwIfAborted()
      if (!data.size) throw new Error('链接返回了空文件')
      onLoad(new File([data], `${fileName}.${extensionByMime[type] || type.split('/')[1]}`, { type }))
    } catch (error) {
      if (!request.signal.aborted) setNotice(signal.aborted ? '读取链接超时，请重试或导入本地文件' : error instanceof Error ? error.message : '读取失败，请重试')
    } finally {
      task.current = null
      if (!request.signal.aborted) setBusy(false)
    }
  }

  return <form className="watermark-link" onSubmit={(event) => { event.preventDefault(); void run(links.length ? selected : undefined) }}>
    <label><Link2 size={16} aria-hidden="true" /><strong>从链接导入</strong></label>
    <div className="watermark-link-field">
      <input aria-label="分享链接" placeholder="粘贴小红书、抖音分享链接或媒体直链" value={text} disabled={busy || disabled}
        onChange={(event) => { setText(event.target.value); setLinks([]); setNotice('') }} />
      <button type="submit" disabled={!text.trim() || busy || disabled}>{busy ? <><LoaderCircle size={14} className="is-spinning" />读取中</> : links.length ? '导入所选' : '读取链接'}</button>
    </div>
    {!!links.length && <label className="watermark-link-pick">找到 {links.length} 张图片<select aria-label="选择帖子图片" value={selected} disabled={busy || disabled} onChange={(event) => setSelected(Number(event.target.value))}>
      {links.map((link, index) => <option key={link.url} value={index}>第 {index + 1} 张</option>)}
    </select></label>}
    {notice && <p className="watermark-status" role="status">{notice}</p>}
  </form>
}
