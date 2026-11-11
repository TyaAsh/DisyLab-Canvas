import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Check, ChevronDown, MessageCircle } from 'lucide-react'

type ModelBrand = 'openai' | 'gemini' | 'claude' | 'doubao' | 'jimeng' | 'kimi' | 'grok' | 'deepseek' | 'qwen' | 'glm' | 'minimax' | 'google' | 'generic'
export type SelectOption = { value: string; label: string; detail?: string; brand?: ModelBrand }

const brandMeta: Record<ModelBrand, { label: string; glyph: string; color: string; background: string }> = {
  openai: { label: 'OpenAI', glyph: '◎', color: '#e8f3ef', background: 'rgba(90, 145, 128, .2)' },
  gemini: { label: 'Gemini', glyph: '✦', color: '#9fc5ff', background: 'rgba(68, 119, 216, .2)' },
  claude: { label: 'Claude', glyph: 'C', color: '#e8b994', background: 'rgba(181, 102, 55, .2)' },
  doubao: { label: '豆包', glyph: '豆', color: '#a9b8ff', background: 'rgba(92, 104, 224, .2)' },
  jimeng: { label: '即梦', glyph: '即', color: '#f1a8dc', background: 'rgba(203, 72, 161, .2)' },
  google: { label: 'Google', glyph: 'G', color: '#9fcbff', background: 'rgba(65, 133, 221, .2)' },
  kimi: { label: 'Kimi', glyph: 'K', color: '#b9b6ff', background: 'rgba(116, 103, 224, .2)' },
  grok: { label: 'Grok', glyph: 'xAI', color: '#e4e9ed', background: 'rgba(155, 165, 174, .18)' },
  deepseek: { label: 'DeepSeek', glyph: 'D', color: '#8ac8ff', background: 'rgba(57, 133, 214, .2)' },
  qwen: { label: '通义', glyph: 'Q', color: '#8ed9c2', background: 'rgba(53, 165, 130, .2)' },
  glm: { label: '智谱', glyph: 'GLM', color: '#d0b5ff', background: 'rgba(130, 91, 210, .2)' },
  minimax: { label: 'MiniMax', glyph: 'M', color: '#ffb69b', background: 'rgba(218, 103, 67, .2)' },
  generic: { label: 'AI 模型', glyph: 'AI', color: '#b8c1cb', background: 'rgba(126, 139, 153, .16)' },
}

export function getModelBrand(name: string): ModelBrand {
  const normalized = name.toLowerCase().replace(/[\s_-]+/g, '')
  if (/gpt|openai|dall|sora/.test(normalized)) return 'openai'
  if (/gemini/.test(normalized)) return 'gemini'
  if (/claude|anthropic/.test(normalized)) return 'claude'
  if (/即梦|jimeng|dreamina|seedream|seedance/.test(normalized)) return 'jimeng'
  if (/豆包|doubao/.test(normalized)) return 'doubao'
  if (/kimi|moonshot/.test(normalized)) return 'kimi'
  if (/grok|xai/.test(normalized)) return 'grok'
  if (/deepseek/.test(normalized)) return 'deepseek'
  if (/qwen|通义|tongyi|千问/.test(normalized)) return 'qwen'
  if (/glm|智谱|chatglm|zhipu/.test(normalized)) return 'glm'
  if (/minimax|hailuo|海螺/.test(normalized)) return 'minimax'
  if (/nanobanana|imagen|google/.test(normalized)) return 'google'
  return 'generic'
}

const brandMarkStyle: CSSProperties = {
  width: 20,
  height: 20,
  flex: '0 0 20px',
  borderRadius: 7,
  display: 'inline-grid',
  placeItems: 'center',
  fontSize: 8,
  fontWeight: 800,
  lineHeight: 1,
  letterSpacing: '-.02em',
}

function ModelBrandMark({ brand }: { brand: ModelBrand }) {
  const meta = brandMeta[brand]
  return (
    <span
      aria-hidden="true"
      title={meta.label}
      style={{ ...brandMarkStyle, color: meta.color, background: meta.background }}
    >
      {meta.glyph}
    </span>
  )
}

