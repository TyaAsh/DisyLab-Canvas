import { useEffect, useState, type RefObject } from 'react'
import { motion, useIsPresent, useReducedMotion } from 'framer-motion'
import { ChevronDown, FilePlus2, FileUp, Play, Plus, Search, Star, Trash2, Wrench } from 'lucide-react'
import { listSkills, officialSkills } from '../skills/registry'
import { deleteUserSkillManifest, subscribeToSkillDeletion } from '../skills/storage'
import { skillKey, type SkillManifest } from '../skills/types'
import { getFilmSkillShowcase } from '../skills/manifests/official/film'
import { toggleSkillFavorite, useSkillFavorites } from './useSkillFavorites'

const TABS = [
  { id: 'official', label: '通用' },
  { id: 'favorites', label: '收藏' },
  { id: 'user', label: '我的' },
] as const

type Props = {
  id: string
  menuRef: RefObject<HTMLDivElement | null>
  activeSkill: SkillManifest | null
  onAttach: (skill: SkillManifest) => void
  onCreate: () => void
  onOpenFactory: (view: 'browse' | 'manage', skillSlug?: string) => void
  onDismiss: () => void
}

export function AgentSkillMenu({ id, menuRef, activeSkill, onAttach, onCreate, onOpenFactory, onDismiss }: Props) {
  const reducedMotion = useReducedMotion()
  const present = useIsPresent()
  const [tab, setTab] = useState<typeof TABS[number]['id']>('official')
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const favorites = useSkillFavorites()
  const [skills, setSkills] = useState(officialSkills)
  const [loadFailed, setLoadFailed] = useState(false)
  const [pendingDelete, setPendingDelete] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  useEffect(() => {
    let active = true
    void listSkills().then((items) => {
      if (active) setSkills(items.sort((a, b) => a.source === 'user' && b.source === 'user' ? b.updatedAt - a.updatedAt : 0))
    }).catch(() => { if (active) setLoadFailed(true) })
    return () => { active = false }
  }, [])
  useEffect(() => subscribeToSkillDeletion((key) => {
    setSkills((current) => current.filter((skill) => skillKey(skill) !== key))
  }), [])

  const confirmDelete = async (skill: SkillManifest) => {
    if (deleting) return
    setDeleting(true)
    setDeleteError('')
    try {
      await deleteUserSkillManifest(skill)
      setPendingDelete('')
      menuRef.current?.querySelector<HTMLButtonElement>('.agent-skill-tabs [aria-pressed=true]')?.focus()
    } catch {
      setDeleteError('删除失败，请重试。')
    } finally {
      setDeleting(false)
    }
  }

  const cancelDelete = () => {
    if (deleting) return
    setPendingDelete('')
    setDeleteError('')
    menuRef.current?.querySelector<HTMLButtonElement>('.agent-skill-delete[aria-expanded=true]')?.focus()
  }

  const query = search.trim().replace(/^\//, '').toLowerCase()
  const visible = skills.filter((skill) => skill.enabled && skill.factoryVisible !== false
    && (tab === 'favorites' ? favorites.has(skillKey(skill)) : skill.source === tab)
    && (!query || [skill.name, skill.slug, skill.description].some((value) => value.toLowerCase().includes(query))))

  return <motion.div ref={menuRef} id={id} className="agent-skill-menu" role="region" aria-label="Skill 菜单" inert={!present}
    initial={reducedMotion ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 5 }}
    transition={{ duration: reducedMotion ? 0 : .2, ease: [0.22, 1, 0.36, 1] }} onKeyDown={(event) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    if (pendingDelete) cancelDelete()
    else if (createOpen) {
      setCreateOpen(false)
      menuRef.current?.querySelector<HTMLButtonElement>('.agent-skill-create-trigger')?.focus()
    } else onDismiss()
  }}>
    <header>
      <strong>Skill</strong>
      <div className="agent-skill-menu-actions">
        <button type="button" className="agent-skill-create-trigger" aria-expanded={createOpen} aria-controls={createOpen ? `${id}-create` : undefined} onClick={() => setCreateOpen(!createOpen)}><Plus size={13} />创建<ChevronDown size={12} /></button>
        <button type="button" onClick={() => onOpenFactory('browse')}>全部</button>
      </div>
    </header>
    {createOpen && <div className="agent-skill-create-menu" id={`${id}-create`}>
      <button type="button" onClick={onCreate}><FilePlus2 size={16} /><span><b>创建新的 Skill</b><small>通过与 Agent 对话创建</small></span></button>
      <button type="button" onClick={() => onOpenFactory('manage')}><FileUp size={16} /><span><b>导入已有 Skill</b><small>支持 SKILL.md 或 DisyLab JSON</small></span></button>
    </div>}
    <div className="agent-skill-menu-filters">
      <div className="agent-skill-tabs" role="group" aria-label="Skill 分类">
        {TABS.map(({ id: value, label }) => <button key={value} type="button" aria-pressed={tab === value} onClick={() => { setTab(value); setCreateOpen(false); setPendingDelete(''); setDeleteError('') }}>{label}</button>)}
      </div>
      <label className="agent-skill-search"><Search size={14} aria-hidden="true" /><input type="search" value={search} placeholder="搜索 Skill" aria-label="搜索 Skill" onFocus={() => setCreateOpen(false)} onChange={(event) => setSearch(event.target.value)} /></label>
    </div>
    <ul className="agent-skill-list" key={tab}>
      {visible.map((skill) => {
        const key = skillKey(skill)
        const favorite = favorites.has(key)
        const confirm = pendingDelete === key
        return <li key={key}>
          <div className="agent-skill-list-row">
            <button type="button" className="agent-skill-list-item" aria-pressed={activeSkill !== null && skillKey(activeSkill) === key} onClick={() => onAttach(skill)} title={skill.description}>
              <span className="agent-skill-list-icon"><Wrench size={14} /></span>
              <span className="agent-skill-list-copy"><span><b>{skill.name}</b></span><small>{skill.description}</small></span>
            </button>
            {getFilmSkillShowcase(skill) && <button type="button" className="agent-skill-preview" aria-label={`查看详情 ${skill.name}`} title="查看 Skill 详情" onClick={() => onOpenFactory('browse', skill.slug)}><Play size={13} /></button>}
            <button type="button" className="agent-skill-favorite" aria-label={`${favorite ? '取消收藏' : '收藏'} ${skill.name}`} aria-pressed={favorite} onClick={() => toggleSkillFavorite(key)}><Star size={14} /></button>
            {tab === 'user' && skill.source === 'user' && <button type="button" className="agent-skill-delete" aria-label={`删除 ${skill.name}`} title="删除 Skill" aria-expanded={confirm} disabled={deleting} onClick={() => {
              if (confirm) cancelDelete()
              else { setPendingDelete(key); setDeleteError('') }
            }}><Trash2 size={14} /></button>}
          </div>
          {confirm && <div className="agent-skill-delete-confirm" role="group" aria-label={`确认删除 ${skill.name}`}>
            <span>删除这个 Skill？</span>
            <button type="button" autoFocus disabled={deleting} onClick={cancelDelete}>取消</button>
            <button type="button" className="agent-skill-delete-primary" disabled={deleting} onClick={() => void confirmDelete(skill)}>{deleting ? '删除中…' : '确认删除'}</button>
            {deleteError && <small role="alert">{deleteError}</small>}
          </div>}
        </li>
      })}
      {!visible.length && <li className="agent-skill-menu-empty">{loadFailed && tab !== 'official' ? '暂时无法读取本地 Skill' : query ? '没有匹配的 Skill' : tab === 'favorites' ? '点按星标即可收藏 Skill' : tab === 'user' ? '创建或导入后，Skill 会出现在这里' : '暂无通用 Skill'}</li>}
    </ul>
  </motion.div>
}
