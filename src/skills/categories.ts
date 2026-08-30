import type { SkillKind, SkillManifest } from './types'
import { skillKey } from './types'

export type SkillCategory = {
  id: string
  label: string
  kind?: SkillKind
  skillKeys: string[]
  system: boolean
}

const STORAGE_KEY = 'disylab-skill-categories-v1'
const ORDER_MIGRATION_KEY = 'disylab-skill-categories-composite-last-v1'

export const defaultSkillCategories: SkillCategory[] = [
  { id: 'all', label: '全部 Skill', skillKeys: [], system: true },
  { id: 'storyboard_comic', label: '漫画与故事板', kind: 'storyboard_comic', skillKeys: [], system: true },
  { id: 'image', label: '图像创作', kind: 'image', skillKeys: [], system: true },
  { id: 'video', label: '视频制作', kind: 'video', skillKeys: [], system: true },
  { id: 'text', label: '文本与策划', kind: 'text', skillKeys: [], system: true },
  { id: 'composite', label: '复合 Skill', kind: 'composite', skillKeys: [], system: true },
]

export function loadSkillCategories(): SkillCategory[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as unknown
    if (!Array.isArray(parsed)) return defaultSkillCategories
    const categories = parsed.filter((item): item is SkillCategory => Boolean(item && typeof item === 'object' && typeof (item as SkillCategory).id === 'string' && typeof (item as SkillCategory).label === 'string' && Array.isArray((item as SkillCategory).skillKeys)))
    const defaultsById = new Map(defaultSkillCategories.map((item) => [item.id, item]))
    const restored = categories.map((item) => defaultsById.has(item.id) ? { ...defaultsById.get(item.id)!, ...item } : item)
    const missing = defaultSkillCategories.filter((item) => !restored.some((current) => current.id === item.id))
    let ordered = [...restored, ...missing]
    const all = ordered.find((item) => item.id === 'all') ?? defaultSkillCategories[0]
    ordered = [all, ...ordered.filter((item) => item.id !== 'all')]
    if (localStorage.getItem(ORDER_MIGRATION_KEY) !== 'done') {
      const composite = ordered.find((item) => item.id === 'composite')
      ordered = [...ordered.filter((item) => item.id !== 'composite'), ...(composite ? [composite] : [])]
      localStorage.setItem(ORDER_MIGRATION_KEY, 'done')
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ordered))
    }
    return ordered
  } catch {
    return defaultSkillCategories
  }
}

export function saveSkillCategories(categories: SkillCategory[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(categories))
}

export function categoryContainsSkill(category: SkillCategory, skill: SkillManifest) {
  if (category.id === 'all') return true
  if (category.kind) return category.kind === skill.kind
  return category.skillKeys.includes(skillKey(skill))
}

export function makeSkillCategory(label: string): SkillCategory {
  return { id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, label: label.trim(), skillKeys: [], system: false }
}