export function AgentSelect({ ariaLabel, value, placeholder, options, icon, onChange, className = '', variant = 'default', disabled = false }: {
  ariaLabel: string
  value: string
  placeholder: string
  options: SelectOption[]
  icon: ReactNode
  onChange: (value: string) => void
  className?: string
  variant?: 'default' | 'conversation' | 'floating'
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  const selected = options.find((option) => option.value === value)

  useLayoutEffect(() => {
    if (!open || variant !== 'floating') return
    const menu = menuRef.current
    const trigger = triggerRef.current
    if (!menu || !trigger) return
    const rect = trigger.getBoundingClientRect()
    const below = window.innerHeight - rect.bottom - 14
    const above = rect.top - 14
    const upward = below < 210 && above > below
    menu.style.left = `${Math.max(8, rect.left)}px`
    menu.style.width = `${Math.min(rect.width, window.innerWidth - Math.max(8, rect.left) - 8)}px`
    menu.style.top = upward ? 'auto' : `${rect.bottom + 5}px`
    menu.style.bottom = upward ? `${window.innerHeight - rect.top + 5}px` : 'auto'
    menu.style.maxHeight = `${Math.min(260, upward ? above : below)}px`
    menu.showPopover()
    const close = () => setOpen(false)
    const pane = trigger.closest('.agent-project-pane, .agent-panel-messages')
    pane?.addEventListener('scroll', close)
    window.addEventListener('resize', close)
    return () => {
      pane?.removeEventListener('scroll', close)
      window.removeEventListener('resize', close)
      if (menu.matches(':popover-open')) menu.hidePopover()
    }
  }, [open, variant])

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  useEffect(() => {
    if (!open) return
    const optionButtons = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')
    const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value))
    window.requestAnimationFrame(() => optionButtons?.[selectedIndex]?.focus())
  }, [open, value])

  const moveOptionFocus = (direction: 1 | -1) => {
    const optionButtons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])]
    if (!optionButtons.length) return
    const currentIndex = optionButtons.indexOf(document.activeElement as HTMLButtonElement)
    optionButtons[(currentIndex + direction + optionButtons.length) % optionButtons.length]?.focus()
  }

  const selectedBrand = selected?.brand

  return (
    <div ref={rootRef} className={`agent-custom-select ${className} ${open ? 'is-open' : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        className="agent-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        <span className="agent-select-icon" style={{ width: 20, display: 'inline-grid', placeItems: 'center' }}>
          {selectedBrand ? <ModelBrandMark brand={selectedBrand} /> : icon}
        </span>
        <span className={`agent-select-value ${selected ? '' : 'is-placeholder'}`}>{selected?.label ?? placeholder}</span>
        <ChevronDown size={14} className="agent-select-chevron" />
      </button>
      {open && !disabled && (
        <div
          ref={menuRef}
          id={menuId}
          className={`agent-select-menu is-${variant}`}
          popover={variant === 'floating' ? 'manual' : undefined}
          role="listbox"
          aria-label={`${ariaLabel}选项`}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              setOpen(false)
              rootRef.current?.querySelector<HTMLButtonElement>('.agent-select-trigger')?.focus()
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              moveOptionFocus(event.key === 'ArrowDown' ? 1 : -1)
            } else if (event.key === 'Home' || event.key === 'End') {
              event.preventDefault()
              const optionButtons = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')
              optionButtons?.[event.key === 'Home' ? 0 : optionButtons.length - 1]?.focus()
            }
          }}
        >
          {variant === 'conversation' && <div className="agent-select-menu-heading" aria-hidden="true">对话记录</div>}
          {options.length ? options.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={option.value === value ? 'is-selected' : ''}
              key={option.value}
              onClick={() => {
                onChange(option.value)
                setOpen(false)
                window.requestAnimationFrame(() => rootRef.current?.querySelector<HTMLButtonElement>('.agent-select-trigger')?.focus())
              }}
            >
              <span className="agent-select-option-main">
                {option.brand && <ModelBrandMark brand={option.brand} />}
                {variant === 'conversation' && <MessageCircle size={15} aria-hidden="true" />}
                <span className="agent-select-option-text"><strong>{option.label}</strong>{option.detail && <small>{option.detail}</small>}</span>
              </span>
              {option.value === value && <Check size={14} />}
            </button>
          )) : <p>暂无可用选项</p>}
        </div>
      )}
    </div>
  )
}
