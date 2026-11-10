import { parseDocument } from 'yaml'
import { parseSkillManifest, skillManifestSchema } from './manifestSchema'
import type { SkillManifest } from './types'

const MAX_SKILL_BYTES = 256 * 1024
const forbidden = new Set(['baseurl', 'apikey', 'headers', 'endpoint', 'fetch', 'script', 'adapter', 'default_params'])

function rejectForbidden(value: unknown, path = 'manifest') {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (forbidden.has(key.toLowerCase())) throw new Error(`${path}.${key} 是禁止字段`)
    rejectForbidden(child, `${path}.${key}`)
  }
}

export function isSkillImportFile(file: File) {
  return /^skill\.md$/i.test(file.name) || /\.json$/i.test(file.name)
}

function importSkillMarkdown(text: string): SkillManifest {
  const input = text.replace(/^\uFEFF/, '')
  const header = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(input)
  if (!header) throw new Error('SKILL.md 开头需要用 --- 包住 name 和 description。')
  let fields: unknown
  try {
    const document = parseDocument(header[1])
    if (document.errors.length || document.warnings.length) throw new Error()
    fields = document.toJS({ mapAsMap: true, maxAliasCount: 0 })
  } catch {
    throw new Error('SKILL.md 顶部的 YAML 格式无效。')
  }
  const name: unknown = fields instanceof Map ? fields.get('name') : undefined
  const description: unknown = fields instanceof Map ? fields.get('description') : undefined
  if (typeof name !== 'string' || name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new Error('name 须为 1–64 个小写英文字母、数字或连字符，例如 creative-brief。')
  }
  if (typeof description !== 'string' || !description.trim() || description.trim().length > 1024) {
    throw new Error('description 需要填写 1–1024 字符的用途说明。')
  }
  const instructions = input.slice(header[0].length).trim()
  if (!instructions || instructions.length > 20000) throw new Error('请在 YAML 后填写 1–20,000 字符的执行说明。')
  const now = Date.now()
  return parseSkillManifest({
    id: 'user.markdown.' + name, slug: name, version: '1.0.0',
    name, description: description.trim(), kind: 'text', execution: 'configured', source: 'user',
    enabled: true, parameters: [{ name: 'subject', label: '本次任务', type: 'string', required: true, bind: 'prompt' }],
    inputs: [], output: { name: 'result', type: 'text' },
    template: { prompt: instructions, format: 'plain' },
    capability: { supportedModes: [], allowedModelCapabilities: ['text'] },
    createdAt: now, updatedAt: now,
  })
}

export async function importSkillFile(file: File, fromFolder = false): Promise<SkillManifest | null> {
  if (!isSkillImportFile(file)) throw new Error('请选择 SKILL.md 或 DisyLab JSON 文件。')
  const ordinaryJson = fromFolder && /\.json$/i.test(file.name) && !/\.disy-skill\.json$/i.test(file.name)
  if (file.size > MAX_SKILL_BYTES) {
    if (ordinaryJson) return null
    throw new Error(file.name + ' 超过 256 KB。')
  }
  if (/^skill\.md$/i.test(file.name)) return importSkillMarkdown(await file.text())

  let value: unknown
  try { value = JSON.parse((await file.text()).replace(/^\uFEFF/, '')) } catch {
    if (ordinaryJson) return null
    throw new Error(file.name + ' 不是有效 JSON。')
  }
  if (ordinaryJson && (!value || typeof value !== 'object' || !('slug' in value) || !('template' in value))) return null
  rejectForbidden(value)
  const checked = skillManifestSchema.safeParse(value)
  if (!checked.success) {
    const issue = checked.error.issues[0]
    throw new Error('DisyLab JSON 字段校验失败：' + (issue.path.join('.') || '文件结构') + '。')
  }
  const parsed = checked.data
  if (parsed.kind === 'composite') throw new Error(`${file.name} 是复合 Skill，当前技能库已不再收录`)
  const now = Date.now()
  return parseSkillManifest({
    ...parsed, id: parsed.source === 'official' ? `user.${crypto.randomUUID()}` : parsed.id,
    source: 'user', createdAt: parsed.createdAt || now, updatedAt: now,
  }) as SkillManifest
}
