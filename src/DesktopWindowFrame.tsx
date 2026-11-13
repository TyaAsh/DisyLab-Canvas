import { useEffect, useState, type ReactNode } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Copy, Minus, Square, X } from 'lucide-react'

const resizeDirections = [
  'North', 'East', 'South', 'West', 'NorthEast', 'SouthEast', 'SouthWest', 'NorthWest',
] as const

export function DesktopWindowFrame({ children }: { children: ReactNode }) {
  const [maximized, setMaximized] = useState(false)
  const [windowError, setWindowError] = useState('')
  const [current] = useState(getCurrentWindow)

  useEffect(() => {
    let active = true
    let timeout = 0
    const sync = () => {
      void current.isMaximized().then((value) => { if (active) setMaximized(value) }).catch(() => {})
    }
    sync()
    const subscription = current.onResized(() => {
      window.clearTimeout(timeout)
      timeout = window.setTimeout(sync, 100)
    })
    return () => {
      active = false
      window.clearTimeout(timeout)
      void subscription.then((unlisten) => unlisten()).catch(() => {})
    }
  }, [current])

  const run = (operation: Promise<void>) => {
    setWindowError('')
    void operation.catch(() => setWindowError('窗口操作暂时不可用'))
  }
  const MaximizeIcon = maximized ? Copy : Square

  return <div className={`desktop-window-frame${maximized ? ' is-maximized' : ''}`}>
    <header className="desktop-titlebar">
      <div className="desktop-titlebar-drag" onMouseDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        run(event.detail === 2 ? current.toggleMaximize() : current.startDragging())
      }}>
        <img src="/disy-logo.png" alt="" draggable={false} />
        <span>DisyLab Canvas</span>
      </div>
      {windowError && <span className="desktop-window-error" role="status">{windowError}</span>}
      <div className="desktop-window-controls">
        <button type="button" aria-label="最小化" title="最小化" onClick={() => run(current.minimize())}><Minus size={15} /></button>
        <button type="button" aria-label={maximized ? '还原窗口' : '最大化'} title={maximized ? '还原窗口' : '最大化'} onClick={() => run(current.toggleMaximize())}><MaximizeIcon size={13} /></button>
        <button type="button" className="desktop-window-close" aria-label="关闭窗口" title="关闭窗口" onClick={() => run(current.close())}><X size={16} /></button>
      </div>
    </header>
    <div className="desktop-window-content">{children}</div>
    {!maximized && resizeDirections.map((direction) => <div key={direction} aria-hidden="true"
      className={`desktop-window-resize is-${direction.toLowerCase()}`}
      onMouseDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        run(current.startResizeDragging(direction))
      }} />)}
  </div>
}
