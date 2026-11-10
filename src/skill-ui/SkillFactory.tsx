import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowLeft, ArrowUpRight, Check, ChevronDown, CircleHelp, Copy, FileText, FileUp, Film, FolderUp, Grid3X3, Image, LayoutGrid, MessageCircle, Pencil, Play, Plus, Route, Search, Settings2, Sparkles, Star, Trash2, Type, X, Zap } from 'lucide-react'
import { listSkills, officialSkills } from '../skills/registry'
import { importSkillFile, isSkillImportFile } from '../skills/importExport'
import { deleteUserSkillManifest, saveUserSkillManifest, subscribeToSkillDeletion } from '../skills/storage'
import { categoryContainsSkill, defaultSkillCategories, loadSkillCategories, makeSkillCategory, saveSkillCategories, type SkillCategory } from '../skills/categories'
import { skillKey, type SkillKind, type SkillManifest } from '../skills/types'
import { getFilmSkillShowcase } from '../skills/manifests/official/film'
import { toggleSkillFavorite, useSkillFavorites } from './useSkillFavorites'
import { skillOpening } from '../skills/conversation'

type Props = { open: boolean; initialView?: 'browse' | 'manage'; initialSkillSlug?: string; onClose: () => void; onLaunch: (skill: SkillManifest) => void }
type FactoryView = 'browse' | 'favorites' | 'mine' | 'manage' | 'categories' | 'guide'
const libraryTabs = [
  { id: 'browse', label: 'Skill' },
  { id: 'favorites', label: '收藏' },
  { id: 'mine', label: '我的' },
] as const
const builtInCovers = new Set(['cinematic-lighting-grade', 'copy-polish', 'structured-summary', 'creative-brief', 'story-outline', 'tone-rewrite', 'visual-prompt-architect'])
const exampleMarkdown = `---
name: creative-brief
description: 将零散的创意整理成可执行的项目需求。
---

根据用户给出的素材，整理项目目标、目标受众和核心卖点。
最后列出建议的交付物和需要用户确认的信息。`
const exampleManifest = `{"id":"user.product-poster","slug":"product-poster","version":"1.0.0","name":"产品海报","description":"将产品卖点整理成海报提示词。","kind":"image","execution":"configured","source":"user","enabled":true,"parameters":[],"inputs":[],"output":{"name":"image","type":"image"},"template":{"prompt":"设计海报：{{subject}}"},"capability":{"supportedModes":["image_generation"],"allowedModelCapabilities":["image"]},"createdAt":0,"updatedAt":0}`
const categoryIcon = (c: SkillCategory) => c.id === 'all' ? Sparkles : c.kind === 'composite' ? Route : c.kind === 'storyboard_comic' ? Grid3X3 : c.kind === 'image' ? Image : c.kind === 'video' ? Film : c.kind === 'text' ? Type : LayoutGrid
const kindLabel = (kind: SkillKind) => kind === 'composite' ? '复合 Skill' : kind === 'storyboard_comic' ? '多阶段工作流' : kind === 'image' ? '图像 Skill' : kind === 'video' ? '视频 Skill' : '文本 Skill'

