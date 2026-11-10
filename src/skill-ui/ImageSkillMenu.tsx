import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, Search, X, Zap } from 'lucide-react'
import { listSkills, officialSkills } from '../skills/registry'
import type { SkillManifest } from '../skills/types'
import { MULTI_GRID_SKILL_SLUGS } from '../skills/manifests/official/image'

type Props = { open: boolean; kind?: 'image' | 'text' | 'video'; onClose: () => void; onApply: (skill: SkillManifest) => void }

export function ImageSkillMenu({ open, kind = 'image', onClose, onApply }: Props) {
  const [skills, setSkills] = useState<SkillManifest[]>(officialSkills)
  const [query, setQuery] = useState('')
  useEffect(() => {
    if (!open) return
    let active = true
    void listSkills(kind).then((items) => { if (active) setSkills(items) }).catch(() => { if (active) setSkills(officialSkills) })
    return () => { active = false }
  }, [open, kind])
  const direct = useMemo(() => skills.filter((skill) => skill.enabled && skill.kind === kind && skill.execution === 'instant'
    && !(MULTI_GRID_SKILL_SLUGS as readonly string[]).includes(skill.slug)), [kind, skills])
  const shown = direct.filter((skill) => `${skill.name} ${skill.description}`.toLowerCase().includes(query.trim().toLowerCase()))

  if (!open) return null
  const panel = <div className="image-skill-popover nodrag nowheel" onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
    <header><button type="button" aria-label="关闭 Skill 菜单" onClick={onClose}><X size={16} /></button><div><strong>{{ text: '文本', image: '图像', video: '视频' }[kind]} Skill</strong><small>选择一个 Skill，直接应用到当前节点</small></div></header>
    <div className="image-skill-search"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索 Skill" autoFocus /></div>
    <div className="image-skill-list">{shown.map((skill) => <button type="button" key={`${skill.id}@${skill.version}`} onClick={() => onApply(skill)}>
      <i><Zap size={17} /></i><span><b>{skill.name}</b><small>{skill.description}</small></span><em className="skill-mode-badge is-instant">直接应用</em><em>{skill.source === 'user' ? '我的' : '内置'}</em><ChevronRight size={14} />
    </button>)}
    {!shown.length && <p className="image-skill-empty">{direct.length ? '没有匹配的 Skill' : '暂无可直接应用的 Skill'}</p>}</div>
  </div>
  return panel
}
