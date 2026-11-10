export type WatermarkRegion = { x: number; y: number; width: number; height: number }

type PixelBounds = { left: number; top: number; right: number; bottom: number }

// Replace the rectangle from the pixels just outside its four edges.
export function fillWatermarkPatch(data: ImageData, { left, top, right, bottom }: PixelBounds) {
  const { width, height, data: pixels } = data
  const hasLeft = left > 0
  const hasRight = right < width
  const hasTop = top > 0
  const hasBottom = bottom < height
  if (!hasLeft && !hasRight && !hasTop && !hasBottom) return
  const regionWidth = right - left
  const regionHeight = bottom - top
  const feather = Math.max(1, Math.min(10, Math.floor(Math.min(regionWidth, regionHeight) / 8)))

  for (let y = top; y < bottom; y++) {
    const v = (y - top + .5) / regionHeight
    const topWeight = hasTop ? (1 - v) ** 2 : 0
    const bottomWeight = hasBottom ? v ** 2 : 0
    const row = y * width * 4
    for (let x = left; x < right; x++) {
      const u = (x - left + .5) / regionWidth
      const leftWeight = hasLeft ? (1 - u) ** 2 : 0
      const rightWeight = hasRight ? u ** 2 : 0
      const sum = leftWeight + rightWeight + topWeight + bottomWeight
      const distance = Math.min(
        hasLeft ? x - left + 1 : Infinity,
        hasRight ? right - x : Infinity,
        hasTop ? y - top + 1 : Infinity,
        hasBottom ? bottom - y : Infinity,
      )
      const blend = Math.min(1, distance / feather)
      const index = row + x * 4
      const l = row + Math.max(0, left - 1) * 4
      const r = row + Math.min(width - 1, right) * 4
      const t = (Math.max(0, top - 1) * width + x) * 4
      const b = (Math.min(height - 1, bottom) * width + x) * 4
      for (let channel = 0; channel < 3; channel++) {
        const fill = (pixels[l + channel] * leftWeight + pixels[r + channel] * rightWeight
          + pixels[t + channel] * topWeight + pixels[b + channel] * bottomWeight) / sum
        pixels[index + channel] = pixels[index + channel] * (1 - blend) + fill * blend
      }
    }
  }
}

export function drawWatermarkFrame(context: CanvasRenderingContext2D, source: CanvasImageSource, regions: WatermarkRegion[]) {
  const { width, height } = context.canvas
  context.clearRect(0, 0, width, height)
  context.drawImage(source, 0, 0, width, height)
  for (const region of regions) {
    const left = Math.max(0, Math.floor(region.x * width))
    const top = Math.max(0, Math.floor(region.y * height))
    const right = Math.min(width, Math.ceil((region.x + region.width) * width))
    const bottom = Math.min(height, Math.ceil((region.y + region.height) * height))
    if (right <= left || bottom <= top) continue
    const x = Math.max(0, left - 1)
    const y = Math.max(0, top - 1)
    const patch = context.getImageData(x, y, Math.min(width, right + 1) - x, Math.min(height, bottom + 1) - y)
    fillWatermarkPatch(patch, { left: left - x, top: top - y, right: right - x, bottom: bottom - y })
    context.putImageData(patch, x, y)
  }
}

// Only propose a compact, nearly neutral bright mark that stands out against
// an even corner. Multiple plausible marks are left to manual selection.
export function suggestWatermarkRegion(frames: ImageData[]): WatermarkRegion | undefined {
  if (!frames.length) return
  const { width, height } = frames[0]
  const frame = frames[0].data
  const bandX = Math.floor(width * .36)
  const bandY = Math.floor(height * .25)
  if (bandX < 10 || bandY < 10) return
  const candidates: WatermarkRegion[] = []
  const luma = (pixels: Uint8ClampedArray, i: number) => (pixels[i] * .2126 + pixels[i + 1] * .7152 + pixels[i + 2] * .0722)
  const isBrightNeutral = (pixels: Uint8ClampedArray, i: number) => pixels[i + 3] > 240
    && Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) > 166
    && Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) - Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) < 25
  for (const x0 of [0, width - bandX]) for (const y0 of [0, height - bandY]) {
    let left = width, right = -1, top = height, bottom = -1
    let count = 0, stable = 0
    for (let y = y0; y < y0 + bandY; y++) for (let x = x0; x < x0 + bandX; x++) {
      const i = (y * width + x) * 4
      if (!isBrightNeutral(frame, i)) continue
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y)
      count++
      if (frames.every(({ data }) => isBrightNeutral(data, i) && Math.abs(luma(data, i) - luma(frame, i)) < 25)) stable++
    }
    if (count < 10 || stable / count < .87) continue
    const w = right - left + 1
    const h = bottom - top + 1
    if (w < 5 || h < 3 || w > width * .33 || h > height * .155 || count / (w * h) < .08) continue
    const pad = Math.max(2, Math.round(Math.min(width, height) * .02))
    const x1 = Math.max(0, left - pad), x2 = Math.min(width, right + pad + 1)
    const y1 = Math.max(0, top - pad), y2 = Math.min(height, bottom + pad + 1)
    const backgrounds: number[] = []
    for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) {
      if (x > x1 && x < x2 - 1 && y > y1 && y < y2 - 1) continue
      if ((x === 0 && left === 0) || (y === 0 && top === 0) || (x === width - 1 && right === x) || (y === height - 1 && bottom === y)) continue
      backgrounds.push(luma(frame, (y * width + x) * 4))
    }
    backgrounds.sort((a, b) => a - b)
    if (backgrounds.length < 8 || backgrounds[Math.floor(backgrounds.length * .9)] > 143
      || backgrounds[Math.floor(backgrounds.length * .9)] - backgrounds[Math.floor(backgrounds.length * .1)] > 28) continue
    candidates.push({ x: x1 / width, y: y1 / height, width: (x2 - x1) / width, height: (y2 - y1) / height })
  }
  return candidates.length === 1 ? candidates[0] : undefined
}

