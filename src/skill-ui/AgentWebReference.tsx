import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { motion, useIsPresent, useReducedMotion } from 'framer-motion'
import { AlignLeft, ChevronDown, ExternalLink, Link2, LoaderCircle, Plus, X } from 'lucide-react'
import type { AgentWebReference } from '../agent'
import { publicAgentReferenceUrl } from '../agentWebReference'

export function AgentWebDisclosure({ label, open, onToggle, children, className = '' }: {
  label: string; open: boolean; onToggle: () => void; children: ReactNode; className?: string
}) {
  const id = useId()
  return <div className={`agent-web-disclosure ${className}`}>
    <button type="button" aria-expanded={open} aria-controls={id} onClick={onToggle}>
      <ChevronDown size={14} aria-hidden="true" />{label}
    </button>
    <div id={id} className="agent-web-collapse" data-expanded={open} inert={!open} aria-hidden={!open}>
      <div className="agent-web-collapse-content">{children}</div>
    </div>
  </div>
}

export function AgentWebReferenceCard({ reference, onReuse, onSave, onRemove }: {
  reference: AgentWebReference
  onReuse?: () => void
  onSave?: () => void
  onRemove?: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  let source: URL | undefined
  try { source = publicAgentReferenceUrl(reference.url) } catch { /* Imported chats can contain untrusted links. */ }
  return <section className="agent-web-card" aria-label="网页参考卡">
    <div className="agent-web-card-title">
      <Link2 size={14} aria-hidden="true" />
      <strong>{reference.title}</strong>
      {onRemove && <button type="button" aria-label={`移除网页参考 ${reference.title}`} onClick={onRemove}><X size={15} /></button>}
    </div>
    {source && <a href={source.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"><ExternalLink size={13} aria-hidden="true" />{source.href}</a>}
    <AgentWebDisclosure label="查看网页摘要" open={expanded} onToggle={() => setExpanded((value) => !value)}>
      <p>{reference.summary}</p>
      <ul>{reference.observations.map((item, index) => <li key={index}>{item}</li>)}</ul>
      <p className="agent-web-scope">{reference.pasted ? '基于用户粘贴的网页文本。' : '基于读取的网页文本。'}实际配色、字体和画面请结合截图核对。{reference.limitation}</p>
    </AgentWebDisclosure>
    {(onReuse || onSave) && <div className="agent-web-card-actions">
      {onReuse && <button type="button" onClick={onReuse}>引用到输入框</button>}
      {onSave && <button type="button" onClick={onSave}>加入画布</button>}
    </div>}
  </section>
}

export function AgentWebReferenceInput({ initialUrl, onRead, onAttach, onClose }: {
  initialUrl: string
  onRead: (url: URL, signal: AbortSignal, pastedText?: string) => Promise<AgentWebReference>
  onAttach: (reference: AgentWebReference) => void
  onClose: () => void
}) {
  const [url, setUrl] = useState(initialUrl)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [usePastedText, setUsePastedText] = useState(false)
  const [pastedText, setPastedText] = useState('')
  const task = useRef<AbortController | null>(null)
  const pastedFieldId = useId()
  const present = useIsPresent()
  const reducedMotion = useReducedMotion()
  useEffect(() => () => task.current?.abort(), [])
  useEffect(() => { if (!present) task.current?.abort() }, [present])

  return <motion.div className="agent-web-input-motion" inert={!present}
    initial={reducedMotion ? false : { height: 0, opacity: 0 }}
    animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
    transition={{ duration: reducedMotion ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] }}>
    <form className="agent-web-input" aria-label="读取公开网页" onKeyDown={(event) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose() }
  }} onSubmit={async (event) => {
    event.preventDefault()
    if (task.current) return
    const controller = new AbortController()
    task.current = controller
    setBusy(true)
    setError('')
    try {
      if (usePastedText && pastedText.trim().length < 40) throw new Error('请粘贴至少 40 字网页正文')
      const reference = await onRead(publicAgentReferenceUrl(url), controller.signal, usePastedText ? pastedText.trim() : undefined)
      if (!controller.signal.aborted) onAttach(reference)
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '读取网页失败')
    } finally {
      task.current = null
      if (!controller.signal.aborted) setBusy(false)
    }
  }}>
    <p className="agent-web-input-intro">把产品页、案例或文章里的卖点和文案要点带进这轮对话。</p>
    <div className="agent-web-source-options" role="group" aria-label="网页内容来源">
      <button type="button" aria-pressed={!usePastedText} disabled={busy} onClick={() => { setUsePastedText(false); setError('') }}>
        <Link2 size={14} aria-hidden="true" />读取链接
      </button>
      <button type="button" aria-pressed={usePastedText} aria-controls={pastedFieldId} disabled={busy} onClick={() => { setUsePastedText(true); setError('') }}>
        <AlignLeft size={14} aria-hidden="true" />粘贴正文
      </button>
    </div>
    <label><strong>{usePastedText ? '原文链接' : '网页链接'}</strong><input autoFocus value={url} onChange={(event) => { setUrl(event.target.value); setError('') }} placeholder="https://…" required type="url" disabled={busy} /></label>
    <div id={pastedFieldId} className="agent-web-collapse" data-expanded={usePastedText} inert={!usePastedText}>
      <div className="agent-web-collapse-content"><label><strong>网页正文</strong><textarea value={pastedText} disabled={busy || !usePastedText}
        rows={3} maxLength={18000} placeholder="粘贴要参考的段落" onChange={(event) => setPastedText(event.target.value)} /></label></div>
    </div>
    {error && <p className="agent-draft-error" role="alert">{error}</p>}
    <div className="agent-web-card-actions">
      <button type="button" onClick={onClose}>{busy ? '停止读取' : '取消'}</button>
      <button type="submit" disabled={busy}>{busy ? <LoaderCircle size={14} className="is-spinning" aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}{busy ? '正在整理…' : '添加到本轮参考'}</button>
    </div>
    <small className="agent-web-scope">{usePastedText ? '原文链接会保留在参考卡上。' : '链接由 Jina Reader 读取，正文交给所选对话模型处理。'}</small>
  </form></motion.div>
}
