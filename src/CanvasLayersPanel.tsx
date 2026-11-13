import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ChevronRight, Copy, Film, Focus, Folder, FolderOpen, Group, Image, Layers3, PanelLeft, Pencil, Search, Trash2, Type, Ungroup, X } from 'lucide-react'
import './canvas-layers.css'
import type { CanvasLayerMove } from './canvasLayers'

export type CanvasLayer = {
  id: string
  parentId?: string
  name: string
  kind: 'group' | 'text' | 'image' | 'upload' | 'video'
  thumbnail?: string
}

type Props = {
  layers: CanvasLayer[]
  selectedIds: string[]
  docked: boolean
  canGroup: boolean
  canUngroup: boolean
  onDock: () => void
  onClose: () => void
  onSelect: (ids: string[]) => void
  onRename: (id: string, name: string) => void
  onGroup: () => void
  onUngroup: () => void
  onDuplicate: () => void
  onDelete: () => void
  onLocate: (id: string) => void
  onMove: (move: CanvasLayerMove) => void
}

type PanelDrag = {
  pointerId: number
  pointerX: number
  pointerY: number
  left: number
  top: number
  minX: number
  maxX: number
  minY: number
  maxY: number
  x: number
  y: number
  frame: number
}

type LayerDrag = {
  sourceId: string
  pointerId: number
  startX: number
  startY: number
  x: number
  y: number
  moving: boolean
  drop: CanvasLayerMove | null
}

