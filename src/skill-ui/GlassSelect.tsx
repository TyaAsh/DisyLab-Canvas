import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'

type Option = { value: string; label: string }

export function GlassSelect({ value, options, onChange, ariaLabel }: { value: string; options: Option[]; onChange: (value: string) => void; ariaLabel?: string }) {
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({})
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  useLayoutEffect(() => {
    if (!open) return
    const placeMenu = () => {
      const rect = rootRef.current?.getBoundingClientRect()
      if (!rect) return
      const spaceBelow = window.innerHeight - rect.bottom
      const openBelow = spaceBelow >= 220 || rect.top < spaceBelow
      setMenuStyle({
        position: 'fixed',
        zIndex: 1000,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)),
        width: rect.width,
        maxHeight: Math.max(120, openBelow ? spaceBelow - 12 : rect.top - 12),
        overflowY: 'auto',
        ...(openBelow ? { top: rect.bottom + 7 } : { bottom: window.innerHeight - rect.top + 7 }),
      })
    }
    placeMenu()
    window.addEventListener('resize', placeMenu)
    window.addEventListener('scroll', placeMenu, true)
    return () => { window.removeEventListener('resize', placeMenu); window.removeEventListener('scroll', placeMenu, true) }
  }, [open])
  const selected = options.find((option) => option.value === value) ?? options[0]
  return <div ref={rootRef} className={`skill-glass-select ${open ? 'is-open' : ''}`}>
    <button type="button" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}><span>{selected?.label}</span><ChevronDown size={15} /></button>
    {open && createPortal(<div className="skill-glass-select-menu" role="listbox" style={menuStyle} onPointerDown={(event) => event.stopPropagation()}>{options.map((option) => <button type="button" role="option" aria-selected={option.value === value} className={option.value === value ? 'is-selected' : ''} key={option.value} onClick={() => { onChange(option.value); setOpen(false) }}><span>{option.label}</span>{option.value === value && <Check size={14} />}</button>)}</div>, document.body)}
  </div>
}
