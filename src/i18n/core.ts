import OpenCC from 'opencc-js/cn2t'
import english from '../locales/en.json'

export type Locale = 'zh-CN' | 'zh-TW' | 'en'
export const LANGUAGE_KEY = 'disylab.language.v1'
export const LANGUAGES: ReadonlyArray<{ value: Locale; label: string; detail: string }> = [
  { value: 'zh-CN', label: '简体中文', detail: 'Simplified Chinese' },
  { value: 'zh-TW', label: '繁體中文', detail: 'Traditional Chinese' },
  { value: 'en', label: 'English', detail: '英文' },
]
const validLocale = (value: unknown): value is Locale => value === 'zh-CN' || value === 'zh-TW' || value === 'en'
function readLocale(): Locale {
  try { const saved = localStorage.getItem(LANGUAGE_KEY); if (validLocale(saved)) return saved } catch { /* Storage may be unavailable. */ }
  return 'zh-CN'
}
let locale = readLocale()
const listeners = new Set<() => void>()
const traditional = OpenCC.Converter({ from: 'cn', to: 'twp' })
const catalog = english as Record<string, string>
const cache = new Map<string, string>()
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// A template must contain a meaningful UI phrase. Do not match arbitrary names
// against broad fragments such as “{0}的{1}”.
const patterns = Object.entries(catalog).filter(([key]) => /\{\d+\}/.test(key) && (key.replace(/\{\d+\}/g, '').match(/[\u3400-\u9fff]/g)?.length ?? 0) >= 2).map(([source, target]) => {
  const slots: number[] = [], parts: string[] = []
  let end = 0
  for (const match of source.matchAll(/\{(\d+)\}/g)) {
    parts.push(escape(source.slice(end, match.index)), '(.*?)'); slots.push(Number(match[1])); end = match.index! + match[0].length
  }
  parts.push(escape(source.slice(end)))
  return { source, target, slots, expression: new RegExp(`^${parts.join('')}$`, 's') }
}).sort((left, right) => right.source.replace(/\{\d+\}/g, '').length - left.source.replace(/\{\d+\}/g, '').length)

export const getLocale = () => locale
export const subscribeLocale = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export function setLocale(next: Locale) {
  if (!validLocale(next) || next === locale) return
  locale = next
  try { localStorage.setItem(LANGUAGE_KEY, next) } catch { /* Language still changes for this session. */ }
  applyDocumentLocale()
  for (const listener of listeners) listener()
}
export function applyDocumentLocale() {
  if (typeof document === 'undefined') return
  document.documentElement.lang = locale
  document.documentElement.dataset.locale = locale
}
export const getIntlLocale = () => locale === 'en' ? 'en-US' : locale

/** Only product-owned UI passes here. User content is excluded at its rendering boundary. */
export function translateUi(source: string, language: Locale = locale): string {
  if (language === 'zh-CN' || !/[\u3400-\u9fff]/.test(source)) return source
  const cacheKey = language + '\0' + source
  const known = cache.get(cacheKey)
  if (known !== undefined) return known
  const normalized = source.replace(/\s+/g, ' ').trim()
  let output: string | undefined
  if (language === 'zh-TW') output = traditional(source).replaceAll('引數', '參數')
  else {
    output = catalog[normalized]
    if (output === undefined) for (const pattern of patterns) {
      const matches = pattern.expression.exec(normalized)
      if (!matches) continue
      const values = new Map(pattern.slots.map((slot, index) => [slot, matches[index + 1]]))
      output = pattern.target.replace(/\{(\d+)\}/g, (_, slot) => values.get(Number(slot)) ?? '')
      break
    }
    if (output !== undefined) output = (source.match(/^\s*/)?.[0] ?? '') + output + (source.match(/\s*$/)?.[0] ?? '')
  }
  // Summaries assembled from several expressions have no single literal key.
  // Translate numeric display units without touching embedded reference names.
  if (language === 'en' && output === undefined) {
    const units: Record<string, string> = { '张':'image', '条':'item', '秒':'sec', '个':'item', '项':'item', '段':'clip', '页':'page' }
    const summary = source.replace(/(\d+)\s*(张|条|秒|个|项|段|页)(?=$|\s*[·/])/g, (_, count, unit) => `${count} ${units[unit]}${Number(count) === 1 || unit === '秒' ? '' : 's'}`)
    if (summary !== source) output = summary
  }
  const result = output ?? source
  if (cache.size > 15000) cache.clear()
  cache.set(cacheKey, result)
  return result
}