export function SkillFactory({ open, initialView = 'browse', initialSkillSlug = '', onClose, onLaunch }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)
  const reduceMotion = useReducedMotion()
  const [skills, setSkills] = useState(officialSkills)
  const favorites = useSkillFavorites()
  const [categories, setCategories] = useState<SkillCategory[]>(loadSkillCategories)
  const [categoryId, setCategoryId] = useState('all')
  const [selectedId, setSelectedId] = useState('all')
  const [categoryName, setCategoryName] = useState('')
  const [query, setQuery] = useState('')
  const [view, setView] = useState<FactoryView>(initialView)
  const [detailSlug, setDetailSlug] = useState(initialSkillSlug)
  const [notice, setNotice] = useState('')
  const [pendingDelete, setPendingDelete] = useState('')
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [savingUsage, setSavingUsage] = useState(false)
  const [draggedCategoryId, setDraggedCategoryId] = useState('')
  const [dropCategoryId, setDropCategoryId] = useState('')
  const refresh = () => listSkills().then(setSkills)
  const updateCategories = (next: SkillCategory[]) => { setCategories(next); saveSkillCategories(next) }
  const moveCategory = (fromId: string, toId: string) => {
    if (!fromId || !toId || fromId === toId || fromId === 'all' || toId === 'all') return
    const fromIndex = categories.findIndex((item) => item.id === fromId)
    const toIndex = categories.findIndex((item) => item.id === toId)
    if (fromIndex < 0 || toIndex < 0) return
    const next = [...categories]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    updateCategories(next)
  }
  const selectForEdit = (item: SkillCategory) => { setSelectedId(item.id); setCategoryName(item.label); setPendingDelete('') }

  useEffect(() => {
    if (!open) return
    setView(initialView)
    setDetailSlug(initialSkillSlug)
    setNotice('')
    setPendingDelete('')
    void refresh().catch(() => setNotice('暂时无法读取本地 Skill。'))
  }, [open, initialView, initialSkillSlug])
  useEffect(() => subscribeToSkillDeletion((key) => {
    setSkills((current) => current.filter((skill) => skillKey(skill) !== key))
  }), [])
  useEffect(() => {
    if (!open) return
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.fullscreenElement) return
      event.preventDefault()
      event.stopImmediatePropagation()
      const menu = document.querySelector<HTMLElement>('.skill-usage-menu:popover-open')
      if (menu) menu.hidePopover()
      else if (detailSlug) setDetailSlug('')
      else onClose()
    }
    window.addEventListener('keydown', closeWithEscape, true)
    return () => window.removeEventListener('keydown', closeWithEscape, true)
  }, [detailSlug, onClose, open])
  const upload = async (files: FileList | null, fromFolder: boolean) => {
    if (!files?.length || uploading) return
    const candidates = Array.from(files).filter(isSkillImportFile)
    let imported = 0
    const errors: string[] = []
    setUploading(true)
    setNotice('')
    try {
      for (const file of candidates) {
        try {
          const manifest = await importSkillFile(file, fromFolder)
          if (!manifest) continue
          await saveUserSkillManifest(manifest)
          imported++
        } catch (error) {
          errors.push(error instanceof Error ? error.message : `${file.name} 导入失败`)
        }
      }
      if (imported) await refresh()
      setNotice(errors.length ? `已导入 ${imported} 个。 ${errors[0]}` : imported ? `已导入 ${imported} 个 Skill。` : '请选择 SKILL.md 或有效的 DisyLab JSON。')
    } catch {
      setNotice('已保存导入的 Skill，请重新打开技能库查看。')
    } finally {
      setUploading(false)
    }
  }
  const removeSkill = async (skill: SkillManifest) => {
    if (deleting || savingUsage) return
    const key = skillKey(skill)
    if (pendingDelete !== key) { setPendingDelete(key); return }
    setDeleting(true)
    setNotice('')
    try {
      await deleteUserSkillManifest(skill)
      setPendingDelete('')
      setNotice(`已删除 ${skill.name}`)
    } catch {
      setNotice('删除失败，请重试。')
    } finally {
      setDeleting(false)
    }
  }
  const changeSkillUsage = async (skill: SkillManifest, execution: SkillManifest['execution']) => {
    if (deleting || savingUsage || skill.execution === execution) return
    const updated = { ...skill, execution, updatedAt: Date.now() }
    setSavingUsage(true)
    setNotice('')
    try {
      await saveUserSkillManifest(updated)
      setSkills((current) => current.map((item) => skillKey(item) === skillKey(skill) ? updated : item))
      setNotice(`已更新「${skill.name}」的使用方式。`)
    } catch {
      setNotice('使用方式保存失败，请重试。')
    } finally {
      setSavingUsage(false)
    }
  }
  const activeCategory = categories.find((item) => item.id === categoryId) ?? defaultSkillCategories[0]
  const selected = categories.find((item) => item.id === selectedId) ?? categories[0]
  const userSkills = skills.filter((skill) => skill.source === 'user')
  const factorySkills = useMemo(() => skills.filter((skill) => skill.factoryVisible !== false), [skills])
  const libraryView = view === 'browse' || view === 'favorites' || view === 'mine'
  const detailSkill = detailSlug ? factorySkills.find((skill) => skillKey(skill) === detailSlug || (skill.source === 'official' && skill.slug === detailSlug)) : undefined
  const showcase = detailSkill && getFilmSkillShowcase(detailSkill)
  const activeTab = view === 'favorites' ? 'favorites' : view === 'mine' || view === 'manage' || view === 'guide' ? 'mine' : 'browse'
  const searchTerm = query.trim().replace(/^\//, '').toLowerCase()
  const shown = factorySkills.filter((skill) => {
    if (view === 'browse' && !categoryContainsSkill(activeCategory, skill)) return false
    if (view === 'favorites' && !favorites.has(skillKey(skill))) return false
    if (view === 'mine' && skill.source !== 'user') return false
    return !searchTerm || [skill.name, skill.description, skill.slug].some((value) => value.toLowerCase().includes(searchTerm))
  })
  if (!open) return null

  return <motion.div className="skill-factory-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
    <motion.section className={`skill-factory-modal ${detailSkill ? 'has-skill-detail' : ''} ${view === 'categories' ? 'has-category-editor' : ''}`} role="dialog" aria-modal="true" aria-label={detailSkill?.name ?? (view === 'categories' ? '分类管理' : '技能库')} initial={reduceMotion ? false : { opacity: 0, y: 12, scale: .99 }} animate={{ opacity: 1, y: 0, scale: 1 }} onPointerDown={(event) => event.stopPropagation()}>
      {detailSkill ? <FilmSkillDetail key={detailSlug} skill={detailSkill} showcase={showcase} favorite={favorites.has(skillKey(detailSkill))}
        onBack={() => setDetailSlug('')} onClose={onClose} onLaunch={() => onLaunch(detailSkill)} /> : <>
      {view === 'categories' ? <header className="skill-category-topbar">
        <button type="button" autoFocus className="skill-detail-back" onClick={() => { setView('browse'); setNotice(''); setPendingDelete('') }}><ArrowLeft size={16} />返回技能库</button>
        <button type="button" aria-label="关闭分类管理" title="关闭" onClick={onClose}><X size={19} /></button>
      </header> : <header>
        <nav className="skill-library-tabs" aria-label="技能库视图">
          {libraryTabs.map(({ id, label }) => <button key={id} type="button" aria-pressed={activeTab === id} onClick={() => {
            setView(id)
            setQuery('')
            setPendingDelete('')
          }}>{label}</button>)}
        </nav>
        <div className="skill-library-actions">
          {view === 'browse' && <button type="button" aria-label="分类管理" title="分类管理" onClick={() => {
            setView('categories')
            selectForEdit(activeCategory)
          }}><Settings2 size={16} /></button>}
          {view === 'mine' && <button type="button" className="skill-library-manage" onClick={() => setView('manage')}><Settings2 size={15} />管理 Skill</button>}
          <button type="button" autoFocus={!libraryView} aria-label="关闭技能库" title="关闭" onClick={onClose}><X size={20} /></button>
        </div>
      </header>}
      {libraryView && <div className="skill-library-toolbar">
        {view === 'browse' && <nav className="skill-category-nav" aria-label="能力分类">
          {categories.map((item) => {
            const draggable = item.id !== 'all'
            return <button key={item.id} type="button" draggable={draggable} aria-pressed={activeCategory.id === item.id}
              className={`${draggedCategoryId === item.id ? 'is-dragging' : ''} ${dropCategoryId === item.id ? 'is-drop-target' : ''}`}
              onClick={() => setCategoryId(item.id)}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', item.id)
                setDraggedCategoryId(item.id)
              }}
              onDragOver={(event) => {
                if (!draggable || !draggedCategoryId || draggedCategoryId === item.id) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                setDropCategoryId(item.id)
              }}
              onDragLeave={() => setDropCategoryId('')}
              onDrop={(event) => {
                event.preventDefault()
                moveCategory(draggedCategoryId, item.id)
                setDraggedCategoryId('')
                setDropCategoryId('')
              }}
              onDragEnd={() => { setDraggedCategoryId(''); setDropCategoryId('') }}
            >{item.label}</button>
          })}
        </nav>}
        <label className="skill-library-search">
          <input autoFocus type="search" aria-label="搜索 Skill" placeholder="搜索 Skill" value={query} onChange={(event) => setQuery(event.target.value)} />
          <Search size={16} aria-hidden="true" />
        </label>
      </div>}
      <main className="skill-library-content" key={view}>
        {libraryView && <>
          {notice && <div className="skill-manager-notice" role="status">{notice}</div>}
          <Browse skills={shown} favorites={favorites} view={activeTab} searching={Boolean(searchTerm)} onShowcase={setDetailSlug} onLaunch={onLaunch} />
        </>}
        {view === 'manage' && <Manage userSkills={userSkills} notice={notice} pendingDelete={pendingDelete} uploading={uploading}
          deleting={deleting} savingUsage={savingUsage} changeSkillUsage={changeSkillUsage} fileRef={fileRef} folderRef={folderRef}
          showGuide={() => setView('guide')} upload={upload} removeSkill={removeSkill} />}
        {view === 'categories' && selected && <CategoryEditor key={selected.id} skills={factorySkills} categories={categories} selected={selected} name={categoryName} notice={notice} pendingDelete={pendingDelete} setName={setCategoryName} setNotice={setNotice} setPendingDelete={setPendingDelete} select={selectForEdit} update={updateCategories} add={() => { const item = makeSkillCategory('新分类'); updateCategories([...categories, item]); selectForEdit(item) }} deleted={(next, label) => { setCategoryId('all'); selectForEdit(next[0] ?? defaultSkillCategories[0]); setNotice(`已删除分类“${label}”`) }} />}
        {view === 'guide' && <Guide notice={notice} setView={setView} setNotice={setNotice} />}
      </main>
      </>}
    </motion.section>
  </motion.div>
}

