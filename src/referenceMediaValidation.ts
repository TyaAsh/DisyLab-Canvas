/*!
 * Copyright (c) 2026 DisyLab. All rights reserved.
 * SPDX-License-Identifier: LicenseRef-DisyLab-Proprietary
 */
export type ReferenceMedia = {
  kind: 'image' | 'video'
  url?: string
  mediaId?: string
  publicUrl?: string
}

export type MediaLimits = {
  types?: readonly string[]
  maxMB?: number
  ratio?: readonly [number, number]
  side?: readonly [number, number]
  minSide?: number
  pixels?: readonly [number, number]
  seconds?: readonly [number, number]
  fps?: readonly [number, number]
  roundFps?: boolean
  publicOnly?: boolean
  upload?: boolean
  requireReadable?: boolean
}

type MediaMetadata = {
  width?: number
  height?: number
  duration?: number
  fps?: number
  bytes?: number
  type?: string
}

const format = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
const formatRatio = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 })
const range = ([min, max]: readonly [number, number]) => `${format.format(min)} 到 ${format.format(max)}`

export function referenceMediaIssue(metadata: MediaMetadata, limits: MediaLimits) {
  const { width, height, duration, fps, bytes, type } = metadata
  if (limits.types && type && !limits.types.includes(type)) {
    const names = limits.types.map((mime) => mime.split('/')[1].replace('quicktime', 'MOV').toUpperCase())
    return `格式须为 ${names.join('、')}`
  }
  if (limits.maxMB && bytes !== undefined && bytes > limits.maxMB * 1024 * 1024) return `文件不能超过 ${limits.maxMB} MB（当前 ${format.format(bytes / 1024 / 1024)} MB）`
  if (limits.seconds && duration !== undefined && (duration < limits.seconds[0] || duration > limits.seconds[1])) return `时长须在 ${range(limits.seconds)} 秒之间（当前 ${format.format(duration)} 秒）`
  const normalizedFps = limits.roundFps && fps !== undefined ? Math.round(fps) : fps
  if (limits.fps && fps !== undefined && normalizedFps !== undefined && (normalizedFps < limits.fps[0] - 0.001 || normalizedFps > limits.fps[1] + 0.001)) {
    return `帧率须在 ${range(limits.fps)} FPS 之间（当前 ${formatRatio.format(fps)} FPS）`
  }
  if (width === undefined || height === undefined) return
  if (limits.ratio && (width / height < limits.ratio[0] || width / height > limits.ratio[1])) return `宽高比须在 ${limits.ratio.map((value) => formatRatio.format(value)).join(' 到 ')} 之间（当前 ${formatRatio.format(width / height)}）`
  const sides = limits.side
  if (sides && [width, height].some((side) => side < sides[0] || side > sides[1])) return `宽和高均须在 ${range(sides)} 像素之间（当前 ${width} × ${height}）`
  if (limits.minSide && Math.min(width, height) < limits.minSide) return `宽和高均不能小于 ${limits.minSide} 像素（当前 ${width} × ${height}）`
  if (limits.pixels && (width * height < limits.pixels[0] || width * height > limits.pixels[1])) return `总像素数须在 ${range(limits.pixels)} 之间（当前 ${format.format(width * height)} 像素）`
}

export async function readReferenceMediaMetadata(kind: ReferenceMedia['kind'], url: string, blob: Blob | undefined, signal: AbortSignal) {
  signal.throwIfAborted()
  const image = kind === 'image' ? new Image() : undefined
  const video = kind === 'video' ? document.createElement('video') : undefined
  const element = image ?? video!
  const objectUrl = blob && URL.createObjectURL(blob)
  let cleanup = () => {}
  try {
    return await new Promise<MediaMetadata>((resolve, reject) => {
      const fail = () => reject(new Error('无法读取素材'))
      const cancel = () => reject(signal.reason)
      const timeout = window.setTimeout(fail, objectUrl ? 10_000 : 3_500)
      const done = () => {
        const width = image?.naturalWidth ?? video?.videoWidth ?? 0
        const height = image?.naturalHeight ?? video?.videoHeight ?? 0
        if (!width || !height) return fail()
        resolve({
          width, height,
          duration: video && Number.isFinite(video.duration) ? video.duration : undefined,
        })
      }
      if (image) image.onload = done
      if (video) {
        video.preload = 'metadata'
        video.onloadedmetadata = done
      }
      element.onerror = fail
      signal.addEventListener('abort', cancel, { once: true })
      cleanup = () => {
        window.clearTimeout(timeout)
        signal.removeEventListener('abort', cancel)
        element.onerror = null
        if (image) image.onload = null
        if (video) video.onloadedmetadata = null
        element.removeAttribute('src')
        video?.load()
      }
      element.src = objectUrl || url
    })
  } finally {
    cleanup()
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }
}

export const HFSY_UPLOAD_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

