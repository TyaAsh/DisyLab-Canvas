export type ConnectedTextReference = {
  mention: string
  name: string
  text: string
}

export function nodesWithGroupChildren<T extends { id: string; parentId?: string }>(nodes: T[], ids: Iterable<string>) {
  const included = new Set(ids)
  const children = new Map<string, string[]>()
  for (const { id, parentId } of nodes) {
    if (!parentId) continue
    const siblings = children.get(parentId)
    if (siblings) siblings.push(id)
    else children.set(parentId, [id])
  }
  const pending = [...included]
  for (let index = 0; index < pending.length; index++) {
    for (const child of children.get(pending[index]) ?? []) {
      if (included.has(child)) continue
      included.add(child)
      pending.push(child)
    }
  }
  return nodes.filter(({ id }) => included.has(id))
}

/** Expands internal canvas tokens into provider-readable labels and appends the
 * complete upstream text so image/video/text models receive the actual content. */
export function expandConnectedTextReferences(prompt: string, references: ConnectedTextReference[]) {
  const usable = references.filter((reference) => reference.text.trim())
  const expandedPrompt = usable.reduce((value, reference) => value.replaceAll(reference.mention, `@${reference.name}`), prompt)
    .replace(/@\[node:[^\]]+\]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  const guide = usable.length
    ? `参考文本：\n${usable.map((reference) => `@${reference.name}\n${reference.text.trim()}`).join('\n\n')}`
    : ''
  return { prompt: expandedPrompt, guide }
}

export function resolveVideoFrameSources<T extends { url?: string; mediaId?: string }>(slots: readonly T[], connected: readonly T[]) {
  const hasSource = (entry: T) => Boolean(entry.url || entry.mediaId)
  const filled = slots.filter(hasSource)
  const candidates = connected.filter((entry) => hasSource(entry) && !filled.some((slot) =>
    Boolean(entry.mediaId && entry.mediaId === slot.mediaId || entry.url && entry.url === slot.url)))
  return [...slots.map((entry) => hasSource(entry) ? entry : candidates.shift()).filter((entry): entry is T => Boolean(entry)), ...candidates]
}

type VideoReferenceData = {
  body: string; promptText?: string; videoReferenceOrder?: string[]
  referenceImages?: Array<{ id: string; url?: string; mediaId?: string }>
  videoReferenceVideos?: Array<{ id: string; url?: string; mediaId?: string }>
  videoFirstFrameUrl?: string; videoFirstFrameMediaId?: string
  videoLastFrameUrl?: string; videoLastFrameMediaId?: string
  videoReferenceImageUrl?: string; videoReferenceImageMediaId?: string; videoReferenceImageName?: string
  videoReferenceUrl?: string; videoReferenceMediaId?: string; videoReferenceFileName?: string
}

/** Clear both transient URLs and durable IDs, including legacy slot aliases. */
export function clearVideoReference<T extends VideoReferenceData>(data: T, reference: { id: string; mention: string; url?: string; mediaId?: string }): T {
  const same = (entry: { url?: string; mediaId?: string }) => Boolean(reference.mediaId && reference.mediaId === entry.mediaId || reference.url && reference.url === entry.url)
  const slot = ['video-first-frame', 'video-last-frame', 'video-reference-image', 'video-reference-video'].includes(reference.id)
  const remove = (entry: { id: string; url?: string; mediaId?: string }) => entry.id !== reference.id && !(slot && same(entry))
  const removedIds = new Set([reference.id, ...(data.referenceImages ?? []).filter(entry => !remove(entry)).map(entry => entry.id), ...(data.videoReferenceVideos ?? []).filter(entry => !remove(entry)).map(entry => entry.id)])
  const clearPrimary = reference.id === 'video-reference-image' || !slot && same({ url: data.videoReferenceImageUrl, mediaId: data.videoReferenceImageMediaId })
  return { ...data, body: data.body.replaceAll(reference.mention, '').replace(/[ \t]{2,}/g, ' ').trimStart(), promptText: undefined,
    videoReferenceOrder: data.videoReferenceOrder?.filter(id => !removedIds.has(id)),
    referenceImages: data.referenceImages?.filter(remove), videoReferenceVideos: data.videoReferenceVideos?.filter(remove),
    ...(reference.id === 'video-first-frame' ? { videoFirstFrameUrl: undefined, videoFirstFrameMediaId: undefined } : {}),
    ...(reference.id === 'video-last-frame' ? { videoLastFrameUrl: undefined, videoLastFrameMediaId: undefined } : {}),
    ...(clearPrimary ? { videoReferenceImageUrl: undefined, videoReferenceImageMediaId: undefined, videoReferenceImageName: undefined } : {}),
    ...(reference.id === 'video-reference-video' ? { videoReferenceUrl: undefined, videoReferenceMediaId: undefined, videoReferenceFileName: undefined } : {}),
  }
}