function Browse({ skills, favorites, view, searching, onShowcase, onLaunch }: {
  skills: SkillManifest[]
  favorites: Set<string>
  view: typeof libraryTabs[number]['id']
  searching: boolean
  onShowcase: (slug: string) => void
  onLaunch: (skill: SkillManifest) => void
}) {
  if (!skills.length) {
    const emptyTitle = searching ? '没有找到匹配的 Skill' : view === 'favorites' ? '还没有收藏的 Skill' : view === 'mine' ? '还没有自己的 Skill' : '这个分类暂时没有 Skill'
    const emptyDescription = searching ? '试试技能名称、描述或调用词。' : view === 'favorites' ? '点击卡片上的星标即可收藏。' : view === 'mine' ? '可以在 Agent 中创建，或通过「管理 Skill」导入。' : '可以切回「推荐」查看全部技能。'
    const Icon = view === 'favorites' && !searching ? Star : Search
    return <div className="skill-factory-empty" role="status"><Icon size={24} /><b>{emptyTitle}</b><span>{emptyDescription}</span></div>
  }

  return <div className="skill-factory-grid">{skills.map((skill) => {
    const key = skillKey(skill)
    const favorite = favorites.has(key)
    const showcase = getFilmSkillShowcase(skill)
    const cover = skill.source === 'official' && (showcase || builtInCovers.has(skill.slug)) ? skill.slug : 'disy'
    return <article key={key}>
      <div className="skill-card-cover" data-cover={cover === 'disy' ? 'disy' : 'artwork'}>
        <img src={`${import.meta.env.BASE_URL}skill-covers/${cover}.webp`} alt="" decoding="async" />
      </div>
      <div className="skill-card-body">
        <div className="skill-card-heading">
          <h4 title={skill.name}>{skill.name}</h4>
          <button type="button" className="skill-card-favorite" aria-pressed={favorite} aria-label={`${favorite ? '取消收藏' : '收藏'} ${skill.name}`} title={favorite ? '取消收藏' : '收藏'} onClick={() => toggleSkillFavorite(key)}><Star size={16} /></button>
        </div>
        <p title={skill.description}>{skill.description}</p>
        <footer>
          <small>{showcase ? '成片制作' : kindLabel(skill.kind)}</small>
          <div className="skill-card-footer-actions">
            {showcase && <button type="button" className="skill-card-launch" onClick={() => onShowcase(key)}><Play size={13} />预览</button>}
            <button type="button" className="skill-card-launch is-primary" onClick={() => onLaunch(skill)}>开始对话<ArrowUpRight size={14} /></button>
          </div>
        </footer>
      </div>
    </article>
  })}</div>
}