export async function imageMimeFromBytes(blob: Blob) {
  const bytes = new Uint8Array(await blob.slice(0, 64).arrayBuffer())
  const header = String.fromCharCode(...bytes)
  if (header.startsWith('\x89PNG\r\n\x1a\n')) return 'image/png'
  if (header.startsWith('\xff\xd8\xff')) return 'image/jpeg'
  if (/^GIF8[79]a/.test(header)) return 'image/gif'
  if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') return 'image/webp'
  if (header.startsWith('BM')) return 'image/bmp'
  if (/^\s*(?:<\?xml[^?]*\?>\s*)?<svg(?:\s|\/?>)/i.test(header)) return 'image/svg+xml'
  if (header.startsWith('II*\0') || header.startsWith('MM\0*')) return 'image/tiff'
  if (header.slice(4, 8) === 'ftyp') {
    const brands = [header.slice(8, 12), ...header.slice(16).match(/.{4}/gs) ?? []]
    if (brands.some((brand) => brand === 'avif' || brand === 'avis')) return 'image/avif'
    if (brands.some((brand) => /^(?:heic|heix|hevc|hevx)$/.test(brand))) return 'image/heic'
  }
}

export async function videoMimeFromBytes(blob: Blob) {
  const header = String.fromCharCode(...new Uint8Array(await blob.slice(0, 256).arrayBuffer()))
  if (header.slice(4, 8) === 'ftyp') {
    const brand = header.slice(8, 12)
    if (brand === 'qt  ') return 'video/quicktime'
    if (/^3g[pegrs]/i.test(brand)) return 'video/3gpp'
    if (/^(?:isom|iso[2-9]|mp4[12]|avc1|M4V )$/.test(brand)) return 'video/mp4'
  }
  if (header.startsWith('\x1a\x45\xdf\xa3') && header.includes('webm')) return 'video/webm'
}

type IsoBox = { type: string; start: number; end: number }

function isoBoxHeader(view: DataView, offset: number, fileOffset: number, end: number): IsoBox | undefined {
  if (view.byteLength - offset < 8) return
  const type = String.fromCharCode(...Array.from({ length: 4 }, (_, i) => view.getUint8(offset + i + 4)))
  let length = view.getUint32(offset)
  let header = 8
  if (length === 1) {
    if (view.byteLength - offset < 16) return
    length = Number(view.getBigUint64(offset + 8))
    header = 16
  } else if (!length) length = end - fileOffset
  if (!Number.isSafeInteger(length) || length < header || length > end - fileOffset) return
  return { type, start: fileOffset + header, end: fileOffset + length }
}

function* isoBoxes(view: DataView, start: number, end: number) {
  for (let offset = start; offset < end;) {
    const box = isoBoxHeader(view, offset, offset, end)
    if (!box) return
    yield box
    offset = box.end
  }
}

function constantRateFromSampleTable(view: DataView) {
  const child = (parent: IsoBox, type: string) => [...isoBoxes(view, parent.start, parent.end)].find((box) => box.type === type)
  for (const track of isoBoxes(view, 0, view.byteLength)) {
    if (track.type !== 'trak') continue
    const media = child(track, 'mdia')
    if (!media) continue
    const handler = child(media, 'hdlr')
    if (!handler || handler.end - handler.start < 12 || view.getUint32(handler.start + 8) !== 0x76696465) continue
    const header = child(media, 'mdhd')
    const info = child(media, 'minf')
    const samples = info && child(info, 'stbl')
    const timing = samples && child(samples, 'stts')
    if (!header || !timing || timing.end - timing.start < 16) return
    const version = view.getUint8(header.start)
    const scaleOffset = header.start + (version === 1 ? 20 : 12)
    if (version > 1 || scaleOffset + 4 > header.end) return
    const entries = view.getUint32(timing.start + 4)
    if (entries !== 1 || view.getUint32(timing.start + 8) < 2) return
    const ticksPerFrame = view.getUint32(timing.start + 12)
    const scale = view.getUint32(scaleOffset)
    if (ticksPerFrame && scale) return scale / ticksPerFrame
  }
}

// ISO BMFF MP4/MOV. A variable-rate or fragmented file may have no single
// reliable frame rate. Leave those files for the model's validator.
export async function readIsoVideoFrameRate(blob: Blob) {
  for (let offset = 0, boxes = 0; offset < blob.size && boxes < 64; boxes++) {
    const view = new DataView(await blob.slice(offset, offset + 16).arrayBuffer())
    const box = isoBoxHeader(view, 0, offset, blob.size)
    if (!box) return
    if (box.type === 'moov') {
      if (box.end - box.start > 4 * 1024 * 1024) return
      return constantRateFromSampleTable(new DataView(await blob.slice(box.start, box.end).arrayBuffer()))
    }
    offset = box.end
  }
}

