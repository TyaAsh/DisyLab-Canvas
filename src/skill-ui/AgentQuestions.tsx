import { useEffect, useId, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { AgentQuestion } from '../agent'

type Answer = { text: string; custom?: string; useCustom?: boolean; skipped?: boolean }

export function AgentQuestions({ questions, onSubmit }: {
  questions: AgentQuestion[]
  onSubmit: (answers: string) => void
}) {
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Answer[]>([])
  const headingId = useId()
  const headingRef = useRef<HTMLElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const question = questions[index]
  const answer = answers[index]
  const isLast = index === questions.length - 1
  const hasOptions = question.options.length > 0
  const example = /品牌名|产品名|品牌或产品|品牌是什么/.test(question.prompt) ? '例如，Disy' : question.example

  useEffect(() => {
    if (!hasOptions) inputRef.current?.focus()
    else headingRef.current?.focus()
  }, [index, hasOptions])

  const replaceAnswer = (next: Answer) => {
    const updated = answers.slice()
    updated[index] = next
    setAnswers(updated)
    return updated
  }

  const advance = (skip = false) => {
    if (!skip && !answer?.text.trim()) return
    const next = skip ? replaceAnswer({ text: '', skipped: true }) : answers
    if (!isLast) { setIndex(index + 1); return }
    const incomplete = questions.findIndex((_, questionIndex) => {
      const item = next[questionIndex]
      return !item?.skipped && !item?.text.trim()
    })
    if (incomplete !== -1) { setIndex(incomplete); return }
    onSubmit(questions.map(({ prompt }, questionIndex) => {
      const item = next[questionIndex]
      return `${prompt}\n${item.skipped ? '先跳过' : item.text.trim()}`
    }).join('\n\n'))
  }

  return <section className="agent-skill-card agent-guided-questions" aria-labelledby={headingId}>
    <header className="agent-skill-card-title">
      <strong ref={headingRef} id={headingId} tabIndex={-1}>{question.prompt}</strong>
      {questions.length > 1 && <div className="agent-skill-pagination">
        <button type="button" aria-label="上一题" disabled={index === 0} onClick={() => setIndex(index - 1)}><ChevronLeft size={16} /></button>
        <span aria-live="polite">{index + 1}/{questions.length}</span>
        <button type="button" aria-label="下一题" disabled={isLast} onClick={() => setIndex(index + 1)}><ChevronRight size={16} /></button>
      </div>}
    </header>
    {hasOptions && <div className="agent-skill-options">
      <div role="radiogroup" aria-labelledby={headingId}>
      {question.options.map((option, optionIndex) => {
        const selected = !answer?.useCustom && answer?.text === option
        return <label key={option} className={`agent-skill-option ${selected ? 'is-selected' : ''}`}>
          <input type="radio" name={headingId} checked={selected} onChange={() => replaceAnswer({ text: option, custom: answer?.custom })} />
          <span className="agent-skill-index" aria-hidden="true">{optionIndex + 1}</span>
          <span>{option}</span>
        </label>
      })}
      </div>
      <label className={`agent-guided-custom ${answer?.useCustom ? 'is-selected' : ''}`}>
        <span className="agent-skill-index" aria-hidden="true">{question.options.length + 1}</span>
        <input key={index} type="text" aria-label="自由回复" placeholder={example || '自由回复，输入你的想法'} maxLength={1800}
          value={answer?.custom ?? ''} onChange={(event) => replaceAnswer({ text: event.target.value, custom: event.target.value, useCustom: true })}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing || !answer?.useCustom) return
            event.preventDefault()
            advance()
          }} />
      </label>
    </div>}
    {!hasOptions && <input key={index} ref={inputRef} type="text" className="agent-guided-answer" aria-labelledby={headingId}
      placeholder={example || '在这里输入你的想法'} value={answer?.text ?? ''} maxLength={1800}
      onChange={(event) => replaceAnswer({ text: event.target.value })}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
        event.preventDefault()
        advance()
      }} />}
    <footer className="agent-skill-footer">
      <div className="agent-skill-actions">
        <button type="button" onClick={() => advance(true)}>跳过</button>
        <button type="button" className="agent-skill-primary" disabled={!answer?.text.trim()} onClick={() => advance()}>{isLast ? '提交' : '继续'}</button>
      </div>
    </footer>
  </section>
}
