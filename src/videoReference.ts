export type VideoReferenceSource = { name: string; url?: string; mediaId?: string }
export type VideoMetadata = { width: number; height: number; seconds: number; bytes?: number; type?: string }
export type VideoReferenceRules = {
  maxCount?: number
  minSeconds?: number
  maxSeconds?: number
  maxTotalSeconds?: number
  seedanceDimensions?: boolean
  mp4OrMov?: boolean
  maxBytes?: number
  localMaxBytes?: number
}

export function checkVideoReferences(
  rules: VideoReferenceRules | undefined,
  videos: Array<{ name: string; metadata?: VideoMetadata; local?: boolean }>,
) {
  if (!rules || !videos.length) return []
  if (rules.maxCount === 0) return ['当前模型不接收参考视频，请移除视频引用或切换模型。']
  const issues: string[] = []
  if (rules.maxCount !== undefined && videos.length > rules.maxCount) {
    issues.push(`当前模型最多接收 ${rules.maxCount} 个参考视频，已添加 ${videos.length} 个。`)
  }
  let totalSeconds = 0
  for (const { name, metadata, local } of videos) {
    if (!metadata) continue
    const { width, height, seconds, bytes, type } = metadata
    const details: string[] = []
    totalSeconds += seconds
    if (rules.seedanceDimensions) {
      const ratio = width / height
      const pixels = width * height
      if (Math.min(width, height) < 300 || Math.max(width, height) > 6000 || ratio < 0.4 || ratio > 2.5 || pixels < 407696 || pixels > 8295044) {
        details.push(`尺寸 ${width}×${height}（${pixels.toLocaleString('zh-CN')} 像素，宽高比 ${ratio.toFixed(2)}）。要求每边 300–6000 px、总像素 407,696–8,295,044、宽高比 0.4–2.5`)
      }
    }
    if (rules.minSeconds !== undefined && rules.maxSeconds !== undefined && (seconds < rules.minSeconds || seconds > rules.maxSeconds)) {
      details.push(`时长 ${Number(seconds.toFixed(2))} 秒，要求 ${rules.minSeconds}–${rules.maxSeconds} 秒`)
    }
    if (rules.mp4OrMov && type && !['video/mp4', 'video/quicktime'].includes(type)) {
      details.push('格式须为 MP4 或 MOV')
    }
    if (local && rules.localMaxBytes && bytes !== undefined && bytes > rules.localMaxBytes) {
      details.push(`文件为 ${(bytes / 1024 ** 2).toFixed(1)} MB，本地参考视频上传上限为 ${rules.localMaxBytes / 1024 ** 2} MB`)
    } else if (rules.maxBytes && bytes !== undefined && bytes > rules.maxBytes) {
      details.push(`文件为 ${(bytes / 1_000_000).toFixed(1)} MB，模型上限为 ${rules.maxBytes / 1_000_000} MB`)
    }
    if (details.length) issues.push(`“${name}”${details.join('；')}。请更换素材或调整后重新添加。`)
  }
  if (rules.maxTotalSeconds && totalSeconds > rules.maxTotalSeconds) {
    issues.push(`参考视频总时长 ${Number(totalSeconds.toFixed(2))} 秒，当前模型最多接收 ${rules.maxTotalSeconds} 秒。`)
  }
  return issues
}

export function unreadableVideoReferenceIssue(videos: Array<{ name: string; metadata?: VideoMetadata; local?: boolean }>) {
  const names = videos.filter(({ metadata, local }) => local && !metadata).map(({ name }) => name)
  return names.length ? `无法读取本地参考视频“${names.join('、')}”的规格，请重新添加可播放的视频文件。` : undefined
}

export function videoFileType(source: Blob, name: string) {
  if (source.type && source.type !== 'application/octet-stream') return source.type
  if (/\.(mp4|m4v)$/i.test(name)) return 'video/mp4'
  if (/\.mov$/i.test(name)) return 'video/quicktime'
  if (/\.webm$/i.test(name)) return 'video/webm'
  return undefined
}

export async function readVideoMetadata(source: Blob | string, name: string): Promise<VideoMetadata | undefined> {
  const blob = typeof source === 'string' ? undefined : source
  const url = blob ? URL.createObjectURL(blob) : source as string
  const video = document.createElement('video')
  video.preload = 'metadata'
  try {
    return await new Promise((resolve) => {
      const finish = (metadata?: VideoMetadata) => {
        clearTimeout(timer)
        resolve(metadata)
      }
      const timer = window.setTimeout(finish, 6000)
      video.onerror = () => finish()
      video.onloadedmetadata = () => {
        const { videoWidth: width, videoHeight: height, duration: seconds } = video
        finish(width && height && Number.isFinite(seconds) && seconds > 0
          ? { width, height, seconds, bytes: blob?.size, type: blob && videoFileType(blob, name) }
          : undefined)
      }
      video.src = url
    })
  } finally {
    video.onerror = video.onloadedmetadata = null
    video.removeAttribute('src')
    video.load()
    if (blob) URL.revokeObjectURL(url)
  }
}
