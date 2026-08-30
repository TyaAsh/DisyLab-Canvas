import type { ComicSection, ComicStyle, ComicWorkflowState } from './storyboard'

export type NiuniuInvokeImport = {
  projectName?: string
  theme?: string
  sections: ComicSection[]
  globalVisualNote?: string
  gridMode?: ComicWorkflowState['gridMode']
  gridCount?: number
  style?: ComicStyle
  styleCompare?: boolean
  aspectRatio?: string
  filePrefix?: string
  warnings: string[]
}

const fieldNames = ['区块', '大标签', '小标签', '主要内容', '画面要求', '画面', '格数', '切割骨架', '版面风格', '画幅', '语言', '交付模式', '命名', '输出路径']
const fieldPattern = new RegExp(`(?:^|\\s{2,})(?=(${fieldNames.join('|')})\\s*[:：])`, 'g')
const valueOf = (line: string) => line.replace(/^[^:：]+[:：]\s*/, '').trim()
const makeSection = (name: string): ComicSection => ({ id: `section-${crypto.randomUUID()}`, name, headline: '', label: '', body: '', points: [], visualNote: '', keepTogether: true })

export function parseNiuniuInvokeText(source: string): NiuniuInvokeImport {
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(fieldPattern, '\n')
  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean)
  const result: NiuniuInvokeImport = { sections: [], warnings: [] }
  let section: ComicSection | undefined
  let readingPoints = false
  let passedGrid = false

  const commit = () => {
    if (!section) return
    section.points = section.points.filter(Boolean)
    if (section.name || section.headline || section.label || section.body || section.points.length) result.sections.push(section)
    section = undefined
  }

  for (const line of lines) {
    if (/^[━—\-=*#\s]+$/.test(line) || /^【牛牛漫画调用】$/.test(line)) continue
    const sectionMatch = line.match(/^(?:#+\s*)?区块\s*[:：]\s*(.*)$/)
    if (sectionMatch) { commit(); section = makeSection(sectionMatch[1].trim()); readingPoints = false; continue }
    if (/^要点\s*[:：]?\s*$/.test(line)) { readingPoints = true; continue }
    if (/^[-•]\s*/.test(line) && readingPoints && section) { section.points.push(line.replace(/^[-•]\s*/, '').replace(/^<要点\d+>\s*[:：]\s*/, '').trim()); continue }
    readingPoints = false
    if (/^大标签\s*[:：]/.test(line) && section) { section.headline = valueOf(line); continue }
    if (/^小标签\s*[:：]/.test(line) && section) { section.label = valueOf(line); continue }
    if (/^主要内容\s*[:：]/.test(line) && section) { section.body = valueOf(line); continue }
    if (/^(?:画面要求|画面)\s*[:：]/.test(line)) {
      const value = valueOf(line).replace(/^<|>$/g, '')
      const meaningful = /如有可填|可选|^如：?$/.test(value) ? '' : value
      if (section && !passedGrid) section.visualNote = meaningful
      else if (meaningful) result.globalVisualNote = meaningful
      continue
    }
    if (/^格数\s*[:：]/.test(line)) {
      passedGrid = true
      const value = valueOf(line)
      const count = Number(value.match(/\d+/)?.[0])
      result.gridMode = /自动/.test(value) || !count ? 'auto' : 'manual'
      if (count) result.gridCount = Math.max(1, Math.min(24, count))
      continue
    }
    if (/^版面风格\s*[:：]/.test(line)) {
      const value = valueOf(line)
      result.styleCompare = /对比|两种|三种/.test(value)
      result.style = /3D/i.test(value) && !/2D/i.test(value) ? '3d' : '2d'
      continue
    }
    if (/^画幅\s*[:：]/.test(line)) { const value = valueOf(line).match(/\d+\s*:\s*\d+/)?.[0]; if (value) result.aspectRatio = value.replace(/\s/g, ''); continue }
    if (/^命名\s*[:：]/.test(line)) { result.projectName = valueOf(line); result.filePrefix = valueOf(line); continue }
    if (/^主题\s*\/\s*脚本\s*[:：]/.test(line)) { const value = valueOf(line); if (value) result.theme = value; continue }
  }
  commit()

  if (!result.sections.length) result.warnings.push('没有识别到“区块：”内容')
  if (!result.projectName) result.warnings.push('没有识别到“命名：”，已保留当前项目名称')
  if (!result.theme && result.sections.length) result.theme = result.sections.map((item) => item.name).filter(Boolean).join(' / ')
  return result
}

export function applyNiuniuInvokeImport(state: ComicWorkflowState, imported: NiuniuInvokeImport): ComicWorkflowState {
  return {
    ...state,
    projectName: imported.projectName || state.projectName,
    theme: imported.theme || state.theme,
    sections: imported.sections.length ? imported.sections : state.sections,
    globalVisualNote: imported.globalVisualNote || state.globalVisualNote,
    gridMode: imported.gridMode || state.gridMode,
    gridCount: imported.gridCount,
    style: imported.style || state.style,
    styleCompare: imported.styleCompare ?? state.styleCompare,
    aspectRatio: imported.aspectRatio || state.aspectRatio,
    filePrefix: imported.filePrefix || state.filePrefix,
    sketches: [], compositions: [], selectedLayouts: [], selectedCompositionIds: [], assetTasks: [], kits: [], status: 'content',
  }
}
