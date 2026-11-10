/*!
 * Copyright (c) 2026 DisyLab. All rights reserved.
 * Proprietary source-available software under LicenseRef-DisyLab-Proprietary.
 * Unauthorized commercial use, redistribution, white-labeling, relicensing,
 * or removal of this copyright notice is prohibited.
 * Repository: https://github.com/TyaAsh/DisyLab-Canvas
 * SPDX-FileCopyrightText: 2026 DisyLab
 * SPDX-License-Identifier: LicenseRef-DisyLab-Proprietary
 */
import { isDesktopApp, providerFetch } from './providerTransport'
import type { ApiAuthMode, ModelCapability } from './store'
import { classifyProviderPayload, extractProviderImages, extractProviderTaskId, extractProviderTaskStatus, providerTaskPollPaths } from './providerLifecycle'
import { inferModelCapability, parseHfsyMarketplaceCatalog, parseRemoteModelCatalog } from './modelCatalog'

export { inferModelCapability } from './modelCatalog'

export type ApiRequestSettings = {
  baseUrl: string
  apiKey: string
  model: string
  authMode?: ApiAuthMode
}

export type RemoteModel = {
  id: string
  name: string
  capability: ModelCapability
}

export type GeneratedImage = {
  url: string
  revisedPrompt?: string
}

export type GeneratedVideo = { blob: Blob; taskId: string; progress: number; sourceUrl?: string }
export type GeneratedAudio = { blob: Blob; taskId: string; progress: number; sourceUrl?: string; payload: unknown }
export type AudioGenerationOptions = {
  prompt: string
  referenceAudioUrl?: string
  referenceImageUrl?: string
  voice?: string
  language?: string
  duration?: number
  extra?: Record<string, unknown>
  signal?: AbortSignal
  onProgress?: (progress: number, status: string) => void
  onTaskId?: (taskId: string) => void
}
export type VideoGenerationOptions = {
  prompt: string
  seconds: number
  size: string
  resolution?: '480p' | '720p' | '768p' | '1080p' | '2k' | '4k'
  aspectRatio?: string
  mode?: 'text2video' | 'image2video' | 'first_last_frame' | 'image_reference' | 'all_reference'
  referenceImage?: string
  referenceImages?: string[]
  firstFrame?: string
  lastFrame?: string
  referenceVideo?: string
  referenceVideos?: string[]
  referenceAudios?: string[]
  generateAudio?: boolean
  signal?: AbortSignal
  onProgress?: (progress: number, status: string) => void
  /** Persists an async provider task before polling/download begins. */
  onTaskId?: (taskId: string) => void
  /** Captures the provider request/result for recovery and output history. */
  captureAdminLog?: (log: GenerationAdminLog) => void
}

export type GenerationAdminLog = {
  provider: string
  taskId?: string
  model: string
  startedAt: string
  finishedAt: string
  durationMs: number
  resultType: 'success' | 'failed'
  requestJson: string
  resultJson: string
  /** Recoverable image/result URLs kept outside sanitized JSON (http kept in full). */
  resultUrls?: string[]
  kind?: 'image' | 'text' | 'video' | 'audio'
}

export type TextGenerationOptions = {
  referenceImages?: string[]
  stream?: boolean
  signal?: AbortSignal
  captureAdminLog?: (log: GenerationAdminLog) => void
}

export type ImageOutput = 'png' | 'transparent-png' | 'gif' | 'svg'
export type ImageQuality = 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
type ImageResolution = '1K' | '2K' | '4K'

export type ImageGenerationOptions = {
  prompt: string
  count: number
  referenceImages?: string[]
  aspectRatio?: string
  resolution?: ImageResolution
  detail?: ImageQuality
  output?: ImageOutput
  signal?: AbortSignal
  onProgress?: ImageTaskProgressCallback
  /** Persists a paid async task before polling starts so it can be recovered safely. */
  onTaskId?: (taskId: string) => void
  /** Captures a sanitized request/result snapshot for admin recovery logs. */
  captureAdminLog?: (log: GenerationAdminLog) => void
}

type ImageTaskProgressCallback = (percent: number | undefined, status: string) => void

const REFERENCE_IMAGE_REQUEST_MAX_DIMENSION = 1024
const REFERENCE_IMAGE_READ_TIMEOUT_MS = 45_000
const REFERENCE_IMAGE_READ_ATTEMPTS = 2
const GRSAI_IMAGE_POLL_INTERVAL_MS = 2_500
const GRSAI_IMAGE_POLL_TIMEOUT_MS = 15 * 60_000
const GRSAI_MAX_CONSECUTIVE_POLL_ERRORS = 24
const GRSAI_MEDIA_HOST = /^file[1-9]\d?\.aitohumanize\.com$/i
const HFSY_MEDIA_HOST = 'file.hfsyapi.cn'
const VISIONARY_POLL_INTERVAL_MS = 3_000
const VISIONARY_POLL_TIMEOUT_MS = 15 * 60_000
const VISIONARY_MAX_CONSECUTIVE_POLL_ERRORS = 5
const VISIONARY_SUCCESS_WITHOUT_URL_RETRIES = 20
const GENERIC_PROVIDER_POLL_INTERVAL_MS = 3_000
const GENERIC_PROVIDER_POLL_TIMEOUT_MS = 15 * 60_000
const GENERIC_PROVIDER_MAX_CONSECUTIVE_POLL_ERRORS = 5
const GENERIC_PROVIDER_SUCCESS_WITHOUT_URL_RETRIES = 20

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('参考图片读取失败'))
    reader.readAsDataURL(blob)
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('参考图片压缩失败')),
      type,
      quality,
    )
  })
}

export async function normalizeOriginalImageBlob(blob: Blob): Promise<Blob> {
  const bytes = new Uint8Array(await blob.slice(0, 8).arrayBuffer())
  const signature = String.fromCharCode(...bytes.subarray(0, 6))
  const isPng = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
  let mime = signature === 'GIF87a' || signature === 'GIF89a' ? 'image/gif' : isPng ? 'image/png' : blob.type
  if (!mime || /^(?:application\/(?:octet-stream|xml)|text\/(?:plain|xml))$/.test(mime)) {
    const header = await blob.slice(0, 1024).text()
    if (/^\s*(?:<\?xml[^?]*\?>\s*)?<svg(?:\s|\/?>)/i.test(header)) mime = 'image/svg+xml'
  }
  return mime === blob.type ? blob : blob.slice(0, blob.size, mime)
}

export async function readImageSourceBlob(source: string, signal?: AbortSignal, referenceLabel = '图片'): Promise<Blob> {
  if (signal?.aborted) throw new DOMException('Generation interrupted', 'AbortError')
  const trimmedSource = source.trim()
  const isBrowserRelativeImage = /^(?:\/|\.\/|\.\.\/)/.test(trimmedSource)
  if (!trimmedSource || (!isBrowserRelativeImage && !/^(?:https?:|blob:|data:image\/)/i.test(trimmedSource))) {
    throw new GenerationRequestError('platform', '图片地址无效', '图片地址不是可读取的图片源')
  }
  const readableSource = (() => {
    if (isBrowserRelativeImage) return new URL(trimmedSource, window.location.href).href
    // HFSY result assets are currently served from aixinai.net without CORS.
    // Route both newly generated and older saved URLs through the same-origin
    // media relay before converting them to request data.
    try {
      const host = new URL(trimmedSource).hostname.toLowerCase()
      // Some providers allow <img> previews but omit CORS headers, which makes
      // their successful output unusable as the next node's reference image.
      // Route those known result hosts through the same-origin media relay.
      if (typeof window !== 'undefined' && (
        host === 'aixinai.net' || host.endsWith('.aixinai.net')
        || host === 'www.qixinai.net' || host === HFSY_MEDIA_HOST
        || host === 'gptgod.online' || host.endsWith('.gptgod.online')
        || host === 'gptgod.com' || host.endsWith('.gptgod.com')
        || GRSAI_MEDIA_HOST.test(host)
      )) return apiYiGeneratedMediaUrl(trimmedSource)
    } catch { /* retain the original source and surface a normal read error */ }
    return trimmedSource
  })()

  let sourceBlob: Blob | undefined
  let lastReadError: unknown
  try {
    for (let attempt = 1; attempt <= REFERENCE_IMAGE_READ_ATTEMPTS; attempt += 1) {
      const referenceController = new AbortController()
      const abortReferenceRead = () => referenceController.abort()
      signal?.addEventListener('abort', abortReferenceRead, { once: true })
      const referenceTimeout = window.setTimeout(() => referenceController.abort(), REFERENCE_IMAGE_READ_TIMEOUT_MS)
      try {
        const separator = readableSource.includes('?') ? '&' : '?'
        const attemptSource = attempt > 1 && /^https?:/i.test(readableSource) ? `${readableSource}${separator}disy_retry=${attempt}` : readableSource
        const response = await providerFetch(attemptSource, { signal: referenceController.signal, cache: 'no-store' })
        if (!response.ok) throw new Error(`图片读取失败（${response.status}）`)
        sourceBlob = await response.blob()
        break
      } catch (error) {
        if (signal?.aborted) throw new DOMException('Generation interrupted', 'AbortError')
        lastReadError = error
        if (attempt === REFERENCE_IMAGE_READ_ATTEMPTS) throw error
      } finally {
        window.clearTimeout(referenceTimeout)
        signal?.removeEventListener('abort', abortReferenceRead)
      }
    }
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Generation interrupted', 'AbortError')
    // Report the host and transport, never signed URL paths/query parameters.
    const sourceDescription = (() => {
      if (/^blob:/i.test(trimmedSource)) return '本地临时图片（blob）'
      if (/^data:/i.test(trimmedSource)) return '内嵌图片（data）'
      try {
        const original = new URL(trimmedSource, window.location.href)
        const relayTarget = original.pathname === '/apiyi/media' ? original.searchParams.get('url') : null
        const host = relayTarget ? new URL(relayTarget).hostname : original.hostname
        return `${host}（${relayTarget || readableSource !== trimmedSource && readableSource.startsWith('/apiyi/media?') ? '同源媒体转发' : '直接读取'}）`
      } catch { return '无法识别的图片地址' }
    })()
    throw new GenerationRequestError(
      'platform',
      `${referenceLabel}${lastReadError instanceof DOMException && lastReadError.name === 'AbortError' ? '读取超时' : '无法读取'}`,
      `来源：${sourceDescription}。已自动重试 ${REFERENCE_IMAGE_READ_ATTEMPTS} 次。${lastReadError instanceof Error ? `${lastReadError.name}: ${lastReadError.message}` : String(lastReadError)}。`,
    )
  }

  if (sourceBlob?.size) sourceBlob = await normalizeOriginalImageBlob(sourceBlob)
  if (!sourceBlob || !sourceBlob.size || !sourceBlob.type.startsWith('image/')) {
    throw new GenerationRequestError('platform', '参考图片格式无法识别', `收到的文件类型为 ${sourceBlob?.type || 'unknown'}`)
  }

  return sourceBlob
}

export async function prepareReferenceImageForRequest(source: string | Blob, signal?: AbortSignal, referenceLabel = '参考图片'): Promise<string> {
  if (signal?.aborted) throw new DOMException('Generation interrupted', 'AbortError')
  const trimmedSource = typeof source === 'string' ? source.trim() : ''
  let sourceBlob: Blob
  try {
    sourceBlob = typeof source === 'string' ? await readImageSourceBlob(source, signal, referenceLabel) : source
  } catch (error) {
    if (error instanceof GenerationRequestError) error.detail += '本次付费生成请求尚未发送。'
    throw error
  }

  const isPreferredEditFormat = /^image\/(?:png|jpe?g)$/i.test(sourceBlob.type)
  // Remote and blob URLs are converted to stable request data. Unsupported
  // formats are always re-encoded while preserving their exact pixel dimensions.
  const svgUrl = sourceBlob.type === 'image/svg+xml' ? URL.createObjectURL(sourceBlob) : undefined
  let image: ImageBitmap | HTMLImageElement | undefined
  try {
    try {
      if (svgUrl) {
        // Browsers may display SVG as an image but reject it as an ImageBitmap.
        const svg = new Image()
        svg.src = svgUrl
        await svg.decode()
        image = svg
      } else {
        image = await createImageBitmap(sourceBlob)
      }
    } catch (error) {
      throw new GenerationRequestError(
        'platform',
        '参考图片无法解码',
        error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      )
    }
    if (signal?.aborted) throw new DOMException('Generation interrupted', 'AbortError')
    const maxSourceDimension = Math.max(image.width, image.height)
    if (isPreferredEditFormat && maxSourceDimension <= REFERENCE_IMAGE_REQUEST_MAX_DIMENSION) {
      return /^data:image\//i.test(trimmedSource) ? trimmedSource : blobToDataUrl(sourceBlob)
    }
    const canvas = document.createElement('canvas')
    // Requests cap their longest edge at 1K. This is large enough for image
    // guidance while preventing an oversized local upload from bloating payloads.
    const scale = Math.min(1, REFERENCE_IMAGE_REQUEST_MAX_DIMENSION / maxSourceDimension)
    canvas.width = Math.max(1, Math.round(image.width * scale))
    canvas.height = Math.max(1, Math.round(image.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('浏览器无法创建图片压缩画布')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)

    // WebP and uncommon formats become PNG only for request compatibility.
    // PNG remains lossless; JPEG retains JPEG encoding at high quality.
    const outputType = /^image\/jpe?g$/i.test(sourceBlob.type) ? 'image/jpeg' : 'image/png'
    return blobToDataUrl(await canvasToBlob(canvas, outputType, .92))

  } finally {
    if (image && 'close' in image) image.close()
    if (svgUrl) URL.revokeObjectURL(svgUrl)
  }
}

export type GenerationErrorCategory = 'api' | 'network' | 'platform'

export class GenerationRequestError extends Error {
  category: GenerationErrorCategory
  detail: string
  status?: number
  code?: string
  requestId?: string
  adminLog?: GenerationAdminLog
  resultUrls?: string[]

  constructor(
    category: GenerationErrorCategory,
    message: string,
    detail: string,
    metadata?: { status?: number; code?: string; requestId?: string; adminLog?: GenerationAdminLog; resultUrls?: string[] },
  ) {
    super(message)
    this.name = 'GenerationRequestError'
    this.category = category
    this.detail = detail
    this.status = metadata?.status
    this.code = metadata?.code
    this.requestId = metadata?.requestId
    this.adminLog = metadata?.adminLog
    this.resultUrls = metadata?.resultUrls
  }
}

function sanitizeAdminLogValue(value: unknown, depth = 0): unknown {
  if (depth > 10) return '[…]'
  if (typeof value === 'string') {
    if (/^data:image\//i.test(value) || (value.length > 240 && /^[A-Za-z0-9+/=\s]+$/.test(value.slice(0, 120)))) {
      return `base64 image… (${value.length} chars)`
    }
    if (value.length > 6_000) return `${value.slice(0, 6_000)}…`
    return value
  }
  if (Array.isArray(value)) return value.slice(0, 40).map((item) => sanitizeAdminLogValue(item, depth + 1))
  if (!value || typeof value !== 'object') return value
  const output: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 80)) {
    output[key] = sanitizeAdminLogValue(child, depth + 1)
  }
  return output
}

export function sanitizeAdminLogJson(value: unknown) {
  try {
    return JSON.stringify(sanitizeAdminLogValue(value), null, 0)
  } catch {
    return String(value)
  }
}

export function extractImageUrlsFromAdminResult(resultJson: string): string[] {
  try {
    return extractGeneratedImages(JSON.parse(resultJson) as unknown).map((image) => image.url)
  } catch {
    return []
  }
}

function normalizedApiBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/^['"]|['"]$/g, '').replace(/\/$/, '')
  if (!trimmed) throw new Error('接口地址不能为空')
  if (/\.apifox\.cn(?:\/|$)/i.test(trimmed)) {
    throw new Error('这里填写的是 Apifox 文档地址。GRS AI 请使用 https://grsaiapi.com/v1 或 https://grsai.dakka.com.cn/v1')
  }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('接口地址必须是完整的 http(s) URL，例如 https://api.example.com/v1')
  }
  if (!/^https?:$/i.test(url.protocol)) throw new Error('接口地址只支持 http:// 或 https://')
  let host = url.hostname.toLowerCase()
  // Accept a copied full OpenAI endpoint and normalize it back to its API base.
  // This prevents accidental paths such as /v1/chat/completions/models.
  const copiedEndpoint = /\/(?:models|chat\/completions|responses|messages|images\/(?:generations|edits)|videos(?:\/generations)?)\/?$/i.test(url.pathname)
  url.pathname = url.pathname.replace(/\/(?:models|chat\/completions|responses|messages|images\/(?:generations|edits)|videos(?:\/generations)?)\/?$/i, '') || '/'
  if (/^(?:www\.|api\.|apigo\.)?hfsyapi\.cn$/i.test(host)) {
    url.pathname = url.pathname.replace(/\/(?:image|video)\/create\/?$/i, '') || '/'
  }
  if (copiedEndpoint) url.hash = ''
  // `visionary.beer` is the website/result-media host. Users commonly copy it
  // from task history, but generation endpoints live on api.visionary.beer/v1.
  // Canonicalize only a bare website base; preserve explicit custom paths.
  if (host === 'visionary.beer' && (!url.pathname || url.pathname === '/')) {
    url.hostname = 'api.visionary.beer'
    url.pathname = '/v1'
    host = 'api.visionary.beer'
  }
  if (!url.pathname || url.pathname === '/') {
    const defaultPath = host === 'api.openai.com' || host === 'api.anthropic.com' || host === 'api.deepseek.com' || /siliconflow\.cn$/i.test(host)
      ? '/v1'
      : /(?:api\.apiyi\.com|apiyi\.com|apimart\.ai)$/i.test(host)
        ? '/v1'
        : /^(?:www\.|api\.|apigo\.)?hfsyapi\.cn$/i.test(host)
          ? '/v1'
        : host === 'api.visionary.beer'
          ? '/v1'
        : host === 'api.evolink.ai'
          ? '/v1'
        : /^(?:grsaiapi\.com|grsai\.dakka\.com\.cn)$/i.test(host)
          ? '/v1'
          : ''
    if (defaultPath) url.pathname = defaultPath
  }
  return url.toString().replace(/\/$/, '')
}

