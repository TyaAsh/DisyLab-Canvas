import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { BookOpen, Check, CircleHelp, Copy, FileJson, FileUp, Film, FolderUp, GripVertical, Grid3X3, Image, LayoutGrid, Pencil, Plus, RotateCcw, Route, Search, Settings2, ShieldCheck, Sparkles, Trash2, Type, WandSparkles, X, Zap } from 'lucide-react'
import { listSkills } from '../skills/registry'
import { importSkillFile } from '../skills/importExport'
import { deleteUserSkillManifest, saveUserSkillManifest } from '../skills/storage'
import { categoryContainsSkill, defaultSkillCategories, loadSkillCategories, makeSkillCategory, saveSkillCategories, type SkillCategory } from '../skills/categories'
import { skillKey, type SkillKind, type SkillManifest } from '../skills/types'

type Props = { open: boolean; onClose: () => void; onLaunch: (skill: SkillManifest) => void }
type FactoryView = 'browse' | 'manage' | 'categories' | 'guide'
const exampleManifest = `{"id":"user.product-poster","slug":"product-poster","version":"1.0.0","name":"产品海报","description":"将产品卖点整理成海报提示词。","kind":"image","execution":"configured","source":"user","enabled":true,"parameters":[],"inputs":[],"output":{"name":"image","type":"image"},"template":{"prompt":"设计海报：{{subject}}"},"capability":{"supportedModes":["image_generation"],"allowedModelCapabilities":["image"]},"createdAt":0,"updatedAt":0}`
const categoryIcon = (c: SkillCategory) => c.id === 'all' ? Sparkles : c.kind === 'composite' ? Route : c.kind === 'storyboard_comic' ? Grid3X3 : c.kind === 'image' ? Image : c.kind === 'video' ? Film : c.kind === 'text' ? Type : LayoutGrid
const kindLabel = (kind: SkillKind) => kind === 'composite' ? '复合 Skill' : kind === 'storyboard_comic' ? '多阶段工作流' : kind === 'image' ? '图像 Skill' : kind === 'video' ? '视频 Skill' : '文本 Skill'

