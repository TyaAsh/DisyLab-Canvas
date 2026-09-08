import type { ModelCapability } from './store'

export type CatalogModel = { id: string; name: string; capability: ModelCapability }

export function inferModelCapability(modelId: string): ModelCapability {
  if (/audio|suno|tts|voice|speech|music/i.test(modelId)) return 'audio'
  // Image markers must run before generic gpt/gemini chat families.
  if (/image|seedream|imagen|flux|banana|dall-e|gpt-image/i.test(modelId)) return 'image'
  if (/video|seedance|sora|veo|kling|runway|hailuo|happyhorse|wan(?:2\.\d)?|(?:^|[-_.])sd-2(?:[.\d-]|$)|(?:^|[-_.])(?:t2v|i2v|r2v)(?:[-_.]|$)/i.test(modelId)) return 'video'
  // Providers often omit modality metadata for chat models; classify known LLM families as text.
  if (/(?:^|[-_.\/])(?:gpt|o[1-9]|claude|gemini|deepseek|qwen|glm|moonshot|kimi|mistral|llama|grok|command-r)(?:[-_.\/]|$)/i.test(modelId)
    || /chat|instruct|completion/i.test(modelId)) return 'text'
  return 'unknown'
}

function readModelAvailability(item: Record<string, unknown>) {
  if (item.available === false || item.enabled === false || item.is_available === false || item.isAvailable === false) return false
  if (item.disabled === true || item.deprecated === true || item.retired === true) return false
  const status = JSON.stringify([item.status, item.state, item.availability]).toLowerCase()
  return !/not[_ -]?support|unsupported|disable|disabled|closed|offline|unavailable|deprecated|retired|inactive|not[_ -]?found|不存在|不支持|已下线|关闭|不可用|停用|废弃/.test(status)
}

function readDeclaredCapability(item: Record<string, unknown>, modelId: string): ModelCapability {
  const declared = [item.capability, item.type, item.task, item.mode, item.modalities]
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value): value is string => typeof value === 'string').join(' ').toLowerCase()
  if (/image|vision-generation|text-to-image/.test(declared)) return 'image'
  if (/video|text-to-video|image-to-video/.test(declared)) return 'video'
  if (/audio|speech|music|text-to-speech|tts/.test(declared)) return 'audio'
  if (inferModelCapability(modelId) === 'video') return 'video'
  if (/text|chat|completion|language/.test(declared)) return 'text'
  return inferModelCapability(modelId)
}

export function parseRemoteModelCatalog(payload: unknown): CatalogModel[] {
  const findRows = (value: unknown, depth = 0): unknown[] => {
    if (Array.isArray(value)) return value
    if (!value || typeof value !== 'object' || depth > 4) return []
    const record = value as Record<string, unknown>
    for (const key of ['data', 'models', 'items', 'result', 'list', 'model_list', 'modelList']) {
      const rows = findRows(record[key], depth + 1)
      if (rows.length) return rows
    }
    return []
  }
  const rows = findRows(payload)
  const models = rows.map((model) => {
    if (typeof model === 'string') return { id: model.trim(), name: model.trim(), capability: inferModelCapability(model) }
    if (!model || typeof model !== 'object') return { id: '', name: '', capability: 'unknown' as const }
    const item = model as Record<string, unknown>
    const id = String(item.id ?? item.model ?? item.model_id ?? item.model_name ?? item.slug ?? item.key ?? '').trim()
    const name = String(item.name ?? item.display_name ?? item.displayName ?? item.title ?? id).trim()
    return readModelAvailability(item) ? { id, name, capability: readDeclaredCapability(item, id) } : { id: '', name: '', capability: 'unknown' as const }
  }).filter((model) => model.id)
  return Array.from(new Map(models.map((model) => [model.id, model])).values()).sort((a, b) => a.name.localeCompare(b.name))
}

export function parseHfsyMarketplaceCatalog(payload: unknown): CatalogModel[] {
  if (!payload || typeof payload !== 'object') return []
  const root = payload as { success?: unknown; data?: unknown }
  if (root.success !== true || !Array.isArray(root.data)) return []
  const models: CatalogModel[] = []
  for (const row of root.data) {
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    const id = String(item.model_name ?? item.model ?? item.id ?? '').trim()
    const tags = Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === 'string') : typeof item.tags === 'string' ? [item.tags] : []
    const groups = Array.isArray(item.enable_groups) ? item.enable_groups.filter((group) => typeof group === 'string' && group.trim()) : []
    const endpoints = Array.isArray(item.supported_endpoint_types) ? item.supported_endpoint_types : []
    const tagText = tags.join(' ')
    const capability: ModelCapability = /视频/.test(tagText) ? 'video' : /图片|图像/.test(tagText) ? 'image' : /文本/.test(tagText) ? 'text' : 'unknown'
    if (!id || capability === 'unknown' || groups.length === 0 || endpoints.length === 0 || !readModelAvailability(item)) continue
    models.push({ id, name: id, capability })
  }
  return Array.from(new Map(models.map((model) => [model.id, model])).values()).sort((a, b) => a.name.localeCompare(b.name))
}
