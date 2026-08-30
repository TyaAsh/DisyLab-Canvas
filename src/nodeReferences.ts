export type ConnectedTextReference = {
  mention: string
  name: string
  text: string
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