export function sampleWatermarkFrame(source: CanvasImageSource, width: number, height: number) {
  const canvas = document.createElement('canvas')
  const scale = Math.min(1, 320 / Math.max(width, height))
  canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('无法读取画面')
  context.drawImage(source, 0, 0, canvas.width, canvas.height)
  return context.getImageData(0, 0, canvas.width, canvas.height)
}

export async function exportWatermarkImage(image: HTMLImageElement, regions: WatermarkRegion[]) {
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context || !canvas.width || !canvas.height) throw new Error('无法读取图片')
  drawWatermarkFrame(context, image, regions)
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('导出图片失败')), 'image/png'))
  return { blob, extension: 'png' }
}

function loadVideo(video: HTMLVideoElement, url: string, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: unknown) => {
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
      video.onloadeddata = null
      video.onerror = null
      if (error) reject(error)
      else resolve()
    }
    const abort = () => finish(signal.reason)
    const timeout = window.setTimeout(() => finish(new Error('读取视频超时')), 15000)
    video.onloadeddata = () => finish()
    video.onerror = () => finish(new Error('无法解码此视频'))
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    else video.src = url
  })
}

export async function exportWatermarkVideo(url: string, regions: WatermarkRegion[], signal: AbortSignal, onProgress: (percent: number) => void) {
  if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream || typeof AudioContext === 'undefined') {
    throw new Error('当前环境不支持本地视频导出')
  }
  const mimeType = ['video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type))
  if (!mimeType) throw new Error('当前环境缺少可用的视频编码器')

  const audio = new AudioContext()
  const video = document.createElement('video')
  video.preload = 'auto'
  video.playsInline = true
  let stream: MediaStream | undefined
  let recorder: MediaRecorder | undefined
  try {
    await audio.resume()
    signal.throwIfAborted()
    await loadVideo(video, url, signal)
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context || !canvas.width || !canvas.height) throw new Error('无法读取视频画面')
    stream = canvas.captureStream(30)
    const destination = audio.createMediaStreamDestination()
    audio.createMediaElementSource(video).connect(destination)
    destination.stream.getAudioTracks().forEach((track) => stream!.addTrack(track))
    const encoder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: Math.max(2_000_000, Math.min(32_000_000, canvas.width * canvas.height * 5)),
      audioBitsPerSecond: 160_000,
    })
    recorder = encoder
    const chunks: BlobPart[] = []
    let encodeError: Error | undefined
    const complete = new Promise<void>((resolve) => {
      encoder.onstop = () => resolve()
      encoder.onerror = () => { encodeError = new Error('视频编码失败'); resolve() }
      encoder.ondataavailable = ({ data }) => { if (data.size) chunks.push(data) }
    })

    drawWatermarkFrame(context, video, regions)
    encoder.start(300)
    await video.play()
    await new Promise<void>((resolve, reject) => {
      let frame = 0
      let lastTime = -1
      let lastChange = performance.now()
      const finish = (error?: unknown) => {
        cancelAnimationFrame(frame)
        signal.removeEventListener('abort', abort)
        video.removeEventListener('ended', ended)
        if (error) reject(error)
        else resolve()
      }
      const abort = () => finish(signal.reason)
      const ended = () => finish()
      const tick = (now: number) => {
        if (encodeError || video.error) { finish(encodeError ?? new Error('视频读取中断')); return }
        try {
          if (video.currentTime !== lastTime) {
            drawWatermarkFrame(context, video, regions)
            lastTime = video.currentTime
            lastChange = now
            if (Number.isFinite(video.duration)) onProgress(Math.min(99, Math.round(lastTime / video.duration * 100)))
          } else if (now - lastChange > 20000) {
            finish(new Error('视频处理已超时，请重新导出'))
            return
          }
        } catch (error) { finish(error); return }
        if (video.ended) finish()
        else frame = requestAnimationFrame(tick)
      }
      signal.addEventListener('abort', abort, { once: true })
      video.addEventListener('ended', ended, { once: true })
      if (signal.aborted) abort()
      else frame = requestAnimationFrame(tick)
    })
    if (encoder.state !== 'inactive') encoder.stop()
    await complete
    signal.throwIfAborted()
    if (encodeError) throw encodeError
    const type = (encoder.mimeType || mimeType).split(';')[0]
    const blob = new Blob(chunks, { type })
    if (!blob.size) throw new Error('导出文件为空，请重试')
    return { blob, extension: type === 'video/mp4' ? 'mp4' : 'webm' }
  } finally {
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    video.pause()
    video.removeAttribute('src')
    video.load()
    stream?.getTracks().forEach((track) => track.stop())
    await audio.close().catch(() => undefined)
  }
}