function FilmSkillDetail({ skill, showcase, favorite, onBack, onClose, onLaunch }: {
  skill: SkillManifest
  showcase: ReturnType<typeof getFilmSkillShowcase>
  favorite: boolean
  onBack: () => void
  onClose: () => void
  onLaunch: () => void
}) {
  const [videoFailed, setVideoFailed] = useState(false)
  const cover = `${import.meta.env.BASE_URL}skill-covers/${skill.slug}.webp`
  const videoUrl = showcase?.referenceVideo && import.meta.env.BASE_URL + showcase.referenceVideo
  return <>
    <header className="skill-detail-bar">
      <button className="skill-detail-back" type="button" autoFocus onClick={onBack}><ArrowLeft size={16} />返回技能库</button>
      <button type="button" aria-label="关闭技能详情" title="关闭" onClick={onClose}><X size={20} /></button>
    </header>
    <main className="skill-library-content skill-detail-content">
      <div className="skill-detail-title">
        <div><h2>{skill.name}</h2><p>{showcase ? 'DisyLab 原创 · 通用视频 Skill' : kindLabel(skill.kind)}</p></div>
        <div className="skill-detail-actions">
          <button type="button" className="skill-card-favorite" aria-pressed={favorite} aria-label={favorite ? '取消收藏' : '收藏 Skill'} onClick={() => toggleSkillFavorite(skillKey(skill))}><Star size={17} /></button>
          <button type="button" className="skill-detail-launch" onClick={onLaunch}>开始对话<ArrowUpRight size={16} /></button>
        </div>
      </div>
      {showcase && <figure className="skill-detail-preview">
        {videoUrl && !videoFailed
          ? <video controls playsInline preload="metadata" src={videoUrl} poster={cover} aria-label="参考成片" onError={() => setVideoFailed(true)} />
          : <img className="skill-detail-cover" src={cover} alt="" />}
        <figcaption>
          <span>{videoFailed ? '参考成片加载失败。' : videoUrl ? 'DisyLab 参考成片' : '技能封面'}</span>
        </figcaption>
      </figure>}
      <section className="skill-detail-description">
        <h3>可以这样开聊</h3>
        <p>{skillOpening(skill)}</p>
      </section>
    </main>
  </>
}


