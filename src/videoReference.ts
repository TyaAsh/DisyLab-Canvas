export type VideoMetadata = { width: number; height: number; seconds: number; bytes?: number; type?: string }
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
