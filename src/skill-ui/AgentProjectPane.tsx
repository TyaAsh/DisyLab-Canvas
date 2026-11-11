import { useState } from 'react'
import { ArrowUpRight, Brain, CircleCheck, Cpu, ListTodo, LoaderCircle, Pencil, Plus, Square, Tag, Trash2, UsersRound } from 'lucide-react'
import { activeAgentTeamRoles, agentTaskIsActive, agentTeamTemplates, getAgentTeamTemplate, memoryKinds, PROJECT_MEMORY_LENGTH, PROJECT_MEMORY_LIMIT, type AgentProjectSettings, type AgentTask, type AgentTeamConfig, type ProjectMemoryKind } from '../agentProject'
import type { AgentModelOption } from '../AgentPanel'
import { AgentSelect, getModelBrand } from './AgentSelect'

export type AgentProjectView = 'memory' | 'tasks' | 'team' | 'guide'
type SaveSettings = (update: (settings: AgentProjectSettings) => AgentProjectSettings) => Promise<void>
const taskStatusLabels = { waiting: '待确认', running: '进行中', completed: '已完成', failed: '失败', cancelled: '已停止' }

export function AgentTasks({ tasks, onOpen, onStop }: { tasks: AgentTask[]; onOpen: (task: AgentTask) => Promise<boolean>; onStop: (id: string) => void }) {
  const [filter, setFilter] = useState<'active' | 'all'>('active')
  const [opening, setOpening] = useState<string | null>(null)
  const active = tasks.filter(agentTaskIsActive)
  const shown = filter === 'active' ? active : tasks
  return <section className="agent-project-pane" aria-label="任务中心">
    <div className="agent-project-tools"><span>{active.length} 项进行中或待确认</span><div className="agent-task-filter" aria-label="任务筛选">
      <button type="button" aria-pressed={filter === 'active'} onClick={() => setFilter('active')}>进行中</button>
      <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>全部</button>
    </div></div>
    {!shown.length && <div className="agent-project-empty"><ListTodo size={24} aria-hidden="true" /><strong>{filter === 'active' ? '暂无进行中的任务' : '还没有任务记录'}</strong></div>}
    <div className="agent-project-list">
      {shown.map((task) => <article key={task.id} className="agent-project-card">
        <div className="agent-project-card-heading"><span>{task.kind} · {task.canvasName}</span><span className={`agent-task-status is-${task.status}`}>{task.status === 'running' && <LoaderCircle size={12} className="is-spinning" aria-hidden="true" />}{taskStatusLabels[task.status]}</span></div>
        <strong>{task.title}</strong>
        {task.stage && <p>{task.stage}</p>}
        <footer><button type="button" disabled={opening !== null} onClick={async () => {
          setOpening(task.id)
          try { await onOpen(task) } finally { setOpening(null) }
        }}><ArrowUpRight size={14} aria-hidden="true" />{opening === task.id ? '正在打开…' : '查看对话'}</button>
          {task.status === 'running' && task.runId && <button type="button" onClick={() => onStop(task.runId!)}><Square size={12} aria-hidden="true" />停止</button>}
        </footer>
      </article>)}
    </div>
  </section>
}

