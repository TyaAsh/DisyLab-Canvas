import { isDesktopApp, providerFetch } from './providerTransport'

export const MUSE_WEB_BASE = 'https://muse.ai/'
export const MUSE_WEB_CONNECTION = 'disy-desktop-muse-web'
export const isMuseWebBase = (baseUrl: string) => baseUrl.trim().replace(/\/$/, '') === 'https://muse.ai'

export const MUSE_WEB_MODELS = [
  { id: 'muse-chat', name: 'Muse 对话', capability: 'text' },
  { id: 'muse-image', name: 'Muse 图片', capability: 'image' },
  { id: 'muse-video', name: 'Muse 视频', capability: 'video' },
] as const

type MuseOperation = 'status' | 'start' | 'poll' | 'media' | 'release'
type MuseKind = typeof MUSE_WEB_MODELS[number]['capability']
type MuseReply = { state: string; text?: string; size?: number; type?: string; data?: string; source?: string }
const MAX_MEDIA_BYTES = 100_000_000

async function callMuse(operation: MuseOperation, payload: Record<string, unknown> = {}): Promise<MuseReply> {
  if (!isDesktopApp()) throw new Error('请在 Disy Windows 桌面版连接 Muse 账号。')
  const { invoke } = await import('@tauri-apps/api/core')
  try {
    const reply = await invoke<MuseReply | null>('muse_web', { operation, payload })
    if (!reply) throw new Error('Muse 网页未返回状态，请打开窗口检查。')
    return reply
  } catch (error) {
    throw new Error(typeof error === 'string' ? error : error instanceof Error ? error.message : 'Muse 网页连接中断')
  }
}

function waitForMuse(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal?.throwIfAborted()
    const cancel = () => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', cancel)
      resolve()
    }, ms)
    signal?.addEventListener('abort', cancel, { once: true })
  })
}

export async function checkMuseWebAccount() {
  let state = 'loading'
  for (let attempt = 0; attempt < 12; attempt++) {
    state = (await callMuse('status')).state
    if (state === 'ready') return
    if (attempt < 11) await waitForMuse(attempt < 3 ? 250 : 650)
  }
  throw new Error(state === 'loading' ? 'Muse 网页仍在加载，请稍后刷新状态。' : '请在 Disy 打开的 Muse 窗口登录，进入可发送消息的页面后刷新状态。')
}

export async function listMuseWebModels() {
  await checkMuseWebAccount()
  return MUSE_WEB_MODELS.map((model) => ({ ...model }))
}

const museErrors: Record<string, string> = {
  login: 'Muse 登录状态失效，请在桌面窗口重新登录。',
  busy: 'Muse 正在处理另一项任务，请等它结束后再提交。',
  draft: 'Muse 输入框有草稿，请先在 Muse 窗口处理草稿。',
  attachments: 'Muse 未确认接收参考图。请在 Muse 窗口检查附件后重试。',
  unsupported: '当前 Muse 页面没有可用的发送控件，请检查是否已进入对话页。',
  lost: 'Muse 页面已刷新或切换，无法继续跟踪这项任务。请在 Muse 窗口查看原任务。',
  'download-failed': 'Muse 已显示生成结果，但画布未能读取媒体。可在 Muse 窗口打开原结果。',
}

async function readMusePublicMedia(source: string, kind: MuseKind, signal?: AbortSignal) {
  const url = new URL(source)
  const trustedHost = /(^|\.)(?:muse\.ai|meta\.ai|meta\.com|fbcdn\.net|facebook\.com|cdninstagram\.com)$/i.test(url.hostname)
  if (url.protocol !== 'https:' || !trustedHost || url.username || url.password || url.port) throw new Error(museErrors['download-failed'])
  const timeout = AbortSignal.timeout(45_000)
  const init = { credentials: 'omit', redirect: 'error', maxRedirections: 0, signal: signal ? AbortSignal.any([signal, timeout]) : timeout } as const
  const response = await providerFetch(url, init)
  const type = response.headers.get('content-type')?.split(';')[0] ?? ''
  if (!response.ok || !type.startsWith(kind + '/') || type === 'image/svg+xml' || !response.body || Number(response.headers.get('content-length')) > MAX_MEDIA_BYTES) {
    throw new Error(museErrors['download-failed'])
  }
  const reader = response.body.getReader()
  const parts: Uint8Array<ArrayBuffer>[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > MAX_MEDIA_BYTES) throw new Error(museErrors['download-failed'])
      parts.push(new Uint8Array(value))
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  if (!size) throw new Error(museErrors['download-failed'])
  return new Blob(parts, { type })
}

export async function runMuseWebTask(input: {
  kind: MuseKind; prompt: string; references?: string[]; signal?: AbortSignal; onSubmitted?: (id: string) => void
}): Promise<{ taskId: string; text?: string; blob?: Blob }> {
  input.signal?.throwIfAborted()
  const id = crypto.randomUUID()
  await checkMuseWebAccount()
  input.signal?.throwIfAborted()
  const started = await callMuse('start', { id, kind: input.kind, prompt: input.prompt, references: input.references ?? [] })
  if (started.state !== 'starting') throw new Error(museErrors[started.state] ?? 'Muse 未能提交任务。')
  let submitted = false
  try {
    const deadline = Date.now() + (input.kind === 'video' ? 480_000 : 210_000)
    while (Date.now() < deadline) {
      await waitForMuse(1000, input.signal)
      const result = await callMuse('poll', { id })
      if (result.state === 'download-failed' && result.source && input.kind !== 'text') {
        try {
          return { taskId: id, blob: await readMusePublicMedia(result.source, input.kind, input.signal) }
        } catch {
          input.signal?.throwIfAborted()
          throw new Error(museErrors['download-failed'])
        }
      }
      if (museErrors[result.state]) throw new Error(museErrors[result.state])
      if (!submitted && ['waiting', 'downloading', 'done'].includes(result.state)) {
        submitted = true
        input.onSubmitted?.(id)
      }
      if (result.state !== 'done') continue
      if (input.kind === 'text' && result.text) return { taskId: id, text: result.text }
      const size = result.size ?? 0
      if (!result.type?.startsWith(input.kind + '/') || !Number.isSafeInteger(size) || size <= 0 || size > MAX_MEDIA_BYTES) {
        throw new Error('Muse 返回的媒体类型或大小无效。')
      }
      const parts: Uint8Array<ArrayBuffer>[] = []
      let offset = 0
      while (offset < size) {
        input.signal?.throwIfAborted()
        const part = await callMuse('media', { id, offset })
        if (!part.data || part.size !== size || part.type !== result.type) throw new Error('Muse 媒体传输中断。')
        const bytes = Uint8Array.from(atob(part.data), (character) => character.charCodeAt(0))
        if (!bytes.length || offset + bytes.length > size) throw new Error('Muse 返回的媒体数据不完整。')
        parts.push(bytes)
        offset += bytes.length
      }
      return { taskId: id, blob: new Blob(parts, { type: result.type }) }
    }
    throw new Error('等待 Muse 回复超时。请在 Muse 窗口查看原任务状态。')
  } finally {
    await callMuse('release', { id }).catch(() => undefined)
  }
}