export function SkillFactory({ open, onClose, onLaunch }: Props) {
  const factoryRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)
  const reduceMotion = useReducedMotion()
  const [skills, setSkills] = useState<SkillManifest[]>([])
  const [categories, setCategories] = useState<SkillCategory[]>(loadSkillCategories)
  const [categoryId, setCategoryId] = useState('all')
  const [selectedId, setSelectedId] = useState('all')
  const [categoryName, setCategoryName] = useState('')
  const [query, setQuery] = useState('')
  const [view, setView] = useState<FactoryView>('browse')
  const [notice, setNotice] = useState('')
  const [pendingDelete, setPendingDelete] = useState('')
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

  useEffect(() => { if (open) { setView('browse'); setNotice(''); setPendingDelete(''); void refresh() } }, [open])
  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    const manifests = Array.from(files).filter((file) => /\.json$/i.test(file.name)); let imported = 0; const errors: string[] = []
    for (const file of manifests) { try { await saveUserSkillManifest(await importSkillFile(file)); imported++ } catch (error) { errors.push(error instanceof Error ? error.message : `${file.name} 导入失败`) } }
    await refresh(); setNotice(errors.length ? `已导入 ${imported} 个；${errors[0]}` : manifests.length ? `已安全导入 ${imported} 个 Skill` : '文件夹中没有找到 JSON Manifest')
  }
  const activeCategory = categories.find((item) => item.id === categoryId) ?? defaultSkillCategories[0]
  const selected = categories.find((item) => item.id === selectedId) ?? categories[0]
  const userSkills = skills.filter((skill) => skill.source === 'user')
  const factorySkills = useMemo(() => skills.filter((skill) => skill.factoryVisible !== false), [skills])
  const shown = useMemo(() => factorySkills
    .filter((skill) => categoryContainsSkill(activeCategory, skill) && `${skill.name} ${skill.description}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => Number(a.kind === 'composite') - Number(b.kind === 'composite')),
  [factorySkills, activeCategory, query])
  const shownKey = shown.map(skillKey).join('|')
  useGSAP(() => { if (!reduceMotion) gsap.timeline({ defaults: { ease: 'power3.out' } }).from('.skill-factory-modal>header>*:not(.skill-factory-close)', { autoAlpha: 0, y: -9, duration: .34, stagger: .045 }).from('.skill-factory-shell>aside>*', { autoAlpha: 0, x: -14, duration: .32, stagger: .055 }, '<.06') }, { scope: factoryRef })
  useGSAP(() => { if (!reduceMotion && shown.length) gsap.fromTo('.skill-factory-grid article', { autoAlpha: 0, y: 18, scale: .975 }, { autoAlpha: 1, y: 0, scale: 1, duration: .38, stagger: .035, ease: 'power3.out', clearProps: 'transform,opacity,visibility' }) }, { dependencies: [shownKey, reduceMotion], scope: factoryRef, revertOnUpdate: true })
  if (!open) return null

  return <motion.div ref={factoryRef} className="skill-factory-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
    <motion.section className="skill-factory-modal" role="dialog" aria-modal="true" aria-labelledby="skill-factory-title" initial={reduceMotion ? false : { opacity: 0, y: 22, scale: .976 }} animate={{ opacity: 1, y: 0, scale: 1 }} onPointerDown={(e) => e.stopPropagation()}>
      <header><div className="skill-factory-title"><h2 id="skill-factory-title">技能库</h2><small>{factorySkills.length} 个可用技能</small></div>{view === 'browse' && <label><Search size={15}/><input autoFocus value={query} placeholder="搜索创作能力、任务或交付类型" onChange={(e) => setQuery(e.target.value)}/></label>}<button type="button" className="skill-factory-close" aria-label="关闭技能库" title="关闭" onClick={onClose}><X size={20} strokeWidth={2.15}/></button></header>
      <div className="skill-factory-shell">
        <aside><small>能力分类</small><nav className="skill-category-nav">{categories.map((item) => { const Icon = categoryIcon(item); const draggable = item.id !== 'all'; return <button type="button" key={item.id} draggable={draggable} className={`${view === 'browse' && categoryId === item.id ? 'is-active ' : ''}${draggedCategoryId === item.id ? 'is-dragging ' : ''}${dropCategoryId === item.id ? 'is-drop-target' : ''}`} onDragStart={(event) => { if (!draggable) return; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.id); setDraggedCategoryId(item.id) }} onDragOver={(event) => { if (!draggable || !draggedCategoryId || draggedCategoryId === item.id) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropCategoryId(item.id) }} onDragLeave={() => dropCategoryId === item.id && setDropCategoryId('')} onDrop={(event) => { event.preventDefault(); moveCategory(draggedCategoryId || event.dataTransfer.getData('text/plain'), item.id); setDraggedCategoryId(''); setDropCategoryId('') }} onDragEnd={() => { setDraggedCategoryId(''); setDropCategoryId('') }} onClick={() => { setCategoryId(item.id); setView('browse') }}>{draggable && <GripVertical className="skill-category-grip" size={13}/>}<Icon size={16}/><span>{item.label}</span><em>{factorySkills.filter((s) => categoryContainsSkill(item, s)).length}</em></button> })}</nav><div className="skill-factory-nav-divider"/><small>Skill 管理</small><nav><button type="button" className={view === 'categories' ? 'is-active' : ''} onClick={() => { setView('categories'); selectForEdit(categories[0] ?? defaultSkillCategories[0]) }}><LayoutGrid size={16}/><span>分类管理</span><em>{Math.max(0, categories.length - 1)}</em></button></nav><div className={`skill-factory-side-note ${view === 'browse' ? '' : 'is-safe'}`}>{view === 'browse' ? <><WandSparkles size={18}/><b>拖拽调整分类</b><p>除“全部 Skill”外，分类顺序会保存在当前设备。</p></> : <><ShieldCheck size={18}/><b>本地安全配置</b><p>分类保存在本机，不会改写 Skill Manifest。</p></>}</div></aside>
        <main>
          {view === 'browse' && <Browse skills={shown} category={activeCategory} query={query} onLaunch={onLaunch}/>} 
          {view === 'manage' && <Manage userSkills={userSkills} notice={notice} pendingDelete={pendingDelete} fileRef={fileRef} folderRef={folderRef} setView={setView} setNotice={setNotice} setPendingDelete={setPendingDelete} upload={upload} refresh={refresh}/>} 
          {view === 'categories' && selected && <CategoryEditor skills={factorySkills} categories={categories} selected={selected} name={categoryName} notice={notice} pendingDelete={pendingDelete} setName={setCategoryName} setNotice={setNotice} setPendingDelete={setPendingDelete} select={selectForEdit} update={updateCategories} add={() => { const item = makeSkillCategory('新分类'); updateCategories([...categories, item]); selectForEdit(item) }} deleted={(next, label) => { setCategoryId('all'); selectForEdit(next[0] ?? defaultSkillCategories[0]); setNotice(`已删除分类“${label}”`) }}/>} 
          {view === 'guide' && <Guide notice={notice} setView={setView} setNotice={setNotice}/>} 
        </main>
      </div>
    </motion.section>
  </motion.div>
}

function Browse({ skills, category, query, onLaunch }: { skills: SkillManifest[]; category: SkillCategory; query: string; onLaunch: (skill: SkillManifest) => void }) {
  return <><div className="skill-factory-heading"><div><small>{category.label}</small><h3>{query ? `“${query}”的结果` : '选择一个 Skill 开始创作'}</h3></div><span>{skills.length} 个可用能力</span></div><div className="skill-factory-grid">{skills.map((skill) => <motion.article layout key={skillKey(skill)} className={skill.kind === 'composite' ? 'is-composite' : skill.kind === 'storyboard_comic' ? 'is-storyboard' : ''}><div className="skill-card-icon">{skill.kind === 'composite' ? <Route size={20}/> : skill.kind === 'storyboard_comic' ? <Grid3X3 size={20}/> : skill.kind === 'image' ? <Image size={20}/> : skill.kind === 'video' ? <Film size={20}/> : <BookOpen size={20}/>}</div><small>{kindLabel(skill.kind)} · {skill.kind === 'composite' ? `${skill.composite?.stages.length ?? 0} 阶段审核` : skill.execution === 'instant' ? '直接执行' : '配置后执行'}</small><h4>{skill.name}</h4><p>{skill.description}</p><footer><button type="button" onClick={() => onLaunch(skill)}>{skill.kind === 'composite' ? <Route size={14}/> : skill.execution === 'instant' ? <Zap size={14}/> : <Sparkles size={14}/>} {skill.kind === 'composite' ? '进入工作台' : '开始使用'}</button></footer></motion.article>)}</div>{!skills.length && <div className="skill-factory-empty"><Search size={26}/><b>没有找到匹配的 Skill</b><span>换一个关键词，或者切换能力分类。</span></div>}</>
}

type ManageProps = { userSkills: SkillManifest[]; notice: string; pendingDelete: string; fileRef: React.RefObject<HTMLInputElement | null>; folderRef: React.RefObject<HTMLInputElement | null>; setView: (v: FactoryView) => void; setNotice: (v: string) => void; setPendingDelete: (v: string) => void; upload: (f: FileList | null) => Promise<void>; refresh: () => Promise<void> }
function Manage({ userSkills, notice, pendingDelete, fileRef, folderRef, setView, setNotice, setPendingDelete, upload, refresh }: ManageProps) {
  return <section className="skill-manager"><div className="skill-factory-heading"><div><small>MY SKILLS</small><h3>上传、更新与删除用户 Skill</h3></div><button type="button" onClick={() => setView('guide')}><CircleHelp size={15}/>上传指南</button></div><div className="skill-manager-upload"><button type="button" onClick={() => fileRef.current?.click()}><FileUp size={22}/><span><b>上传 Skill 文件</b><small>选择 .disy-skill.json 或 .json</small></span></button><button type="button" onClick={() => folderRef.current?.click()}><FolderUp size={22}/><span><b>上传 Skill 文件夹</b><small>扫描文件夹内所有 JSON Manifest</small></span></button></div>{notice && <div className="skill-manager-notice">{notice}</div>}<div className="skill-manager-list"><header><span>已上传 Skill</span><em>{userSkills.length}</em></header>{userSkills.map((skill) => { const key = skillKey(skill); return <article key={key}><i><FileJson size={17}/></i><span><b>{skill.name}</b><small>{skill.slug} · v{skill.version}</small></span><button className={pendingDelete === key ? 'is-confirming' : ''} type="button" onClick={async () => { if (pendingDelete !== key) return setPendingDelete(key); await deleteUserSkillManifest(skill); setPendingDelete(''); await refresh(); setNotice(`已删除 ${skill.name}`) }}>{pendingDelete === key ? '确认删除' : <Trash2 size={15}/>}</button></article>})}{!userSkills.length && <div className="skill-manager-empty"><FileJson size={24}/><b>还没有用户 Skill</b><span>上传后会立即出现在技能库中。</span></div>}</div><input ref={fileRef} hidden type="file" accept=".json,.disy-skill.json" onChange={(e) => { void upload(e.target.files); e.target.value = '' }}/><input ref={folderRef} hidden type="file" multiple {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)} onChange={(e) => { void upload(e.target.files); e.target.value = '' }}/></section>
}

type EditorProps = { skills: SkillManifest[]; categories: SkillCategory[]; selected: SkillCategory; name: string; notice: string; pendingDelete: string; setName: (v: string) => void; setNotice: (v: string) => void; setPendingDelete: (v: string) => void; select: (c: SkillCategory) => void; update: (c: SkillCategory[]) => void; add: () => void; deleted: (c: SkillCategory[], label: string) => void }
function CategoryEditor({ skills, categories, selected, name, notice, pendingDelete, setName, setNotice, setPendingDelete, select, update, add, deleted }: EditorProps) {
  const saveName = () => { const value = name.trim(); if (!value) return; update(categories.map((c) => c.id === selected.id ? { ...c, label: value } : c)); setNotice('分类名称已保存') }
  return <section className="skill-category-manager"><div className="skill-factory-heading"><div><small>ORGANIZE SKILLS</small><h3>管理能力分类</h3></div><button type="button" onClick={add}><Plus size={15}/>新增分类</button></div><div className="skill-category-workspace"><div className="skill-category-list"><header><span>分类</span><em>{categories.length}</em></header>{categories.map((item) => { const Icon = categoryIcon(item); return <button type="button" key={item.id} className={selected.id === item.id ? 'is-active' : ''} onClick={() => select(item)}><i><Icon size={16}/></i><span><b>{item.label}</b><small>{item.id === 'all' ? '聚合全部 Skill' : item.kind ? '按类型自动收录' : '自定义收录'}</small></span><em>{skills.filter((s) => categoryContainsSkill(item, s)).length}</em></button> })}</div><div className="skill-category-editor"><header><span><Pencil size={16}/><b>编辑分类</b></span><small>{selected.system ? '系统分类' : '自定义分类'}</small></header><label><span>分类名称</span><div><input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveName()}/><button type="button" disabled={!name.trim() || name.trim() === selected.label} onClick={saveName}><Check size={15}/>保存</button></div></label>{selected.id === 'all' ? <Rule icon={<Sparkles size={18}/>} title="固定聚合分类" text="始终包含所有能力，可以重命名，但不能删除或调整归属。"/> : selected.kind ? <Rule icon={<RotateCcw size={18}/>} title="自动收录规则" text={`按照 ${kindLabel(selected.kind)} 类型自动更新。你可以重命名或删除它。`}/> : <div className="skill-category-members"><header><span>包含的 Skill</span><em>{selected.skillKeys.length} 个已选择</em></header><div>{skills.map((skill) => { const key = skillKey(skill); const checked = selected.skillKeys.includes(key); return <button type="button" key={key} className={checked ? 'is-selected' : ''} onClick={() => { const keys = checked ? selected.skillKeys.filter((k) => k !== key) : [...selected.skillKeys, key]; update(categories.map((c) => c.id === selected.id ? { ...c, skillKeys: keys } : c)) }}><i>{checked && <Check size={13}/>}</i><span><b>{skill.name}</b><small>{kindLabel(skill.kind)} · {skill.source === 'official' ? '官方' : '用户'}</small></span></button> })}</div></div>}<footer><span>删除分类不会删除其中的 Skill。</span><button type="button" disabled={selected.id === 'all'} className={pendingDelete === `category:${selected.id}` ? 'is-confirming' : ''} onClick={() => { const key = `category:${selected.id}`; if (pendingDelete !== key) return setPendingDelete(key); const next = categories.filter((c) => c.id !== selected.id); update(next); deleted(next, selected.label) }}>{pendingDelete === `category:${selected.id}` ? '再次点击确认删除' : <><Trash2 size={14}/>删除分类</>}</button></footer></div></div>{notice && <div className="skill-manager-notice">{notice}</div>}</section>
}
function Rule({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) { return <div className="skill-category-rule">{icon}<span><b>{title}</b><small>{text}</small></span></div> }
function Guide({ notice, setView, setNotice }: { notice: string; setView: (v: FactoryView) => void; setNotice: (v: string) => void }) { return <section className="skill-upload-guide"><div className="skill-factory-heading"><div><small>UPLOAD MANUAL</small><h3>用户 Skill 上传指南</h3></div><button type="button" onClick={() => setView('manage')}><Settings2 size={15}/>前往管理</button></div><div className="skill-guide-steps"><article><i>01</i><div><b>准备 Manifest</b><p>创建 UTF-8 JSON 文件。</p></div></article><article><i>02</i><div><b>选择上传方式</b><p>支持单文件或文件夹批量上传。</p></div></article><article><i>03</i><div><b>通过安全校验</b><p>拒绝 API Key、脚本和自定义端点。</p></div></article><article><i>04</i><div><b>更新与删除</b><p>内置 Skill 不可删除。</p></div></article></div><div className="skill-guide-example"><header><span><FileJson size={17}/><b>最小可用示例</b></span><button type="button" onClick={() => void navigator.clipboard.writeText(exampleManifest).then(() => setNotice('示例 Manifest 已复制'))}><Copy size={14}/>复制示例</button></header><pre>{exampleManifest}</pre></div>{notice && <div className="skill-manager-notice">{notice}</div>}</section> }

