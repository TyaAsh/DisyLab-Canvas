import { useEffect, useState } from 'react'
import type { FilmReview, FilmReviewAnswer } from '../skills/filmProduction'

function ReviewAsset({ asset }: { asset: NonNullable<FilmReview['assets']>[number] }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    const objectUrl = URL.createObjectURL(asset.blob)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [asset.blob])
  if (!url) return null
  return asset.kind === 'video'
    ? <video src={url} controls playsInline preload="metadata" aria-label={asset.label} />
    : <img src={url} alt={asset.label} />
}

export function AgentFilmReview({ stage, onAnswer }: { stage: FilmReview; onAnswer: (answer: FilmReviewAnswer) => void }) {
  const [selected, setSelected] = useState(0)
  const [editing, setEditing] = useState(false)
  const [notes, setNotes] = useState('')
  const assetSelection = stage.chooseAsset && (stage.title !== '检查视频镜头' || editing)
  return <section className="agent-plan-card agent-film-card" aria-label={stage.title}>
    <strong>{stage.title}</strong>
    <p>{stage.assets?.length ? (assetSelection ? '选一个你想用的版本，或者告诉我怎么改。' : '看看这一批画面是否符合你的想法。') : '看看这一步的安排，满意就继续。'}</p>
    {!stage.assets?.length && <details><summary>查看这一步</summary><p>{stage.summary}</p></details>}
    {!!stage.assets?.length && <div className="agent-film-assets">
      {stage.assets.map((asset, index) => <figure key={index}>
        <ReviewAsset asset={asset} />
        <figcaption>{assetSelection
          ? <button type="button" className="agent-plan-cancel" aria-pressed={selected === index} onClick={() => setSelected(index)}>{asset.label}{selected === index ? ' · 已选' : ''}</button>
          : asset.label}</figcaption>
      </figure>)}
    </div>}
    {editing && <label className="agent-film-revision">想怎么改？
      <textarea autoFocus value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1400} placeholder="例如：画面再亮一点" />
      {stage.paidRevision && <small>重新生成会产生费用。</small>}
    </label>}
    <div className="agent-plan-actions">
      <button type="button" className="agent-plan-cancel" onClick={() => setEditing(!editing)}>{editing ? '取消修改' : '我想改一下'}</button>
      {editing
        ? <button type="button" className="agent-plan-confirm" disabled={!notes.trim()} onClick={() => onAnswer({ action: 'revise', selected, notes: notes.trim() })}>{stage.paidRevision ? '重新生成' : '更新这一步'}</button>
        : <button type="button" className="agent-plan-confirm" onClick={() => onAnswer({ action: 'continue', selected, notes: '' })}>确认，继续</button>}
    </div>
  </section>
}
