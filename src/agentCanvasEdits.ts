export const MAX_CANVAS_TEXT_EDITS = 8
export const MAX_CANVAS_EDIT_TITLE = 80
export const MAX_CANVAS_EDIT_BODY = 12000

type TextFields = { title: string; body: string }
type CanvasEditNode = { id: string; data: TextFields & { kind: string; status?: string } }
export type AgentCanvasEditProposal = { nodeId: string; title?: string; body?: string }
export type AgentCanvasEdit = { nodeId: string; before: TextFields; after: Partial<TextFields>; included: boolean }
export type AgentCanvasEditDraft = {
  projectId: string
  canvasId: string
  status: 'pending' | 'draft' | 'applied' | 'reverted' | 'dismissed'
  edits: AgentCanvasEdit[]
  feedback?: string
}

export function resolveAgentTextEditTargets<N extends CanvasEditNode>(nodes: N[], selectedIds: string[], request: string) {
  const textNodes = nodes.filter((node) => node.data.kind === 'text')
  const named = Array.from(request.matchAll(/《([^》\r\n]+)》|@\[node:([^\]\r\n]+)\]/g))
  if (named.length) {
    const matches = named.map((match) => textNodes.filter((node) => match[2] ? node.id === match[2] : node.data.title === match[1]))
    if (matches.some((items) => items.length !== 1)) return []
    return Array.from(new Set(matches.flat()))
  }
  return textNodes.filter((node) => selectedIds.includes(node.id))
}

export function prepareAgentCanvasEdits<N extends CanvasEditNode>(targets: N[], proposals: AgentCanvasEditProposal[]): AgentCanvasEdit[] {
  const byId = new Map(targets.map((node) => [node.id, node]))
  const edits: AgentCanvasEdit[] = []
  const seen = new Set<string>()
  for (const proposal of proposals.slice(0, MAX_CANVAS_TEXT_EDITS)) {
    const node = byId.get(proposal.nodeId)
    if (!node || seen.has(node.id)) continue
    const before = { title: node.data.title, body: node.data.body }
    const after: Partial<TextFields> = {}
    if (typeof proposal.title === 'string' && proposal.title.trim() && proposal.title.length <= MAX_CANVAS_EDIT_TITLE && proposal.title.trim() !== before.title) after.title = proposal.title.trim()
    if (typeof proposal.body === 'string' && proposal.body.trim() && proposal.body.length <= MAX_CANVAS_EDIT_BODY && proposal.body !== before.body) after.body = proposal.body
    if (!Object.keys(after).length) continue
    seen.add(node.id)
    edits.push({ nodeId: node.id, before, after, included: true })
  }
  return edits
}

export function applyAgentCanvasEdits<N extends CanvasEditNode>(nodes: N[], edits: AgentCanvasEdit[], editingNodeId?: string | null) {
  const selected = edits.filter(({ included }) => included)
  if (!selected.length) return { ok: false, error: '请先勾选至少一项修改。' } as const
  if (selected.length > MAX_CANVAS_TEXT_EDITS) return { ok: false, error: '一次最多应用 8 个文本节点的修改。' } as const
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const patches = new Map<string, Partial<TextFields>>()
  for (const { nodeId, before, after } of selected) {
    const node = byId.get(nodeId)
    const name = before.title || '文本'
    if (!node || node.data.kind !== 'text') return { ok: false, error: `「${name}」已不在画布上。请取消勾选这一项，或重新生成方案。` } as const
    if (editingNodeId === nodeId || node.data.status === '生成中') return { ok: false, error: `「${name}」仍在编辑或生成中，请结束后再应用。` } as const
    if (node.data.title !== before.title || node.data.body !== before.body) return { ok: false, error: `「${name}」在方案生成后已修改。请取消勾选这一项，或基于新内容重新生成方案。` } as const
    if (patches.has(nodeId)) return { ok: false, error: `「${name}」包含重复修改，请重新生成方案。` } as const
    const normalized: Partial<TextFields> = {}
    if (after.title !== undefined) {
      if (typeof after.title !== 'string' || !after.title.trim() || after.title.length > MAX_CANVAS_EDIT_TITLE) return { ok: false, error: '标题需填写，最多 80 个字符。' } as const
      if (after.title.trim() !== before.title) normalized.title = after.title.trim()
    }
    if (after.body !== undefined) {
      if (typeof after.body !== 'string' || !after.body.trim() || after.body.length > MAX_CANVAS_EDIT_BODY) return { ok: false, error: '正文需填写，最多 12000 个字符。' } as const
      if (after.body !== before.body) normalized.body = after.body
    }
    if (!Object.keys(normalized).length) continue
    patches.set(nodeId, normalized)
  }
  if (!patches.size) return { ok: false, error: '勾选的内容与原文相同。' } as const
  return { ok: true, nodes: nodes.map((node) => patches.has(node.id) ? { ...node, data: { ...node.data, ...patches.get(node.id) } } : node), nodeIds: [...patches.keys()] } as const
}

export function revertAgentCanvasEdits<N extends CanvasEditNode>(nodes: N[], edits: AgentCanvasEdit[], editingNodeId?: string | null) {
  const patches = new Map<string, Partial<TextFields>>()
  const byId = new Map(nodes.map((node) => [node.id, node]))
  for (const { nodeId, before, after } of edits.filter(({ included }) => included)) {
    const node = byId.get(nodeId)
    if (!node || node.data.kind !== 'text' || node.data.status === '生成中' || editingNodeId === nodeId) {
      return { ok: false, error: `「${before.title || '文本'}」已删除、正在编辑或正在生成，无法撤回这批修改。` } as const
    }
    const restore: Partial<TextFields> = {}
    for (const field of ['title', 'body'] as const) {
      const written = after[field]
      if (written === undefined || written === before[field]) continue
      if (node.data[field] !== written) return { ok: false, error: `「${before.title || '文本'}」已有后续修改，未覆盖现有内容。` } as const
      restore[field] = before[field]
    }
    if (Object.keys(restore).length) patches.set(nodeId, restore)
  }
  if (!patches.size) return { ok: false, error: '没有可撤回的修改。' } as const
  return { ok: true, nodes: nodes.map((node) => patches.has(node.id) ? { ...node, data: { ...node.data, ...patches.get(node.id) } } : node) } as const
}
