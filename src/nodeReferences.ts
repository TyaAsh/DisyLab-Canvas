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
