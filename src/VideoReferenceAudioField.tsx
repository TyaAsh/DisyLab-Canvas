import { useId, useState } from 'react'
import { Link2, Music2, Plus, X } from 'lucide-react'
import { publicImageSourceUrl } from './imageApi'

export function VideoReferenceAudioField({ value, limit, assetOnly, onChange }: {
  value: string
  limit?: number
  assetOnly: boolean
  onChange: (value: string) => void
}) {
  const id = useId()
  const [draft, setDraft] = useState('')
  const [draftError, setDraftError] = useState('')
  const [editing, setEditing] = useState<{ index: number; link: string }>()
  const links = value ? value.split(/\r?\n/) : []
  const count = links.filter((link) => link.trim()).length
  const full = limit !== undefined && count >= limit
  const excess = limit === undefined ? 0 : Math.max(0, count - limit)
  const formatError = assetOnly ? '请输入已审核的 asset:// 地址' : '请输入可公开访问的 HTTP(S) 链接'
  const isValid = (link: string) => assetOnly ? /^asset:\/\/[A-Za-z0-9_-]+$/.test(link)
    : Boolean(publicImageSourceUrl(link))
  const invalidLinks = links.map((link, index) => {
    const current = (editing?.index === index ? editing.link : link).trim()
    return Boolean(current) && !isValid(current)
  })
  const addLinks = (text: string) => {
    const next = text.split(/\r?\n/).map((link) => link.trim()).filter(Boolean)
    if (!next.length) return
    if (limit !== undefined && count + next.length > limit) {
      setDraftError(`最多添加 ${limit} 条音频链接`)
      return
    }
    if (next.some((link) => !isValid(link))) {
      setDraftError(formatError)
      return
    }
    onChange([...links.filter((link) => link.trim()), ...next].join('\n'))
    setDraft('')
    setDraftError('')
  }

  return <section className="video-reference-audio-section" aria-labelledby={`${id}-title`}>
    <div className="video-reference-audio">
      <div className="video-reference-audio-heading">
        <Music2 size={14} aria-hidden="true" />
        <h3 id={`${id}-title`}>参考音频</h3>
        <span className="video-reference-audio-count" data-over-limit={excess > 0}>
          {limit === undefined ? `${count} 条` : `${count} / ${limit}`}
        </span>
      </div>
      {excess > 0 && <p className="video-reference-audio-error" role="status">超出上限，请移除 {excess} 条链接。</p>}
      {links.length > 0 && <ol className="video-reference-audio-list">
        {links.map((link, index) => {
          const currentLink = editing?.index === index ? editing.link : link
          const invalid = invalidLinks[index]
          return <li key={index}>
            <div className="video-reference-audio-field">
              <Link2 size={13} aria-hidden="true" />
              <input type="text" inputMode="url" spellCheck={false} autoComplete="off" value={currentLink}
                placeholder={assetOnly ? 'asset://…' : 'https://…'}
                aria-label={`音频链接 ${index + 1}`} aria-invalid={invalid}
                aria-describedby={invalid ? `${id}-link-format` : undefined}
                onChange={(event) => setEditing({ index, link: event.target.value })}
                onBlur={() => {
                  if (editing?.index !== index) return
                  setEditing(undefined)
                  const nextLink = editing.link.trim()
                  if (nextLink !== link) onChange(links.map((item, itemIndex) => itemIndex === index ? nextLink : item)
                    .filter((item) => item.trim()).join('\n'))
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  event.stopPropagation()
                  event.currentTarget.blur()
                }} />
              <button type="button" className="video-audio-link-remove" aria-label={`移除音频链接 ${index + 1}`}
                onClick={() => onChange(links.filter((_, itemIndex) => itemIndex !== index).join('\n'))}>
                <X size={13} aria-hidden="true" />
              </button>
            </div>
          </li>
        })}
      </ol>}
      {invalidLinks.some(Boolean) && <p id={`${id}-link-format`} className="video-reference-audio-error">
        标出的链接格式有误，{formatError.replace('请输入', '请改为')}。
      </p>}
      {!full && <div className="video-reference-audio-field is-add">
        <Link2 size={13} aria-hidden="true" />
        <input type="text" inputMode="url" spellCheck={false} autoComplete="off" value={draft}
          placeholder={assetOnly ? '粘贴 asset:// 地址' : '粘贴音频链接'} aria-label="添加参考音频链接"
          aria-invalid={Boolean(draftError)} aria-describedby={draftError ? `${id}-draft-error` : undefined}
          onChange={(event) => { setDraft(event.target.value); setDraftError('') }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            event.stopPropagation()
            addLinks(draft)
          }}
          onPaste={(event) => {
            const text = event.clipboardData.getData('text')
            if (!/\r?\n/.test(text)) return
            event.preventDefault()
            addLinks(text)
          }} />
        <button type="button" className="video-audio-link-add" onClick={() => addLinks(draft)} disabled={!draft.trim()}>
          <Plus size={13} aria-hidden="true" />添加
        </button>
      </div>}
      {!full && draftError && <p id={`${id}-draft-error`} className="video-reference-audio-error" role="status">{draftError}</p>}
    </div>
  </section>
}
