import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ArrowUp, Check, ChevronLeft, ChevronRight, FilePlus2, LoaderCircle, Plus, Save, Wrench } from 'lucide-react'
import { normalizeAgentMessageContent, type AgentMessage } from '../agent'
import { buildSkillAuthorPrompt, createAuthoredSkill, parseSkillAuthorReply, SKILL_START_QUESTIONS, type SkillAuthorDraft, type SkillAuthorMessage, type SkillAuthorQuestion, type SkillAuthorSource } from '../skills/authoring'
import { saveUserSkillManifest, subscribeToSkillDeletion } from '../skills/storage'
import { skillKey, type SkillManifest } from '../skills/types'

type Props = {
  model: ReactNode
  modelReady: boolean
  request: (prompt: string, signal: AbortSignal) => Promise<string>
  conversation: AgentMessage[]
  getCanvasContext?: () => string
  onCancel: () => void
  onAttachSkill: (skill: SkillManifest) => void
  onOpenFactory: () => void
}
type Answer = { selected: string[]; custom?: string }
const emptyAnswer: Answer = { selected: [] }
const KIND_LABELS = { text: '文本', image: '图像', video: '视频' }
const EXECUTION_LABELS = { instant: '在节点直接应用', configured: '在对话中逐步引导' }
const SOURCE_OPTIONS = [
  { id: 'scratch', label: '从零聊出一个 Skill' },
  { id: 'conversation', label: '基于当前对话创建 Skill' },
  { id: 'canvas', label: '基于当前画布创建 Skill' },
] as const

