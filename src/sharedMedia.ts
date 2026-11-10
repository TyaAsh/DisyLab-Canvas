export type MediaKind = 'image' | 'video'
export type MediaLink = { url: string; kind: MediaKind; name: string }
type Fetcher = (url: string, init: RequestInit) => Promise<Response>
type Platform = 'xiaohongshu' | 'douyin' | 'youtube'

const MAX_PAGE = 5 * 1024 * 1024
export const MAX_LINK_MEDIA = 180 * 1024 * 1024
const roots = {
  xiaohongshu: ['xiaohongshu.com', 'xhslink.com'],
  douyin: ['douyin.com', 'iesdouyin.com'],
  youtube: ['youtube.com', 'youtu.be'],
}
const mediaHosts = ['xhscdn.com', 'douyinvod.com', 'douyinpic.com', 'byteimg.com', 'ixigua.com', 'douyin.com', 'iesdouyin.com']
const hostMatches = (host: string, domains: string[]) => domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
const cleanHttps = (raw: string) => {
  const url = new URL(raw)
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('请使用公开的 HTTPS 链接')
  return url
}

export function parseSharedMediaUrl(text: string) {
  const match = text.match(/https?:\/\/[^\s\u3000\u4e00-\u9fff<>"'，。！？、；（）【】]+/i)?.[0]
  if (!match) throw new Error('请粘贴完整链接，也可以粘贴带链接的分享文案')
  const url = cleanHttps(match.replace(/[.,;!?)\]}]+$/, '').replace(/^http:\/\//i, 'https://'))
  if (!url.hostname.includes('.') || /^(?:\d+\.){3}\d+$|\.(?:localhost|local|internal)$/i.test(url.hostname)) throw new Error('请使用公开的媒体链接')
  return url
}

export function sharedPlatform(url: URL): Platform | undefined {
  return (Object.keys(roots) as Platform[]).find((name) => hostMatches(url.hostname, roots[name]))
}

export function mediaKind(contentType: string): MediaKind | undefined {
  if (/^image\/(?:jpeg|png|webp|avif|gif|bmp)(?:$|;)/i.test(contentType)) return 'image'
  if (/^video\/(?:mp4|webm|quicktime|ogg|x-m4v|x-matroska|x-msvideo)(?:$|;)/i.test(contentType)) return 'video'
}

function allowedMediaUrl(raw: string, base: URL) {
  try {
    const url = cleanHttps(new URL(raw.replaceAll('&amp;', '&'), base).href.replace(/^http:/, 'https:'))
    return hostMatches(url.hostname, mediaHosts) ? url : undefined
  } catch { return undefined }
}

export async function limitedBody(response: Response, limit: number, signal?: AbortSignal) {
  if (!response.body || Number(response.headers.get('content-length')) > limit) {
    void response.body?.cancel()
    throw new Error('文件过大或内容不可读，请保存到本地后导入')
  }
  let bytes = 0
  return response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) {
    signal?.throwIfAborted()
    bytes += chunk.byteLength
    if (bytes > limit) throw new Error('文件过大，请保存到本地后导入')
    controller.enqueue(chunk)
  } }))
}

async function followPublic(url: URL, transport: Fetcher, allow: (url: URL) => boolean, signal?: AbortSignal, referer?: string) {
  const headers = { Accept: '*/*', ...(referer ? { Referer: referer } : {}), 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' }
  for (let i = 0; i < 6; i++) {
    if (!allow(url)) throw new Error('链接跳转到了不支持的地址')
    const response = await transport(url.href, { redirect: 'manual', signal, headers, credentials: 'omit' })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      void response.body?.cancel()
      if (!location) break
      url = cleanHttps(new URL(location, url).href.replace(/^http:/, 'https:'))
    } else if (response.ok) return { url, response }
    else { void response.body?.cancel(); break }
  }
  throw new Error('平台暂时没有返回公开媒体，请确认链接可公开访问，或改用本地文件')
}