export function CanvasLayersPanel({
  layers, selectedIds, docked, canGroup, canUngroup, onDock, onClose, onSelect,
  onRename, onGroup, onUngroup, onDuplicate, onDelete, onLocate, onMove,
}: Props) {
  const reduceMotion = useReducedMotion()
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [rename, setRename] = useState<{ id: string; draft: string } | null>(null)
  const [draggedId, setDraggedId] = useState('')
  const [drop, setDrop] = useState<CanvasLayerMove | null>(null)
  const anchor = useRef('')
  const panelRef = useRef<HTMLElement>(null)
  const drag = useRef<PanelDrag | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const layerDrag = useRef<LayerDrag | null>(null)
  const layerScrollFrame = useRef(0)
  const suppressLayerClick = useRef(false)
  const byId = useMemo(() => new Map(layers.map((layer) => [layer.id, layer])), [layers])
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
  const single = selectedIds.length === 1 ? byId.get(selectedIds[0]) : undefined
  const term = query.trim().toLocaleLowerCase()

  useEffect(() => {
    setExpanded((current) => {
      const next = new Set(current)
      for (const id of selectedIds) {
        let parent = byId.get(id)?.parentId
        const visited = new Set<string>()
        while (parent && !visited.has(parent)) {
          visited.add(parent)
          next.add(parent)
          parent = byId.get(parent)?.parentId
        }
      }
      return next.size === current.size ? current : next
    })
  }, [selectedIds, byId])

  const rows = useMemo(() => {
    const children = new Map<string | undefined, CanvasLayer[]>()
    for (const layer of [...layers].reverse()) {
      const parent = layer.parentId && byId.has(layer.parentId) ? layer.parentId : undefined
      const siblings = children.get(parent) ?? []
      siblings.push(layer)
      children.set(parent, siblings)
    }
    const shown = new Set<string>()
    if (term) {
      for (const layer of layers) {
        if (!layer.name.toLocaleLowerCase().includes(term)) continue
        let id: string | undefined = layer.id
        while (id && !shown.has(id)) {
          shown.add(id)
          id = byId.get(id)?.parentId
        }
      }
    }
    const result: { layer: CanvasLayer; depth: number; hasChildren: boolean; open: boolean }[] = []
    const visited = new Set<string>()
    const append = (parent: string | undefined, depth: number) => {
      for (const layer of children.get(parent) ?? []) {
        if (visited.has(layer.id) || (term && !shown.has(layer.id))) continue
        visited.add(layer.id)
        const hasChildren = (children.get(layer.id) ?? []).some((child) => !term || shown.has(child.id))
        const open = hasChildren && (Boolean(term) || expanded.has(layer.id))
        result.push({ layer, depth, hasChildren, open })
        if (open) append(layer.id, depth + 1)
      }
    }
    append(undefined, 0)
    return result
  }, [layers, byId, expanded, term])

  const select = (id: string, event: MouseEvent) => {
    const from = rows.findIndex(({ layer }) => layer.id === anchor.current)
    const to = rows.findIndex(({ layer }) => layer.id === id)
    if (event.shiftKey && from !== -1) {
      onSelect(rows.slice(Math.min(from, to), Math.max(from, to) + 1).map(({ layer }) => layer.id))
      return
    }
    anchor.current = id
    onSelect(event.ctrlKey || event.metaKey
      ? selected.has(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id]
      : [id])
  }
  const finishRename = () => {
    if (!rename) return
    const name = rename.draft.trim()
    if (name && name !== byId.get(rename.id)?.name) onRename(rename.id, name)
    setRename(null)
  }
  const startDrag = (event: PointerEvent<HTMLElement>) => {
    const panel = panelRef.current
    const container = panel?.offsetParent
    if (!panel || !container || docked || drag.current || !event.isPrimary || event.button !== 0
      || (event.target as Element).closest('button')) return
    const left = panel.offsetLeft
    const top = panel.offsetTop
    drag.current = {
      pointerId: event.pointerId, pointerX: event.clientX, pointerY: event.clientY,
      left, top, x: left, y: top, frame: 0,
      minX: Math.min(8, left), maxX: Math.max(left, container.clientWidth - panel.offsetWidth - 8),
      minY: Math.min(8, top), maxY: Math.max(top, container.clientHeight - panel.offsetHeight - 8),
    }
    event.preventDefault()
    panel.classList.add('is-panel-dragging')
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const updateDragPosition = (current: PanelDrag, event: PointerEvent<HTMLElement>) => {
    current.x = Math.max(current.minX, Math.min(current.maxX, current.left + event.clientX - current.pointerX))
    current.y = Math.max(current.minY, Math.min(current.maxY, current.top + event.clientY - current.pointerY))
  }
  const moveDrag = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    updateDragPosition(current, event)
    if (current.frame) return
    current.frame = window.requestAnimationFrame(() => {
      current.frame = 0
      panelRef.current?.style.setProperty('translate', `${current.x - current.left}px ${current.y - current.top}px`)
    })
  }
  const finishDrag = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    if (event.type === 'pointerup') updateDragPosition(current, event)
    drag.current = null
    window.cancelAnimationFrame(current.frame)
    const panel = panelRef.current
    panel?.style.setProperty('--layers-x', `${current.x}px`)
    panel?.style.setProperty('--layers-y', `${current.y}px`)
    panel?.style.removeProperty('translate')
    panel?.classList.remove('is-panel-dragging')
  }

  useEffect(() => () => {
    window.cancelAnimationFrame(layerScrollFrame.current)
    if (drag.current) window.cancelAnimationFrame(drag.current.frame)
  }, [])

  const updateDrop = (current: LayerDrag) => {
    const row = document.elementFromPoint(current.x, current.y)?.closest<HTMLElement>('[data-layer-id]')
    const target = row && listRef.current?.contains(row) ? byId.get(row.dataset.layerId ?? '') : undefined
    const source = byId.get(current.sourceId)
    let next: CanvasLayerMove | null = null
    if (row && target && source && target.id !== source.id && (target.parentId ?? '') === (source.parentId ?? '')) {
      const rect = row.getBoundingClientRect()
      next = { sourceId: source.id, targetId: target.id, placement: current.y < rect.top + rect.height / 2 ? 'before' : 'after' }
    }
    if (next?.targetId === current.drop?.targetId && next?.placement === current.drop?.placement) return
    current.drop = next
    setDrop(next)
  }

  const scrollWhileDragging = () => {
    const current = layerDrag.current
    const list = listRef.current
    if (!current?.moving || !list) return
    const rect = list.getBoundingClientRect()
    if (current.x >= rect.left && current.x <= rect.right) {
      const fromTop = current.y - rect.top
      const fromBottom = rect.bottom - current.y
      if (fromTop < 28) list.scrollTop -= Math.min(16, 1 + (28 - fromTop) / 4)
      else if (fromBottom < 28) list.scrollTop += Math.min(16, 1 + (28 - fromBottom) / 4)
    }
    updateDrop(current)
    layerScrollFrame.current = window.requestAnimationFrame(scrollWhileDragging)
  }

  const moveLayerDrag = (event: PointerEvent<HTMLDivElement>) => {
    const current = layerDrag.current
    if (!current || current.pointerId !== event.pointerId) return
    current.x = event.clientX
    current.y = event.clientY
    if (!current.moving && Math.hypot(current.x - current.startX, current.y - current.startY) >= 5) {
      current.moving = true
      suppressLayerClick.current = true
      event.currentTarget.setPointerCapture(event.pointerId)
      setDraggedId(current.sourceId)
      layerScrollFrame.current = window.requestAnimationFrame(scrollWhileDragging)
    }
  }

  const finishLayerDrag = (event: PointerEvent<HTMLDivElement>, commit = false) => {
    const current = layerDrag.current
    if (!current || current.pointerId !== event.pointerId) return
    layerDrag.current = null
    window.cancelAnimationFrame(layerScrollFrame.current)
    if (commit && current.moving) {
      current.x = event.clientX
      current.y = event.clientY
      updateDrop(current)
      if (current.drop) onMove(current.drop)
    }
    setDraggedId('')
    setDrop(null)
  }

  return <motion.aside id="canvas-layers-panel" ref={panelRef} className={`canvas-layers ${docked ? 'is-docked' : 'is-floating'}`}
    initial={reduceMotion ? false : { opacity: 0, x: docked ? -14 : -8, y: docked ? 0 : 7, scale: docked ? 1 : .985 }}
    animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -8, y: docked ? 0 : 5, scale: docked ? 1 : .985 }}
    transition={{ duration: reduceMotion ? 0 : .19, ease: [.22, .8, .25, 1] }}
    aria-label="画布图层"
    onKeyDown={(event) => {
      if (event.target instanceof HTMLInputElement) return
      if (event.key === 'F2' && single) {
        event.preventDefault()
        setRename({ id: single.id, draft: single.name })
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd' && selectedIds.length) {
        event.preventDefault()
        onDuplicate()
      }
      if (event.key === 'Delete' && selectedIds.length) {
        event.stopPropagation()
        event.preventDefault()
        onDelete()
      }
    }}>
    <header className="canvas-layers-header" onPointerDown={startDrag} onPointerMove={moveDrag}
      onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={finishDrag}>
      <span className="canvas-layers-mark"><Layers3 size={17} /></span>
      <h2>图层</h2>
      <button type="button" className="canvas-layers-dock" aria-label={docked ? '取消固定图层' : '固定图层到左侧'} aria-pressed={docked}
        title={docked ? '取消固定' : '固定到左侧'} onClick={onDock}><PanelLeft size={16} /></button>
      <button type="button" aria-label="关闭图层" title="关闭图层" onClick={onClose}><X size={17} /></button>
    </header>
    <div className="canvas-layers-controls">
      <label className="canvas-layers-search"><Search size={15} aria-hidden="true" /><input type="search" aria-label="搜索图层" placeholder="搜索图层" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <div className="canvas-layers-actions" role="group" aria-label="图层操作">
        <button type="button" title="打组 (Ctrl/⌘ + G)" aria-label="打组" disabled={!canGroup} onClick={onGroup}><Group size={16} /></button>
        <button type="button" title="解组" aria-label="解组" disabled={!canUngroup} onClick={onUngroup}><Ungroup size={16} /></button>
        <button type="button" title="复制图层 (Ctrl/⌘ + D)" aria-label="复制图层" disabled={!selectedIds.length} onClick={onDuplicate}><Copy size={15} /></button>
        <button type="button" title="重命名图层 (F2)" aria-label="重命名图层" disabled={!single || !rows.some(({ layer }) => layer.id === single.id)} onClick={() => single && setRename({ id: single.id, draft: single.name })}><Pencil size={15} /></button>
        <button type="button" title="定位到画布" aria-label="定位到画布" disabled={!single} onClick={() => single && onLocate(single.id)}><Focus size={16} /></button>
        <button type="button" title="删除所选图层" aria-label="删除所选图层" disabled={!selectedIds.length} onClick={onDelete}><Trash2 size={15} /></button>
      </div>
    </div>
    <div className="canvas-layers-list" ref={listRef}
      onPointerMove={moveLayerDrag}
      onPointerUp={(event) => finishLayerDrag(event, true)}
      onPointerCancel={(event) => finishLayerDrag(event)}
      onLostPointerCapture={(event) => finishLayerDrag(event)}
      onPointerLeave={(event) => { if (!layerDrag.current?.moving) finishLayerDrag(event) }}
      onClickCapture={(event) => {
        if (!suppressLayerClick.current || !event.detail) return
        event.preventDefault()
        event.stopPropagation()
        suppressLayerClick.current = false
      }}>
      {rows.map(({ layer, depth, hasChildren, open }) => {
        const Icon = layer.kind === 'group' ? open ? FolderOpen : Folder : layer.kind === 'text' ? Type : layer.kind === 'video' ? Film : Image
        return <div key={layer.id} className={`canvas-layer-row ${selected.has(layer.id) ? 'is-selected' : ''} ${draggedId === layer.id ? 'is-dragging' : ''}`}
          data-drop={drop?.targetId === layer.id ? drop.placement : undefined}
          style={{ '--layer-indent': `${Math.min(depth, 8) * 15}px` } as CSSProperties}
          data-layer-id={layer.id}
          data-sortable={!term && !rename}
          onPointerDown={(event) => {
            suppressLayerClick.current = false
            if (term || rename || event.pointerType === 'touch' || event.button !== 0 || (event.target as HTMLElement).closest('.canvas-layer-toggle')) return
            const { clientX, clientY, pointerId } = event
            layerDrag.current = { sourceId: layer.id, pointerId, startX: clientX, startY: clientY, x: clientX, y: clientY, moving: false, drop: null }
          }}>
          {hasChildren && !term ? <button type="button" className="canvas-layer-toggle" aria-expanded={open} aria-label={`${open ? '折叠' : '展开'} ${layer.name}`}
            onClick={() => setExpanded((current) => {
              const next = new Set(current)
              if (open) next.delete(layer.id)
              else next.add(layer.id)
              return next
            })}><ChevronRight size={13} /></button> : <span className="canvas-layer-spacer" />}
          {rename?.id === layer.id ? <label className="canvas-layer-name">
            <Icon size={17} aria-hidden="true" />
            <input autoFocus aria-label="图层名称" value={rename.draft} onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setRename({ id: layer.id, draft: event.target.value })} onBlur={finishRename}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return
                if (event.key === 'Enter') { event.preventDefault(); finishRename() }
                if (event.key === 'Escape') { event.stopPropagation(); setRename(null) }
              }} />
          </label> : <button type="button" className="canvas-layer-name" title={layer.name} aria-pressed={selected.has(layer.id)}
            onClick={(event) => select(layer.id, event)} onDoubleClick={() => setRename({ id: layer.id, draft: layer.name })}>
            {layer.thumbnail ? <img src={layer.thumbnail} alt="" loading="lazy" draggable={false} /> : <Icon size={17} aria-hidden="true" />}
            <span>{layer.name}</span>
          </button>}
        </div>
      })}
      {!rows.length && <div className="canvas-layers-empty"><Layers3 size={22} /><span>{term ? '没有匹配的图层' : '画布还没有图层'}</span></div>}
    </div>
    <footer className="canvas-layers-footer"><span title="Shift 连选 · Ctrl/⌘ 多选">{selectedIds.length ? `已选 ${selectedIds.length} 项` : '拖动调整同级顺序'}</span><span>共 {layers.length} 个节点</span></footer>
  </motion.aside>
}
