/*!
 * Copyright (c) 2026 DisyLab. All rights reserved.
 * SPDX-License-Identifier: LicenseRef-DisyLab-Proprietary
 */
import { useState } from 'react'
import { Focus, Image as ImageIcon } from 'lucide-react'
import type { AgentImageOperationDraft } from '../agentImageOperations'

export function AgentImageOperationReview({ draft, onApply, onLocate }: {
  draft: AgentImageOperationDraft
  onApply: (indices: number[]) => Promise<void>
  onLocate?: (nodeId: string) => void
}) {
  const [excluded, setExcluded] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const selected = draft.regions.map((_, index) => index).filter((index) => !excluded.includes(index))
  const split = draft.kind === 'split'
  const completed = draft.completedNodeIds
  const conflict = split && draft.requestedCount && draft.requestedCount !== draft.regions.length
  return <section className="agent-plan-card agent-image-plan-card" aria-label={split ? '分镜拆图' : '图片放大'}>
    <header><span><ImageIcon size={16} />{split ? '分镜拆图' : '图片放大'}</span><em>{completed ? '已加入画布' : '待确认'}</em></header>
    {completed ? <>
      <p>已保存 {completed.length} 张独立图片</p>
      {onLocate && <div className="agent-plan-actions"><button type="button" className="agent-plan-cancel" onClick={() => onLocate(completed[0])}><Focus size={14} />查看画布结果</button></div>}
    </> : <>
      {conflict ? <p>原图识别到 {draft.regions.length} 格，你要求 {draft.requestedCount} 张。可点击图上的编号选择镜头，或确认拆出全部。</p> : split && <p>识别到 {draft.regions.length} 格。按图中编号输出，保留每格原画幅。</p>}
      <div className="agent-image-operation-preview">
        <img src={draft.previewUrl} alt={split ? '待拆分的分镜原图' : '待放大的原图'} />
        {split && draft.regions.map(([left, top, right, bottom], index) => <button
          key={index} type="button" aria-label={`镜头 ${index + 1}`} aria-pressed={!excluded.includes(index)} disabled={busy}
          style={{ left: `${left / 10}%`, top: `${top / 10}%`, width: `${(right - left) / 10}%`, height: `${(bottom - top) / 10}%` }}
          onClick={() => setExcluded((current) => current.includes(index) ? current.filter((item) => item !== index) : [...current, index])}
        ><span>{index + 1}</span></button>)}
      </div>
      <div className="agent-plan-actions">
        {conflict && draft.requestedCount! < draft.regions.length && <button type="button" className="agent-plan-cancel" disabled={busy}
          onClick={() => setExcluded(draft.regions.map((_, index) => index).slice(draft.requestedCount))}>选择前 {draft.requestedCount} 格</button>}
        <span className="agent-image-plan-confirm-note">{draft.longEdge ? `按原画幅放大至长边至少 ${draft.longEdge}px` : '按原始像素裁切'} · 本地处理</span>
        <button type="button" className="agent-plan-confirm" disabled={busy || !selected.length} onClick={async () => {
          setBusy(true)
          setError('')
          try { await onApply(selected) }
          catch (failure) { setError(failure instanceof Error ? failure.message : '处理失败，请重试') }
          finally { setBusy(false) }
        }}>{busy ? '正在处理…' : split ? `确认拆出${selected.length === draft.regions.length ? '全部 ' : ' '}${selected.length} 张` : '确认放大'}</button>
      </div>
      {error && <p className="agent-plan-error" role="alert">{error}</p>}
    </>}
  </section>
}
