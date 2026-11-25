import { useLayoutEffect, useRef, type RefObject } from 'react'

/** Native top-layer surfaces escape canvas transforms and clipped editors. */
export function useAnchoredPopover(open: boolean, panelRef: RefObject<HTMLElement | null>, onClose: () => void, anchorRef?: RefObject<HTMLElement | null>) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useLayoutEffect(() => {
    const panel = panelRef.current
    const anchor = anchorRef?.current ?? panel?.parentElement?.querySelector<HTMLElement>(':scope > button')
    if (!open || !panel || !anchor) return
    const close = () => closeRef.current()
    const toggled = (event: Event) => { if ((event as ToggleEvent).newState === 'closed') close() }
    const dismissOther = (event: Event) => { if ((event as CustomEvent).detail !== panel) close() }
    const outside = (event: PointerEvent) => {
      if (!panel.contains(event.target as Node) && !anchor.contains(event.target as Node)) close()
    }
    document.dispatchEvent(new CustomEvent('disy:popover-open', { detail: panel }))
    panel.addEventListener('toggle', toggled)
    document.addEventListener('disy:popover-open', dismissOther)
    document.addEventListener('pointerdown', outside)
    panel.showPopover()
    const place = () => {
      const rect = anchor.getBoundingClientRect(), gap = 8, edge = 12
      const width = Math.min(Number(panel.dataset.width) || 350, window.innerWidth - edge * 2)
      const above = rect.top - gap - edge, below = window.innerHeight - rect.bottom - gap - edge
      const up = above >= below
      const room = Math.max(120, Math.min(window.innerHeight - edge * 2, Math.max(above, below)))
      panel.style.width = `${width}px`
      panel.style.maxHeight = `${room}px`
      const left = panel.dataset.align === 'start' ? rect.left : rect.right - width
      panel.style.left = `${Math.max(edge, Math.min(left, window.innerWidth - width - edge))}px`
      const height = panel.offsetHeight
      panel.style.top = `${Math.max(edge, Math.min(up ? rect.top - gap - height : rect.bottom + gap, window.innerHeight - height - edge))}px`
      panel.dataset.direction = up ? 'up' : 'down'
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(panel)
    window.addEventListener('resize', close)
    return () => {
      observer.disconnect()
      panel.removeEventListener('toggle', toggled)
      document.removeEventListener('disy:popover-open', dismissOther)
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('resize', close)
      if (panel.matches(':popover-open')) panel.hidePopover()
    }
  }, [open, panelRef, anchorRef])
}