function endpoint(baseUrl: string, path: string) {
  // APIYI's OpenAI-compatible endpoints are not consistently CORS-enabled.
  // Browser builds use the same-origin relay; server-side callers keep the
  // configured provider URL. The relay forwards the original path unchanged.
  if (typeof window !== 'undefined' && /api\.apiyi\.com|apiyi\.com/i.test(baseUrl)) {
    const normalized = normalizedApiBaseUrl(baseUrl)
    const providerPath = new URL(normalized).pathname.replace(/\/$/, '')
    return `/apiyi/openai${providerPath}/${path.replace(/^\//, '')}`
  }
  if (typeof window !== 'undefined' && isHfsyBaseUrl(baseUrl)) {
    const providerPath = new URL(normalizedApiBaseUrl(baseUrl)).pathname.replace(/^\//, '').replace(/\/$/, '')
    return `/hfsy/${providerPath}/${path.replace(/^\//, '')}`
  }
  if (typeof window !== 'undefined' && isVisionaryBaseUrl(baseUrl)) {
    return `/visionary/${path.replace(/^\//, '')}`
  }
  if (typeof window !== 'undefined' && isEvolinkBaseUrl(baseUrl)) {
    return `/evolink/${path.replace(/^\//, '')}`
  }
  const url = new URL(normalizedApiBaseUrl(baseUrl))
  url.pathname = `${url.pathname.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
  return url.toString()
}

function apiYiRelayHeaders(settings: Pick<ApiRequestSettings, 'baseUrl'>, init?: HeadersInit) {
  const headers = new Headers(init)
  if (typeof window !== 'undefined' && /api\.apiyi\.com|apiyi\.com/i.test(settings.baseUrl)) {
    try {
      const normalized = normalizedApiBaseUrl(settings.baseUrl)
      headers.set('X-DisyLab-APIYI-Origin', new URL(normalized).origin)
      headers.set('X-DisyLab-APIYI-Base', normalized)
    } catch { /* validated by endpoint */ }
  }
  if (typeof window !== 'undefined' && isHfsyBaseUrl(settings.baseUrl)) {
    try { headers.set('X-DisyLab-HFSY-Base', normalizedApiBaseUrl(settings.baseUrl)) } catch { /* validated by endpoint */ }
  }
  return headers
}

/** GRS's account endpoints live at the host root, outside the /v1 API prefix. */
function grsaiControlEndpoint(baseUrl: string, path: string) {
  const url = new URL(normalizedApiBaseUrl(baseUrl))
  return `${url.origin}/${path.replace(/^\//, '')}`
}

function isGrsaiBaseUrl(baseUrl: string) {
  return /^https?:\/\/(?:grsaiapi\.com|grsai\.dakka\.com\.cn)(?:\/|$)/i.test(normalizedApiBaseUrl(baseUrl))
}

function grsaiImageEndpoint(baseUrl: string) {
  return /\/(images\/(?:generations|edits))\/?(?:[?#].*)?$/i.exec(baseUrl.trim())?.[1]?.toLowerCase() ?? 'api/generate'
}

function grsaiMediaEndpoint(baseUrl: string, path: 'generate' | 'result') {
  return `${new URL(normalizedApiBaseUrl(baseUrl)).origin}/v1/api/${path}`
}

const GRS_VIDEO_RATIOS = ['16:9', '9:16', '21:9', '4:3', '1:1', '3:4'] as const
const GRS_VIDEO_MODELS = {
  'minimax-h3': { resolutions: ['480p', '768p', '1080p'], ratios: ['16:9', '9:16'], minDuration: 1, maxDuration: 15, defaultDuration: 5, defaultResolution: '768p', images: 9, supportsFrames: false },
  'agnes-video-2.5': { resolutions: ['720p', '1080p', '2k'], ratios: GRS_VIDEO_RATIOS, minDuration: 4, maxDuration: 12, defaultDuration: 5, defaultResolution: '720p', images: 5, supportsFrames: true },
  'wan-3.0': { resolutions: ['480p', '720p', '1080p'], ratios: GRS_VIDEO_RATIOS, minDuration: 2, maxDuration: 30, defaultDuration: 5, defaultResolution: '720p', images: 10, supportsFrames: true },
} as const

export function getGrsaiVideoCapabilities(baseUrl: string, modelId: string) {
  try { if (!baseUrl || !isGrsaiBaseUrl(baseUrl)) return undefined } catch { return undefined }
  const model = modelId.trim().toLowerCase().split(/\s+/)[0]
  return Object.hasOwn(GRS_VIDEO_MODELS, model) ? GRS_VIDEO_MODELS[model as keyof typeof GRS_VIDEO_MODELS] : undefined
}

const GRS_IMAGE_SIZES: Record<string, readonly [string, string, string]> = {
  '1:1': ['1024x1024', '2048x2048', '2880x2880'],
  '16:9': ['1280x720', '2048x1152', '3840x2160'],
  '9:16': ['720x1280', '1152x2048', '2160x3840'],
  '4:3': ['1152x864', '2304x1728', '3264x2448'],
  '3:4': ['864x1152', '1728x2304', '2448x3264'],
  '3:2': ['1536x1024', '2048x1360', '3504x2336'],
  '2:3': ['1024x1536', '1360x2048', '2336x3504'],
  '5:4': ['1120x896', '2240x1792', '3200x2560'],
  '4:5': ['896x1120', '1792x2240', '2560x3200'],
  '21:9': ['1456x624', '2912x1248', '3840x1648'],
  '9:21': ['624x1456', '1248x2912', '1648x3840'],
  '2:1': ['1536x768', '3072x1536', '3840x1920'],
  '1:2': ['768x1536', '1536x3072', '1920x3840'],
}

const GRS_GPT_MODELS = /^(?:gpt-image-2(?:-vip|\.[56](?:-(?:flare|sunburst))?)?)$/i
const GRS_NANO_RATIOS = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9']

export function getGrsaiImageCapabilities(baseUrl: string, modelId: string) {
  try { if (!baseUrl || !isGrsaiBaseUrl(baseUrl)) return undefined } catch { return undefined }
  const model = modelId.trim().toLowerCase()
  if (/^nano-banana(?:-|$)/.test(model)) {
    return {
      gpt: false, customRatio: false,
      ratios: /^nano-banana-2(?:[.-]|$)/.test(model) ? [...GRS_NANO_RATIOS, '1:4', '4:1', '1:8', '8:1'] : GRS_NANO_RATIOS,
      resolutions: ['1K', '2K', '4K'] as readonly ImageResolution[],
      qualities: [] as readonly ImageQuality[], outputs: [] as readonly ImageOutput[],
    }
  }
  if (!GRS_GPT_MODELS.test(model)) return undefined
  const premium = /-(?:vip|flare|sunburst)$/.test(model)
  const qualities: ImageQuality[] = premium ? ['auto', 'low', 'medium', 'high'] : ['auto']
  if (model === 'gpt-image-2.5-sunburst') qualities.push('xhigh', 'max')
  const outputs: ImageOutput[] = grsaiImageEndpoint(baseUrl) === 'images/edits' ? ['png'] : ['png', 'transparent-png']
  if (model.startsWith('gpt-image-2.6')) outputs.push('gif')
  if (model === 'gpt-image-2.6') outputs.push('svg')
  return {
    gpt: true, customRatio: model === 'gpt-image-2-vip',
    ratios: ['auto', ...Object.keys(GRS_IMAGE_SIZES)],
    resolutions: (premium ? ['1K', '2K', '4K'] : ['1K']) as readonly ImageResolution[],
    qualities, outputs,
  }
}

// Pixel sizes in HFSY's native image/create tables, indexed by resolution.
const HFSY_IMAGE_SIZES: Record<string, readonly [string, string, string]> = {
  '1:1': ['1024x1024', '2048x2048', '2880x2880'],
  '5:4': ['1040x832', '2080x1664', '3200x2560'],
  '9:16': ['720x1280', '1152x2048', '2160x3840'],
  '16:9': ['1280x720', '2048x1152', '3840x2160'],
  '4:3': ['1024x768', '2048x1536', '3264x2448'],
  '3:2': ['1008x672', '2016x1344', '3504x2336'],
  '4:5': ['832x1040', '1664x2080', '2560x3200'],
  '3:4': ['768x1024', '1536x2048', '2448x3264'],
  '2:3': ['672x1008', '1344x2016', '2336x3504'],
  '21:9': ['1344x576', '2016x864', '3696x1584'],
  '3:1': ['1008x336', '2016x672', '3504x1168'],
}
const HFSY_SEEDREAM_SIZES: Record<string, string> = {
  '1:1': '1024x1024', '16:9': '1280x720', '4:3': '1024x768', '4:5': '1024x832',
  '9:16': '720x1280', '2:1': '1024x512', '1.85:1': '1024x554', '2.4:1': '1024x427', '21:9': '1344x576',
}

export function getHfsyImageCapabilities(baseUrl: string, modelId: string) {
  if (!isHfsyBaseUrl(baseUrl)) return undefined
  const model = modelId.trim().toLowerCase()
  const transparent = /^gpt-image-2\.[56]-(?:flare|sunburst)$/.test(model)
  const standard = /^gpt-image-2(?:\.[56])?$/.test(model)
  const pro = model === 'gpt-image-2pro' || model === 'gpt-image-2pro-4k'
  const gemini = /^(?:gemini-3-pro-image-preview|gemini-3\.1-flash-image-preview|nano-banana-(?:2(?:\.1)?|pro))$/.test(model)
  const seedream = model === 'seedream-5.0-pro'
  const midjourney = /^(?:mj_imagine|mj_blend)$/.test(model)
  if (!transparent && !standard && !pro && !gemini && !seedream && !midjourney) return undefined
  const resolutions: readonly ImageResolution[] = standard || seedream ? ['1K'] : midjourney ? []
    : pro ? (model.endsWith('-4k') ? ['2K', '4K'] : ['2K']) : ['1K', '2K', '4K']
  const ratios = seedream ? Object.keys(HFSY_SEEDREAM_SIZES) : transparent
    ? ['1:1', '5:4', '9:16', '16:9', '4:3', '3:1', '3:2', '3:4']
    : Object.keys(HFSY_IMAGE_SIZES).filter((ratio) => ratio !== '3:1')
  const outputs: readonly ImageOutput[] = transparent ? ['png', 'transparent-png'] : ['png']
  const images = transparent ? 16 : standard ? 6 : seedream ? 10
    : /^(?:nano-banana-pro|gemini-3-pro-image-preview|mj_)/.test(model) ? 7 : 4
  return { ratios, resolutions, outputs, images, qualities: [] as readonly ImageQuality[], customRatio: midjourney }
}

export function getImageModelCapabilities(baseUrl: string, model: string) {
  return getGrsaiImageCapabilities(baseUrl, model) ?? getHfsyImageCapabilities(baseUrl, model)
}

function numericAspectRatio(value: string) {
  const [width, height] = value.split(/[:x]/i).map(Number)
  return width > 0 && height > 0 && Number.isFinite(width / height) ? width / height : 1
}

export function resolveImageModelOptions(baseUrl: string, model: string, options: Pick<ImageGenerationOptions, 'aspectRatio' | 'resolution' | 'detail' | 'output'>) {
  const capabilities = getImageModelCapabilities(baseUrl, model)
  if (!capabilities) return options
  const ratio = options.aspectRatio || '1:1'
  const closest = capabilities.ratios.filter((value) => value !== 'auto').reduce((best, value) => {
    const distance = (candidate: string) => Math.abs(Math.log(numericAspectRatio(candidate) / numericAspectRatio(ratio)))
    return distance(value) < distance(best) ? value : best
  }, '1:1')
  return {
    aspectRatio: capabilities.customRatio || capabilities.ratios.includes(ratio) ? ratio : closest,
    resolution: options.resolution && capabilities.resolutions.includes(options.resolution) ? options.resolution : capabilities.resolutions[0],
    detail: options.detail && capabilities.qualities.includes(options.detail) ? options.detail : capabilities.qualities[0],
    output: options.output && capabilities.outputs.includes(options.output) ? options.output : capabilities.outputs[0],
  }
}

function resolveGrsaiGptSize(model: string, ratio: string, resolution: ImageResolution) {
  if (ratio === 'auto') return 'auto'
  if (!/-(?:vip|flare|sunburst)$/i.test(model)) return ratio
  const preset = GRS_IMAGE_SIZES[ratio]
  if (preset) return preset[resolution === '4K' ? 2 : resolution === '2K' ? 1 : 0]

  // Custom VIP dimensions must meet the pixel budget, edge and ratio limits.
  const numeric = Math.min(3, Math.max(1 / 3, numericAspectRatio(ratio)))
  const shape = Math.max(numeric, 1 / numeric)
  const targetPixels = resolution === '4K' ? 8_294_400 : resolution === '2K' ? 4_194_304 : 1_048_576
  const short = Math.floor(Math.sqrt(targetPixels / shape) / 16) * 16
  const long = Math.min(3840, Math.floor(short * shape / 16) * 16)
  return numeric >= 1 ? `${long}x${short}` : `${short}x${long}`
}

function isHfsyBaseUrl(baseUrl: string) {
  try { return /^(?:www\.|api\.|apigo\.)?hfsyapi\.cn$/i.test(new URL(normalizedApiBaseUrl(baseUrl)).hostname) } catch { return false }
}

function isVisionaryBaseUrl(baseUrl: string) {
  try {
    const host = new URL(normalizedApiBaseUrl(baseUrl)).hostname.toLowerCase()
    return host === 'visionary.beer' || host === 'api.visionary.beer'
  } catch {
    return false
  }
}

function isEvolinkBaseUrl(baseUrl: string) {
  try { return new URL(normalizedApiBaseUrl(baseUrl)).hostname.toLowerCase() === 'api.evolink.ai' } catch { return false }
}

function providerRelayHeaders(settings: Pick<ApiRequestSettings, 'baseUrl'>, init?: HeadersInit) {
  const headers = apiYiRelayHeaders(settings, init)
  if (typeof window !== 'undefined' && isVisionaryBaseUrl(settings.baseUrl)) {
    headers.set('X-DisyLab-Visionary-Base', normalizedApiBaseUrl(settings.baseUrl))
  }
  if (typeof window !== 'undefined' && isEvolinkBaseUrl(settings.baseUrl)) {
    headers.set('X-DisyLab-Evolink-Base', normalizedApiBaseUrl(settings.baseUrl))
  }
  return headers
}

function compatibleApiHeaders(settings: Pick<ApiRequestSettings, 'baseUrl' | 'apiKey' | 'authMode'>, init?: HeadersInit) {
  const headers = providerRelayHeaders(settings, init)
  const nativeAnthropic = /api\.anthropic\.com/i.test(settings.baseUrl) || /\/messages\/?(?:[?#].*)?$/i.test(settings.baseUrl.trim())
  const authMode = settings.authMode && settings.authMode !== 'auto'
    ? settings.authMode
    : nativeAnthropic ? 'x-api-key'
      : /(?:^|\.)openai\.azure\.com$/i.test(new URL(normalizedApiBaseUrl(settings.baseUrl)).hostname) ? 'api-key'
        : 'bearer'
  for (const name of ['Authorization', 'x-api-key', 'api-key', 'x-goog-api-key']) headers.delete(name)
  if (authMode === 'bearer') headers.set('Authorization', `Bearer ${settings.apiKey}`)
  else headers.set(authMode, settings.apiKey)
  if (nativeAnthropic) headers.set('anthropic-version', '2023-06-01')
  return headers
}

// Decide whether the structured numbered reference guide ("图1 / 图片1 / 参考图1 =
// 第 1 张输入图片") should be appended to the prompt.
//
// The guide is ONLY required by the OpenAI `images/edits` multipart path
// (GPT Image / ChatGPT Image): there the reference images are uploaded as unnamed
// files, so the model can only tell them apart from the prompt's "图N" mapping.
//
// Every other path receives reference images positionally (GRS AI unified
// `images` array, Seedream / Volces `image_urls`, the standard OpenAI
// `image_urls` field, or multimodal text content). For these the guide is
// redundant and — critically — GRS AI enforces a server-side prompt regex
// ("The string did not match the expected pattern") that the guide's
// `图1 / 图片1 / 参考图1 = 第 1 张输入图片（@name）` structure violates, so the
// request is rejected before any image is generated. We omit it everywhere but
// the multipart GPT Image path so every model accepts the prompt and returns
// results. Position-based reference ("图1/图2" in the user's own prompt) still
// works because those providers align images by upload order.
export function shouldAppendReferenceGuide(opts: { modelId: string; baseUrl: string; isImageGeneration: boolean }): boolean {
  if (isGrsaiBaseUrl(opts.baseUrl) || isVisionaryBaseUrl(opts.baseUrl)) return false
  if (opts.isImageGeneration) return /(?:gpt-image|chatgpt-image)/i.test(opts.modelId)
  return true
}

export function resolveProviderLabel(baseUrl: string) {
  const normalized = normalizedApiBaseUrl(baseUrl).toLowerCase()
  if (/grsaiapi\.com|grsai\.dakka\.com\.cn/.test(normalized)) return 'GRS AI'
  if (/api\.evolink\.ai/.test(normalized)) return 'Evolink'
  if (/(?:api\.)?visionary\.beer/.test(normalized)) return 'Visionary'
  if (/api\.apiyi\.com|apiyi\.com/.test(normalized)) return 'APIYI'
  if (/(?:www\.|api\.|apigo\.)?hfsyapi\.cn/.test(normalized)) return 'HFSY'
  if (/api\.apimart\.ai|apimart\.ai/.test(normalized)) return 'APIMart'
  if (/gptgod\.online|gptgod\.com/.test(normalized)) return 'GPTGod'
  if (/ark\.cn-beijing\.volces\.com/.test(normalized)) return '即梦'
  if (/api\.openai\.com/.test(normalized)) return 'OpenAI'
  if (/api\.siliconflow\.cn|siliconflow/.test(normalized)) return '硅基流动'
  if (/api\.deepseek\.com/.test(normalized)) return 'DeepSeek'
  try {
    return new URL(normalized).hostname.replace(/^www\./, '') || 'Custom API'
  } catch {
    return 'Custom API'
  }
}

function extractTaskId(payload: unknown) {
  return extractProviderTaskId(payload)
}

function collectRecoverableResultUrls(payload: unknown) {
  return extractGeneratedImages(payload)
    .map((image) => image.url)
    .filter((url) => {
      if (/^https?:\/\//i.test(url)) return true
      // Keep small embedded results so admins can still recover when CDN URLs are absent.
      return /^data:image\//i.test(url) && url.length <= 350_000
    })
}

function waitForDelay(delay: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Generation interrupted', 'AbortError'))
      return
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, delay)
    const abort = () => {
      window.clearTimeout(timer)
      reject(new DOMException('Generation interrupted', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

async function mediaSourceForApiYi(source: string, signal?: AbortSignal) {
  // APIYI accepts remote URLs, but browser clients cannot reliably read the
  // provider CDN (CORS). Route APIYI-hosted media through our same-origin
  // relay; data/blob URLs remain local and are read directly.
  const isRemote = /^https?:\/\//i.test(source)
  const isApiYiMedia = (() => {
    try { return /(?:^|\.)apiyi\.com$|(?:^|\.)volces\.com$|(?:^|\.)aliyuncs\.com$/i.test(new URL(source).hostname) } catch { return false }
  })()
  const readableSource = typeof window !== 'undefined' && isRemote && isApiYiMedia
    ? `/apiyi/media?url=${encodeURIComponent(source)}`
    : source
  if (isRemote && typeof window === 'undefined') return source
  const response = await providerFetch(readableSource, { signal })
  if (!response.ok) throw new GenerationRequestError('platform', '参考媒体无法读取', `媒体读取失败（${response.status}）`)
  const blob = await response.blob()
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('参考媒体转换失败'))
    reader.readAsDataURL(blob)
  })
}

function videoResultUrl(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const record = payload as Record<string, unknown>
  const nested = record.content && typeof record.content === 'object' ? record.content as Record<string, unknown> : null
  const data = record.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : null
  const output = record.output && typeof record.output === 'object' ? record.output as Record<string, unknown> : null
  const candidates = [
    record.video_url, record.videoUrl, record.result_url, record.resultUrl, record.url,
    nested?.video_url, nested?.videoUrl, nested?.result_url, nested?.resultUrl, nested?.url,
    data?.video_url, data?.videoUrl, data?.result_url, data?.resultUrl, data?.url,
    output?.video_url, output?.videoUrl, output?.result_url, output?.resultUrl, output?.url,
  ]
  return candidates.find((value): value is string => typeof value === 'string' && /^https?:\/\//i.test(value))
    ?? extractGeneratedImages(payload).find((item) => /^https?:\/\//i.test(item.url))?.url
    ?? ''
}

function videoTaskStatus(payload: unknown, fallback = 'queued') {
  return extractProviderTaskStatus(payload) || fallback
}

async function waitForReplicatedVideoUrl(taskUrl: string, headers: HeadersInit, initialPayload: unknown, signal?: AbortSignal) {
  let payload = initialPayload
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const url = videoResultUrl(payload)
    if (url) return { url, payload }
    await waitForDelay(2_000, signal)
    try {
      const response = await providerFetch(taskUrl, { headers, signal })
      if (response.ok) payload = await response.json() as unknown
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
    }
  }
  return { url: '', payload }
}

export function apiYiGeneratedMediaUrl(source: string) {
  // Result/CDN URLs are often missing CORS headers. Keep browser downloads on
  // the app origin; server-side callers continue to use the provider URL.
  return typeof window === 'undefined' ? source : `/apiyi/media?url=${encodeURIComponent(source)}`
}

function browserReadableImageResult(source: string, settings: ApiRequestSettings) {
  if (isDesktopApp()) return source
  // The provider can return this CDN regardless of the configured gateway.
  // Normalize new outputs before archiving; older saved URLs are also handled
  // by prepareReferenceImageForRequest above.
  if (typeof window !== 'undefined') {
    try {
      const url = new URL(source)
      if (url.protocol === 'https:' && (url.hostname === 'www.qixinai.net' || url.hostname === HFSY_MEDIA_HOST || GRSAI_MEDIA_HOST.test(url.hostname))) return apiYiGeneratedMediaUrl(source)
    } catch { /* data/blob and relative URLs retain their existing handling */ }
  }
  if (typeof window === 'undefined' || !isVisionaryBaseUrl(settings.baseUrl) || !/^https?:\/\//i.test(source)) return source
  try {
    const hostname = new URL(source).hostname.toLowerCase()
    if (hostname === 'visionary.beer' || hostname.endsWith('.visionary.beer')) return `/apiyi/media?url=${encodeURIComponent(source)}`
  } catch { /* keep the original result */ }
  return source
}

function apiYiVideoEndpoint(settings: ApiRequestSettings, relayPrefix: string, path: string) {
  if (typeof window !== 'undefined') return `${relayPrefix}${path}`
  return `${new URL(normalizedApiBaseUrl(settings.baseUrl)).origin}${path}`
}

function apiYiVideoHeaders(settings: ApiRequestSettings, headers: Record<string, string> = {}) {
  const output = { ...headers }
  if (typeof window !== 'undefined') output['X-DisyLab-APIYI-Origin'] = new URL(normalizedApiBaseUrl(settings.baseUrl)).origin
  return output
}

function apiYiVideoRatio(size: string) {
  const match = /^(\d+)x(\d+)$/i.exec(size)
  if (!match) return 'adaptive'
  const ratio = Number(match[1]) / Number(match[2])
  const options: Array<[string, number]> = [['16:9', 16 / 9], ['4:3', 4 / 3], ['1:1', 1], ['3:4', 3 / 4], ['9:16', 9 / 16], ['21:9', 21 / 9]]
  return options.sort((left, right) => Math.abs(left[1] - ratio) - Math.abs(right[1] - ratio))[0][0]
}

async function generateApiYiSeedanceVideo(settings: ApiRequestSettings, options: VideoGenerationOptions): Promise<GeneratedVideo> {
  const defaults = seedanceVideoDefaults(settings.model)!
  const origin = new URL(normalizedApiBaseUrl(settings.baseUrl)).origin
  const taskPath = '/seedance/api/v3/contents/generations/tasks'
  // APIYI documents that browsers cannot read this endpoint's response because
  // of CORS even when the paid task was accepted. Use the app's same-origin
  // relay in the browser; Node/test callers continue to use the provider URL.
  const taskEndpoint = typeof window === 'undefined'
    ? `${origin}${taskPath}`
    : `/apiyi/seedance${taskPath}`
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: options.prompt }]
  const imageSources = options.mode === 'first_last_frame'
    ? [options.firstFrame, options.lastFrame]
    : options.mode === 'image2video'
      ? [options.firstFrame ?? options.referenceImage]
      : options.referenceImages ?? []
  const imageRoles = options.mode === 'first_last_frame' ? ['first_frame', 'last_frame'] : imageSources.map(() => options.mode === 'image2video' ? undefined : 'reference_image')
  for (const [index, source] of imageSources.entries()) {
    if (!source) continue
    content.push({ type: 'image_url', image_url: { url: await mediaSourceForApiYi(source, options.signal) }, ...(imageRoles[index] ? { role: imageRoles[index] } : {}) })
  }
  const referenceVideos = Array.from(new Set([...(options.referenceVideos ?? []), options.referenceVideo].filter((source): source is string => Boolean(source))))
  for (const source of referenceVideos) {
    content.push({ type: 'video_url', video_url: { url: await mediaSourceForApiYi(source, options.signal) } })
  }
  const requestedResolution = defaults.resolutions.includes(options.resolution as typeof defaults.resolutions[number])
    ? options.resolution
    : defaults.defaultResolution
  const requestedDuration = Math.max(defaults.minDuration, Math.min(defaults.maxDuration, Math.round(options.seconds)))
  let response: Response
  const requestHeaders = new Headers({
    Authorization: `Bearer ${settings.apiKey}`,
    'Content-Type': 'application/json',
    'Accept-Encoding': 'identity',
  })
  if (typeof window !== 'undefined') requestHeaders.set('X-DisyLab-APIYI-Origin', origin)
  try {
    response = await providerFetch(taskEndpoint, {
      method: 'POST',
      signal: options.signal,
      headers: requestHeaders,
      body: JSON.stringify({
        model: settings.model,
        content,
        resolution: requestedResolution,
        ratio: apiYiVideoRatio(options.size),
        duration: requestedDuration,
        ...(defaults.defaultGenerateAudio ? { generate_audio: options.generateAudio !== false } : {}),
      }),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new GenerationRequestError('network', 'Seedance 同源代理请求失败', `${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}。请求地址：${taskEndpoint}`)
  }
  if (!response.ok) throw await createApiError(response)
  const created = await response.json() as Record<string, unknown>
  const taskId = extractTaskId(created)
  if (!taskId) throw new GenerationRequestError('platform', 'Seedance 没有返回任务编号', sanitizeAdminLogJson(created))
  options.onTaskId?.(taskId)
  options.onProgress?.(1, 'queued')
  const startedAt = Date.now()
  let status = videoTaskStatus(created, 'queued')
  let job: Record<string, unknown> = created
  while (true) {
    const sourceUrl = videoResultUrl(job)
    options.onProgress?.(status === 'running' || status === 'processing' ? 50 : ['succeeded', 'completed', 'success'].includes(status) || sourceUrl ? 90 : 10, status)
    if (['failed', 'expired', 'cancelled', 'canceled'].includes(status)) throw new GenerationRequestError('api', `Seedance 任务${status === 'expired' ? '已过期' : '失败'}`, sanitizeAdminLogJson(job), { requestId: taskId })
    if (['succeeded', 'completed', 'success'].includes(status) || sourceUrl) {
      const replicated = await waitForReplicatedVideoUrl(`${taskEndpoint}/${encodeURIComponent(taskId)}`, requestHeaders, job, options.signal)
      const videoUrl = replicated.url
      if (!videoUrl) throw new GenerationRequestError('platform', 'Seedance 成功但没有返回视频地址', sanitizeAdminLogJson(replicated.payload), { requestId: taskId })
      let blob: Blob
      try {
        blob = await downloadGeneratedVideoBlob(videoUrl, { signal: options.signal })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error
        throw new GenerationRequestError('network', 'Seedance 视频已生成但本地归档失败', error instanceof GenerationRequestError ? error.detail : `${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}。任务 ${taskId}`, { requestId: taskId, resultUrls: [videoUrl] })
      }
      options.onProgress?.(100, 'completed')
      return { blob, taskId, progress: 100, sourceUrl: videoUrl }
    }
    if (Date.now() - startedAt > 15 * 60_000) throw new GenerationRequestError('network', 'Seedance 视频生成等待超时', `任务 ${taskId} 超过 15 分钟仍未完成`)
    await waitForDelay(20_000, options.signal)
    let poll: Response
    try {
      poll = await providerFetch(`${taskEndpoint}/${encodeURIComponent(taskId)}`, {
        signal: options.signal,
        headers: requestHeaders,
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      throw new GenerationRequestError('network', 'Seedance 任务查询请求失败', `${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}。任务 ${taskId}`, { requestId: taskId })
    }
    if (!poll.ok) throw await createApiError(poll)
    job = await poll.json() as Record<string, unknown>
    status = videoTaskStatus(job, status)
  }
}

function validGeneratedVideoType(contentType: string) {
  return !/^(?:text\/|image\/|audio\/)|application\/(?:json|problem\+json)|image\/svg\+xml/i.test(contentType)
}

/** Download a completed provider video into a durable local Blob. Provider
 * result URLs frequently omit CORS headers or need anti-hotlink credentials,
 * and their CDN can lag behind the completed task response. Try the controlled
 * same-origin relay (with and without scoped auth) and a direct request across
 * a short replication window before declaring the archive recoverable. */
export async function downloadGeneratedVideoBlob(sourceUrl: string, options: { signal?: AbortSignal; authorization?: string } = {}) {
  const relayUrl = apiYiGeneratedMediaUrl(sourceUrl)
  const candidates = typeof window === 'undefined'
    ? [{ url: sourceUrl, headers: undefined as HeadersInit | undefined }]
    : [
        ...(options.authorization ? [{ url: relayUrl, headers: { 'X-DisyLab-Media-Authorization': options.authorization } }] : []),
        { url: relayUrl, headers: undefined },
        ...(relayUrl !== sourceUrl ? [{ url: sourceUrl, headers: undefined }] : []),
      ]
  const failures: string[] = []
  for (let round = 0; round < 3; round += 1) {
    for (const candidate of candidates) {
      try {
        const response = await providerFetch(candidate.url, { signal: options.signal, headers: candidate.headers, cache: round ? 'reload' : 'default' })
        if (!response.ok) {
          failures.push(`${response.status}`)
          continue
        }
        const blob = await response.blob()
        const contentType = blob.type || response.headers.get('content-type') || ''
        if (!blob.size || !validGeneratedVideoType(contentType)) {
          failures.push(!blob.size ? 'empty' : contentType || 'invalid-type')
          continue
        }
        const prefix = await blob.slice(0, 96).text().catch(() => '')
        if (/^\s*(?:<!doctype\s+html|<html|\{\s*"?(?:error|message)"?\s*:)/i.test(prefix)) {
          failures.push('invalid-body')
          continue
        }
        return blob.type ? blob : blob.slice(0, blob.size, 'video/mp4')
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error
        failures.push(error instanceof Error ? error.name : 'network')
      }
    }
    if (round < 2) await waitForDelay(round ? 1_800 : 700, options.signal)
  }
  const host = (() => { try { return new URL(sourceUrl).hostname } catch { return 'unknown-host' } })()
  throw new GenerationRequestError('network', '视频已生成但本地归档失败', `媒体主机 ${host} 在多路径下载后仍不可读（${Array.from(new Set(failures)).join('、') || '无响应'}）。任务结果地址已保留，可稍后恢复。`, { resultUrls: [sourceUrl] })
}

function videoResolutionFromSize(size: string) {
  const height = Number(/x(\d+)$/i.exec(size)?.[1] ?? 720)
  return height >= 2160 ? '4k' : height >= 1080 ? '1080p' : height <= 480 ? '480p' : '720p'
}

async function generateApiYiVeoVideo(settings: ApiRequestSettings, options: VideoGenerationOptions): Promise<GeneratedVideo> {
  if (options.mode !== 'text2video') {
    throw new GenerationRequestError('api', 'Veo 图生视频需要专用上传接口', '当前已适配 APIYI Veo 3.1 文生视频端点；图生视频请先使用文本模式，避免把参考图静默丢弃。')
  }
  const resolution = videoResolutionFromSize(options.size)
  const requestedSeconds = [4, 6, 8].reduce((best, current) => Math.abs(current - options.seconds) < Math.abs(best - options.seconds) ? current : best, 4)
  const seconds = resolution === '1080p' || resolution === '4k' ? 8 : requestedSeconds
  const response = await providerFetch(apiYiVideoEndpoint(settings, '/apiyi/veo', '/v1/videos'), {
    method: 'POST',
    signal: options.signal,
    headers: apiYiVideoHeaders(settings, { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      model: settings.model,
      prompt: options.prompt,
      seconds: String(seconds),
      size: options.size,
      metadata: { resolution, aspectRatio: apiYiVideoRatio(options.size) },
    }),
  })
  if (!response.ok) throw await createApiError(response)
  const created = await response.json() as Record<string, unknown>
  const taskId = extractTaskId(created)
  if (!taskId) throw new GenerationRequestError('platform', 'Veo 没有返回任务编号', sanitizeAdminLogJson(created))
  options.onTaskId?.(taskId)
  let status = videoTaskStatus(created)
  const startedAt = Date.now()
  while (!['completed', 'succeeded', 'success', 'failed', 'cancelled', 'canceled'].includes(status)) {
    if (Date.now() - startedAt > 10 * 60_000) throw new GenerationRequestError('network', 'Veo 视频生成等待超时', `任务 ${taskId} 超过 10 分钟仍未完成`, { requestId: taskId })
    await waitForDelay(8_000, options.signal)
    const poll = await providerFetch(apiYiVideoEndpoint(settings, '/apiyi/veo', `/v1/videos/${encodeURIComponent(taskId)}`), { signal: options.signal, headers: apiYiVideoHeaders(settings, { Authorization: `Bearer ${settings.apiKey}` }) })
    if (!poll.ok) throw await createApiError(poll)
    const job = await poll.json() as Record<string, unknown>
    status = videoTaskStatus(job, status)
    const jobProgress = Number(job.progress)
    options.onProgress?.(Number.isFinite(jobProgress) ? jobProgress : (['completed', 'succeeded', 'success'].includes(status) ? 100 : 30), status)
    if (status === 'failed') throw new GenerationRequestError('api', 'Veo 视频生成失败', sanitizeAdminLogJson(job), { requestId: taskId })
    if (status === 'cancelled' || status === 'canceled') throw new GenerationRequestError('api', 'Veo 视频生成已取消', sanitizeAdminLogJson(job), { requestId: taskId })
  }
  await waitForDelay(4_000, options.signal)
  let lastError: GenerationRequestError | null = null
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const content = await providerFetch(apiYiVideoEndpoint(settings, '/apiyi/veo', `/v1/videos/${encodeURIComponent(taskId)}/content`), { signal: options.signal, headers: apiYiVideoHeaders(settings, { Authorization: `Bearer ${settings.apiKey}` }) })
    if (content.ok) {
      const blob = await content.blob()
      if (blob.size) return { blob, taskId, progress: 100 }
    }
    lastError = await createApiError(content)
    if (attempt < 3) await waitForDelay(4_000, options.signal)
  }
  throw lastError ?? new GenerationRequestError('platform', 'Veo 返回了空视频文件', `任务 ${taskId}`, { requestId: taskId })
}

async function generateApiYiWanVideo(settings: ApiRequestSettings, options: VideoGenerationOptions): Promise<GeneratedVideo> {
  const requestedMode = options.mode ?? 'text2video'
  const expectedSuffix = requestedMode === 'image2video'
    ? 'i2v'
    : requestedMode === 'image_reference' || requestedMode === 'all_reference' || requestedMode === 'first_last_frame'
      ? 'r2v'
      : 't2v'
  const modelSuffix = /-(t2v|i2v|r2v)$/i.exec(settings.model)?.[1]?.toLowerCase()
  if (modelSuffix && modelSuffix !== expectedSuffix) {
    throw new GenerationRequestError(
      'api',
      `当前选择的是 ${settings.model}`,
      `当前节点使用 ${requestedMode} 模式，但模型 ${settings.model} 与它不匹配。请选择 wan2.7-${expectedSuffix}；wan2.7-videoedit 只用于输入已有视频后再编辑。`,
    )
  }
  const input: Record<string, unknown> = { prompt: options.prompt }
  if (expectedSuffix === 'i2v') {
    const image = options.firstFrame ?? options.referenceImage ?? options.referenceImages?.[0]
    if (!image) throw new GenerationRequestError('platform', 'Wan 图生视频缺少参考图', '请选择一张首帧或参考图片后再生成。')
    input.img_url = await mediaSourceForApiYi(image, options.signal)
  } else if (expectedSuffix === 'r2v') {
    const images = [
      ...(options.referenceImages ?? []),
      ...(requestedMode === 'first_last_frame' ? [options.firstFrame, options.lastFrame] : []),
    ].filter((source): source is string => Boolean(source))
    if (images.length) input.reference_image_urls = await Promise.all(images.map((source) => mediaSourceForApiYi(source, options.signal)))
    const videos = Array.from(new Set([...(options.referenceVideos ?? []), options.referenceVideo].filter((source): source is string => Boolean(source))))
    if (videos.length) input.reference_video_urls = await Promise.all(videos.map((source) => mediaSourceForApiYi(source, options.signal)))
    if (!images.length && !videos.length) throw new GenerationRequestError('platform', 'Wan 参考生视频缺少参考素材', '请选择至少一张参考图或一个参考视频后再生成。')
  }
  const response = await providerFetch(apiYiVideoEndpoint(settings, '/apiyi/wan', '/wan/api/v1/services/aigc/video-generation/video-synthesis'), {
    method: 'POST',
    signal: options.signal,
    headers: apiYiVideoHeaders(settings, { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable' }),
    body: JSON.stringify({
      model: settings.model,
      input,
      parameters: {
        resolution: videoResolutionFromSize(options.size) === '1080p' ? '1080P' : '720P',
        ratio: apiYiVideoRatio(options.size),
        duration: Math.max(2, Math.min(15, Math.round(options.seconds))),
        prompt_extend: true,
        watermark: false,
      },
    }),
  })
  if (!response.ok) throw await createApiError(response)
  const created = await response.json() as Record<string, unknown>
  const taskId = extractTaskId(created)
  if (!taskId) throw new GenerationRequestError('platform', 'Wan 没有返回任务编号', sanitizeAdminLogJson(created))
  options.onTaskId?.(taskId)
  const startedAt = Date.now()
  let status = 'submitted'
  while (!['completed', 'succeeded', 'success', 'failed', 'cancelled', 'canceled'].includes(status)) {
    if (Date.now() - startedAt > 15 * 60_000) throw new GenerationRequestError('network', 'Wan 视频生成等待超时', `任务 ${taskId} 超过 15 分钟仍未完成`, { requestId: taskId })
    await waitForDelay(8_000, options.signal)
    const poll = await providerFetch(apiYiVideoEndpoint(settings, '/apiyi/wan', `/v1/tasks/${encodeURIComponent(taskId)}`), { signal: options.signal, headers: apiYiVideoHeaders(settings, { Authorization: `Bearer ${settings.apiKey}` }) })
    if (!poll.ok) throw await createApiError(poll)
    const job = await poll.json() as Record<string, unknown>
    status = videoTaskStatus(job, status)
    const progressValue = Number(job.progress ?? (status === 'completed' || status === 'succeeded' || status === 'success' ? 100 : 30))
    options.onProgress?.(Number.isFinite(progressValue) ? progressValue : 30, status)
    if (['failed', 'cancelled', 'canceled'].includes(status)) throw new GenerationRequestError('api', 'Wan 视频生成失败', sanitizeAdminLogJson(job), { requestId: taskId })
    if (['completed', 'succeeded', 'success'].includes(status)) {
      const taskUrl = apiYiVideoEndpoint(settings, '/apiyi/wan', `/v1/tasks/${encodeURIComponent(taskId)}`)
      const taskHeaders = apiYiVideoHeaders(settings, { Authorization: `Bearer ${settings.apiKey}` })
      const replicated = await waitForReplicatedVideoUrl(taskUrl, taskHeaders, job, options.signal)
      const resultUrl = replicated.url
      if (!resultUrl) throw new GenerationRequestError('platform', 'Wan 成功但没有返回视频地址', sanitizeAdminLogJson(replicated.payload), { requestId: taskId })
      try {
        return { blob: await downloadGeneratedVideoBlob(resultUrl, { signal: options.signal }), taskId, progress: 100, sourceUrl: resultUrl }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error
        throw new GenerationRequestError('network', 'Wan 视频已生成但本地归档失败', error instanceof GenerationRequestError ? error.detail : String(error), { requestId: taskId, resultUrls: [resultUrl] })
      }
    }
  }
  throw new GenerationRequestError('platform', 'Wan 任务未完成', `任务 ${taskId}`, { requestId: taskId })
}

async function readError(response: Response) {
  const text = await response.text().catch(() => '')
  if (!text) return `请求失败（${response.status}）`
  try {
    const payload = JSON.parse(text) as Record<string, unknown>
    const error = payload.error
    const errors = Array.isArray(payload.errors) ? payload.errors : []
    const candidates = [
      typeof error === 'string' ? error : error && typeof error === 'object' ? (error as Record<string, unknown>).message : undefined,
      error && typeof error === 'object' ? (error as Record<string, unknown>).detail : undefined,
      payload.message, payload.msg, payload.detail, payload.title,
      ...errors.map((item) => typeof item === 'string' ? item : item && typeof item === 'object' ? ((item as Record<string, unknown>).message ?? (item as Record<string, unknown>).detail) : undefined),
    ]
    const message = candidates.find((value): value is string => typeof value === 'string' && value.trim().length > 0)
    return message?.trim().slice(0, 4_000) || text.slice(0, 4_000)
  } catch {
    return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4_000) || `请求失败（${response.status}）`
  }
}

export type SeedanceVideoDefaults = {
  resolutions: readonly ('480p' | '720p' | '1080p' | '4k')[]
  ratios: readonly ('auto' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16' | '21:9')[]
  minDuration: number
  maxDuration: number
  defaultDuration: number
  defaultRatio: 'auto' | '16:9'
  defaultImageRatio?: 'auto'
  defaultResolution: '720p'
  defaultGenerateAudio: boolean
}

/** Shared defaults for Volcengine, BytePlus and gateway Seedance model IDs. */
export function seedanceVideoDefaults(model: string): SeedanceVideoDefaults | undefined {
  const normalized = model.toLowerCase().replace(/_/g, '-')
  if (!/(?:seedance|doubao-seedance|dreamina-seedance)/.test(normalized)) return undefined
  const versionMatch = normalized.match(/seedance(?:[- ]?v)?[- ]?([12])(?:[. -]?([025]))/)
  const version = versionMatch ? `${versionMatch[1]}.${versionMatch[2]}` : ''
  const allRatios = ['auto', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'] as const
  if (version === '2.5') return {
    resolutions: ['480p', '720p'], ratios: allRatios,
    minDuration: 4, maxDuration: 30, defaultDuration: 5,
    defaultRatio: 'auto', defaultResolution: '720p', defaultGenerateAudio: true,
  }
  if (version === '2.0') return {
    resolutions: /(?:fast|mini)/.test(normalized) ? ['480p', '720p'] : ['480p', '720p', '1080p', '4k'],
    ratios: allRatios,
    minDuration: 4, maxDuration: 15, defaultDuration: 5,
    defaultRatio: 'auto', defaultResolution: '720p', defaultGenerateAudio: true,
  }
  if (version === '1.5') return {
    resolutions: ['480p', '720p', '1080p'], ratios: allRatios,
    minDuration: 4, maxDuration: 12, defaultDuration: 5,
    defaultRatio: 'auto', defaultResolution: '720p', defaultGenerateAudio: true,
  }
  if (version === '1.0') return {
    resolutions: /lite/.test(normalized) ? ['480p', '720p'] : ['480p', '720p', '1080p'],
    ratios: allRatios,
    minDuration: 2, maxDuration: 12, defaultDuration: 5,
    defaultRatio: '16:9', ...(!/lite/.test(normalized) ? { defaultImageRatio: 'auto' as const } : {}), defaultResolution: '720p', defaultGenerateAudio: false,
  }
  return {
    resolutions: ['480p', '720p'], ratios: allRatios,
    minDuration: 4, maxDuration: 15, defaultDuration: 5,
    defaultRatio: 'auto', defaultResolution: '720p', defaultGenerateAudio: true,
  }
}

function apiErrorSummary(status: number) {
  if (status === 400 || status === 422) return '当前模型不接受这组生成参数'
  if (status === 401) return 'API Key 无效或已经过期'
  if (status === 403) return '当前账号没有使用这个模型的权限'
  if (status === 404) return '接口地址或模型不存在'
  if (status === 408) return 'API 请求超时了'
  if (status === 429) return '请求太频繁，或者账号额度不足'
  if (status >= 500) return 'API 服务暂时不可用'
  return 'API 服务拒绝了这次请求'
}

async function createApiError(response: Response) {
  const detail = await readError(response)
  const responseRequestId = ['x-request-id', 'openai-request-id', 'request-id', 'x-correlation-id', 'x-ms-request-id', 'cf-ray', 'traceparent']
    .map((name) => response.headers.get(name)).find(Boolean) ?? undefined
  if (response.status === 502 && response.headers.get('x-disylab-relay-error') === 'upstream-fetch-failed') {
    return new GenerationRequestError('network', '没有连接到 APIYI 视频服务', `${detail}。请检查当前网络是否能访问所配置的 APIYI 节点，或在接口设置中切换 APIYI 官方备用节点。`, {
      status: response.status,
      requestId: responseRequestId,
    })
  }
  if (/no available channels|没有可用通道|no available channel/i.test(detail)) {
    return new GenerationRequestError('api', '当前 API 分组没有可用通道', `${detail}。请在 APIYI Token 页面切换支持该模型的分组，或改用当前分组可用的模型；这不是浏览器网络故障。`, {
      status: response.status,
      requestId: responseRequestId,
    })
  }
  return new GenerationRequestError('api', apiErrorSummary(response.status), detail, {
    status: response.status,
    requestId: responseRequestId,
  })
}

function createNetworkError(error: unknown) {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return new GenerationRequestError('network', '没有连接到 API 服务，请检查网络、接口地址或跨域设置', detail)
}

export function normalizeGenerationError(error: unknown) {
  if (error instanceof GenerationRequestError) return error
  if (error instanceof TypeError && /fetch|network|load|cors/i.test(error.message)) return createNetworkError(error)
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  if (error instanceof Error && /没有返回图片|没有返回图像/.test(error.message)) {
    return new GenerationRequestError('platform', '模型没有返回图像', detail)
  }
  return new GenerationRequestError('platform', 'Disy 处理生成结果时遇到了问题', detail)
}

// Generic registry so any vendor can declare models that its standard OpenAI-compatible
// GET /v1/models endpoint will not enumerate (typically video/image models behind a
// dedicated endpoint). Vendors flagged `catalogOnly` skip the live request entirely.
type VendorModelSupplement = {
  match: (normalizedBaseUrl: string) => boolean
  catalogOnly?: boolean
}

const VENDOR_MODEL_SUPPLEMENTS: VendorModelSupplement[] = [
  { match: isGrsaiBaseUrl, catalogOnly: true },
]

/** GRS exposes the live catalogue at a host-root control path, not OpenAI `/v1/models`. */
async function fetchGrsaiLiveCatalog(settings: Pick<ApiRequestSettings, 'baseUrl'>, signal: AbortSignal): Promise<RemoteModel[] | null> {
  try {
    const response = await providerFetch(grsaiControlEndpoint(settings.baseUrl, 'client/serverGrsai/getModelList'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: '{}',
      signal,
    })
    if (!response.ok) return null
    const payload = await response.json() as { code?: unknown; data?: { list?: unknown[] } }
    if (payload.code !== 0 || !Array.isArray(payload.data?.list)) return null
    const models = parseRemoteModelCatalog(payload.data.list.map((row) => {
      if (!row || typeof row !== 'object') return null
      const item = row as Record<string, unknown>
      const id = String(item.name ?? item.model ?? item.id ?? '').trim()
      if (!id) return null
      const maintenance = typeof item.maintenance === 'string' ? item.maintenance.trim() : ''
      return {
        id,
        name: id,
        available: !maintenance,
        desc: typeof item.desc === 'string' ? item.desc : undefined,
      }
    }).filter(Boolean))
    return models.length ? models : null
  } catch {
    return null
  }
}

async function fetchHfsyMarketplaceCatalog(settings: Pick<ApiRequestSettings, 'baseUrl' | 'apiKey' | 'authMode'>, signal: AbortSignal): Promise<RemoteModel[]> {
  // The public plaza omits some documented models. Include those only when
  // returned by the user's authenticated catalogue.
  const plazaSettings = { ...settings, baseUrl: 'https://www.hfsyapi.cn/v1' }
  const [account, plaza] = await Promise.all([
    providerFetch(endpoint(settings.baseUrl, 'models'), { headers: compatibleApiHeaders(settings, { Accept: 'application/json' }), signal }),
    providerFetch(typeof window === 'undefined' ? 'https://www.hfsyapi.cn/api/pricing' : '/hfsy/__root__/api/pricing', {
      headers: providerRelayHeaders(plazaSettings, { Accept: 'application/json' }), signal,
    }).then(async (response) => response.ok ? parseHfsyMarketplaceCatalog(await response.json() as unknown) : []).catch(() => []),
  ])
  if (!account.ok) throw new Error(await readError(account) || apiErrorSummary(account.status))
  const available = parseRemoteModelCatalog(await account.json() as unknown)
  const plazaById = new Map(plaza.map((model) => [model.id, model]))
  const models = available.flatMap((model): RemoteModel[] => {
    const listed = plazaById.get(model.id)
    if (listed) return [listed]
    if (getHfsyImageCapabilities(settings.baseUrl, model.id)) return [{ ...model, capability: 'image' }]
    if (hfsyVideoLimits(model.id) || isHfsyNativeSeedance(model.id)) return [{ ...model, capability: 'video' }]
    return model.capability === 'text' ? [model] : []
  })
  if (!models.length) throw new Error('HFSY 未返回当前 API Key 可用的已识别模型')
  return models
}

export async function fetchRemoteModels(settings: Pick<ApiRequestSettings, 'baseUrl' | 'apiKey' | 'authMode'>): Promise<RemoteModel[]> {
  const normalizedBase = normalizedApiBaseUrl(settings.baseUrl)
  const signal = AbortSignal.timeout(15_000)
  if (isHfsyBaseUrl(normalizedBase)) return fetchHfsyMarketplaceCatalog(settings, signal)
  const supplement = VENDOR_MODEL_SUPPLEMENTS.find((entry) => entry.match(normalizedBase))
  // GRS has no standard OpenAI-compatible model endpoint. Prefer the live
  // host-root catalogue; do not fall back to a static list when it fails.
  if (supplement?.catalogOnly) {
    const models = await fetchGrsaiLiveCatalog(settings, signal)
    if (!models) throw new Error('GRS AI 当前模型目录不可用，请稍后重新刷新')
    return models
  }
  const response = await providerFetch(endpoint(settings.baseUrl, 'models'), {
    headers: compatibleApiHeaders(settings),
    signal,
  })
  if (!response.ok) {
    // A response means the provider evaluated the request. In particular, do
    // not replace 401/403 credential failures with a local catalog: that makes a
    // bad key look connected and leaves unusable models visible in the canvas.
    throw new Error(await readError(response))
  }
  // `/models` is the authenticated provider truth for all normal connections.
  // Never merge local manifests here: those lists cannot prove that a model is
  // still sold or enabled for this API key today.
  return parseRemoteModelCatalog(await response.json() as unknown)
}

/** OpenAI-compatible asynchronous video job. Large media stays as a Blob and is
 * never converted to base64, keeping React state and canvas snapshots small. */
async function generateRemoteVideoRequest(settings: ApiRequestSettings, options: VideoGenerationOptions): Promise<GeneratedVideo> {
  const grsai = getGrsaiVideoCapabilities(settings.baseUrl, settings.model)
  if (grsai) return generateGrsaiVideo(settings, options, grsai)
  if (isHfsyBaseUrl(settings.baseUrl)) return generateHfsyVideo(settings, options)
  if (isEvolinkBaseUrl(settings.baseUrl)) return generateEvolinkVideo(settings, options)
  if (/api\.apiyi\.com|apiyi\.com/i.test(settings.baseUrl) && /seedance|doubao-seedance/i.test(settings.model)) {
    return generateApiYiSeedanceVideo(settings, options)
  }
  if (/api\.apiyi\.com|apiyi\.com/i.test(settings.baseUrl) && /veo-3\.1/i.test(settings.model)) {
    return generateApiYiVeoVideo(settings, options)
  }
  if (/api\.apiyi\.com|apiyi\.com/i.test(settings.baseUrl) && /wan2\.|happyhorse/i.test(settings.model)) {
    return generateApiYiWanVideo(settings, options)
  }
  const form = new FormData()
  form.set('model', settings.model)
  form.set('prompt', options.prompt)
  form.set('seconds', String(options.seconds))
  form.set('size', options.size)
  if (options.mode) form.set('mode', options.mode)
  if (typeof options.generateAudio === 'boolean') form.set('generate_audio', String(options.generateAudio))
  for (const [index, image] of (options.referenceImages ?? []).entries()) {
    const reference = await providerFetch(image, { signal: options.signal })
    if (!reference.ok) throw new GenerationRequestError('platform', '参考图片无法读取', `图片读取失败（${reference.status}）`)
    form.append('reference_images', await reference.blob(), `reference-${index + 1}.png`)
  }
  if (options.firstFrame) {
    const first = await providerFetch(options.firstFrame, { signal: options.signal })
    if (!first.ok) throw new GenerationRequestError('platform', '首帧图片无法读取', `图片读取失败（${first.status}）`)
    form.set('first_frame', await first.blob(), 'first-frame.png')
  }
  if (options.lastFrame) {
    const last = await providerFetch(options.lastFrame, { signal: options.signal })
    if (!last.ok) throw new GenerationRequestError('platform', '尾帧图片无法读取', `图片读取失败（${last.status}）`)
    form.set('last_frame', await last.blob(), 'last-frame.png')
  }
  const referenceVideos = Array.from(new Set([...(options.referenceVideos ?? []), options.referenceVideo].filter((url): url is string => Boolean(url))))
  for (const [index, source] of referenceVideos.entries()) {
    const video = await providerFetch(source, { signal: options.signal })
    if (!video.ok) throw new GenerationRequestError('platform', '参考视频无法读取', `视频读取失败（${video.status}）`)
    if (referenceVideos.length === 1) form.set('reference_video', await video.blob(), 'reference-video.mp4')
    else form.append('reference_videos', await video.blob(), `reference-video-${index + 1}.mp4`)
  }
  if (options.referenceImage) {
    const reference = await providerFetch(options.referenceImage, { signal: options.signal })
    if (!reference.ok) throw new GenerationRequestError('platform', '首帧图片无法读取', `图片读取失败（${reference.status}）`)
    form.set('input_reference', await reference.blob(), 'start-frame.png')
  }
  let createdResponse: Response
  try {
    createdResponse = await providerFetch(endpoint(settings.baseUrl, 'videos'), { method: 'POST', headers: compatibleApiHeaders(settings), body: form, signal: options.signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw createNetworkError(error)
  }
  if (!createdResponse.ok) throw await createApiError(createdResponse)
  const created = await createdResponse.json() as Record<string, unknown>
  const taskId = extractTaskId(created)
  if (!taskId) throw new GenerationRequestError('platform', '视频服务没有返回任务编号', sanitizeAdminLogJson(created))
  options.onTaskId?.(taskId)
  const startedAt = Date.now()
  let progress = Number(created.progress ?? 0)
  let status = videoTaskStatus(created)
  let lastJob: unknown = created
  let consecutivePollErrors = 0
  options.onProgress?.(progress, status)
  while (!['completed', 'succeeded', 'success', 'failed', 'cancelled', 'canceled'].includes(status)) {
    if (Date.now() - startedAt > 30 * 60_000) throw new GenerationRequestError('network', '视频生成等待超时', `任务 ${taskId} 超过 30 分钟仍未完成`, { requestId: taskId })
    await waitForDelay(2_500, options.signal)
    let pollResponse: Response
    try {
      pollResponse = await providerFetch(endpoint(settings.baseUrl, `videos/${encodeURIComponent(taskId)}`), { headers: compatibleApiHeaders(settings), signal: options.signal })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      consecutivePollErrors += 1
      if (consecutivePollErrors < 3) continue
      throw new GenerationRequestError('network', '视频任务查询暂时中断', `任务 ID：${taskId}。任务仍可能成功，请勿重新提交。`, { requestId: taskId })
    }
    if (!pollResponse.ok) {
      if (pollResponse.status === 429 || pollResponse.status >= 500) {
        consecutivePollErrors += 1
        if (consecutivePollErrors < 3) continue
        throw new GenerationRequestError('network', '视频任务查询暂时中断', `任务 ID：${taskId}。连续查询失败，任务仍可能成功。`, { requestId: taskId })
      }
      throw await createApiError(pollResponse)
    }
    consecutivePollErrors = 0
    const job = await pollResponse.json() as Record<string, unknown>
    lastJob = job
    status = videoTaskStatus(job, status)
    const jobProgress = Number(job.progress)
    progress = Math.max(progress, Number.isFinite(jobProgress) ? jobProgress : progress)
    options.onProgress?.(progress, status)
    if (status === 'failed') throw new GenerationRequestError('api', '视频生成失败', sanitizeAdminLogJson(job), { requestId: taskId })
    if (status === 'cancelled' || status === 'canceled') throw new DOMException('Generation cancelled', 'AbortError')
  }
  const completedUrl = videoResultUrl(lastJob)
  if (completedUrl) {
    try {
      const mediaBlob = await downloadGeneratedVideoBlob(completedUrl, { signal: options.signal })
      return { blob: mediaBlob, taskId, progress: 100, sourceUrl: completedUrl }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      throw new GenerationRequestError('network', '视频已生成但本地归档失败', error instanceof GenerationRequestError ? error.detail : String(error), { requestId: taskId, resultUrls: [completedUrl] })
    }
  }
  const contentResponse = await providerFetch(endpoint(settings.baseUrl, `videos/${encodeURIComponent(taskId)}/content`), { headers: compatibleApiHeaders(settings), signal: options.signal })
  if (!contentResponse.ok) throw await createApiError(contentResponse)
  const blob = await contentResponse.blob()
  if (!blob.size) throw new GenerationRequestError('platform', '视频服务返回了空文件', `任务 ${taskId}`)
  options.onProgress?.(100, 'completed')
  return { blob, taskId, progress: 100 }
}

async function generateGrsaiVideo(settings: ApiRequestSettings, options: VideoGenerationOptions, capabilities: NonNullable<ReturnType<typeof getGrsaiVideoCapabilities>>): Promise<GeneratedVideo> {
  const isH3 = settings.model.toLowerCase() === 'minimax-h3'
  const resolution = options.resolution ?? capabilities.defaultResolution
  const maxSeconds = isH3 && resolution === '1080p' ? 10 : capabilities.maxDuration
  const invalid = (detail: string) => new GenerationRequestError('platform', 'GRS AI 视频参数不受支持', `${detail}，生成尚未提交。`)
  if (!capabilities.resolutions.some((value) => value === resolution)) throw invalid(`当前模型支持 ${capabilities.resolutions.join('、')}`)
  if (!Number.isInteger(options.seconds) || options.seconds < capabilities.minDuration || options.seconds > maxSeconds) {
    throw invalid(`${settings.model} 在 ${resolution} 下支持 ${capabilities.minDuration}–${maxSeconds} 秒`)
  }
  if (options.referenceVideo || options.referenceVideos?.length) throw invalid('当前 GRS AI 模型暂不接收参考视频')
  const firstFrame = options.firstFrame ?? options.referenceImage
  const lastFrame = options.lastFrame
  const references = options.referenceImages?.filter(Boolean) ?? []
  if (lastFrame && (!firstFrame || !capabilities.supportsFrames)) throw invalid('该模型的首尾帧模式不可用或缺少首帧')
  if ((firstFrame || lastFrame) && references.length) throw invalid('首尾帧和参考图不能在同一次请求中使用')
  if (references.length > capabilities.images) throw invalid(`当前模型最多支持 ${capabilities.images} 张参考图`)
  if (options.aspectRatio && !capabilities.ratios.some((value) => value === options.aspectRatio)) throw invalid(`当前模型支持 ${capabilities.ratios.join('、')}`)
  const ratio = options.aspectRatio ?? capabilities.ratios.reduce<string>((best, value) => {
    const distance = (candidate: string) => Math.abs(Math.log(numericAspectRatio(candidate) / numericAspectRatio(options.size)))
    return distance(value) < distance(best) ? value : best
  }, capabilities.ratios[0])
  const mediaInput = async (source: string) => publicImageSourceUrl(source)
    ?? (await blobToDataUrl(await readImageSourceBlob(source, options.signal))).split(',')[1]
  const body = {
    model: settings.model,
    prompt: options.prompt,
    aspectRatio: isH3 ? ratio === '9:16' ? 'portrait' : 'landscape' : ratio,
    resolution,
    duration: options.seconds,
    replyType: 'async',
    ...(firstFrame && !isH3 ? { firstFrame: await mediaInput(firstFrame) } : {}),
    ...(lastFrame ? { lastFrame: await mediaInput(lastFrame) } : {}),
    ...(firstFrame && isH3 ? { images: [await mediaInput(firstFrame)] } : references.length ? { images: await Promise.all(references.map(mediaInput)) } : {}),
  }
  const response = await providerFetch(grsaiMediaEndpoint(settings.baseUrl, 'generate'), {
    method: 'POST', signal: options.signal,
    headers: { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw await createApiError(response)
  const created: unknown = await response.json()
  const taskId = extractProviderTaskId(created)
  if (taskId) options.onTaskId?.(taskId)
  const completed = await resolveGrsaiMediaResult(settings, created, options.signal, '视频', (percent, status) => {
    if (percent !== undefined) options.onProgress?.(percent, status)
  })
  const sourceUrl = extractGeneratedImages(completed).find(({ url }) => /^https?:\/\//i.test(url))?.url
  if (!sourceUrl) throw new GenerationRequestError('platform', 'GRS AI 未返回可下载的视频', '请检查服务商任务记录。', { requestId: taskId || undefined })
  try {
    const blob = await downloadGeneratedVideoBlob(sourceUrl, { signal: options.signal })
    options.onProgress?.(100, 'completed')
    return { blob, taskId, progress: 100, sourceUrl }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new GenerationRequestError('network', 'GRS AI 视频已生成但本地归档失败', error instanceof GenerationRequestError ? error.detail : String(error), { requestId: taskId || undefined, resultUrls: [sourceUrl] })
  }
}

/** HFSY video models use a shared JSON create/query protocol rather than the
 * OpenAI multipart /videos API. This covers sd-2*, sd-2.5*, Grok and future
 * compatible entries returned by the HFSY model catalogue. */
export function publicImageSourceUrl(source?: string): string | undefined {
  if (!source) return undefined
  try {
    let parsed = new URL(source, 'https://local.invalid')
    if (parsed.pathname === '/apiyi/media' && (parsed.origin === 'https://local.invalid' || typeof window !== 'undefined' && parsed.origin === new URL(window.location.href).origin)) {
      parsed = new URL(parsed.searchParams.get('url') || '')
    }
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) return undefined
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '')
    if (/^(?:localhost|local\.invalid)$|\.(?:localhost|local|internal)$/i.test(hostname)) return undefined
    const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname)?.slice(1).map(Number)
    if (ipv4) {
      const [a, b] = ipv4
      if (ipv4.some((part) => part > 255) || a === 0 || a === 10 || a === 127 || a >= 224
        || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168
        || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19)) return undefined
    }
    if (/^\[(?:::1|::|f[cd]|fe[89ab]|::ffff:)/i.test(hostname)) return undefined
    return parsed.href
  } catch { return undefined }
}

function requireHfsyPublicMediaUrl(source: string, kind: 'image' | 'video' | 'audio') {
  const url = publicImageSourceUrl(source)
  if (url) return url
  const label = kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频'
  throw new GenerationRequestError('platform', 'HFSY 仅支持公网素材链接', `请先将本地${label}上传到可公开访问的地址，再把 URL 用作参考素材。视频生成尚未提交。`)
}

function hfsyFailureDetail(payload: unknown) {
  if (!payload || typeof payload !== 'object') return ''
  const root = payload as Record<string, unknown>
  const data = root.data && typeof root.data === 'object' ? root.data as Record<string, unknown> : undefined
  for (const value of [data?.fail_reason, root.fail_reason, data?.error, root.error, root.success === false ? root.message : undefined]) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (value && typeof value === 'object' && 'message' in value && typeof value.message === 'string') return value.message.trim()
  }
  return root.success === false ? 'HFSY 返回请求失败' : ''
}

function hfsyTaskUrl(settings: ApiRequestSettings, kind: 'image' | 'video', taskId: string, queryParameter = false) {
  const path = endpoint(settings.baseUrl, `${kind}/query`)
  return queryParameter ? `${path}?id=${encodeURIComponent(taskId)}` : `${path}/${encodeURIComponent(taskId)}`
}

type HfsyVideoLimits = {
  minSeconds: number; maxSeconds: number; images: number; videos: number; audios: number; prompt: number
  ratios?: readonly string[]; durations?: readonly number[]; minImages?: number; minReferenceImages?: number; maxAssets?: number; audioRequiresImage?: boolean
}
const HFSY_VERTICAL_RATIOS = ['9:16', '16:9']
const HFSY_VIDEO_RATIOS = [...HFSY_VERTICAL_RATIOS, '3:4', '1:1', '4:3']
const HFSY_SEEDANCE_RATIOS = [...HFSY_VIDEO_RATIOS, '21:9']
const HFSY_LEGACY_SEEDANCE = { minSeconds: 5, maxSeconds: 15, images: 9, videos: 3, audios: 3, prompt: 10_000, ratios: HFSY_SEEDANCE_RATIOS, audioRequiresImage: true }
export const isHfsyNativeSeedance = (model: string) => /^doubao-seedance-2\.(?:0(?:-fast|-mini)?|5)$/i.test(model)

/** Prefer per-model limits over grouped examples in the HFSY docs. */
export function hfsyVideoLimits(model: string): HfsyVideoLimits | undefined {
  model = model.trim().toLowerCase()
  if (/^sd-2\.5(?:-(?:480|720|1080))?(?:-v2)?$/.test(model)) return {
    minSeconds: 4, maxSeconds: 30, images: 30, videos: 10, audios: 10,
    prompt: model.endsWith('-v2') || model === 'sd-2.5' ? 15_000 : 10_000, ratios: HFSY_VIDEO_RATIOS,
  }
  if (/^sd-2\.0(?:-(?:(?:mini|fast)(?:-(?:480|720))?|480|720))?$/.test(model)) return {
    ...HFSY_LEGACY_SEEDANCE,
    minSeconds: model.endsWith('-mini-480') ? 5 : 4,
    images: /-mini(?:-720)?$/.test(model) ? 4 : 9,
    audios: /-mini(?:-720)?$/.test(model) ? 1 : 3,
    prompt: model.endsWith('-mini') ? 5_000 : /-fast|-mini-480/.test(model) ? 10_000 : 3_500,
    ratios: model.endsWith('-mini') ? [...HFSY_VERTICAL_RATIOS, '1:1'] : HFSY_SEEDANCE_RATIOS,
  }
  if (/^sd-2(?:-(?:(?:vip|mini|fast)(?:-(?:480|720))?|1080-cheap))?$/.test(model)) return {
    ...HFSY_LEGACY_SEEDANCE,
    prompt: model === 'sd-2' ? 5_000 : /-1080-cheap|-(?:vip|mini)$/.test(model) ? 15_000 : 10_000,
  }
  if (/^wan-3\.0(?:-(?:480|720|1080))?$/.test(model)) return { minSeconds: 2, maxSeconds: 30, images: 10, videos: 5, audios: 5, prompt: 5000, ratios: model === 'wan-3.0' ? HFSY_VIDEO_RATIOS : HFSY_SEEDANCE_RATIOS }
  if (model === 'video-2.5') return { minSeconds: 4, maxSeconds: 12, images: 5, videos: 1, audios: 3, prompt: 10_000, ratios: HFSY_SEEDANCE_RATIOS }
  if (/^muse[-_]video$/.test(model)) return { minSeconds: model === 'muse_video' ? 1 : 4, maxSeconds: 30, images: 10, videos: 10, audios: 10, prompt: 10_000, maxAssets: 10, ratios: HFSY_VERTICAL_RATIOS }
  if (model === 'minimax-h3') return { minSeconds: 5, maxSeconds: 15, images: 9, videos: 0, audios: 3, minImages: 1, prompt: 7000, ratios: HFSY_VERTICAL_RATIOS }
  if (model === 'sora-2') return { minSeconds: 4, maxSeconds: 12, images: 1, videos: 0, audios: 0, prompt: 10_000, durations: [4, 8, 12], ratios: HFSY_VERTICAL_RATIOS }
  if (model === 'grok-imagine-video-1.5') return { minSeconds: 6, maxSeconds: 15, images: 7, videos: 0, audios: 0, minReferenceImages: 2, prompt: 5000, durations: [6, 10, 15], ratios: [...HFSY_VERTICAL_RATIOS, '4:3', '3:4', '3:2', '2:3'] }
  if (model === 'kling-o3') return { minSeconds: 5, maxSeconds: 15, images: 8, videos: 0, audios: 0, prompt: 5000, ratios: [...HFSY_VERTICAL_RATIOS, '1:1'] }
  return undefined
}

async function generateHfsyVideo(settings: ApiRequestSettings, options: VideoGenerationOptions): Promise<GeneratedVideo> {
  const ratio = options.aspectRatio && options.aspectRatio !== 'auto' ? options.aspectRatio
    : options.size === 'portrait' ? '9:16' : options.size === 'square' ? '1:1'
    : /^\d+:\d+$/.test(options.size) ? options.size
    : apiYiVideoRatio(options.size) === 'adaptive' ? '16:9' : apiYiVideoRatio(options.size)
  const [ratioWidth, ratioHeight] = ratio.split(':').map(Number)
  const videos = Array.from(new Set([...(options.referenceVideos ?? []), options.referenceVideo].filter((url): url is string => Boolean(url))))
  const audios = Array.from(new Set(options.referenceAudios?.map((url) => url.trim()).filter(Boolean) ?? []))
  const nativeSeedance = isHfsyNativeSeedance(settings.model)
  const model = settings.model.toLowerCase()
  const imageSources = options.mode === 'first_last_frame'
    ? [options.firstFrame, options.lastFrame]
    : options.mode === 'image2video'
      ? [options.firstFrame ?? options.referenceImage]
      : [...(options.referenceImages ?? []), options.referenceImage, options.firstFrame, options.lastFrame]
  // First and last frame may intentionally be the same source; preserve both
  // positions while still deduplicating unordered reference-image modes.
  const images = options.mode === 'first_last_frame'
    ? imageSources.filter((url): url is string => Boolean(url))
    : Array.from(new Set(imageSources.filter((url): url is string => Boolean(url))))
  const limits = hfsyVideoLimits(settings.model)
  const invalid = (detail: string): never => { throw new GenerationRequestError('platform', '视频参数不符合模型要求', `${detail}。视频生成尚未提交。`) }
  if (!options.prompt.trim()) invalid('请先填写视频提示词')
  if (nativeSeedance && (!Number.isInteger(options.seconds) || (options.seconds !== -1 && (options.seconds < 4 || options.seconds > 30)))) invalid('豆包 Seedance 接口接受 4–30 秒或自动时长')
  if (limits) {
    if (!Number.isInteger(options.seconds) || options.seconds < limits.minSeconds || options.seconds > limits.maxSeconds || (limits.durations && !limits.durations.includes(options.seconds))) invalid(`${settings.model} 时长需为 ${limits.durations?.join(' / ') || `${limits.minSeconds}–${limits.maxSeconds}`} 秒`)
    if (images.length > limits.images) invalid(`${settings.model} 最多支持 ${limits.images} 张图片`)
    if (limits.minImages && images.length < limits.minImages) invalid(`${settings.model} 至少需要 ${limits.minImages} 张参考图`)
    if (limits.minReferenceImages && images.length && images.length < limits.minReferenceImages) invalid(`${settings.model} 使用图片参考时至少需要 ${limits.minReferenceImages} 张图`)
    if (videos.length > limits.videos) invalid(limits.videos ? `${settings.model} 最多支持 ${limits.videos} 个参考视频` : `${settings.model} 不支持视频参考，请选择支持视频参考的模型`)
    if (audios.length > limits.audios) invalid(limits.audios ? `${settings.model} 最多支持 ${limits.audios} 个参考音频` : `${settings.model} 不支持音频参考`)
    if (limits.maxAssets && images.length + videos.length + audios.length > limits.maxAssets) invalid(`${settings.model} 最多支持 ${limits.maxAssets} 个参考素材`)
    if (audios.length && limits.audioRequiresImage && !images.length) invalid('使用音频参考时至少需要一张参考图')
    if (Array.from(options.prompt).length > limits.prompt) invalid(`${settings.model} 提示词不得超过 ${limits.prompt} 字符`)
    if (limits.ratios && !limits.ratios.includes(ratio)) invalid(`${settings.model} 不支持 ${ratio} 比例`)
  }
  if (options.mode === 'text2video' && (images.length || videos.length)) invalid('文生视频不能携带图片或视频，请切换参考模式')
  if (options.mode === 'image2video' && images.length !== 1) invalid('图生视频需要一张首帧图片')
  if (options.mode === 'first_last_frame' && images.length !== 2) invalid('首尾帧需要两张图片')
  if (options.mode === 'all_reference' && !images.length && !videos.length && !audios.length) invalid('全能参考需要图片、视频或音频素材')
  const publicImages = images.map((image) => requireHfsyPublicMediaUrl(image, 'image'))
  const publicVideos = videos.map((video) => requireHfsyPublicMediaUrl(video, 'video'))
  const publicAudios = audios.map((audio) => {
    if (!nativeSeedance) return requireHfsyPublicMediaUrl(audio, 'audio')
    if (/^asset:\/\/[A-Za-z0-9_-]+$/.test(audio)) return audio
    return invalid('豆包 Seedance 的参考音频须为已审核的 asset:// 素材')
  })
  const body = nativeSeedance ? {
    model: settings.model,
    duration: options.seconds,
    ratio: options.aspectRatio === 'auto' ? undefined : ratio,
    resolution: options.resolution,
    generate_audio: options.generateAudio,
    content: [
      { type: 'text', text: options.prompt },
      ...publicImages.map((url, index) => ({
        type: 'image_url', image_url: { url },
        role: options.mode === 'first_last_frame' ? (index === 0 ? 'first_frame' : 'last_frame')
          : options.mode === 'image2video' ? 'first_frame' : 'reference_image',
      })),
      ...publicVideos.map((url) => ({ type: 'video_url', video_url: { url }, role: 'reference_video' })),
      ...publicAudios.map((url) => ({ type: 'audio_url', audio_url: { url }, role: 'reference_audio' })),
    ],
  } : {
    model: settings.model,
    prompt: options.prompt,
    duration: options.seconds,
    ...(!['minimax-h3', 'kling-o3', 'sora-2'].includes(model) ? { ratio } : {}),
    ...(!/^muse[-_]video$/.test(model) ? {
      orientation: model === 'kling-o3' && ratio === '1:1' ? 'square' : ratioWidth < ratioHeight ? 'portrait' : 'landscape',
    } : {}),
    ...(/^(?:sd-2|sora-2|grok-imagine-video-1\.5)/.test(model) ? { watermark: false } : {}),
    ...(publicImages.length ? { images: publicImages } : {}),
    ...(publicVideos.length ? { videos: publicVideos } : {}),
    ...(publicAudios.length ? { audios: publicAudios } : {}),
  }
  let createdResponse: Response
  try {
    createdResponse = await providerFetch(endpoint(settings.baseUrl, 'video/create'), {
      method: 'POST', signal: options.signal,
      headers: providerRelayHeaders(settings, { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw createNetworkError(error)
  }
  if (!createdResponse.ok) throw await createApiError(createdResponse)
  let task = await createdResponse.json() as unknown
  const createFailure = hfsyFailureDetail(task)
  if (createFailure) throw new GenerationRequestError('api', '视频接口拒绝了生成参数', createFailure)
  const taskId = extractTaskId(task)
  if (!taskId) throw new GenerationRequestError('platform', 'HFSY 没有返回视频任务编号', sanitizeAdminLogJson(task))
  options.onTaskId?.(taskId)
  const startedAt = Date.now()
  let pollSettings = settings
  let queryParameter = false
  let consecutiveFailures = 0
  while (Date.now() - startedAt < 30 * 60_000) {
    const status = extractProviderTaskStatus(task)
    if (['failed', 'failure', 'error', 'expired', 'cancelled', 'canceled', 'violation', 'rejected'].includes(status)) {
      throw new GenerationRequestError('api', 'HFSY 视频生成失败', hfsyFailureDetail(task) || sanitizeAdminLogJson(task), { requestId: taskId })
    }
    const sourceUrl = videoResultUrl(task)
    if (sourceUrl && (!status || /^(?:success|succeeded|completed|complete)$/.test(status))) {
      let blob: Blob
      try {
        blob = await downloadGeneratedVideoBlob(sourceUrl, {
          signal: options.signal,
          authorization: `Bearer ${settings.apiKey}`,
        })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error
        const detail = error instanceof GenerationRequestError ? error.detail : error instanceof Error ? error.message : String(error)
        throw new GenerationRequestError('network', 'HFSY 视频已生成但本地归档失败', detail, { requestId: taskId, resultUrls: [sourceUrl] })
      }
      options.onProgress?.(100, 'completed')
      return { blob, taskId, progress: 100, sourceUrl }
    }
    options.onProgress?.(Math.min(99, providerTaskPercent(task) ?? 0), status || 'queued')
    await waitForDelay(3_000, options.signal)
    try {
      const poll = await providerFetch(hfsyTaskUrl(pollSettings, 'video', taskId, queryParameter), {
        signal: options.signal, headers: providerRelayHeaders(pollSettings, { Authorization: `Bearer ${pollSettings.apiKey}`, Accept: 'application/json' }),
      })
      // HFSY's notice specifies api.hfsyapi.cn as the query fallback for 504s.
      if (poll.status === 504 && /^(?:www\.|apigo\.)?hfsyapi\.cn$/i.test(new URL(normalizedApiBaseUrl(pollSettings.baseUrl)).hostname)) {
        pollSettings = { ...settings, baseUrl: 'https://api.hfsyapi.cn/v1' }
        continue
      }
      if (poll.status === 404 && !queryParameter) {
        queryParameter = true
        continue
      }
      if (!poll.ok) throw await createApiError(poll)
      task = await poll.json() as unknown
      const queryFailure = hfsyFailureDetail(task)
      if (queryFailure && !/^(?:failed|failure|error|expired|cancelled|canceled|violation|rejected)$/.test(extractProviderTaskStatus(task))) {
        throw new GenerationRequestError('api', 'HFSY 视频任务查询失败', queryFailure, { requestId: taskId })
      }
      consecutiveFailures = 0
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      if (error instanceof GenerationRequestError && (error.status === undefined || error.status < 500 && ![408, 429].includes(error.status))) throw error
      consecutiveFailures += 1
      if (consecutiveFailures >= 3) throw new GenerationRequestError('network', 'HFSY 视频任务查询暂时中断', `任务 ID：${taskId}。任务仍可能成功，请勿重复提交。`, { requestId: taskId })
    }
  }
  throw new GenerationRequestError('network', 'HFSY 视频生成等待超时', `任务 ID：${taskId}。任务可能仍在生成，请在 HFSY 控制台查询。`, { requestId: taskId })
}

async function waitForEvolinkTask(settings: ApiRequestSettings, taskId: string, signal?: AbortSignal, onProgress?: (progress: number, status: string) => void) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 30 * 60_000) {
    await waitForDelay(3_000, signal)
    const response = await providerFetch(endpoint(settings.baseUrl, `tasks/${encodeURIComponent(taskId)}`), {
      signal,
      headers: providerRelayHeaders(settings, { Authorization: `Bearer ${settings.apiKey}`, Accept: 'application/json' }),
    })
    if (!response.ok) throw await createApiError(response)
    const payload = await response.json() as Record<string, unknown>
    const status = extractProviderTaskStatus(payload) || String(payload.status ?? 'processing').toLowerCase()
    const progress = Number(payload.progress ?? 0)
    onProgress?.(Number.isFinite(progress) ? progress : 0, status)
    if (['failed', 'cancelled', 'canceled', 'expired'].includes(status)) throw new GenerationRequestError('api', 'Evolink 任务失败', sanitizeAdminLogJson(payload), { requestId: taskId })
    if (status === 'completed' || extractProviderImages(payload).length) return payload
  }
  throw new GenerationRequestError('network', 'Evolink 任务查询超时', `任务 ID：${taskId}。任务仍可能稍后完成，请勿重复提交。`, { requestId: taskId })
}

async function generateEvolinkVideo(settings: ApiRequestSettings, options: VideoGenerationOptions): Promise<GeneratedVideo> {
  const imageUrls = Array.from(new Set([
    ...(options.referenceImages ?? []), options.firstFrame, options.lastFrame, options.referenceImage,
  ].filter((value): value is string => Boolean(value))))
  const videoUrls = Array.from(new Set([...(options.referenceVideos ?? []), options.referenceVideo].filter((value): value is string => Boolean(value))))
  const response = await providerFetch(endpoint(settings.baseUrl, 'videos/generations'), {
    method: 'POST', signal: options.signal,
    headers: providerRelayHeaders(settings, { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      model: settings.model,
      prompt: options.prompt,
      duration: Math.max(3, Math.min(15, Math.round(options.seconds))),
      quality: videoResolutionFromSize(options.size),
      aspect_ratio: apiYiVideoRatio(options.size),
      generate_audio: options.generateAudio !== false,
      ...(imageUrls.length ? { image_urls: imageUrls } : {}),
      ...(videoUrls.length ? { video_urls: videoUrls } : {}),
    }),
  })
  if (!response.ok) throw await createApiError(response)
  const created = await response.json() as Record<string, unknown>
  const taskId = extractTaskId(created)
  if (!taskId) throw new GenerationRequestError('platform', 'Evolink 没有返回视频任务编号', sanitizeAdminLogJson(created))
  options.onTaskId?.(taskId)
  const completed = await waitForEvolinkTask(settings, taskId, options.signal, options.onProgress)
  const sourceUrl = extractProviderImages(completed)[0]?.url
  if (!sourceUrl) throw new GenerationRequestError('platform', 'Evolink 视频任务完成但没有返回媒体地址', sanitizeAdminLogJson(completed), { requestId: taskId })
  try {
    return { blob: await downloadGeneratedVideoBlob(sourceUrl, { signal: options.signal }), taskId, progress: 100, sourceUrl }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new GenerationRequestError('network', 'Evolink 视频已生成但本地归档失败', error instanceof GenerationRequestError ? error.detail : String(error), { requestId: taskId, resultUrls: [sourceUrl] })
  }
}

/** Evolink unified asynchronous audio endpoint. Model-specific optional fields
 * are accepted through `extra` so new documented audio models remain usable
 * without weakening the generic OpenAI-compatible request paths. */
export async function generateRemoteAudio(settings: ApiRequestSettings, options: AudioGenerationOptions): Promise<GeneratedAudio> {
  const response = await providerFetch(endpoint(settings.baseUrl, 'audios/generations'), {
    method: 'POST', signal: options.signal,
    headers: providerRelayHeaders(settings, { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      model: settings.model,
      prompt: options.prompt,
      ...(options.voice ? { voice: options.voice } : {}),
      ...(options.language ? { language_type: options.language } : {}),
      ...(options.duration ? { duration: options.duration } : {}),
      ...(options.referenceAudioUrl ? { audio_urls: [options.referenceAudioUrl] } : {}),
      ...(options.referenceImageUrl ? { image_urls: [options.referenceImageUrl] } : {}),
      ...(options.extra ?? {}),
    }),
  })
  if (!response.ok) throw await createApiError(response)
  const created = await response.json() as Record<string, unknown>
  const taskId = extractTaskId(created)
  if (!taskId) throw new GenerationRequestError('platform', 'Evolink 没有返回音频任务编号', sanitizeAdminLogJson(created))
  options.onTaskId?.(taskId)
  const completed = await waitForEvolinkTask(settings, taskId, options.signal, options.onProgress)
  const sourceUrl = extractProviderImages(completed)[0]?.url
  if (!sourceUrl) throw new GenerationRequestError('platform', 'Evolink 音频任务完成但没有返回媒体地址', sanitizeAdminLogJson(completed), { requestId: taskId })
  const mediaResponse = await providerFetch(sourceUrl, { signal: options.signal })
  if (!mediaResponse.ok) throw new GenerationRequestError('network', 'Evolink 音频下载失败', `下载失败（${mediaResponse.status}）`, { requestId: taskId, resultUrls: [sourceUrl] })
  return { blob: await mediaResponse.blob(), taskId, progress: 100, sourceUrl, payload: completed }
}

/**
 * Video providers do not share one response schema, so keep a compact request
 * and lifecycle snapshot even when a provider rejects the request. This is
 * especially useful for APIYI 5xx responses whose actionable detail is only
 * present in the one-time error body.
 */
export async function generateRemoteVideo(settings: ApiRequestSettings, options: VideoGenerationOptions): Promise<GeneratedVideo> {
  const startedAtMs = Date.now()
  const startedAt = new Date(startedAtMs).toISOString()
  const provider = resolveProviderLabel(settings.baseUrl)
  const requestJson = sanitizeAdminLogJson({
    model: settings.model,
    prompt: options.prompt,
    seconds: options.seconds,
    size: options.size,
    mode: options.mode,
    generateAudio: options.generateAudio,
    referenceImageCount: (options.referenceImages?.length ?? 0) + (options.referenceImage ? 1 : 0) + (options.firstFrame ? 1 : 0) + (options.lastFrame ? 1 : 0),
    referenceVideoCount: (options.referenceVideos?.length ?? 0) + (options.referenceVideo ? 1 : 0),
    referenceAudioCount: options.referenceAudios?.length ?? 0,
  })
  try {
    const result = await generateRemoteVideoRequest(settings, options)
    options.captureAdminLog?.({
      provider,
      taskId: result.taskId,
      model: settings.model,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      resultType: 'success',
      kind: 'video',
      requestJson,
      resultJson: sanitizeAdminLogJson({ taskId: result.taskId, status: 'completed', progress: result.progress, contentType: result.blob.type, bytes: result.blob.size }),
      resultUrls: result.sourceUrl ? [result.sourceUrl] : [],
    })
    return result
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    const normalized = normalizeGenerationError(error)
    const generatedButDownloadPending = Boolean(normalized.resultUrls?.length && /视频已生成但(?:下载|本地归档)/.test(normalized.message))
    options.captureAdminLog?.({
      provider,
      taskId: normalized.requestId,
      model: settings.model,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      resultType: generatedButDownloadPending ? 'success' : 'failed',
      kind: 'video',
      requestJson,
      resultJson: sanitizeAdminLogJson({ category: normalized.category, summary: normalized.message, detail: normalized.detail, status: generatedButDownloadPending ? 'download_pending' : normalized.status, requestId: normalized.requestId }),
      resultUrls: normalized.resultUrls ?? [],
    })
    throw error
  }
}

export type ProviderCredits = {
  provider: string
  amount: number
  unit: string
  updatedAt: string
  scope?: 'account' | 'api-key'
}

export type CurrencyRate = {
  base: string
  target: string
  rate: number
  date: string
  fetchedAt: string
}

export async function fetchUsdToCnyRate(): Promise<CurrencyRate> {
  const response = await providerFetch('https://api.frankfurter.app/latest?from=USD&to=CNY', {
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`汇率服务暂不可用（${response.status}）`)
  const payload = await response.json() as { amount?: unknown; base?: unknown; date?: unknown; rates?: { CNY?: unknown } }
  const rate = Number(payload.rates?.CNY)
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('汇率服务返回了无效的 USD/CNY 汇率')
  return {
    base: String(payload.base ?? 'USD'),
    target: 'CNY',
    rate,
    date: String(payload.date ?? new Date().toISOString().slice(0, 10)),
    fetchedAt: new Date().toISOString(),
  }
}

export type ProviderModelPrice = {
  modelId: string
  credits: number
  billing: 'fixed' | 'token'
  priceExample?: string
  unit?: string
}

export async function fetchProviderModelPrices(baseUrl: string): Promise<ProviderModelPrice[]> {
  const normalizedBase = normalizedApiBaseUrl(baseUrl)
  if (/api\.apiyi\.com|apiyi\.com/i.test(normalizedBase)) {
    const apiYiOrigin = new URL(normalizedBase).origin
    const response = await providerFetch(`${apiYiOrigin}/api/pricing`, {
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) throw new Error(await readError(response) || apiErrorSummary(response.status))
    const payload = await response.json() as { success?: unknown; data?: unknown }
    if (payload.success !== true || !Array.isArray(payload.data)) return []
    return payload.data.flatMap((row): ProviderModelPrice[] => {
      if (!row || typeof row !== 'object') return []
      const item = row as Record<string, unknown>
      const modelId = String(item.model_name ?? '').trim()
      const quotaType = Number(item.quota_type)
      const modelPrice = Number(item.model_price)
      const modelRatio = Number(item.model_ratio)
      if (!modelId) return []
      if (quotaType === 1 && Number.isFinite(modelPrice) && modelPrice > 0) {
        return [{ modelId, credits: modelPrice, billing: 'fixed', unit: 'USD', priceExample: `约 $${modelPrice.toFixed(2)} / 次` }]
      }
      if (quotaType === 0 && Number.isFinite(modelRatio) && modelRatio > 0) {
        return [{ modelId, credits: modelRatio, billing: 'token', unit: '倍率', priceExample: `按 Token · 倍率 ${modelRatio}` }]
      }
      return []
    })
  }
  if (!isGrsaiBaseUrl(baseUrl)) return []
  const origin = new URL(normalizedApiBaseUrl(baseUrl)).origin
  const response = await providerFetch(`${origin}/client/serverGrsai/getModelList`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  if (!response.ok) throw new Error(await readError(response) || apiErrorSummary(response.status))
  const payload = await response.json() as { code?: unknown; data?: { list?: unknown[] }; msg?: unknown }
  if (payload.code !== 0) throw new Error(typeof payload.msg === 'string' ? payload.msg : '未能读取 GRS AI 模型价格')
  return (payload.data?.list ?? []).flatMap((row): ProviderModelPrice[] => {
    if (!row || typeof row !== 'object') return []
    const item = row as Record<string, unknown>
    const modelId = String(item.name ?? item.model ?? '').trim()
    const credits = Number(item.credits)
    if (!modelId || !Number.isFinite(credits) || credits < 0) return []
    return [{
      modelId,
      credits,
      billing: Number(item.cost_type) === 0 ? 'fixed' : 'token',
      priceExample: typeof item.priceExample === 'string' ? item.priceExample : undefined,
    }]
  })
}

/**
 * Provider account adapters live here instead of the UI so adding a new vendor
 * never requires changing the connection screen. OpenAI-compatible APIs do not
 * have a standard balance endpoint, therefore only documented providers appear.
 */
export async function fetchProviderCredits(settings: Pick<ApiRequestSettings, 'baseUrl' | 'apiKey'> & { balanceToken?: string }): Promise<ProviderCredits | null> {
  const normalizedBase = normalizedApiBaseUrl(settings.baseUrl)
  if (isHfsyBaseUrl(normalizedBase)) {
    throw new Error('HFSY 官方公开 API 暂未提供余额查询接口；请在 HFSY 控制台查看余额。')
  }
  if (isEvolinkBaseUrl(normalizedBase)) {
    const response = await providerFetch(endpoint(normalizedBase, 'credits'), {
      headers: providerRelayHeaders(settings, { Authorization: `Bearer ${settings.apiKey.trim()}`, Accept: 'application/json' }),
    })
    if (!response.ok) throw new Error(await readError(response) || apiErrorSummary(response.status))
    const payload = await response.json() as { success?: unknown; message?: unknown; data?: { token?: { remaining_credits?: unknown; unlimited_credits?: unknown } } }
    if (payload.success !== true) throw new Error(typeof payload.message === 'string' && payload.message ? payload.message : '未能读取 Evolink 积分')
    if (payload.data?.token?.unlimited_credits === true) return { provider: 'Evolink', amount: Number.POSITIVE_INFINITY, unit: '无限积分', updatedAt: new Date().toISOString() }
    const amount = Number(payload.data?.token?.remaining_credits)
    if (!Number.isFinite(amount) || amount < 0) throw new Error('Evolink 返回了无效的 Token 积分余额')
    return { provider: 'Evolink', amount, unit: '积分', updatedAt: new Date().toISOString() }
  }
  if (/api\.apimart\.ai|apimart\.ai/i.test(normalizedBase)) {
    const response = await providerFetch('https://api.apimart.ai/v1/balance', {
      headers: { Authorization: `Bearer ${settings.apiKey.trim()}`, Accept: 'application/json' },
    })
    if (!response.ok) throw new Error(await readError(response) || apiErrorSummary(response.status))
    const payload = await response.json() as { success?: unknown; message?: unknown; remain_balance?: unknown; unlimited_quota?: unknown }
    if (payload.success !== true) throw new Error(typeof payload.message === 'string' ? payload.message : '未能读取 APIMart 余额')
    if (payload.unlimited_quota === true) return { provider: 'APIMart', amount: Number.POSITIVE_INFINITY, unit: '无限额度', updatedAt: new Date().toISOString() }
    const amount = Number(payload.remain_balance)
    if (!Number.isFinite(amount) || amount < 0) throw new Error('APIMart 返回了无效的余额')
    return { provider: 'APIMart', amount, unit: '余额（账户币种）', updatedAt: new Date().toISOString() }
  }
  if (/api\.apiyi\.com|apiyi\.com/i.test(normalizedBase)) {
    const token = settings.balanceToken?.trim()
    if (!token) throw new Error('请填写 APIYI 个人中心生成的余额查询 AccessToken')
    const apiYiOrigin = new URL(normalizedBase).origin
    const response = await providerFetch(`${apiYiOrigin}/api/user/self`, {
      headers: { Accept: 'application/json', Authorization: token, 'Content-Type': 'application/json' },
    })
    if (!response.ok) throw new Error(await readError(response) || apiErrorSummary(response.status))
    const payload = await response.json() as { success?: unknown; message?: unknown; data?: { quota?: unknown } }
    if (payload.success !== true) throw new Error(typeof payload.message === 'string' ? payload.message : '未能读取 APIYI 余额')
    const quota = Number(payload.data?.quota)
    if (!Number.isFinite(quota) || quota < 0) throw new Error('APIYI 返回了无效的余额')
    return { provider: 'APIYI', amount: quota / 500_000, unit: 'USD', updatedAt: new Date().toISOString() }
  }
  if (!isGrsaiBaseUrl(settings.baseUrl) || !settings.apiKey.trim()) return null
  const apiKey = settings.apiKey.trim()
  const parseGrsCredits = (payload: { code?: unknown; msg?: unknown; data?: unknown }, label: string) => {
    if (payload.code !== 0) throw new Error(typeof payload.msg === 'string' ? payload.msg : `未能读取 GRS AI ${label}`)
    const data = payload.data
    const numericCredit = (value: unknown, depth = 0): number | undefined => {
      if (typeof value === 'number' && Number.isFinite(value)) return value
      if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
      if (!value || typeof value !== 'object' || depth > 2) return undefined
      const record = value as Record<string, unknown>
      const preferredFields = [
        'remainingCredits', 'remaining_credits', 'remainCredits', 'remain_credits',
        'availableCredits', 'available_credits', 'apiKeyCredits', 'keyCredits',
        'accountCredits', 'account_credits', 'userCredits', 'user_credits',
        'totalCredits', 'total_credits', 'credit', 'credits', 'quota', 'balance',
      ]
      for (const field of preferredFields) {
        if (!(field in record)) continue
        const parsed = numericCredit(record[field], depth + 1)
        if (parsed !== undefined) return parsed
      }
      for (const [field, nested] of Object.entries(record)) {
        if (!/(?:credit|balance|quota|remain|available)/i.test(field)) continue
        const parsed = numericCredit(nested, depth + 1)
        if (parsed !== undefined) return parsed
      }
      for (const field of ['account', 'user', 'wallet', 'result', 'data']) {
        if (!(field in record)) continue
        const parsed = numericCredit(record[field], depth + 1)
        if (parsed !== undefined) return parsed
      }
      return undefined
    }
    const credits = numericCredit(data)
    const amount = credits ?? Number.NaN
    if (!Number.isFinite(amount) || amount < 0) {
      const fields = data && typeof data === 'object' ? Object.keys(data as Record<string, unknown>).slice(0, 8).join('、') : typeof data
      throw new Error(`GRS AI 返回了无法识别的${label}${fields ? `（字段：${fields}）` : ''}`)
    }
    return amount
  }
  const requestCredits = async (path: 'getAPIKeyCredits' | 'getCredits', label: string) => {
    // Query the generation key itself. The common getCredits endpoint reports
    // the owning account's pool and ignores a per-key credit limit.
    const response = await providerFetch(grsaiControlEndpoint(settings.baseUrl, `client/openapi/${path}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    })
    if (!response.ok) throw new Error(await readError(response) || apiErrorSummary(response.status))
    const payload = await response.json() as { code?: unknown; msg?: unknown; data?: unknown }
    return parseGrsCredits(payload, label)
  }
  const requestSharedAccountCredits = async () => {
    // Current GRS documentation exposes the account pool associated with a key
    // through this read-only endpoint. Keep the legacy POST path as a fallback
    // for older domestic nodes that have not rolled out the common endpoint.
    const url = new URL(grsaiControlEndpoint(settings.baseUrl, 'client/common/getCredits'))
    url.searchParams.set('apikey', apiKey)
    const response = await providerFetch(url.toString(), { headers: { Accept: 'application/json' } })
    if (response.ok) {
      const payload = await response.json() as { code?: unknown; msg?: unknown; data?: unknown; credits?: unknown }
      return parseGrsCredits({ ...payload, data: payload.data ?? payload.credits }, '账户积分余额')
    }
    return requestCredits('getCredits', '账户积分余额')
  }
  const keyAmount = await requestCredits('getAPIKeyCredits', 'API Key 积分余额')
  if (keyAmount > 0) return { provider: 'GRS AI', amount: keyAmount, unit: '积分', updatedAt: new Date().toISOString(), scope: 'api-key' }
  // GRS returns zero when a key has no independent quota. Such keys spend from
  // the account pool, so zero is a sentinel rather than an exhausted balance.
  const accountAmount = await requestSharedAccountCredits()
  return { provider: 'GRS AI', amount: accountAmount, unit: '积分', updatedAt: new Date().toISOString(), scope: 'account' }
}

/** Validate credentials without performing a billable generation request. */
export async function validateApiCredentials(settings: Pick<ApiRequestSettings, 'baseUrl' | 'apiKey' | 'authMode'>): Promise<void> {
  const normalizedBase = normalizedApiBaseUrl(settings.baseUrl)
  if (!settings.apiKey.trim()) throw new Error('API Key 不能为空')
  const signal = AbortSignal.timeout(15_000)
  const supplement = VENDOR_MODEL_SUPPLEMENTS.find((entry) => entry.match(normalizedBase))
  if (supplement?.catalogOnly) {
    // GRS documents this account endpoint specifically for querying an API key's
    // credit balance. It authenticates the supplied key without starting a
    // generation, unlike the static local catalog which proves nothing about it.
    let response: Response
    try {
      response = await providerFetch(grsaiControlEndpoint(settings.baseUrl, 'client/openapi/getAPIKeyCredits'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: settings.apiKey.trim() }),
        signal,
      })
    } catch (error) {
      throw new Error(error instanceof Error ? `无法验证 GRS AI API Key：${error.message}` : '无法验证 GRS AI API Key，请检查地址和网络')
    }
    if (!response.ok) throw new Error(await readError(response) || apiErrorSummary(response.status))
    try {
      const payload = await response.json() as { code?: unknown; msg?: unknown; data?: unknown }
      if (payload.code !== 0) {
        throw new Error(typeof payload.msg === 'string' && payload.msg.trim() ? payload.msg : 'GRS AI API Key 无效或已失效')
      }
    } catch (error) {
      if (error instanceof Error) throw error
      throw new Error('GRS AI 未返回可确认的 API Key 校验结果')
    }
    return
  }
  let response: Response
  try {
    response = await providerFetch(endpoint(settings.baseUrl, 'models'), {
      headers: compatibleApiHeaders({ ...settings, apiKey: settings.apiKey.trim() }),
      signal,
    })
  } catch (error) {
    throw new Error(error instanceof Error ? `无法连接接口：${error.message}` : '无法连接接口，请检查地址和网络')
  }
  if (!response.ok) throw new Error(await readError(response) || apiErrorSummary(response.status))
}

// Auto-enable current mainstream families when a provider actually exposes
// them to the user's key. This never invents catalog entries or bypasses the
// provider's model/group permissions.
const DEFAULT_TEXT_PATTERN = /gemini|deepseek|gpt/i
const DEFAULT_IMAGE_PATTERN = /nano(?:-banana)?|seedream|gpt-image/i
// Video families that should be enabled immediately after a successful model
// catalog refresh. The match is deliberately based on the provider's returned
// id/name, so it never creates a model the current key cannot access.
const DEFAULT_VIDEO_PATTERN = /seedance|veo|wan(?:2\.\d)?|happyhorse/i

export function isModelAutoEnabled(model: { id: string; name: string; capability: ModelCapability }): boolean {
  const haystack = `${model.id} ${model.name}`
  if (model.capability === 'text') return DEFAULT_TEXT_PATTERN.test(haystack)
  if (model.capability === 'image') return DEFAULT_IMAGE_PATTERN.test(haystack)
  if (model.capability === 'video') return DEFAULT_VIDEO_PATTERN.test(haystack)
  return false
}

export function pickPreferredModelId(
  models: { id: string; name: string; capability: ModelCapability; enabled: boolean }[],
  kind: 'text' | 'image',
): string | undefined {
  const enabled = models.filter((model) => model.enabled && model.capability === kind)
  if (enabled.length === 0) return undefined
  if (kind === 'text') {
    return enabled.find((model) => /gpt/i.test(`${model.id} ${model.name}`))?.id
      ?? enabled.find((model) => /gemini/i.test(`${model.id} ${model.name}`))?.id
      ?? enabled[0].id
  }
  return enabled.find((model) => /gpt-image|image2/i.test(`${model.id} ${model.name}`))?.id
    ?? enabled.find((model) => /nano/i.test(`${model.id} ${model.name}`))?.id
    ?? enabled[0].id
}

const extractGeneratedImages = extractProviderImages

/** Visionary can echo request reference URLs while a task is processing. Only
 * documented result containers count as generated output. */
function extractVisionaryGeneratedImages(payload: unknown): GeneratedImage[] {
  if (!payload || typeof payload !== 'object') return []
  const root = payload as Record<string, unknown>
  const candidates: unknown[] = [root.results, root.result, root.output]
  const dataItems = Array.isArray(root.data) ? root.data : [root.data]
  for (const item of dataItems) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    candidates.push(record.result, record.results, record.output)
  }
  return candidates.flatMap((candidate) => extractGeneratedImages(candidate))
}

function providerTaskPercent(payload: unknown) {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  return [record.data, record.result, record].flat()
    .map((candidate) => (candidate as { progress?: unknown } | null)?.progress)
    .map((value) => typeof value === 'string' && /^\d+(?:\.\d+)?%?$/.test(value.trim()) ? Number.parseFloat(value) : value)
    .find((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100)
}

function reportImageTaskProgress(payload: unknown, onProgress?: ImageTaskProgressCallback, fallbackStatus = '') {
  if (!onProgress) return
  const percent = providerTaskPercent(payload)
  const status = extractProviderTaskStatus(payload) || fallbackStatus
  if (percent !== undefined || status) onProgress(percent, status)
}

async function resolveGrsaiMediaResult(
  settings: ApiRequestSettings,
  initialPayload: unknown,
  signal?: AbortSignal,
  kind: '图片' | '视频' = '图片',
  onProgress?: ImageTaskProgressCallback,
) {
  const initial = initialPayload && typeof initialPayload === 'object'
    ? initialPayload as Record<string, unknown>
    : {}
  const taskId = extractProviderTaskId(initialPayload)
  const initialStatus = extractProviderTaskStatus(initialPayload)
  if (/^(?:failed|failure|violation|cancelled|canceled|expired|error)$/.test(initialStatus)) {
    throw new GenerationRequestError(
      'api',
      initialStatus === 'violation' ? `${kind}生成未通过内容审核` : `GRS AI ${kind}任务生成失败`,
      String(initial.error ?? initial.message ?? `任务状态：${initialStatus}`),
      { requestId: taskId || undefined },
    )
  }
  if (extractGeneratedImages(initialPayload).length) return initialPayload
  if (!taskId) return initialPayload
  if (kind === '图片') reportImageTaskProgress(initialPayload, onProgress, 'queued')

  const startedAt = Date.now()
  let consecutiveErrors = 0
  let succeededWithoutResultCount = 0
  while (Date.now() - startedAt < GRSAI_IMAGE_POLL_TIMEOUT_MS) {
    await waitForDelay(GRSAI_IMAGE_POLL_INTERVAL_MS, signal)
    let response: Response
    try {
      response = await providerFetch(`${grsaiMediaEndpoint(settings.baseUrl, 'result')}?id=${encodeURIComponent(taskId)}`, {
        signal,
        headers: apiYiRelayHeaders(settings, { Authorization: `Bearer ${settings.apiKey}` }),
      })
      if (!response.ok) {
        const errorPayload = await response.clone().json().catch(() => null) as Record<string, unknown> | null
        const nestedError = errorPayload?.data && typeof errorPayload.data === 'object'
          ? errorPayload.data as Record<string, unknown>
          : null
        const errorRecord = nestedError ?? errorPayload
        const errorStatus = String(errorRecord?.status ?? '').toLowerCase()
        if (/^(?:failed|failure|violation|cancelled|canceled|expired|error)$/.test(errorStatus)) {
          throw new GenerationRequestError(
            'api',
            errorStatus === 'violation' ? `${kind}生成未通过内容审核` : `GRS AI ${kind}任务生成失败`,
            String(errorRecord?.error ?? errorRecord?.message ?? `任务状态：${errorStatus}`),
            { requestId: taskId },
          )
        }
        if (response.status === 401 || response.status === 403) throw await createApiError(response)
        throw new Error(`结果查询失败（${response.status}）`)
      }
      const payload = await response.json() as unknown
      consecutiveErrors = 0
      const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
      const status = extractProviderTaskStatus(payload)
      const task = record.data && typeof record.data === 'object' && !Array.isArray(record.data) ? record.data as Record<string, unknown> : record
      if (/^(?:failed|failure|violation|cancelled|canceled|expired|error)$/.test(status)) {
        throw new GenerationRequestError(
          'api',
          status === 'violation' ? `${kind}生成未通过内容审核` : `GRS AI ${kind}任务生成失败`,
          String(task.error ?? task.message ?? `任务状态：${status}`),
          { requestId: taskId },
        )
      }
      if (extractGeneratedImages(payload).length) return payload
      if (kind === '图片') reportImageTaskProgress(payload, onProgress)
      else if (typeof task.progress === 'number') onProgress?.(Math.max(0, Math.min(99, task.progress)), status)
      if (/^(?:succeeded|success|completed|complete)$/.test(status)) {
        succeededWithoutResultCount += 1
        // A successful status can arrive just before the result URL is replicated.
        if (succeededWithoutResultCount >= 20) {
          throw new GenerationRequestError(
            'platform',
            `GRS AI 显示生成成功，但暂未返回${kind}地址`,
            `任务 ${taskId} 已成功。Disy 已额外查询多次，但结果地址仍为空；请稍后从 GRS AI 日志找回，避免重复扣费。`,
            { requestId: taskId },
          )
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      if (error instanceof GenerationRequestError) throw error
      consecutiveErrors += 1
      if (consecutiveErrors >= GRSAI_MAX_CONSECUTIVE_POLL_ERRORS) {
        throw new GenerationRequestError(
          'network',
          'GRS AI 任务已提交，但结果查询暂时中断',
          `任务 ID：${taskId}。连续 ${consecutiveErrors} 次查询失败，任务仍可能在服务端成功完成；请勿直接重试。`,
          { requestId: taskId },
        )
      }
    }
  }
  throw new GenerationRequestError(
    'network',
    'GRS AI 任务仍在生成或结果查询超时',
    `任务 ID：${taskId}。Disy 已持续查询 15 分钟，任务仍可能稍后成功；请勿直接重复生成。`,
    { requestId: taskId },
  )
}

async function resolveVisionaryImageResult(
  settings: ApiRequestSettings,
  initialPayload: unknown,
  signal?: AbortSignal,
  onProgress?: ImageTaskProgressCallback,
) {
  if (extractVisionaryGeneratedImages(initialPayload).length) return initialPayload
  const taskId = extractTaskId(initialPayload)
  if (!taskId) return initialPayload
  if (classifyProviderPayload(initialPayload) === 'failed') {
    throw new GenerationRequestError('api', 'Visionary 图像任务生成失败', sanitizeAdminLogJson(initialPayload), { requestId: taskId })
  }
  reportImageTaskProgress(initialPayload, onProgress, 'queued')

  const startedAt = Date.now()
  let consecutiveErrors = 0
  let successWithoutResultCount = 0
  while (Date.now() - startedAt < VISIONARY_POLL_TIMEOUT_MS) {
    await waitForDelay(VISIONARY_POLL_INTERVAL_MS, signal)
    try {
      const response = await providerFetch(endpoint(settings.baseUrl, `tasks/${encodeURIComponent(taskId)}`), {
        signal,
        headers: providerRelayHeaders(settings, { Authorization: `Bearer ${settings.apiKey}` }),
      })
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw await createApiError(response)
        // A newly submitted task can briefly be absent while it propagates.
        if (response.status === 404 && Date.now() - startedAt < 30_000) continue
        if (response.status === 429 || response.status >= 500) throw new Error(`任务查询暂时失败（${response.status}）`)
        throw await createApiError(response)
      }
      const payload = await response.json() as unknown
      consecutiveErrors = 0
      if (extractVisionaryGeneratedImages(payload).length) return payload
      const state = classifyProviderPayload(payload)
      if (state === 'failed') {
        throw new GenerationRequestError('api', 'Visionary 图像任务生成失败', sanitizeAdminLogJson(payload), { requestId: taskId })
      }
      reportImageTaskProgress(payload, onProgress)
      if (state === 'success_without_result') {
        successWithoutResultCount += 1
        if (successWithoutResultCount >= VISIONARY_SUCCESS_WITHOUT_URL_RETRIES) {
          throw new GenerationRequestError(
            'platform',
            'Visionary 显示生成成功，但暂未返回图片地址',
            `任务 ${taskId} 已成功，但结果地址仍未同步；请从任务记录恢复，不要重新生成。`,
            { requestId: taskId },
          )
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      if (error instanceof GenerationRequestError) throw error
      consecutiveErrors += 1
      if (consecutiveErrors >= VISIONARY_MAX_CONSECUTIVE_POLL_ERRORS) {
        throw new GenerationRequestError(
          'network',
          'Visionary 任务已提交，但结果查询暂时中断',
          `任务 ID：${taskId}。任务仍可能成功，请从任务记录恢复，不要重新生成。`,
          { requestId: taskId },
        )
      }
    }
  }
  throw new GenerationRequestError(
    'network',
    'Visionary 任务查询超时',
    `任务 ID：${taskId}。任务仍可能稍后完成，请勿重复生成。`,
    { requestId: taskId },
  )
}

function genericProviderPollCandidates(settings: ApiRequestSettings, initialPayload: unknown, taskId: string) {
  const candidates: string[] = []
  const baseOrigin = new URL(normalizedApiBaseUrl(settings.baseUrl)).origin
  const visited = new WeakSet<object>()
  const addExplicit = (value: unknown) => {
    if (typeof value !== 'string' || !value.trim()) return
    try {
      const url = new URL(value.trim(), normalizedApiBaseUrl(settings.baseUrl) + '/')
      // Never forward a user's API key to a host other than the configured
      // provider. Cross-origin result media is handled after JSON extraction.
      if (url.origin === baseOrigin) candidates.push(url.toString())
    } catch { /* ignore malformed provider hints */ }
  }
  const visit = (value: unknown, depth = 0) => {
    if (!value || depth > 4 || typeof value !== 'object' || visited.has(value)) return
    visited.add(value)
    if (Array.isArray(value)) { value.forEach((item) => visit(item, depth + 1)); return }
    const record = value as Record<string, unknown>
    for (const key of ['status_url', 'statusUrl', 'task_url', 'taskUrl', 'poll_url', 'pollUrl']) addExplicit(record[key])
    for (const key of ['data', 'result', 'output']) visit(record[key], depth + 1)
  }
  visit(initialPayload)
  if (isHfsyBaseUrl(settings.baseUrl)) candidates.push(endpoint(settings.baseUrl, `images/generations/${encodeURIComponent(taskId)}`))
  for (const path of providerTaskPollPaths(taskId)) candidates.push(endpoint(settings.baseUrl, path))
  return Array.from(new Set(candidates))
}

/**
 * Conservative fallback for OpenAI-shaped providers that submit an async job.
 * It performs GET-only discovery, never retries the billable POST, and only
 * sends credentials to the configured provider origin.
 */
async function resolveGenericProviderImageResult(
  settings: ApiRequestSettings,
  initialPayload: unknown,
  signal?: AbortSignal,
  onProgress?: ImageTaskProgressCallback,
  nativeHfsy = false,
) {
  const hasResult = (payload: unknown) => {
    if (nativeHfsy) {
      const status = extractProviderTaskStatus(payload)
      if (status && !/^(?:success|succeeded|completed|complete)$/.test(status)) return false
    }
    return extractProviderImages(payload).length > 0
  }
  if (hasResult(initialPayload)) return initialPayload
  const taskId = extractProviderTaskId(initialPayload)
  const initialFailure = nativeHfsy ? hfsyFailureDetail(initialPayload) : ''
  if (initialFailure || classifyProviderPayload(initialPayload) === 'failed') {
    throw new GenerationRequestError('api', '图像任务生成失败', initialFailure || sanitizeAdminLogJson(initialPayload), { requestId: taskId || undefined })
  }
  if (!taskId && nativeHfsy) throw new GenerationRequestError('platform', 'HFSY 没有返回图片任务编号或结果', sanitizeAdminLogJson(initialPayload))
  if (!taskId) return initialPayload
  reportImageTaskProgress(initialPayload, onProgress, 'queued')

  let pollSettings = settings
  let candidates = nativeHfsy
    ? [hfsyTaskUrl(pollSettings, 'image', taskId), hfsyTaskUrl(pollSettings, 'image', taskId, true)]
    : genericProviderPollCandidates(settings, initialPayload, taskId)
  const startedAt = Date.now()
  let selectedEndpoint = ''
  let consecutiveErrors = 0
  let successWithoutResultCount = 0
  while (Date.now() - startedAt < GENERIC_PROVIDER_POLL_TIMEOUT_MS) {
    await waitForDelay(GENERIC_PROVIDER_POLL_INTERVAL_MS, signal)
    const roundCandidates = selectedEndpoint ? [selectedEndpoint] : candidates
    let foundEndpointThisRound = false
    let transientFailureThisRound = false
    for (const candidate of roundCandidates) {
      try {
        const headers = providerRelayHeaders(pollSettings, { Authorization: `Bearer ${settings.apiKey}`, Accept: 'application/json' })
        const response = await providerFetch(candidate, { signal, headers })
        if (nativeHfsy && response.status === 504 && new URL(normalizedApiBaseUrl(pollSettings.baseUrl)).hostname !== 'api.hfsyapi.cn') {
          pollSettings = { ...settings, baseUrl: 'https://api.hfsyapi.cn/v1' }
          candidates = [hfsyTaskUrl(pollSettings, 'image', taskId), hfsyTaskUrl(pollSettings, 'image', taskId, true)]
          selectedEndpoint = ''
          transientFailureThisRound = true
          break
        }
        if (response.status === 404 && !selectedEndpoint) continue
        if (response.status === 401 || response.status === 403) throw await createApiError(response)
        if (response.status === 429 || response.status >= 500) {
          transientFailureThisRound = true
          continue
        }
        if (!response.ok) throw await createApiError(response)
        foundEndpointThisRound = true
        selectedEndpoint = candidate
        const payload = await response.json() as unknown
        consecutiveErrors = 0
        const state = classifyProviderPayload(payload)
        const failure = nativeHfsy ? hfsyFailureDetail(payload) : ''
        if (failure || state === 'failed') {
          throw new GenerationRequestError('api', '图像任务生成失败', failure || sanitizeAdminLogJson(payload), { requestId: taskId })
        }
        if (hasResult(payload)) return payload
        reportImageTaskProgress(payload, onProgress)
        if (state === 'success_without_result') {
          successWithoutResultCount += 1
          if (successWithoutResultCount >= GENERIC_PROVIDER_SUCCESS_WITHOUT_URL_RETRIES) {
            throw new GenerationRequestError(
              'platform',
              '厂商显示生成成功，但暂未返回图片地址',
              `任务 ID：${taskId}。结果可能仍在同步，请从厂商任务记录恢复，不要重新生成。`,
              { requestId: taskId },
            )
          }
        }
        break
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error
        if (error instanceof GenerationRequestError) throw error
        transientFailureThisRound = true
      }
    }
    if (foundEndpointThisRound) continue
    if (!selectedEndpoint && !transientFailureThisRound) {
      if (Date.now() - startedAt < 30_000) continue
    }
    if (!selectedEndpoint && Date.now() - startedAt >= 30_000 && !transientFailureThisRound) {
      throw new GenerationRequestError(
        'platform',
        '已收到任务编号，但无法识别厂商的查询接口',
        `任务 ID：${taskId}。已安全尝试常见 tasks、jobs、requests 查询路径，未重新提交生成请求。请从厂商后台恢复。`,
        { requestId: taskId },
      )
    }
    consecutiveErrors += 1
    if (consecutiveErrors >= GENERIC_PROVIDER_MAX_CONSECUTIVE_POLL_ERRORS) {
      throw new GenerationRequestError(
        'network',
        '任务已提交，但结果查询暂时中断',
        `任务 ID：${taskId}。任务仍可能在厂商服务器完成，请勿重新生成。`,
        { requestId: taskId },
      )
    }
  }
  throw new GenerationRequestError(
    'network',
    '任务查询超时',
    `任务 ID：${taskId}。任务仍可能稍后完成，请勿重复生成。`,
    { requestId: taskId },
  )
}

export function resolveImageRequestSize(model: string, aspectRatio = '1:1', resolution: '1K' | '2K' | '4K' = '1K') {
  const compatibleSize = (() => {
    const [width, height] = String(aspectRatio).split(':').map(Number)
    if (!Number.isFinite(width) || !Number.isFinite(height) || height === 0) return '1024x1024'
    const ratio = width / height
    if (ratio > 1.15) return '1536x1024'
    if (ratio < 0.87) return '1024x1536'
    return '1024x1024'
  })()
  // GPT Image 2 accepts flexible dimensions. Preserve the requested canvas
  // ratio instead of collapsing portrait work (for example 9:16) into the
  // legacy 2:3 bucket used by earlier image APIs.
  if (!/(?:^|\b)gpt-image-2(?:\b|$)/i.test(model)) return compatibleSize
  const [rawWidth, rawHeight] = String(aspectRatio).split(':').map(Number)
  if (!Number.isFinite(rawWidth) || !Number.isFinite(rawHeight) || rawWidth <= 0 || rawHeight <= 0) return compatibleSize
  const ratio = Math.min(3, Math.max(1 / 3, rawWidth / rawHeight))
  const shortEdge = resolution === '4K' ? 2160 : resolution === '2K' ? 1440 : 1024
  const roundTo16 = (value: number) => Math.max(16, Math.round(value / 16) * 16)
  const width = ratio >= 1 ? roundTo16(shortEdge * ratio) : roundTo16(shortEdge)
  const height = ratio >= 1 ? roundTo16(shortEdge) : roundTo16(shortEdge / ratio)
  return `${Math.min(3840, width)}x${Math.min(3840, height)}`
}

export async function generateRemoteImages(
  settings: ApiRequestSettings,
  options: ImageGenerationOptions,
): Promise<GeneratedImage[]> {
  const startedAtMs = Date.now()
  const startedAt = new Date(startedAtMs).toISOString()
  const requestSize = resolveImageRequestSize(settings.model, options.aspectRatio, options.resolution)
  const isApiYiSeedream = /api\.apiyi\.com|apiyi\.com/i.test(settings.baseUrl) && /seedream/i.test(settings.model)
  const body: Record<string, unknown> = {
    model: settings.model,
    prompt: options.prompt,
    ...(isApiYiSeedream ? {} : { n: options.count }),
    size: requestSize,
  }
  // APIYI's Seedream endpoint uses resolution presets. A 1024x1024 OpenAI
  // default is invalid for Seedream 5.x (and pro requires 1K/2K presets).
  if (/api\.apiyi\.com|apiyi\.com/i.test(settings.baseUrl) && /seedream/i.test(settings.model)) {
    const requested = options.resolution ?? '2K'
    body.size = /pro/i.test(settings.model)
      ? (requested === '4K' ? '2K' : requested)
      : (requested === '1K' || requested === '4K' ? '2K' : requested)
    body.watermark = false
    body.output_format = 'png'
  }
  if (options.aspectRatio && options.aspectRatio !== 'auto' && !isApiYiSeedream) body.aspect_ratio = options.aspectRatio
  if (options.resolution && !isApiYiSeedream) body.resolution = options.resolution
  if (options.detail && !isApiYiSeedream) body.quality = options.detail
  if (!/gpt-image/i.test(settings.model)) body.response_format = 'url'
  const referenceImages = options.referenceImages?.filter(Boolean) ?? []
  const hfsy = getHfsyImageCapabilities(settings.baseUrl, settings.model)
  const publicHfsyReferences = hfsy ? referenceImages.map(publicImageSourceUrl) : []
  const useHfsyNativeImage = Boolean(hfsy && publicHfsyReferences.every(Boolean))
  if (hfsy) {
    const invalid = (detail: string): never => { throw new GenerationRequestError('platform', 'HFSY 图片参数不符合模型要求', `${detail}。图片生成尚未提交。`) }
    if (!options.prompt.trim() || Array.from(options.prompt).length > 5_000) invalid('提示词须为 1–5000 字符')
    if (referenceImages.length > hfsy.images) invalid(`当前模型最多支持 ${hfsy.images} 张参考图`)
    if (options.output && !hfsy.outputs.includes(options.output)) invalid(`当前模型没有提供 ${options.output} 输出`)
    if (options.output === 'transparent-png' && !useHfsyNativeImage) invalid('透明背景接口需要公网参考图链接。请换用有公网源地址的图片，或移除本地参考图')
  }
  if (!useHfsyNativeImage && isHfsyBaseUrl(settings.baseUrl) && /^nano-banana-(?:2|pro)$/i.test(settings.model)) {
    const betaSettings = { ...settings, baseUrl: new URL(normalizedApiBaseUrl(settings.baseUrl)).origin + '/v1beta' }
    const parts: Array<Record<string, unknown>> = [{ text: options.prompt }]
    for (const fileUri of referenceImages.slice(0, 7)) parts.push({ fileData: { mimeType: /^data:image\/jpeg/i.test(fileUri) ? 'image/jpeg' : 'image/png', fileUri } })
    const response = await providerFetch(endpoint(betaSettings.baseUrl, `models/${settings.model}:generateContent`), {
      method: 'POST', signal: options.signal,
      headers: providerRelayHeaders(betaSettings, { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' }),
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { imageConfig: { imageSize: options.resolution ?? '1K', aspectRatio: options.aspectRatio ?? '1:1' } } }),
    })
    if (!response.ok) throw await createApiError(response)
    const payload = await response.json() as unknown
    const rows = extractGeneratedImages(payload)
    if (!rows.length) throw new GenerationRequestError('platform', 'HFSY Nano Banana 没有返回图片地址', sanitizeAdminLogJson(payload))
    return rows
  }
  const isGrsai = isGrsaiBaseUrl(settings.baseUrl)
  const grsaiPath = isGrsai ? grsaiImageEndpoint(settings.baseUrl) : undefined
  const useGrsaiUnifiedImage = grsaiPath === 'api/generate'
  const grsaiOptions = isGrsai ? resolveImageModelOptions(settings.baseUrl, settings.model, options) : options
  const hfsyOptions = hfsy ? resolveImageModelOptions(settings.baseUrl, settings.model, options) : undefined
  const hfsySize = hfsyOptions?.resolution && (settings.model.toLowerCase() === 'seedream-5.0-pro'
    ? HFSY_SEEDREAM_SIZES[hfsyOptions.aspectRatio ?? '1:1']
    : HFSY_IMAGE_SIZES[hfsyOptions.aspectRatio ?? '1:1']?.[hfsyOptions.resolution === '4K' ? 2 : hfsyOptions.resolution === '2K' ? 1 : 0])
  const hfsyImageBody = {
    model: settings.model,
    prompt: options.prompt,
    ...(hfsySize ? { size: hfsySize } : {}),
    ...(publicHfsyReferences.length ? { reference_images: publicHfsyReferences } : {}),
    ...(options.output === 'transparent-png' ? { background: 'transparent' } : {}),
  }
  if (isGrsai && options.output && options.output !== grsaiOptions.output) {
    throw new GenerationRequestError('platform', '当前模型或接口不支持此输出格式', `${settings.model} 无法输出 ${options.output}，生成尚未提交。`)
  }
  const useVisionaryTaskImage = isVisionaryBaseUrl(settings.baseUrl)
  const useEvolinkTaskImage = isEvolinkBaseUrl(settings.baseUrl)
  const useStandardImageEdit = grsaiPath === 'images/edits' || (!isGrsai && !useEvolinkTaskImage && referenceImages.length > 0 && /(?:gpt-image|chatgpt-image)/i.test(settings.model))
  const isGrsaiGptImage = /(?:gpt-image|chatgpt-image)/i.test(settings.model)
  const grsaiSize = GRS_GPT_MODELS.test(settings.model)
    ? resolveGrsaiGptSize(settings.model, grsaiOptions.aspectRatio ?? '1:1', grsaiOptions.resolution ?? '1K')
    : requestSize
  const outputFormat = grsaiOptions.output === 'transparent-png' ? 'png' : grsaiOptions.output
  const background = grsaiOptions.output === 'transparent-png' ? 'transparent' : undefined
  if (grsaiPath === 'images/generations' && isGrsaiGptImage) {
    delete body.aspect_ratio
    delete body.resolution
    body.size = GRS_IMAGE_SIZES[grsaiSize]?.[0] ?? grsaiSize
    body.quality = grsaiOptions.detail ?? 'auto'
    body.output_format = outputFormat ?? 'png'
    if (background) body.background = background
    if (referenceImages.length) body.image = referenceImages
  }
  // GRS documents `images` as raw Base64 or URL values. A browser Data URL
  // includes a MIME header that its upload worker does not decode reliably.
  const grsaiReferenceImages = referenceImages.map((source) => {
    const dataUrl = /^data:image\/(?:png|jpe?g|webp);base64,([\s\S]+)$/i.exec(source)
    return dataUrl ? dataUrl[1].replace(/\s/g, '') : source
  })
  const grsaiRequestBody: Record<string, unknown> = {
    model: settings.model,
    prompt: options.prompt,
    images: grsaiReferenceImages,
    aspectRatio: isGrsaiGptImage
      ? grsaiSize
      : grsaiOptions.aspectRatio ?? '1:1',
    // Async mode returns a task ID immediately. Polling that ID avoids losing
    // successful images when a long-lived synchronous connection is interrupted.
    replyType: 'async',
  }
  if (isGrsaiGptImage) {
    grsaiRequestBody.quality = grsaiOptions.detail ?? 'auto'
    grsaiRequestBody.outputFormat = outputFormat ?? 'png'
    if (background) grsaiRequestBody.background = background
  } else {
    grsaiRequestBody.imageSize = grsaiOptions.resolution ?? '1K'
  }
  const clientRequestId = crypto.randomUUID()
  const visionaryRequestBody: Record<string, unknown> = {
    model: settings.model,
    prompt: options.prompt,
    images: referenceImages,
      size: options.aspectRatio && options.aspectRatio !== 'auto' ? options.aspectRatio : requestSize,
    resolution: options.resolution ?? '1K',
    ...(options.detail ? { quality: options.detail } : {}),
    client_request_id: clientRequestId,
  }
  const evolinkRequestBody: Record<string, unknown> = {
    model: settings.model,
    prompt: options.prompt,
    size: options.aspectRatio && options.aspectRatio !== 'auto' ? options.aspectRatio : 'auto',
    // Nano Banana 2 Lite currently documents only the 1K quality preset.
    quality: /gemini-3\.1-flash-lite-image/i.test(settings.model) ? '1K' : (options.resolution ?? '1K'),
    ...(referenceImages.length ? { image_urls: referenceImages } : {}),
  }
  const requestForLog: Record<string, unknown> = useHfsyNativeImage
    ? hfsyImageBody
    : useGrsaiUnifiedImage
    ? grsaiRequestBody
    : useEvolinkTaskImage
      ? evolinkRequestBody
    : useVisionaryTaskImage
      ? visionaryRequestBody
    : useStandardImageEdit
      ? { model: settings.model, prompt: options.prompt, n: options.count, size: requestSize, quality: options.detail, images: `[multipart × ${referenceImages.length}]` }
      : body
  let taskId = ''
  let lastPayload: unknown = null

  const providerLabel = resolveProviderLabel(settings.baseUrl)

  const emitAdminLog = (resultType: 'success' | 'failed', resultPayload: unknown) => {
    if (!options.captureAdminLog) return
    const finishedAt = new Date().toISOString()
    const payload = resultPayload ?? lastPayload ?? {}
    options.captureAdminLog({
      provider: providerLabel,
      taskId: taskId || extractTaskId(payload) || undefined,
      model: settings.model,
      startedAt,
      finishedAt,
      durationMs: Date.now() - startedAtMs,
      resultType,
      kind: 'image',
      requestJson: sanitizeAdminLogJson(requestForLog),
      resultJson: sanitizeAdminLogJson(payload),
      resultUrls: collectRecoverableResultUrls(payload),
    })
  }

  const failWithAdminLog = (error: unknown): never => {
    if (error instanceof GenerationRequestError) {
      if (!error.adminLog && options.captureAdminLog) {
        const payload = lastPayload ?? { error: error.detail, summary: error.message }
        const log: GenerationAdminLog = {
          provider: providerLabel,
          taskId: taskId || error.requestId || extractTaskId(payload) || undefined,
          model: settings.model,
          startedAt,
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAtMs,
          resultType: 'failed',
          kind: 'image',
          requestJson: sanitizeAdminLogJson(requestForLog),
          resultJson: sanitizeAdminLogJson(payload),
          resultUrls: collectRecoverableResultUrls(payload),
        }
        error.adminLog = log
        options.captureAdminLog(log)
      }
      throw error
    }
    emitAdminLog('failed', { error: error instanceof Error ? error.message : String(error) })
    throw error
  }

  let response: Response
  try {
    if (useHfsyNativeImage) {
      response = await providerFetch(endpoint(settings.baseUrl, 'image/create'), {
        method: 'POST',
        signal: options.signal,
        headers: providerRelayHeaders(settings, { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' }),
        body: JSON.stringify(hfsyImageBody),
      })
    } else if (useGrsaiUnifiedImage) {
      response = await providerFetch(grsaiMediaEndpoint(settings.baseUrl, 'generate'), {
        method: 'POST',
        signal: options.signal,
        headers: {
          ...Object.fromEntries(apiYiRelayHeaders(settings, { Authorization: `Bearer ${settings.apiKey}` }).entries()),
          'Content-Type': 'application/json',
          ...(isApiYiSeedream ? { 'Accept-Encoding': 'identity' } : {}),
        },
        body: JSON.stringify(grsaiRequestBody),
      })
    } else if (useVisionaryTaskImage || useEvolinkTaskImage) {
      response = await providerFetch(endpoint(settings.baseUrl, 'images/generations'), {
        method: 'POST',
        signal: options.signal,
        headers: compatibleApiHeaders(settings, {
          'Content-Type': 'application/json',
          ...(useVisionaryTaskImage ? { 'Idempotency-Key': clientRequestId } : {}),
        }),
        body: JSON.stringify(useEvolinkTaskImage ? evolinkRequestBody : visionaryRequestBody),
      })
    } else if (useStandardImageEdit) {
      const form = new FormData()
      form.append('model', settings.model)
      form.append('prompt', options.prompt)
      if (!isGrsai) {
        form.append('n', String(options.count))
        form.append('size', requestSize)
      }
      const quality = isGrsai ? grsaiOptions.detail : options.detail
      if (quality) form.append('quality', quality)
      if (isGrsai) form.append('output_format', outputFormat ?? 'png')
      if (isGrsai && !referenceImages.length) throw new GenerationRequestError('platform', '图像编辑需要参考图', '当前连接指定了 images/edits。请先添加参考图，或使用 GRS AI 默认接口。')

      for (const [index, imageSource] of referenceImages.entries()) {
        const publicUrl = isGrsai ? publicImageSourceUrl(imageSource) : undefined
        if (publicUrl) {
          form.append('image', publicUrl)
          continue
        }
        let imageResponse: Response
        const imageController = new AbortController()
        const abortImageRead = () => imageController.abort()
        options.signal?.addEventListener('abort', abortImageRead, { once: true })
        const imageTimeout = window.setTimeout(() => imageController.abort(), REFERENCE_IMAGE_READ_TIMEOUT_MS)
        try {
          imageResponse = await providerFetch(imageSource, { signal: imageController.signal })
        } catch (error) {
          if (options.signal?.aborted) throw new DOMException('Generation interrupted', 'AbortError')
          throw new GenerationRequestError(
            'platform',
            error instanceof DOMException && error.name === 'AbortError' ? '参考图片读取超时' : '参考图片无法转换为模型输入',
            `${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}。为避免产生无效计费，本次请求尚未发送到图像生成接口。`,
          )
        } finally {
          window.clearTimeout(imageTimeout)
          options.signal?.removeEventListener('abort', abortImageRead)
        }
        if (!imageResponse.ok) {
          throw new GenerationRequestError(
            'platform',
            '参考图片无法转换为模型输入',
            `图片读取失败（${imageResponse.status}）。为避免产生无效计费，本次请求尚未发送到图像生成接口。`,
          )
        }
        const imageBlob = await imageResponse.blob()
        if (!imageBlob.type.startsWith('image/')) {
          throw new GenerationRequestError(
            'platform',
            '参考图片格式无法识别',
            `第 ${index + 1} 张参考图的文件类型为 ${imageBlob.type || 'unknown'}，本次生成请求未发送。`,
          )
        }
        const extension = imageBlob.type.includes('webp') ? 'webp' : imageBlob.type.includes('jpeg') ? 'jpg' : 'png'
        // GPT Image edit APIs represent an image array by repeating the same
        // multipart `image` field. The upload order is the prompt's 图1/图2/... order.
        form.append('image', imageBlob, `reference-${index + 1}.${extension}`)
      }

      response = await providerFetch(endpoint(settings.baseUrl, 'images/edits'), {
        method: 'POST',
        headers: compatibleApiHeaders(settings),
        body: form,
        signal: options.signal,
      })
    } else {
      if (referenceImages.length) {
        // APIYI Seedream uses `image` URL/base64 array on the same generations
        // endpoint; `image_urls` is not part of its documented schema.
        if (isApiYiSeedream) {
          body.image = referenceImages
          if (!/pro/i.test(settings.model)) body.sequential_image_generation = 'disabled'
        } else if (isHfsyBaseUrl(settings.baseUrl)) {
          // HFSY documents this field as `reference_images` (not OpenAI's
          // `image_urls`). apigo accepts the data-URL values prepared above.
          body.reference_images = referenceImages
        } else body.image_urls = referenceImages
      }
      response = await providerFetch(endpoint(settings.baseUrl, 'images/generations'), {
        method: 'POST',
        signal: options.signal,
        headers: {
          ...Object.fromEntries(compatibleApiHeaders(settings).entries()),
          'Content-Type': 'application/json',
          ...(isApiYiSeedream ? { 'Accept-Encoding': 'identity' } : {}),
        },
        body: JSON.stringify(body),
      })
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    if (error instanceof GenerationRequestError) return failWithAdminLog(error)
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    return failWithAdminLog(new GenerationRequestError(
      'network',
      '请求可能已送达并扣费，但浏览器没有收到生成结果',
      `${detail}。请先检查中转服务的消费记录、任务详情或生成历史，不要直接重复生成。常见原因是中转响应缺少跨域许可、连接中途断开或代理没有把图片响应返回给浏览器。`,
    ))
  }
  // Paid generation requests are never retried or split automatically. A rejected
  // batch stops here so one click can produce at most one billable API request.
  if (!response.ok) return failWithAdminLog(await createApiError(response))
  let payload: unknown
  try {
    payload = await response.json()
    lastPayload = payload
    taskId = extractTaskId(payload) || taskId
    if (taskId) {
      try { options.onTaskId?.(taskId) } catch { /* persistence must not interrupt a paid task */ }
    }
  } catch (error) {
    return failWithAdminLog(new GenerationRequestError(
      'platform',
      '请求可能已经扣费，但 API 返回了无法识别的数据',
      `${error instanceof Error ? error.message : String(error)}。请检查中转任务或生成历史，不要直接重试。`,
    ))
  }
  try {
    if (useHfsyNativeImage) {
      const failure = hfsyFailureDetail(payload)
      if (failure) throw new GenerationRequestError('api', 'HFSY 图片任务生成失败', failure, { requestId: taskId || undefined })
      payload = await resolveGenericProviderImageResult(settings, payload, options.signal, options.onProgress, true)
      lastPayload = payload
    } else if (useGrsaiUnifiedImage) {
      payload = await resolveGrsaiMediaResult(settings, payload, options.signal, '图片', options.onProgress)
      lastPayload = payload
      taskId = extractTaskId(payload) || taskId
    } else if (useVisionaryTaskImage) {
      payload = await resolveVisionaryImageResult(settings, payload, options.signal, options.onProgress)
      lastPayload = payload
    } else if (extractProviderTaskId(payload) && !extractProviderImages(payload).length) {
      payload = await resolveGenericProviderImageResult(settings, payload, options.signal, options.onProgress)
      lastPayload = payload
      taskId = extractProviderTaskId(payload) || taskId
    }
    const rows = (useVisionaryTaskImage ? extractVisionaryGeneratedImages(payload) : extractGeneratedImages(payload))
      .map((image) => ({ ...image, url: browserReadableImageResult(image.url, settings) }))
    if (!rows.length) {
      throw new GenerationRequestError(
        'platform',
        '请求可能已经扣费，但没有收到图片结果',
        '接口请求成功，但响应中没有可识别的图片。请检查中转任务或生成历史，不要直接重试。',
        { requestId: taskId || undefined },
      )
    }
    emitAdminLog('success', payload)
    // Preserve response order and cardinality. Some gateways intentionally reuse the
    // same proxy URL for separate batch items, so URL-based deduplication can lose images.
    return rows
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    return failWithAdminLog(error)
  }
}

export async function generateRemoteText(
  settings: ApiRequestSettings,
  prompt: string,
  options: TextGenerationOptions = {},
) {
  const startedAtMs = Date.now()
  const startedAt = new Date(startedAtMs).toISOString()
  const providerLabel = resolveProviderLabel(settings.baseUrl)
  const hfsy = isHfsyBaseUrl(settings.baseUrl)
  const stream = hfsy && options.stream === true
  const referenceImages = options.referenceImages?.map((source) => source.trim()).filter(Boolean) ?? []
  const userContent = referenceImages.length
    ? [
        { type: 'text' as const, text: prompt },
        ...referenceImages.map((url) => ({
          type: 'image_url' as const,
          image_url: { url },
        })),
      ]
    : prompt
  const requestForLog = {
    model: settings.model,
    messages: [{ role: 'user', content: typeof userContent === 'string' ? userContent : '[multimodal text + images]' }],
    stream,
    referenceImageCount: referenceImages.length,
  }

  const emitTextAdminLog = (resultType: 'success' | 'failed', resultPayload: unknown, taskId?: string) => {
    if (!options.captureAdminLog) return
    options.captureAdminLog({
      provider: providerLabel,
      taskId,
      model: settings.model,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      resultType,
      kind: 'text',
      requestJson: sanitizeAdminLogJson(requestForLog),
      resultJson: sanitizeAdminLogJson(resultPayload),
      resultUrls: [],
    })
  }

  let response: Response
  try {
    const nativeAnthropic = /api\.anthropic\.com/i.test(settings.baseUrl) || /\/messages\/?(?:[?#].*)?$/i.test(settings.baseUrl.trim())
    const openAiResponses = !nativeAnthropic && /\/responses\/?(?:[?#].*)?$/i.test(settings.baseUrl.trim())
    const grsai = isGrsaiBaseUrl(settings.baseUrl) ? new URL(normalizedApiBaseUrl(settings.baseUrl)) : undefined
    const nativeGemini = grsai && /^gemini-/i.test(settings.model) && /^\/v1beta(?:\/models(?:\/[^/]+)?)?\/?$/i.test(grsai.pathname)
    const geminiMethod = /:streamGenerateContent\/?$/i.test(grsai?.pathname ?? '') ? 'streamGenerateContent' : 'generateContent'
    const requestPath = nativeAnthropic ? 'messages' : openAiResponses ? 'responses' : 'chat/completions'
    const requestUrl = nativeGemini
      ? `${grsai.origin}/v1beta/models/${encodeURIComponent(settings.model)}:${geminiMethod}${geminiMethod === 'streamGenerateContent' ? '?alt=sse' : ''}`
      : grsai && requestPath === 'chat/completions' ? `${grsai.origin}/v1/chat/completions` : endpoint(settings.baseUrl, requestPath)
    const requestBody = nativeGemini
      ? {
          contents: [{ role: 'user', parts: [{ text: prompt }, ...await Promise.all(referenceImages.map(async (source) => {
            const blob = await readImageSourceBlob(source, options.signal)
            return { inlineData: { mimeType: blob.type, data: (await blobToDataUrl(blob)).split(',')[1] } }
          }))] }],
        }
      : nativeAnthropic
      ? {
          model: settings.model,
          max_tokens: 4096,
          messages: [{
            role: 'user',
            content: referenceImages.length
              ? [{ type: 'text', text: prompt }, ...referenceImages.map((url) => ({ type: 'image', source: { type: 'url', url } }))]
              : prompt,
          }],
        }
      : openAiResponses
        ? {
            model: settings.model,
            input: referenceImages.length
              ? [{ role: 'user', content: [{ type: 'input_text', text: prompt }, ...referenceImages.map((image_url) => ({ type: 'input_image', image_url }))] }]
              : prompt,
          }
        : { model: settings.model, messages: [{ role: 'user', content: userContent }], stream }
    response = await providerFetch(requestUrl, {
      method: 'POST',
      signal: options.signal,
      headers: compatibleApiHeaders(settings, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(requestBody),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    if (error instanceof GenerationRequestError) throw error
    const networkError = createNetworkError(error)
    emitTextAdminLog('failed', { error: networkError.detail, summary: networkError.message })
    throw networkError
  }
  if (!response.ok) {
    const apiError = await createApiError(response)
    emitTextAdminLog('failed', { error: apiError.detail, summary: apiError.message, status: apiError.status }, apiError.requestId)
    throw apiError
  }
  let payload: unknown
  try {
    const contentType = response.headers.get('content-type') || ''
    if (/text\/event-stream/i.test(contentType) || hfsy) {
      const body = await response.text()
      if (/text\/event-stream/i.test(contentType) || /^(?:data:|event:|:)/.test(body.trimStart())) {
        const events = body.split(/\r?\n\r?\n/).map((event) => event.split(/\r?\n/)
          .filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n'))
          .filter((event) => event && event !== '[DONE]')
        payload = events.flatMap((event) => { try { return [JSON.parse(event)] } catch { return [] } })
      } else {
        try { payload = JSON.parse(body) } catch (error) {
          if (/application\/(?:json|[^;]+\+json)/i.test(contentType)) throw error
          payload = body
        }
      }
    } else if (/application\/(?:json|[^;]+\+json)/i.test(contentType)) {
      payload = await response.json()
    } else {
      const text = await response.text()
      try { payload = JSON.parse(text) } catch { payload = text }
    }
  } catch (error) {
    const parseError = new GenerationRequestError('platform', 'API 返回了无法识别的数据', error instanceof Error ? error.message : String(error))
    emitTextAdminLog('failed', { error: parseError.detail, summary: parseError.message })
    throw parseError
  }
  if (hfsy) {
    const failure = (Array.isArray(payload) ? payload : [payload]).map(hfsyFailureDetail).find(Boolean)
    if (failure) {
      const taskId = extractTaskId(payload)
      emitTextAdminLog('failed', payload, taskId)
      throw new GenerationRequestError('api', 'HFSY 文本生成失败', failure, { requestId: taskId })
    }
  }
  const extractText = (value: unknown, depth = 0): string => {
    if (typeof value === 'string') return value
    if (!value || typeof value !== 'object' || depth > 7) return ''
    if (Array.isArray(value)) return value.map((item) => extractText(item, depth + 1)).filter(Boolean).join('')
    const record = value as Record<string, unknown>
    if (record.thought === true) return ''
    for (const key of ['output_text', 'text']) {
      const text = extractText(record[key], depth + 1)
      if (text) return text
    }
    const choices = Array.isArray(record.choices) ? record.choices : []
    if (choices.length) {
      const choice = choices[0]
      const text = choice && typeof choice === 'object' ? (() => {
        const item = choice as Record<string, unknown>
        return extractText((item.message as Record<string, unknown> | undefined)?.content ?? item.delta ?? item.text, depth + 1)
      })() : ''
      if (text) return text
    }
    const candidates = Array.isArray(record.candidates) ? record.candidates : []
    if (candidates.length) return extractText(candidates[0], depth + 1)
    for (const key of ['output', 'content', 'parts', 'result', 'data', 'message', 'delta']) {
      const text = extractText(record[key], depth + 1)
      if (text) return text
    }
    return ''
  }
  const responseEvents = Array.isArray(payload) ? payload.filter((event): event is Record<string, unknown> => Boolean(event) && typeof event === 'object') : []
  const completedResponseText = [...responseEvents].reverse().find((event) => event.type === 'response.output_text.done' && typeof event.text === 'string')?.text
  const responseDeltaText = responseEvents.filter((event) => event.type === 'response.output_text.delta' && typeof event.delta === 'string').map((event) => event.delta).join('')
  const content = (typeof completedResponseText === 'string' ? completedResponseText : responseDeltaText) || extractText(payload)
  if (!content.trim()) {
    const emptyError = new GenerationRequestError('platform', '模型没有返回文本内容', '接口请求成功，但响应中没有可用的文本字段。')
    emitTextAdminLog('failed', payload, extractTaskId(payload))
    throw emptyError
  }
  emitTextAdminLog('success', {
    id: payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>).id : undefined,
    content: content.trim().slice(0, 8_000),
    truncated: content.trim().length > 8_000,
  }, extractTaskId(payload))
  return content.trim()
}
