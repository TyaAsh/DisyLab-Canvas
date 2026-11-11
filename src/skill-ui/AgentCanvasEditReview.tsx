import { useId, useState } from 'react'
import { Check, FilePenLine, Focus } from 'lucide-react'
import { MAX_CANVAS_EDIT_BODY, MAX_CANVAS_EDIT_TITLE, type AgentCanvasEditDraft } from '../agentCanvasEdits'

export function AgentCanvasEditReview({ draft, onChange, onSave, onApply, onRevert, onLocate }: {
  draft: AgentCanvasEditDraft
  onChange: (update: (draft: AgentCanvasEditDraft) => AgentCanvasEditDraft) => void
  onSave: () => Promise<string | null>
  onApply: () => string | null
  onRevert: () => string | null
  onLocate: (nodeId: string) => void
}) {
  const heading = useId()
  const [issue, setIssue] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [saving, setSaving] = useState(false)
  const count = draft.edits.filter((edit) => edit.included).length
  const updateStatus = (status: AgentCanvasEditDraft['status']) => {
    setIssue('')
    setRejecting(false)
    onChange((current) => ({ ...current, status, ...(status === 'dismissed' ? { feedback: feedback.trim() || undefined } : {}) }))
  }
  const save = async () => {
    setIssue('')
    setSaving(true)
    try { setIssue(await onSave() ?? '') }
    finally { setSaving(false) }
  }
  return <section className="agent-plan-card agent-canvas-review" aria-labelledby={heading}>
    <header><span><FilePenLine size={16} aria-hidden="true" /><strong id={heading}>文本修改</strong></span>
      <em>{draft.status === 'pending' ? '待确认' : draft.status === 'draft' ? '已暂存' : draft.status === 'applied' ? '已应用' : draft.status === 'reverted' ? '已撤回' : '未采纳'}</em>
    </header>
    {draft.status === 'applied' ? <div className="agent-canvas-edit-outcome">
      <p>已修改 {count} 个节点。</p>
      {draft.edits.filter((edit) => edit.included).map((edit) => <button type="button" className="agent-canvas-edit-locate" key={edit.nodeId} onClick={() => onLocate(edit.nodeId)}><Focus size={14} aria-hidden="true" />{(edit.after.title ?? edit.before.title) || '文本'}</button>)}
      {issue && <p className="agent-plan-error" role="alert">{issue}</p>}
      <footer className="agent-plan-actions"><button type="button" className="agent-plan-cancel" onClick={() => setIssue(onRevert() ?? '')}>撤回这批修改</button></footer>
    </div> : draft.status === 'reverted' ? <p className="agent-canvas-edit-hint">这批修改已撤回。</p> : draft.status === 'dismissed' ? (draft.feedback && <p className="agent-canvas-edit-hint">未采纳原因：{draft.feedback}</p>) : draft.status === 'draft' ? <footer className="agent-plan-actions">
      <button type="button" className="agent-plan-confirm" onClick={() => updateStatus('pending')}>继续审阅</button>
    </footer> : <>
      <p className="agent-canvas-edit-hint">只更新勾选的节点。展开可对照原文、微调建议。</p>
      <div className="agent-canvas-edit-list">
        {draft.edits.map((edit, index) => <div className="agent-canvas-edit-row" key={edit.nodeId}>
          <label className="agent-canvas-edit-pick">
            <input type="checkbox" checked={edit.included} disabled={saving} onChange={(event) => {
              const included = event.target.checked
              setIssue('')
              onChange((current) => ({ ...current, edits: current.edits.map((item) => item.nodeId === edit.nodeId ? { ...item, included } : item) }))
            }} />
            <span>{edit.before.title || `文本 ${index + 1}`}</span>
          </label>
          <details>
            <summary>对照并编辑</summary>
            {(['title', 'body'] as const).map((field) => {
              if (edit.after[field] === undefined) return null
              const noun = field === 'title' ? '标题' : '正文'
              const value = edit.after[field]
              const update = (text: string) => {
                setIssue('')
                onChange((current) => ({ ...current, edits: current.edits.map((item) => item.nodeId === edit.nodeId ? { ...item, after: { ...item.after, [field]: text } } : item) }))
              }
              return <div className="agent-canvas-edit-field" key={field}>
                <small>原{noun}</small>
                <div className="agent-canvas-edit-before">{edit.before[field] || '（空）'}</div>
                <label><small>修改后的{noun}</small>
                  {field === 'title' ? <input value={value} disabled={saving} maxLength={MAX_CANVAS_EDIT_TITLE} onChange={(event) => update(event.target.value)} />
                    : <textarea rows={4} value={value} disabled={saving} maxLength={MAX_CANVAS_EDIT_BODY} onChange={(event) => update(event.target.value)} />}
                </label>
              </div>
            })}
          </details>
        </div>)}
      </div>
      {issue && <p className="agent-plan-error" role="alert">{issue}</p>}
      {rejecting ? <div className="agent-canvas-edit-reject">
        <label>未采纳原因（选填）<input value={feedback} maxLength={300} placeholder="例如：我想保留原来的语气" onChange={(event) => setFeedback(event.target.value)} /></label>
        <footer className="agent-plan-actions"><button type="button" className="agent-plan-cancel" onClick={() => setRejecting(false)}>返回</button><button type="button" className="agent-plan-cancel" onClick={() => updateStatus('dismissed')}>确认不采纳</button></footer>
      </div> : <footer className="agent-plan-actions">
        <button type="button" className="agent-plan-cancel" disabled={saving} onClick={() => { setIssue(''); setRejecting(true) }}>不采纳</button>
        <button type="button" className="agent-plan-cancel" disabled={saving} onClick={() => void save()}>{saving ? '暂存中…' : '暂存'}</button>
        <button type="button" className="agent-plan-confirm" disabled={!count || saving} onClick={() => setIssue(onApply() ?? '')}><Check size={15} aria-hidden="true" />应用 {count} 项修改</button>
      </footer>}
    </>}
  </section>
}
