import { filmVideoSize, type FilmClip } from './filmProduction'

const filmFormats = ['video/mp4;codecs=avc1.42001f,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus']

export async function prepareFilmEditor() {
  const mimeType = typeof MediaRecorder === 'undefined' ? undefined : filmFormats.find((format) => MediaRecorder.isTypeSupported(format))
  if (!mimeType || !HTMLCanvasElement.prototype.captureStream || typeof AudioContext === 'undefined') {
    throw new Error('当前环境无法合成带音轨的视频，请使用 DisyLab 桌面版或支持视频编码的浏览器。')
  }
  const audio = new AudioContext()
  try {
    await audio.resume()
    return { mimeType, audio }
  } catch (error) {
    await audio.close()
    throw error
  }
}

function loadClip(video: HTMLVideoElement, url: string, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: unknown) => {
      window.clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
      video.onloadeddata = null
      video.onerror = null
      if (error) reject(error)
      else resolve()
    }
    const abort = () => finish(signal.reason)
    const timeout = window.setTimeout(() => finish(new Error('读取视频片段超时。')), 15000)
    signal.addEventListener('abort', abort, { once: true })
    video.onloadeddata = () => finish()
    video.onerror = () => finish(new Error('无法解码生成的视频片段。'))
    video.preload = 'auto'
    video.playsInline = true
    video.src = url
    if (signal.aborted) abort()
  })
}

export async function editFilmClips(clips: FilmClip[], ratio: string, height: number, editor: Awaited<ReturnType<typeof prepareFilmEditor>>, signal: AbortSignal, onProgress: (percent: number) => void) {
  const { audio, mimeType } = editor
  const canvas = document.createElement('canvas')
  const size = filmVideoSize(ratio, height)
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建视频合成画面。')
  const stream = canvas.captureStream(30)
  const audioDestination = audio.createMediaStreamDestination()
  audioDestination.stream.getAudioTracks().forEach((track) => stream.addTrack(track))
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 5000000, audioBitsPerSecond: 128000 })
  const chunks: BlobPart[] = []
  let encodeError: Error | undefined
  const complete = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve()
    recorder.onerror = () => { encodeError = new Error('视频合成编码失败。'); resolve() }
    recorder.ondataavailable = ({ data }) => { if (data.size) chunks.push(data) }
  })
  const video = document.createElement('video')
  const source = audio.createMediaElementSource(video)
  source.connect(audioDestination)
  let duration = 0
  const total = clips.reduce((sum, clip) => sum + clip.duration, 0)
  const draw = () => {
    const scale = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight)
    const width = video.videoWidth * scale
    const height = video.videoHeight * scale
    context.drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height)
  }
  try {
    for (const clip of clips) {
      signal.throwIfAborted()
      const url = URL.createObjectURL(clip.blob)
      try {
        await loadClip(video, url, signal)
        const seconds = Math.min(clip.duration, Number.isFinite(video.duration) ? video.duration : clip.duration)
        draw()
        if (recorder.state === 'paused') recorder.resume()
        if (recorder.state === 'inactive' && !encodeError) recorder.start(250)
        await video.play()
        await new Promise<void>((resolve, reject) => {
          let animation = 0
          const finish = (error?: unknown) => {
            cancelAnimationFrame(animation)
            clearTimeout(timeout)
            signal.removeEventListener('abort', abort)
            if (error) reject(error)
            else resolve()
          }
          const abort = () => finish(signal.reason)
          const timeout = window.setTimeout(() => finish(new Error('视频片段合成超时。')), (seconds + 20) * 1000)
          const tick = () => {
            if (encodeError) { finish(encodeError); return }
            draw()
            onProgress((duration + Math.min(seconds, video.currentTime)) / total * 100)
            if (video.ended || video.currentTime >= seconds) finish()
            else animation = requestAnimationFrame(tick)
          }
          signal.addEventListener('abort', abort, { once: true })
          if (signal.aborted) abort()
          else tick()
        })
        duration += seconds
        video.pause()
        if (recorder.state === 'recording') recorder.pause()
      } finally {
        video.pause()
        video.removeAttribute('src')
        video.load()
        URL.revokeObjectURL(url)
      }
    }
    if (recorder.state !== 'inactive') recorder.stop()
    await complete
    if (encodeError) throw encodeError
    const blob = new Blob(chunks, { type: mimeType.split(';')[0] })
    if (!blob.size) throw new Error('成片文件为空。')
    return { blob, duration }
  } finally {
    if (recorder.state !== 'inactive') recorder.stop()
    source.disconnect()
    stream.getTracks().forEach((track) => track.stop())
  }
}
