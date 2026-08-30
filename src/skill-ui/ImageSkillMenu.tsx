import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, Grid3X3, Search, Sparkles, X, Zap } from 'lucide-react'
import { listSkills, officialSkills } from '../skills/registry'
import type { SkillManifest } from '../skills/types'
import { MULTI_GRID_SKILL_SLUGS } from '../skills/manifests/official/image'

type Props = { open: boolean; kind?: 'image' | 'text'; onClose: () => void; onApply: (skill: SkillManifest) => void; onNotice: (message: string) => void }

export function ImageSkillMenu({ open, kind = 'image', onClose, onApply }: Props) {
  const [skills, setSkills] = useState<SkillManifest[]>(officialSkills)
  const [query, setQuery] = useState('')
  const accepts = (item: SkillManifest) => kind === 'text' ? item.kind === 'text' : item.kind === 'image' || item.kind === 'storyboard_comic'
  const refresh = () => listSkills().then((items) => setSkills(items.filter(accepts))).catch(() => setSkills(officialSkills.filter(accepts)))
  useEffect(() => { if (open) void refresh() }, [open])
  const shown = useMemo(() => skills.filter((skill) =>
    !(MULTI_GRID_SKILL_SLUGS as readonly string[]).includes(skill.slug)
    && `${skill.name} ${skill.description}`.toLowerCase().includes(query.trim().toLowerCase()),
  ), [query, skills])

  if (!open) return null
  const panel = <div className="image-skill-popover nodrag nowheel" onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
    <header><button type="button" aria-label="关闭 Skill 菜单" onClick={onClose}><X size={16} /></button><div><strong>{kind === 'text' ? '文本' : '图像'} Skill</strong><small>选择后由 Skill 自动执行任务；管理请前往技能库</small></div></header>
    <div className="image-skill-search"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索 Skill" autoFocus /></div>
    <div className="image-skill-list">{shown.map((skill) => <button type="button" key={`${skill.id}@${skill.version}`} onClick={() => onApply(skill)}><i>{skill.execution === 'instant' ? <Zap size={17} /> : skill.slug.includes('grid') || skill.slug.includes('panel') || skill.slug.includes('board') ? <Grid3X3 size={17} /> : <Sparkles size={17} />}</i><span><b>{skill.name}</b><small>{skill.description}</small></span><em className={`skill-mode-badge is-${skill.execution}`}>{skill.execution === 'instant' ? '⚡ 直接执行' : '◫ 配置后执行'}</em><em>{skill.source === 'user' ? '我的' : '内置'}</em><ChevronRight size={14} /></button>)}</div>
  </div>
  return panel
}