type ManageProps = {
  userSkills: SkillManifest[]
  notice: string
  pendingDelete: string
  uploading: boolean
  deleting: boolean
  savingUsage: boolean
  changeSkillUsage: (skill: SkillManifest, execution: SkillManifest['execution']) => Promise<void>
  fileRef: React.RefObject<HTMLInputElement | null>
  folderRef: React.RefObject<HTMLInputElement | null>
  showGuide: () => void
  upload: (files: FileList | null, fromFolder: boolean) => Promise<void>
  removeSkill: (skill: SkillManifest) => Promise<void>
}

function Manage({ userSkills, notice, pendingDelete, uploading, deleting, savingUsage, changeSkillUsage, fileRef, folderRef, showGuide, upload, removeSkill }: ManageProps) {
  return <section className="skill-manager">
    <div className="skill-factory-heading">
      <h3>管理自建和导入的 Skill</h3>
      <button type="button" aria-label="上传指南" onClick={showGuide}><CircleHelp size={15} />上传指南</button>
    </div>
    <div className="skill-manager-upload">
      <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()}>
        <FileUp size={21} /><span><b>上传 Skill 文件</b><small>推荐 SKILL.md，也支持 DisyLab JSON</small></span>
      </button>
      <button type="button" disabled={uploading} onClick={() => folderRef.current?.click()}>
        <FolderUp size={21} /><span><b>上传 Skill 文件夹</b><small>选择含有 SKILL.md 或 DisyLab JSON 的文件夹</small></span>
      </button>
    </div>
    {uploading && <div className="skill-manager-notice" role="status">正在导入…</div>}
    {notice && <div className="skill-manager-notice" role="status">{notice}</div>}
    <div className="skill-manager-list">
      <header><span>我的 Skill</span><em>{userSkills.length}</em></header>
      {userSkills.map((skill) => {
        const key = skillKey(skill)
        const confirming = pendingDelete === key
        return <article key={key}>
          <i><FileText size={17} /></i>
          <span><b>{skill.name}</b><small>{skill.slug} · v{skill.version}</small></span>
          <SkillUsageMenu skill={skill} disabled={savingUsage || deleting} onChange={(execution) => void changeSkillUsage(skill, execution)} />
          <button className={confirming ? 'is-confirming' : ''} type="button" disabled={deleting || savingUsage}
            aria-label={`${confirming ? '确认删除' : '删除'} ${skill.name}`}
            onClick={() => void removeSkill(skill)}>{confirming ? '确认删除' : <Trash2 size={15} />}</button>
        </article>
      })}
      {!userSkills.length && <div className="skill-manager-empty"><FileText size={24} /><b>还没有用户 Skill</b><span>创建或导入后会出现在这里。</span></div>}
    </div>
    <input ref={fileRef} hidden type="file" accept=".md,.json" onChange={(event) => { void upload(event.target.files, false); event.target.value = '' }} />
    <input ref={folderRef} hidden type="file" multiple {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)} onChange={(event) => { void upload(event.target.files, true); event.target.value = '' }} />
  </section>
}

