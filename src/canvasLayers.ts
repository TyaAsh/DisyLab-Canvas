export type CanvasLayerMove = { sourceId: string; targetId: string; placement: 'before' | 'after' }

export function moveCanvasLayer<Node extends { id: string; parentId?: string }>(nodes: Node[], move: CanvasLayerMove): Node[] {
  const { sourceId, targetId, placement } = move
  if (sourceId === targetId) return nodes
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const source = byId.get(sourceId)
  const target = byId.get(targetId)
  if (!source || !target || (source.parentId ?? '') !== (target.parentId ?? '')) return nodes

  const byParent = new Map<string | undefined, Node[]>()
  for (const node of nodes) {
    const parent = node.parentId && byId.has(node.parentId) ? node.parentId : undefined
    const siblings = byParent.get(parent) ?? []
    siblings.push(node)
    byParent.set(parent, siblings)
  }
  const parent = source.parentId && byId.has(source.parentId) ? source.parentId : undefined
  const original = byParent.get(parent)!
  const siblings = original.filter((node) => node.id !== sourceId)
  const targetIndex = siblings.findIndex((node) => node.id === targetId)
  // The layers panel shows each set of siblings from front to back.
  siblings.splice(targetIndex + (placement === 'before' ? 1 : 0), 0, source)
  if (siblings.every((node, index) => node === original[index])) return nodes
  byParent.set(parent, siblings)

  const ordered: Node[] = []
  const seen = new Set<string>()
  const append = (node: Node) => {
    if (seen.has(node.id)) return
    seen.add(node.id)
    ordered.push(node)
    for (const child of byParent.get(node.id) ?? []) append(child)
  }
  // React Flow requires a group to precede its descendants.
  for (const node of byParent.get(undefined) ?? []) append(node)
  for (const node of nodes) append(node)
  return ordered
}