async function readRemotePrefix(url: string, signal: AbortSignal) {
  const maxBytes = 256 * 1024
  const response = await fetch(url, { headers: { Range: `bytes=0-${maxBytes - 1}` }, signal: AbortSignal.any([signal, AbortSignal.timeout(2500)]) })
  const range = /^bytes 0-(\d+)\/(\d+)$/i.exec(response.headers.get('Content-Range') ?? '')
  const end = Number(range?.[1])
  const bytes = Number(range?.[2])
  if (response.status !== 206 || !response.body || !range || end >= maxBytes || bytes <= end) {
    await response.body?.cancel().catch(() => {})
    return
  }
  const reader = response.body.getReader()
  const data = new Uint8Array(end + 1)
  let offset = 0
  try {
    while (offset < data.byteLength) {
      const { value, done } = await reader.read()
      if (done || value.byteLength > data.byteLength - offset) return
      data.set(value, offset)
      offset += value.byteLength
    }
    return { blob: new Blob([data]), bytes }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export async function checkReferenceMedia(
  entries: ReferenceMedia[],
  limitsFor: (entry: ReferenceMedia) => MediaLimits,
  loadBlob: (id: string) => Promise<Blob | undefined>,
  signal: AbortSignal,
  totals?: { maxImageBytes?: number; maxVideoSeconds?: number },
) {
  let imageBytes = 0
  let videoSeconds = 0
  let imageNumber = 0
  let videoNumber = 0
  const check = async (entry: ReferenceMedia) => {
    signal.throwIfAborted()
    const label = entry.kind === 'image' ? `参考图 ${++imageNumber}` : `参考视频 ${++videoNumber}`
    const limits = limitsFor(entry)
    if (limits.publicOnly && !entry.publicUrl) return `${label} 须使用可公开访问的链接`
    const url = entry.publicUrl || entry.url || ''
    const local = !entry.publicUrl
    let blob: Blob | undefined
    let sourceUnavailable = false
    if (local) {
      try {
        blob = entry.mediaId ? await loadBlob(entry.mediaId) : undefined
        const wantsBytes = limits.upload || limits.types || limits.maxMB || (entry.kind === 'image' && totals?.maxImageBytes)
        if (!blob && url && wantsBytes && !/^https?:/i.test(url)) {
          const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(2500)]) })
          if (response.ok) blob = await response.blob()
        }
      } catch {
        signal.throwIfAborted()
        sourceUnavailable = true
      }
    }
    if (!blob && !url && !sourceUnavailable) return `${label} 已丢失，请重新添加`
    const canReadFileInfo = limits.types || limits.maxMB || limits.fps || (entry.kind === 'image' && totals?.maxImageBytes)
    const prefix = !blob && /^https?:/i.test(url) && canReadFileInfo
      ? await readRemotePrefix(url, signal).catch(() => { signal.throwIfAborted(); return undefined }) : undefined
    const bytesForType = blob ?? prefix?.blob
    const type = bytesForType
      ? await (entry.kind === 'image' ? imageMimeFromBytes(bytesForType) : videoMimeFromBytes(bytesForType)).catch(() => undefined)
      : undefined
    const willConvert = limits.upload && (!type || !HFSY_UPLOAD_IMAGE_TYPES.includes(type))
    const bytes = willConvert ? undefined : blob?.size ?? (type ? prefix?.bytes : undefined)
    const decodedBlob = blob && type && type !== blob.type ? blob.slice(0, blob.size, type) : blob
    const issueFromBytes = referenceMediaIssue({ bytes, type: willConvert ? undefined : type }, limits)
    if (issueFromBytes) return `${label}的${issueFromBytes}`
    const needsMetadata = limits.requireReadable || limits.ratio || limits.side || limits.minSide || limits.pixels || limits.seconds
      || (entry.kind === 'video' && totals?.maxVideoSeconds)
    const metadata: MediaMetadata = needsMetadata && (url || blob) ? await readReferenceMediaMetadata(entry.kind, url, decodedBlob, signal).catch(() => {
      signal.throwIfAborted()
      return {}
    }) : {}
    if (limits.requireReadable && (!metadata.width || !metadata.height || !metadata.duration)) return `${label}无法读取视频规格，请重新添加可播放的视频文件`
    if (limits.fps && bytesForType && (type === 'video/mp4' || type === 'video/quicktime')) {
      metadata.fps = await readIsoVideoFrameRate(bytesForType).catch(() => undefined)
    }
    const issue = referenceMediaIssue(metadata, limits)
    if (issue) return `${label}的${issue}`
    if (entry.kind === 'image') imageBytes += bytes ?? 0
    if (entry.kind === 'video') videoSeconds += metadata.duration ?? 0
  }
  // Bound concurrent media decodes for models that accept dozens of references.
  for (let index = 0; index < entries.length; index += 4) {
    const results = await Promise.all(entries.slice(index, index + 4).map(check))
    const firstIssue = results.find(Boolean)
    if (firstIssue) return firstIssue
  }
  if (totals?.maxImageBytes && imageBytes > totals.maxImageBytes) return `参考图总大小不能超过 ${format.format(totals.maxImageBytes / 1024 ** 2)} MB（当前 ${format.format(imageBytes / 1024 ** 2)} MB）`
  if (totals?.maxVideoSeconds && videoSeconds > totals.maxVideoSeconds) return `参考视频总时长不能超过 ${totals.maxVideoSeconds} 秒（当前 ${format.format(videoSeconds)} 秒）`
}