export function AgentMemory({ settings, save, seed }: { settings: AgentProjectSettings; save: SaveSettings; seed?: string }) {
  const [editing, setEditing] = useState<string | null>(seed ? 'new' : null)
  const [kind, setKind] = useState<ProjectMemoryKind>('fact')
  const [value, setValue] = useState(seed ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const start = (id = 'new', type: ProjectMemoryKind = 'fact', text = '') => {
    setEditing(id); setKind(type); setValue(text); setError('')
  }
  const commit = async (update: Parameters<SaveSettings>[0], close = false) => {
    setBusy(true); setError('')
    try { await save(update); if (close) setEditing(null) }
    catch { setError('项目记忆保存失败，请重试。') }
    finally { setBusy(false) }
  }
  const full = settings.memory.length >= PROJECT_MEMORY_LIMIT
  return <section className="agent-project-pane" aria-label="项目记忆">
    <div className="agent-project-tools"><span>{settings.memory.length} 条记忆</span><button type="button" disabled={busy || full} onClick={() => start()}><Plus size={15} aria-hidden="true" />添加记忆</button></div>
    <p className="agent-project-copy">保存的内容会供这个项目里的后续对话参考。</p>
    {editing && <form className="agent-project-form" onSubmit={(event) => {
      event.preventDefault()
      const text = value.trim()
      if (!text || busy || (editing === 'new' && full)) return
      const entry = { id: editing === 'new' ? crypto.randomUUID() : editing, kind, text }
      void commit((current) => ({ ...current, memory: editing === 'new' ? [entry, ...current.memory] : current.memory.map((item) => item.id === entry.id ? entry : item) }), true)
    }}>
      <div className="agent-project-field"><span>类型</span><AgentSelect variant="floating" ariaLabel="记忆类型" value={kind} disabled={busy} placeholder="选择记忆类型" icon={<Tag size={14} />}
        options={Object.entries(memoryKinds).map(([value, label]) => ({ value, label }))} onChange={(value) => setKind(value as ProjectMemoryKind)} /></div>
      <label>记忆内容<textarea autoFocus value={value} maxLength={PROJECT_MEMORY_LENGTH} rows={3} disabled={busy} onChange={(event) => setValue(event.target.value)} /></label>
      <footer><button type="button" disabled={busy} onClick={() => setEditing(null)}>取消</button><button type="submit" className="is-primary" disabled={busy || !value.trim() || (editing === 'new' && full)}>保存记忆</button></footer>
    </form>}
    {error && <p className="agent-plan-error" role="alert">{error}</p>}
    {!settings.memory.length && !editing && <div className="agent-project-empty"><Brain size={24} aria-hidden="true" /><strong>还没有项目记忆</strong><span>可保存已经确认的事实、偏好、约束或决定。</span></div>}
    <div className="agent-project-list">{settings.memory.map((item) => <article className="agent-project-card" key={item.id}>
      <div className="agent-project-card-heading"><span>{memoryKinds[item.kind]}</span><div>
        <button type="button" disabled={busy} aria-label={`编辑记忆 ${item.text.slice(0, 20)}`} onClick={() => start(item.id, item.kind, item.text)}><Pencil size={14} /></button>
        <button type="button" disabled={busy} aria-label={`删除记忆 ${item.text.slice(0, 20)}`} onClick={() => {
          if (editing === item.id) setEditing(null)
          void commit((current) => ({ ...current, memory: current.memory.filter(({ id }) => id !== item.id) }))
        }}><Trash2 size={14} /></button>
      </div></div><p>{item.text}</p>
    </article>)}</div>
  </section>
}

export function AgentTeam({ settings, save, models, enabled, onEnabled }: { settings: AgentProjectSettings; save: SaveSettings; models: AgentModelOption[]; enabled: boolean; onEnabled: (value: boolean) => void }) {
  const [team, setTeam] = useState<AgentTeamConfig>(settings.team)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const template = getAgentTeamTemplate(team.template)
  const active = activeAgentTeamRoles(team)
  const changed = team.template !== settings.team.template || agentTeamTemplates.some(({ roles }) => roles.some(({ id }) => (
    (team.models[id] || '') !== (settings.team.models[id] || '') || team.disabled.includes(id) !== settings.team.disabled.includes(id)
  )))
  const unavailable = active.some(({ id }) => team.models[id] && !models.some(({ key }) => key === team.models[id]))
  return <section className="agent-project-pane" aria-label="团队协作">
    <div className="agent-project-tools"><span><UsersRound size={16} aria-hidden="true" />{active.length} 个角色</span><label className="agent-team-toggle"><input type="checkbox" checked={enabled} disabled={changed || saving || unavailable} onChange={(event) => onEnabled(event.target.checked)} />在此对话启用</label></div>
    <p className="agent-project-copy">角色按顺序交接，通常每个角色调用一次模型，按实际调用计费。</p>
    <form className="agent-project-form" onSubmit={async (event) => {
      event.preventDefault()
      if (!changed || unavailable) return
      setSaving(true); setNotice('')
      try { await save((current) => ({ ...current, team })); setNotice('团队配置已保存') }
      catch { setNotice('团队配置保存失败，请重试。') }
      finally { setSaving(false) }
    }}>
      <div className="agent-project-field"><span>团队模板</span><AgentSelect variant="floating" ariaLabel="团队模板" value={team.template} disabled={saving} placeholder="选择团队模板" icon={<UsersRound size={14} />}
        options={agentTeamTemplates.map(({ id, label, use }) => ({ value: id, label, detail: use }))}
        onChange={(value) => { setNotice(''); setTeam((current) => ({ ...current, template: value as AgentTeamConfig['template'] })) }} /></div>
      <p className="agent-project-copy">{template.use}</p>
      {template.roles.map(({ id, label, action }, index) => {
        const participating = active.some((role) => role.id === id)
        const final = index === template.roles.length - 1
        return <div className="agent-team-role" key={id}>
        <label className="agent-team-toggle"><input type="checkbox" checked={participating} disabled={saving || final || (participating && active.length <= 2)}
          aria-label={`启用${label}`} onChange={(event) => {
            const checked = event.target.checked
            setNotice('')
            setTeam((current) => ({ ...current, disabled: checked ? current.disabled.filter((role) => role !== id) : [...current.disabled, id] }))
          }} /><strong>{label}</strong>{final && <small>负责交付</small>}</label><small>{action}</small>
        <AgentSelect variant="floating" ariaLabel={`${label}模型`} disabled={saving || !participating} value={team.models[id] || ''} placeholder="选择模型" icon={<Cpu size={14} />}
          options={[{ value: '', label: '跟随当前对话模型' },
            ...(team.models[id] && !models.some(({ key }) => key === team.models[id]) ? [{ value: team.models[id], label: '原模型已不可用' }] : []),
            ...models.map(({ key, name, connectionName }) => ({ value: key, label: name, detail: connectionName, brand: getModelBrand(name) }))]}
          onChange={(key) => { setNotice(''); setTeam((current) => ({ ...current, models: { ...current.models, [id]: key } })) }} />
        </div>
      })}
      <footer><button type="submit" className="is-primary" disabled={saving || !changed || unavailable}><CircleCheck size={15} aria-hidden="true" />保存团队配置</button></footer>
    </form>
    {notice && <p className="agent-project-copy" role="status">{notice}</p>}
  </section>
}

export function AgentProjectGuide({ open }: { open: (view: AgentProjectView) => void }) {
  const sections = [
    { view: 'memory', icon: Brain, title: '项目记忆', text: '添加品牌口吻、画幅或已定方向。也可点自己消息旁的记忆图标，核对后保存。同项目的新对话会参考这些内容。' },
    { view: 'tasks', icon: ListTodo, title: '任务中心', text: '在「进行中」找正在运行或待确认的任务，切到「全部」查看记录。点「查看对话」回到原画布和对话。' },
    { view: 'team', icon: UsersRound, title: '团队协作', text: '按任务选设计、制片或文案模板，选择参与角色和模型后保存。在当前对话开启，再像平时一样发消息。最后由你确认方案。' },
  ] as const
  return <section className="agent-project-pane" aria-label="使用指南">
    {sections.map(({ view, icon: Icon, title, text }) => <article className="agent-project-card agent-guide-card" key={view}>
      <strong><Icon size={16} aria-hidden="true" />{title}</strong><p>{text}</p>
      <footer><button type="button" onClick={() => open(view)}>打开{title}<ArrowUpRight size={14} aria-hidden="true" /></button></footer>
    </article>)}
  </section>
}