function parsePageState(html: string) {
  const result: unknown[] = []
  const tryJson = (raw: string) => {
    try { result.push(JSON.parse(raw.trim().replace(/"(?:[^"\\]|\\.)*"|\bundefined\b/g, (token) => token === 'undefined' ? 'null' : token))) } catch { /* page has no structured data */ }
  }
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/\bid\s*=\s*["']RENDER_DATA["']/i.test(script[1])) {
      try { tryJson(decodeURIComponent(script[2].trim())) } catch { /* invalid escape */ }
    } else {
      const state = script[2].match(/^\s*(?:window\.)?(?:__INITIAL_STATE__|_ROUTER_DATA|__NEXT_DATA__|__SSR_HYDRATED_DATA)\s*=\s*([\s\S]+?)\s*;?\s*$/)
      if (state) tryJson(state[1])
      else if (/application\/(?:ld\+json|json)/i.test(script[1])) tryJson(script[2])
    }
  }
  return result
}

export function extractSharedMedia(html: string, base: URL): MediaLink[] {
  const found: Record<MediaKind, Map<string, URL>> = { image: new Map(), video: new Map() }
  const add = (value: unknown, kind: MediaKind) => {
    if (typeof value !== 'string') return false
    const url = allowedMediaUrl(value, base)
    if (!url || (kind === 'video' && /(?:\.m3u8|\.mpd)(?:$|\?)/i.test(url.href))) return false
    if (found[kind].size < 24) found[kind].set(url.origin + url.pathname, url)
    return true
  }
  const firstUrl = (value: unknown, kind: MediaKind, depth = 0): boolean => {
    if (depth > 5 || !value) return false
    if (typeof value === 'string') return add(value, kind)
    if (Array.isArray(value)) return value.some((item) => firstUrl(item, kind, depth + 1))
    if (typeof value !== 'object') return false
    const node = value as Record<string, unknown>
    return ['urlDefault', 'masterUrl', 'url', 'src', 'urlList', 'url_list', 'downloadUrlList', 'infoList', 'display_image'].some((key) => firstUrl(node[key], kind, depth + 1))
  }
  const states = parsePageState(html)
  const noteId = base.pathname.match(/\/(?:explore|discovery\/item)\/([\da-f]+)/i)?.[1]
  const matchingNotes = noteId ? states.flatMap((state) => {
    const note = (state as { note?: { noteDetailMap?: Record<string, { note?: unknown }> } } | null)?.note?.noteDetailMap?.[noteId]?.note
    return note ? [note] : []
  }) : []
  const queue = matchingNotes.length ? matchingNotes : states
  for (let index = 0; index < queue.length && index < 50000; index++) {
    const value = queue[index]
    if (Array.isArray(value)) { for (const item of value) if (item && typeof item === 'object') queue.push(item); continue }
    if (!value || typeof value !== 'object') continue
    const node = value as Record<string, unknown>
    for (const [key, child] of Object.entries(node)) {
      if (key === 'imageList' || key === 'images') {
        if (Array.isArray(child)) for (const item of child) firstUrl(item, 'image')
      } else if (['masterUrl', 'playAddr', 'play_addr', 'downloadAddr', 'download_addr'].includes(key)) firstUrl(child, 'video')
      else if (key === 'contentUrl' && node['@type'] === 'VideoObject') add(child, 'video')
      else if (key === 'contentUrl' && node['@type'] === 'ImageObject') add(child, 'image')
      if (child && typeof child === 'object' && queue.length < 50000) queue.push(child)
    }
  }
  let cover = ''
  let videoPage = /\/(?:video|share\/video)\//.test(base.pathname)
    || matchingNotes.some((note) => (note as { type?: string }).type === 'video')
    || /["']noteType["']\s*:\s*["']video["']/i.test(html)
  for (const match of html.matchAll(/<meta\s+([^>]+)>/gi)) {
    const attributes = Object.fromEntries(Array.from(match[1].matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g), (part) => [part[1].toLowerCase(), part[3]]))
    const key = (attributes.property || attributes.name || '').toLowerCase()
    if (key === 'og:type' && /^video\b/i.test(attributes.content)) videoPage = true
    if (['og:video', 'og:video:url', 'og:video:secure_url', 'twitter:player:stream'].includes(key)) add(attributes.content, 'video')
    if (key === 'og:image' && !cover) cover = attributes.content
  }
  if (videoPage && !found.video.size) return []
  if (!found.video.size && !found.image.size && cover && /\/(?:explore|discovery\/item|note|share\/note)\//.test(base.pathname)) add(cover, 'image')
  const kind: MediaKind = found.video.size ? 'video' : 'image'
  return Array.from(found[kind].values()).slice(0, kind === 'video' ? 1 : 24).map((url, index) => ({
    url: url.href, kind, name: `${sharedPlatform(base) || 'media'}-${index + 1}`,
  }))
}

export async function resolveSharedPost(raw: string, transport: Fetcher, signal?: AbortSignal) {
  const initial = cleanHttps(raw)
  const platform = sharedPlatform(initial)
  if (!platform || platform === 'youtube') throw new Error('这个平台未提供可直接读取的公开文件')
  const read = async (address: URL) => {
    const { url, response } = await followPublic(address, transport, (target) => sharedPlatform(target) === platform, signal)
    const html = await new Response(await limitedBody(response, MAX_PAGE, signal)).text()
    return { media: extractSharedMedia(html, url), url }
  }
  const first = await read(initial)
  if (first.media.length) return first.media
  const douyinPost = platform === 'douyin' && first.url.pathname.match(/^\/(?:share\/)?(video|note)\/(\d+)\/?$/)
  if (douyinPost && !hostMatches(first.url.hostname, ['iesdouyin.com'])) {
    const alternate = new URL(`https://www.iesdouyin.com/share/${douyinPost[1]}/${douyinPost[2]}/`)
    const result = await read(alternate)
    if (result.media.length) return result.media
  }
  throw new Error('没有读取到公开图片或视频；如果帖子需要登录，请先保存文件，再拖入工具')
}

export async function fetchSharedMedia(raw: string, transport: Fetcher, signal?: AbortSignal) {
  const initial = cleanHttps(raw)
  const referer = hostMatches(initial.hostname, ['xhscdn.com']) ? 'https://www.xiaohongshu.com/' : 'https://www.douyin.com/'
  const { response } = await followPublic(initial, transport, (target) => hostMatches(target.hostname, mediaHosts), signal, referer)
  const type = response.headers.get('content-type') || ''
  if (!mediaKind(type)) { void response.body?.cancel(); throw new Error('该地址没有返回可读取的图片或视频') }
  return new Response(await limitedBody(response, MAX_LINK_MEDIA, signal), {
    headers: { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  })
}