export function AgentSkillCreator({ model, modelReady, request, conversation, getCanvasContext, onCancel, onAttachSkill, onOpenFactory }: Props) {
  const [started, setStarted] = useState(false)
  const [sourceChoice, setSourceChoice] = useState<typeof SOURCE_OPTIONS[number]['id']>('scratch')
  const [source, setSource] = useState<SkillAuthorSource | null>(null)
  const [messages, setMessages] = useState<SkillAuthorMessage[]>([])
  const [questions, setQuestions] = useState<SkillAuthorQuestion[]>([])
  const [answers, setAnswers] = useState<Record<number, Answer>>({})
  const [index, setIndex] = useState(0)
  const [input, setInput] = useState('')
  const [draft, setDraft] = useState<SkillAuthorDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<SkillManifest | null>(null)
  const [failed, setFailed] = useState(false)
  const [notice, setNotice] = useState('')
  const requestRef = useRef<AbortController | null>(null)
  const saveLock = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const startRef = useRef<HTMLInputElement>(null)
  const customRef = useRef<HTMLInputElement>(null)
  const headingId = useId()
  const question = questions[index]
  const answer = answers[index] ?? emptyAnswer
  const customAnswerOpen = answer.custom !== undefined
  const canContinue = Boolean(answer.selected.length || answer.custom?.trim())
  const availableSources = SOURCE_OPTIONS.filter(({ id }) => id === 'scratch' || (id === 'conversation' ? conversation.length > 0 : getCanvasContext))
  const selectedSource = availableSources.find(({ id }) => id === sourceChoice) ?? SOURCE_OPTIONS[0]

  useEffect(() => () => requestRef.current?.abort(), [])
  useEffect(() => subscribeToSkillDeletion((key) => {
    setSaved((current) => current && skillKey(current) === key ? null : current)
  }), [])
  useEffect(() => { startRef.current?.focus() }, [])
  useEffect(() => {
    const scroll = scrollRef.current
    if (scroll) scroll.scrollTop = scroll.scrollHeight
  }, [messages, busy, saved, index, customAnswerOpen])
  useEffect(() => {
    if (customAnswerOpen) customRef.current?.focus()
  }, [index, customAnswerOpen])

  const runTurn = async (next: SkillAuthorMessage[], context = source) => {
    if (requestRef.current || saved) return
    if (!modelReady) { setNotice('请先选择一个可用的对话模型。'); return }
    const controller = new AbortController()
    requestRef.current = controller
    setMessages(next)
    setQuestions([])
    setAnswers({})
    setIndex(0)
    setNotice('')
    setFailed(false)
    setBusy(true)
    try {
      const result = parseSkillAuthorReply(await request(buildSkillAuthorPrompt(next, draft, context), controller.signal))
      if (controller.signal.aborted) return
      if (result.reply) setMessages([...next, { role: 'assistant', content: result.reply }])
      if (result.draft) setDraft(result.draft)
      setQuestions(result.questions)
    } catch (error) {
      if (!controller.signal.aborted) {
        setNotice(error instanceof Error ? error.message : '本轮请求失败。')
        setFailed(true)
      }
    } finally {
      if (!controller.signal.aborted) {
        requestRef.current = null
        setBusy(false)
      }
    }
  }

  const start = () => {
    if (selectedSource.id === 'scratch') {
      setStarted(true)
      setQuestions(SKILL_START_QUESTIONS)
      return
    }
    if (!modelReady) { setNotice('请先选择一个可用的对话模型。'); return }
    const context = selectedSource.id === 'conversation'
      ? JSON.stringify(conversation.slice(-12).map(({ role, content }) => ({
          role, text: (role === 'assistant' ? normalizeAgentMessageContent(content) : content).slice(0, 700),
        })))
      : getCanvasContext?.() ?? ''
    const nextSource = { label: selectedSource.id === 'conversation' ? '当前对话' : '当前画布', context }
    setSource(nextSource)
    setStarted(true)
    void runTurn([{ role: 'user', content: selectedSource.label }], nextSource)
  }

  const submitAnswers = (skip = false) => {
    const nextAnswers = skip ? { ...answers, [index]: emptyAnswer } : answers
    setAnswers(nextAnswers)
    if (index < questions.length - 1) { setIndex(index + 1); return }
    const summary = questions.map(({ prompt }, questionIndex) => {
      const current = nextAnswers[questionIndex] ?? emptyAnswer
      return { question: prompt, answer: [...current.selected, current.custom?.trim()].filter(Boolean).join('、') || '跳过' }
    })
    void runTurn([...messages, { role: 'user', content: summary.map((row) => `${row.question}\n${row.answer}`).join('\n\n'), answers: summary }])
  }

  const send = () => {
    const content = input.trim()
    if (!content || !modelReady || requestRef.current || saved) return
    setInput('')
    void runTurn([...messages, { role: 'user', content }])
  }

  const save = async () => {
    if (!draft || saveLock.current || saved) return
    saveLock.current = true
    setSaving(true)
    setNotice('')
    try {
      const manifest = createAuthoredSkill(draft)
      await saveUserSkillManifest(manifest)
      setSaved(manifest)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '本地保存失败，请重试。')
    } finally {
      saveLock.current = false
      setSaving(false)
    }
  }

  return <>
    <div className="agent-panel-messages-wrap">
      <div className="agent-panel-messages agent-skill-transcript" ref={scrollRef}>
        {!messages.length && <div className="agent-empty agent-skill-intro">
          <span><FilePlus2 size={19} /></span>
          <strong>把创作方法存成 Skill</strong>
          <p>聊清楚输入、交付物和创作规则，以后用一份 Skill 复用这套方法。</p>
        </div>}
        {messages.map((message, i) => message.answers
          ? <details key={i} className="agent-skill-answers">
              <summary>已回答 {message.answers.filter((item) => item.answer !== '跳过').length} / {message.answers.length} 题</summary>
              <dl>{message.answers.map(({ question, answer }, j) => <div key={j}><dt>{question}</dt><dd>{answer}</dd></div>)}</dl>
            </details>
          : <article key={i} className={`agent-message is-${message.role}`}><p>{message.content}</p></article>)}
        {busy && <div className="agent-thinking" role="status"><LoaderCircle size={14} className="is-spinning" />正在整理需求…</div>}
        {draft && !question && !busy && <section className="agent-skill-card agent-skill-preview" aria-label="Skill 草稿">
          <div className="agent-skill-card-title"><strong>{saved ? '已保存 Skill' : 'Skill 草稿'}</strong>{saved && <Check size={16} />}</div>
          {saved ? <div className="agent-skill-saved"><Wrench size={16} /><div><strong>{saved.name}</strong><p>{saved.description}</p><p>{EXECUTION_LABELS[saved.execution]}</p></div></div> : <>
            <label>名称<input value={draft.name} maxLength={80} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
            <label>用途<input value={draft.description} maxLength={300} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
            <label>内容类型<select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as SkillAuthorDraft['kind'] })}>{Object.entries(KIND_LABELS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label>
            <label>使用方式<select value={draft.execution} onChange={(event) => setDraft({ ...draft, execution: event.target.value as SkillAuthorDraft['execution'] })}>{Object.entries(EXECUTION_LABELS).map(([execution, label]) => <option key={execution} value={execution}>{label}</option>)}</select></label>
            <label>执行指令<textarea rows={5} maxLength={20000} value={draft.instructions} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} /></label>
            <button className="agent-skill-primary" type="button" disabled={saving || !draft.name.trim() || !draft.description.trim() || !draft.instructions.trim()} onClick={() => void save()}><Save size={14} />{saving ? '正在保存' : '保存 Skill'}</button>
          </>}
          {saved && <div className="agent-skill-actions">
            <button type="button" onClick={onOpenFactory}>在 Skill 工厂查看</button>
            {saved.execution === 'configured' && <button className="agent-skill-primary" type="button" onClick={() => onAttachSkill(saved)}><Plus size={14} />添加到对话</button>}
          </div>}
        </section>}
      </div>
    </div>
    <div className="agent-panel-composer agent-skill-composer">
      {!started ? <section className="agent-skill-card agent-skill-question">
        <div className="agent-skill-card-title"><strong id={headingId}>你想怎么创建 Skill？</strong></div>
        <div className="agent-skill-options" role="radiogroup" aria-labelledby={headingId}>
          {availableSources.map(({ id, label }, i) => <label key={id} className={`agent-skill-option ${selectedSource.id === id ? 'is-selected' : ''}`}>
            <input ref={i === 0 ? startRef : undefined} type="radio" name={headingId} checked={selectedSource.id === id} onChange={() => { setSourceChoice(id); setNotice('') }} />
            <span className="agent-skill-index" aria-hidden="true">{i + 1}</span><span>{label}</span>
          </label>)}
        </div>
        <div className="agent-skill-footer">
          {selectedSource.id !== 'scratch' && <div className="agent-skill-model">{model}</div>}
          <div className="agent-skill-actions">
            <button type="button" onClick={onCancel}>取消</button>
            <button className="agent-skill-primary" type="button" onClick={start}>继续</button>
          </div>
        </div>
      </section> : !saved && <section className="agent-skill-card">
        {question && <>
          <div className="agent-skill-card-title">
            <strong id={headingId}>{question.prompt}</strong>
            {questions.length > 1 && <div className="agent-skill-pagination">
              <button type="button" aria-label="上一题" disabled={!index} onClick={() => setIndex(index - 1)}><ChevronLeft size={15} /></button>
              <span aria-live="polite">{index + 1}/{questions.length}</span>
              <button type="button" aria-label="下一题" disabled={index === questions.length - 1} onClick={() => setIndex(index + 1)}><ChevronRight size={15} /></button>
            </div>}
          </div>
          <div className="agent-skill-options">
            <div role={question.multiple ? 'group' : 'radiogroup'} aria-labelledby={headingId}>
            {question.options.map((option, i) => <label key={option} className={`agent-skill-option ${answer.selected.includes(option) ? 'is-selected' : ''}`}>
              <input type={question.multiple ? 'checkbox' : 'radio'} name={headingId} checked={answer.selected.includes(option)} onChange={() => {
                const selected = question.multiple
                  ? (answer.selected.includes(option) ? answer.selected.filter((value) => value !== option) : [...answer.selected, option])
                  : [option]
                setAnswers({ ...answers, [index]: { selected, custom: question.multiple ? answer.custom : undefined } })
              }} />
              {!question.multiple && <span className="agent-skill-index" aria-hidden="true">{i + 1}</span>}
              <span>{option}</span>
            </label>)}
            </div>
            <button type="button" className={`agent-skill-option agent-skill-custom ${customAnswerOpen ? 'is-selected' : ''}`} aria-expanded={customAnswerOpen} onClick={() => setAnswers({ ...answers, [index]: { selected: question.multiple ? answer.selected : [], custom: customAnswerOpen ? undefined : '' } })}><span className="agent-skill-index" aria-hidden="true">{question.options.length + 1}</span><span>其他，我自己说</span></button>
            {answer.custom !== undefined && <input ref={customRef} aria-label="自定义回答" maxLength={1000} value={answer.custom} onChange={(event) => setAnswers({ ...answers, [index]: { ...answer, custom: event.target.value } })} />}
          </div>
        </>}
        {!question && <form className="agent-skill-input" onSubmit={(event) => { event.preventDefault(); send() }}>
          <textarea aria-label="补充 Skill 要求" placeholder={draft ? '告诉 Agent 草稿哪里需要修改…' : '补充这个 Skill 的用途、步骤或交付要求…'} rows={2} maxLength={4000} value={input} onChange={(event) => setInput(event.target.value)} />
          <button type="submit" className="agent-send-button" aria-label="发送 Skill 消息" disabled={!modelReady || busy || !input.trim()}><ArrowUp size={16} /></button>
        </form>}
        <div className="agent-skill-footer">
          <div className="agent-skill-model">{model}</div>
          {question && <div className="agent-skill-actions">
            <button type="button" onClick={() => submitAnswers(true)}>跳过</button>
            <button type="button" className="agent-skill-primary" disabled={!canContinue} onClick={() => submitAnswers()}>{index === questions.length - 1 ? '提交' : '继续'}</button>
          </div>}
          {failed && <button type="button" className="agent-skill-retry" disabled={!modelReady || busy} onClick={() => void runTurn(messages)}>重试本轮</button>}
        </div>
      </section>}
      {notice && <p className="agent-skill-notice" role="alert">{notice}</p>}
    </div>
  </>
}
