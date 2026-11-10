import { useState } from 'react'
import { Upload } from 'lucide-react'

export function ToolboxDropZone({ detail, onPick, onDrop, disabled }: {
  detail: string
  onPick: () => void
  onDrop: (files: FileList) => void
  disabled?: boolean
}) {
  const [over, setOver] = useState(false)
  return <button type="button" className={`toolbox-drop-zone ${over ? 'is-drag-over' : ''}`} disabled={disabled} onClick={onPick}
    onDragOver={(event) => {
      event.preventDefault()
      if (disabled) return
      event.dataTransfer.dropEffect = 'copy'
      setOver(true)
    }}
    onDragLeave={() => setOver(false)}
    onDrop={(event) => {
      event.preventDefault()
      setOver(false)
      if (!disabled) onDrop(event.dataTransfer.files)
    }}>
    <span className="toolbox-drop-icon"><Upload size={20} aria-hidden="true" /></span>
    <strong>拖入文件，或点击选择</strong>
    <small>{detail}</small>
  </button>
}
