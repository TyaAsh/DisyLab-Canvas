const APIYI_HOSTS = ['api.apiyi.com', 'vip.apiyi.com', 'b.apiyi.com']
const HFSY_HOSTS = ['www.hfsyapi.cn', 'api.hfsyapi.cn', 'apigo.hfsyapi.cn']
const VISIONARY_HOSTS = ['visionary.beer', 'api.visionary.beer']
const RELAY_ORIGIN = 'https://disylab.invalid'

export function isDesktopApp() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function trustedBase(value: string | null, fallback: string, hosts: string[]) {
  const url = new URL(value || fallback)
  if (url.protocol !== 'https:' || !hosts.includes(url.hostname) || url.username || url.password || url.port) {
    throw new Error('不支持的上游接口地址')
  }
  return url
}

// Translate the browser-only relays into their original upstream requests.
// The desktop client sends them through Tauri, without depending on Vite or Pages.
export function resolveDesktopProviderRequest(input: string | URL, init?: RequestInit, appOrigin?: string) {
  const url = new URL(input, RELAY_ORIGIN)
  if (!/^https?:$/.test(url.protocol)) return undefined
  if (url.origin !== RELAY_ORIGIN && url.origin !== appOrigin) return { url, init }
  const headers = new Headers(init?.headers)
  const path = url.pathname
  let target: URL
  let scopedMediaAuth = false

  if (path === '/apiyi/media') {
    target = new URL(url.searchParams.get('url') ?? '')
    if (!/^https?:$/.test(target.protocol) || target.username || target.password) throw new Error('不支持的媒体地址')
    const authorization = headers.get('x-disylab-media-authorization')
    headers.delete('authorization')
    if (target.protocol === 'https:' && /(?:^|\.)aixinai\.net$|^www\.qixinai\.net$/i.test(target.hostname)) {
      headers.set('Referer', 'https://www.hfsyapi.cn/')
      headers.set('Origin', 'https://www.hfsyapi.cn')
      if (authorization?.startsWith('Bearer ')) {
        headers.set('Authorization', authorization)
        scopedMediaAuth = true
      }
    }
  } else if (/^\/apiyi\/(?:openai|seedance|wan|veo)\//.test(path)) {
    const base = trustedBase(headers.get('x-disylab-apiyi-origin'), 'https://api.apiyi.com', APIYI_HOSTS)
    target = new URL(base.origin + path.replace(/^\/apiyi\/[^/]+/, '') + url.search)
    headers.set('Accept-Encoding', 'identity')
  } else if (path.startsWith('/hfsy/')) {
    const base = trustedBase(headers.get('x-disylab-hfsy-base'), 'https://apigo.hfsyapi.cn/v1', HFSY_HOSTS)
    const upstream = path.slice('/hfsy/'.length)
    target = upstream === '__root__/api/pricing'
      ? new URL(base.origin + '/api/pricing' + url.search)
      : new URL(base.origin + '/' + upstream + url.search)
  } else if (path.startsWith('/visionary/')) {
    const base = trustedBase(headers.get('x-disylab-visionary-base'), 'https://api.visionary.beer/v1', VISIONARY_HOSTS)
    target = new URL(base.origin + base.pathname.replace(/\/$/, '') + path.slice('/visionary'.length) + url.search)
  } else if (path.startsWith('/evolink/')) {
    target = new URL('https://api.evolink.ai/v1' + path.slice('/evolink'.length) + url.search)
  } else {
    return undefined
  }

  for (const name of Array.from(headers.keys())) {
    if (name.startsWith('x-disylab-')) headers.delete(name)
  }
  return { url: target, init: { ...init, headers, ...(scopedMediaAuth ? { maxRedirections: 0 } : {}) } }
}

export async function providerFetch(input: string | URL, init?: RequestInit) {
  if (isDesktopApp()) {
    const request = resolveDesktopProviderRequest(input, init, window.location.origin)
    if (request) {
      const { fetch: nativeFetch } = await import('@tauri-apps/plugin-http')
      const headers = new Headers(request.init?.headers)
      // Native requests have no browser origin. Preserve the explicit origin for media relays.
      if (!headers.has('Origin')) headers.set('Origin', '')
      try {
        return await nativeFetch(request.url, { ...request.init, headers })
      } catch (error) {
        if (request.init?.signal?.aborted) throw request.init.signal.reason
        const detail = error instanceof Error ? error.message : String(error)
        // Native errors can contain the full URL, including credentials in its query string.
        const safeDetail = detail.replace(/https?:\/\/[^\s)]+/gi, () => request.url.origin)
        throw new Error(safeDetail || '桌面网络请求失败')
      }
    }
  }
  return fetch(input, init)
}
