import { useCallback, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Info, X } from 'lucide-react'

type DialogOptions = {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

type DialogState = DialogOptions & { mode: 'confirm' | 'alert' }

const backdropClass = 'fixed inset-0 z-[var(--z-critical)] grid place-items-center bg-[rgba(2,4,3,.78)] p-[22px] backdrop-blur-[10px]'
const dialogClass = 'w-[min(430px,100%)] rounded-[18px] border border-[var(--disy-glass-border)] bg-[var(--disy-glass-panel)] p-[18px] text-ink shadow-[var(--disy-glass-shadow)]'
const headerClass = 'flex h-8 items-center justify-between'
const iconClass = 'grid size-8 place-items-center rounded-[10px] bg-[var(--accent-soft)] text-accent'
const closeClass = 'grid size-[30px] place-items-center rounded-[9px] bg-transparent text-muted transition-colors hover:bg-white/6 hover:text-ink'
const footerButtonClass = 'min-h-9 rounded-[10px] border border-[var(--line)] bg-white/[.045] px-[14px] text-[10px] font-bold text-ink transition-[transform,background,color,filter,box-shadow] hover:bg-white/8'
const primaryButtonClass = 'border-transparent bg-[var(--brand-gradient)] text-[#0b1113] shadow-[0_8px_24px_rgba(82,132,255,.18),inset_0_1px_rgba(255,255,255,.28)] hover:-translate-y-px hover:brightness-105 hover:saturate-[1.08] hover:bg-[var(--brand-gradient-hover)] hover:shadow-[0_12px_30px_rgba(89,132,255,.28),0_0_0_1px_rgba(176,210,255,.22),inset_0_1px_rgba(255,255,255,.38)]'
const dangerButtonClass = 'border-[rgba(238,112,104,.45)] bg-[#a94440] text-white hover:bg-[#b84d48]'

export function useProjectDialog() {
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const resolverRef = useRef<((value: boolean) => void) | null>(null)

  const settle = useCallback((value: boolean) => {
    resolverRef.current?.(value)
    resolverRef.current = null
    setDialog(null)
  }, [])

  const confirm = useCallback((options: DialogOptions) => new Promise<boolean>((resolve) => {
    resolverRef.current?.(false)
    resolverRef.current = resolve
    setDialog({ ...options, mode: 'confirm' })
  }), [])

  const alert = useCallback((options: Omit<DialogOptions, 'cancelLabel'>) => new Promise<void>((resolve) => {
    resolverRef.current?.(false)
    resolverRef.current = () => resolve()
    setDialog({ ...options, mode: 'alert' })
  }), [])

  const dialogNode = <AnimatePresence>
    {dialog && <motion.div className={backdropClass} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => settle(false)}>
      <motion.section role="dialog" aria-modal="true" aria-labelledby="project-dialog-title" className={`${dialogClass} ${dialog.danger ? 'border-[rgba(238,112,104,.32)]' : ''}`} initial={{ opacity: 0, y: 12, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: .985 }} onClick={(event) => event.stopPropagation()}>
        <header className={headerClass}>
          <span className={`${iconClass} ${dialog.danger ? 'bg-[rgba(190,68,62,.2)] text-[#ffb6b0]' : ''}`}>{dialog.danger ? <AlertTriangle size={17} /> : <Info size={17} />}</span>
          <button className={closeClass} type="button" aria-label="关闭" onClick={() => settle(false)}><X size={16} /></button>
        </header>
        <h3 className="mt-[14px] mb-[7px] text-base tracking-[-.02em]" id="project-dialog-title">{dialog.title}</h3>
        <p className="m-0 whitespace-pre-line text-[11px] leading-[1.7] text-muted">{dialog.message}</p>
        <footer className="mt-[22px] flex justify-end gap-2">
          {dialog.mode === 'confirm' && <button className={footerButtonClass} type="button" onClick={() => settle(false)}>{dialog.cancelLabel ?? '取消'}</button>}
          <button type="button" className={`${footerButtonClass} ${dialog.danger ? dangerButtonClass : primaryButtonClass}`} onClick={() => settle(true)}>{dialog.confirmLabel ?? (dialog.mode === 'alert' ? '知道了' : '确认')}</button>
        </footer>
      </motion.section>
    </motion.div>}
  </AnimatePresence>

  return { confirm, alert, dialogNode }
}