const skillUsageOptions = [
  { value: 'instant', label: '直接应用', detail: '在画布节点里一步完成', icon: Zap },
  { value: 'configured', label: '对话引导', detail: '由 Disy 在对话中逐步引导', icon: MessageCircle },
] as const

function SkillUsageMenu({ skill, disabled, onChange }: { skill: SkillManifest; disabled: boolean; onChange: (execution: SkillManifest['execution']) => void }) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const active = skillUsageOptions.find(({ value }) => value === skill.execution) ?? skillUsageOptions[1]
  const ActiveIcon = active.icon
  useEffect(() => {
    const close = () => { if (menu.current?.matches(':popover-open')) menu.current.hidePopover() }
    const scroller = trigger.current?.closest('.skill-library-content')
    scroller?.addEventListener('scroll', close)
    window.addEventListener('resize', close)
    return () => { scroller?.removeEventListener('scroll', close); window.removeEventListener('resize', close) }
  }, [])
  return <div className="skill-manager-usage">
    <button type="button" ref={trigger} popoverTarget={id} disabled={disabled} className="skill-usage-trigger"
      aria-label={`${skill.name}的使用方式：${active.label}`} title="更改使用方式" onClick={() => {
        const rect = trigger.current?.getBoundingClientRect()
        if (!rect || !menu.current) return
        const width = Math.min(250, window.innerWidth - 24)
        menu.current.style.left = `${Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))}px`
        const above = rect.bottom + 170 > window.innerHeight && rect.top > window.innerHeight - rect.bottom
        menu.current.style.top = above ? 'auto' : `${rect.bottom + 6}px`
        menu.current.style.bottom = above ? `${window.innerHeight - rect.top + 6}px` : 'auto'
      }}><ActiveIcon size={14} aria-hidden="true" /><span>{active.label}</span><ChevronDown size={13} aria-hidden="true" /></button>
    <div ref={menu} id={id} popover="auto" className="skill-usage-menu" role="group" aria-label="使用方式" onKeyDown={(event) => {
      if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return
      event.preventDefault()
      const items = Array.from(event.currentTarget.querySelectorAll('button'))
      const index = items.indexOf(document.activeElement as HTMLButtonElement)
      items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
    }}>
      <span className="skill-usage-heading">使用方式</span>
      {skillUsageOptions.map(({ value, label, detail, icon: Icon }) => <button type="button" key={value}
        autoFocus={skill.execution === value} aria-pressed={skill.execution === value} onClick={() => {
          menu.current?.hidePopover()
          trigger.current?.focus()
          if (value !== skill.execution) onChange(value)
        }}>
        <Icon size={16} aria-hidden="true" /><span><strong>{label}</strong><small>{detail}</small></span>
        {value === skill.execution && <Check size={16} aria-hidden="true" />}
      </button>)}
    </div>
  </div>
}

