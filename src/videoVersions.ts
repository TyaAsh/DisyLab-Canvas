export type VideoResultBinding = { connectionId: string; modelId: string }

export type VideoVariant = {
  id: string
  mediaId?: string
  fileName: string
  createdAt: string
  taskId?: string
  sourceUrl?: string
  binding?: VideoResultBinding
  source?: 'generated' | 'local-upload'
}

export type PendingVideoResult = {
  id: string
  taskId?: string
  sourceUrl?: string
  binding: VideoResultBinding
}

type VideoVersions = {
  videoMediaId?: string
  videoUrl?: string
  videoGeneratedAt?: string
  videoSource?: VideoVariant['source']
  fileName?: string
  videoTaskId?: string
  videoResultBinding?: VideoResultBinding
  videoVariants?: VideoVariant[]
  activeVideoVariantId?: string
}

export function selectedVideoVariant(data: VideoVersions) {
  return data.videoVariants?.find((variant) => variant.id === data.activeVideoVariantId)
    ?? data.videoVariants?.find((variant) => data.videoMediaId ? variant.mediaId === data.videoMediaId : Boolean(data.videoUrl && variant.sourceUrl === data.videoUrl))
}

export function videoVariantSelection(variant: VideoVariant) {
  return {
    videoMediaId: variant.mediaId,
    videoUrl: variant.mediaId ? undefined : variant.sourceUrl,
    videoGeneratedAt: variant.createdAt || undefined,
    videoSource: variant.source ?? 'generated' as const,
    fileName: variant.fileName,
    videoTaskId: variant.taskId,
    videoResultBinding: variant.binding,
    activeVideoVariantId: variant.id,
  }
}

export function appendVideoVariant(data: VideoVersions, variant: VideoVariant): Partial<VideoVersions> {
  const previous = data.videoVariants ?? []
  if (previous.some(({ id }) => id === variant.id)) return {}
  const main = selectedVideoVariant(data)
  const legacyMain = !main && (data.videoMediaId || data.videoUrl)
    ? {
        id: `video-original-${data.videoMediaId ?? 'link'}`,
        mediaId: data.videoMediaId,
        sourceUrl: data.videoUrl?.startsWith('blob:') && data.videoMediaId ? undefined : data.videoUrl,
        fileName: data.fileName || 'disy-video.mp4',
        createdAt: data.videoGeneratedAt ?? '',
        taskId: data.videoTaskId,
        binding: data.videoResultBinding,
        source: data.videoSource,
      } : undefined
  return {
    ...(main || legacyMain ? { activeVideoVariantId: (main ?? legacyMain)?.id } : videoVariantSelection(previous[0] ?? variant)),
    videoVariants: [...(legacyMain ? [legacyMain] : []), ...previous, variant],
  }
}
