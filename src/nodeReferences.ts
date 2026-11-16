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