type EditorProps = { skills: SkillManifest[]; categories: SkillCategory[]; selected: SkillCategory; name: string; notice: string; pendingDelete: string; setName: (v: string) => void; setNotice: (v: string) => void; setPendingDelete: (v: string) => void; select: (c: SkillCategory) => void; update: (c: SkillCategory[]) => void; add: () => void; deleted: (c: SkillCategory[], label: string) => void }
function CategoryEditor({ skills, categories, selected, name, notice, pendingDelete, setName, setNotice, setPendingDelete, select, update, add, deleted }: EditorProps) {
  const [renaming, setRenaming] = useState(false)
  const members = skills.filter((skill) => categoryContainsSkill(selected, skill))
  const automatic = selected.id === 'all' || Boolean(selected.kind)
  const deleteKey = `category:${selected.id}`
  const confirming = pendingDelete === deleteKey
  const Icon = categoryIcon(selected)

  const saveName = () => {
    const label = name.trim()
    if (!label) return
    update(categories.map((category) => category.id === selected.id ? { ...category, label } : category))
    setRenaming(false)
    setNotice('分类名称已保存')
  }
  const toggleMember = (key: string) => {
    const skillKeys = selected.skillKeys.includes(key)
      ? selected.skillKeys.filter((item) => item !== key)
      : [...selected.skillKeys, key]
    update(categories.map((category) => category.id === selected.id ? { ...category, skillKeys } : category))
  }
  const confirmDelete = () => {
    const next = categories.filter((category) => category.id !== selected.id)
    update(next)
    deleted(next, selected.label)
  }

  return <section className="skill-category-manager">
    <header className="skill-category-heading">
      <div><h2>分类管理</h2><p>整理技能库里的分类和技能。</p></div>
      <button type="button" className="skill-category-add" onClick={add}><Plus size={17} />新增分类</button>
    </header>
    <div className="skill-category-workspace">
      <nav className="skill-category-list" aria-label="分类列表">
        {categories.map((category) => {
          const CategoryIcon = categoryIcon(category)
          return <button type="button" key={category.id} aria-pressed={selected.id === category.id} onClick={() => select(category)}>
            <CategoryIcon size={17} /><span>{category.label}</span>
            <em>{skills.filter((skill) => categoryContainsSkill(category, skill)).length}</em>
          </button>
        })}
      </nav>
      <div className="skill-category-editor">
        <header className="skill-category-summary">
          <span className="skill-category-symbol"><Icon size={22} /></span>
          <div><h3>{selected.label}</h3><p>{members.length} 个技能 <span aria-hidden="true">·</span> {selected.id === 'all' ? '包含所有技能' : selected.kind ? '按类型自动收录' : '手动选择收录'}</p></div>
          <div className="skill-category-tools">
            <button type="button" aria-label="重命名分类" title="重命名" onClick={() => { setPendingDelete(''); setRenaming(true) }}><Pencil size={16} /></button>
            {selected.id !== 'all' && <button type="button" aria-label="删除分类" title="删除分类" onClick={() => { setRenaming(false); setPendingDelete(confirming ? '' : deleteKey) }}><Trash2 size={16} /></button>}
          </div>
        </header>
        {renaming && <form className="skill-category-rename" onSubmit={(event) => { event.preventDefault(); saveName() }}>
          <input autoFocus aria-label="分类名称" value={name} maxLength={24} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setName(event.target.value)} />
          <button type="button" onClick={() => { setName(selected.label); setRenaming(false) }}>取消</button>
          <button type="submit" className="skill-category-add" disabled={!name.trim() || name.trim() === selected.label}>保存</button>
        </form>}
        {confirming && <div className="skill-category-delete">
          <span>删除「{selected.label}」？其中的技能会保留。</span>
          <button type="button" onClick={() => setPendingDelete('')}>取消</button>
          <button type="button" className="is-danger" onClick={confirmDelete}>确认删除</button>
        </div>}
        <div className="skill-category-members">
          <h4>{automatic ? '已收录' : '选择要收录的技能'}</h4>
          {(automatic ? members : skills).length ? <ul>
            {(automatic ? members : skills).map((skill) => {
              const key = skillKey(skill)
              const SkillIcon = skill.kind === 'video' ? Film : skill.kind === 'image' ? Image : FileText
              return <li key={key}>
                {automatic
                  ? <div className="skill-category-member"><SkillIcon size={16} /><span title={skill.name}>{skill.name}</span></div>
                  : <label className="skill-category-member"><input type="checkbox" checked={selected.skillKeys.includes(key)} onChange={() => toggleMember(key)} /><span title={skill.name}>{skill.name}</span></label>}
              </li>
            })}
          </ul> : <p className="skill-category-empty">这个分类还没有技能。</p>}
        </div>
      </div>
    </div>
    {notice && <div className="skill-manager-notice" role="status">{notice}</div>}
  </section>
}
function Guide({ notice, setView, setNotice }: { notice: string; setView: (v: FactoryView) => void; setNotice: (v: string) => void }) {
  const copy = async (example: string) => {
    try {
      await navigator.clipboard.writeText(example)
      setNotice('已复制示例。')
    } catch {
      setNotice('复制失败，请选中示例后手动复制。')
    }
  }

  return <section className="skill-upload-guide">
    <div className="skill-factory-heading">
      <h3>Skill 上传指南</h3>
      <button type="button" aria-label="返回上传" onClick={() => { setNotice(''); setView('manage') }}><Settings2 size={15} />返回上传</button>
    </div>
    <div className="skill-guide-steps">
      <article><i>01</i><div><b>准备 SKILL.md</b><p>文件顶部填写 name 和 description，下面写清步骤、输入和期望输出。建议用 UTF-8 保存。</p></div></article>
      <article><i>02</i><div><b>上传文件或文件夹</b><p>可选单个 SKILL.md，也可选择包含它的文件夹。文件夹里有多个 Skill 时会逐个导入。</p></div></article>
      <article><i>03</i><div><b>导入为文本 Skill</b><p>DisyLab 读取 SKILL.md 里的文字指令。请把完成任务必需的内容写在正文里。</p></div></article>
      <article><i>04</i><div><b>兼容 DisyLab JSON</b><p>已有 DisyLab Skill 可直接上传 .disy-skill.json 或 .json，保留其配置参数和输出类型。</p></div></article>
    </div>
    <div className="skill-guide-example">
      <header>
        <span><FileText size={17} /><b>SKILL.md 示例</b></span>
        <div className="skill-guide-copy">
          <button type="button" onClick={() => void copy(exampleMarkdown)}><Copy size={14} />复制 Markdown</button>
          <button type="button" onClick={() => void copy(exampleManifest)}>复制 JSON 示例</button>
        </div>
      </header>
      <pre>{exampleMarkdown}</pre>
    </div>
    {notice && <div className="skill-manager-notice" role="status">{notice}</div>}
  </section>
}

