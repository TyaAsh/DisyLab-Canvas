import type { SkillKind, SkillManifest } from './types'
import { skillKey } from './types'
import { getFilmSkillShowcase } from './manifests/official/film'

export type SkillCategory = {
  id: string
  label: string
  kind?: SkillKind
  skillKeys: string[]
  system: boolean
}

const STORAGE_KEY = 'disylab-skill-categories-v1'

export const defaultSkillCategories: SkillCategory[] = [
  { id: 'all', label: '推荐', skillKeys: [], system: true },
  { id: 'image', label: '图像创作', kind: 'image', skillKeys: [], system: true },
  { id: 'video', label: '视频制作', kind: 'video', skillKeys: [], system: true },
  { id: 'text', label: '文本与策划', kind: 'text', skillKeys: [], system: true },
]

export function loadSkillCategories(): SkillCategory[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as unknown
    if (!Array.isArray(parsed)) return defaultSkillCategories
    const categories = parsed.filter((item): item is SkillCategory => Boolean(item && typeof item === 'object' && typeof (item as SkillCategory).id === 'string' && typeof (item as SkillCategory).label === 'string' && Array.isArray((item as SkillCategory).skillKeys)))
    const defaultsById = new Map(defaultSkillCategories.map((item) => [item.id, item]))
    const restored = categories.map((item) => defaultsById.has(item.id) ? { ...defaultsById.get(item.id)!, ...item } : item)
    const missing = defaultSkillCategories.filter((item) => !restored.some((current) => current.id === item.id))
    const available = [...restored, ...missing].filter((item) => item.id !== 'composite' && item.kind !== 'composite' && item.id !== 'storyboard_comic')
    const all = available.find((item) => item.id === 'all')
    const first = all && all.label !== '全部 Skill' ? all : defaultSkillCategories[0]
    return [first, ...available.filter((item) => item.id !== 'all')]
  } catch {
    return defaultSkillCategories
  }
}

export function saveSkillCategories(categories: SkillCategory[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(categories))
}

export function categoryContainsSkill(category: SkillCategory, skill: SkillManifest) {
  if (category.id === 'all') return true
  if (category.kind) return category.kind === (getFilmSkillShowcase(skill) ? 'video' : skill.kind)
  return category.skillKeys.includes(skillKey(skill))
}

export function makeSkillCategory(label: string): SkillCategory {
  return { id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, label: label.trim(), skillKeys: [], system: false }
}
