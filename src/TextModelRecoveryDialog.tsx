import { useEffect, useRef, useState } from 'react'
import { CircleAlert, X } from 'lucide-react'

export type TextModelRecovery = {
  id: string
  currentKey: string
  modelName: string
  message: string
  models: { key: string; name: string; connectionName: string }[]
  choose: (key: string) => void
  cancel: () => void
}
export function TextModelRecoveryDialog({ recovery }: { recovery: TextModelRecovery }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [selected, setSelected] = useState(recovery.models.find(model => model.key !== recovery.currentKey)?.key ?? '')
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close() }, [])
  return <dialog ref={dialog} className="text-model-recovery" aria-labelledby="text-model-recovery-title" onCancel={event => { event.preventDefault(); recovery.cancel() }}>
    <header><span><CircleAlert size={19} /><strong id="text-model-recovery-title">模型请求未完成</strong></span><button type="button" aria-label="关闭" onClick={recovery.cancel}><X size={18} /></button></header>
    <p><b>{recovery.modelName}</b> 未能返回结果。你可以重试，或选择另一个模型继续。</p>
    <div className="text-model-recovery-error">{recovery.message}</div>
    <label htmlFor="text-model-recovery-select">更换对话模型</label>
    <select id="text-model-recovery-select" value={selected} onChange={event => setSelected(event.target.value)}>
      <option value="" disabled>请选择其他模型</option>
      {recovery.models.filter(model => model.key !== recovery.currentKey).map(model => <option key={model.key} value={model.key}>{model.name} · {model.connectionName}</option>)}
    </select>
    <small>确认后仅重试本次请求，不更改默认模型。</small>
    <footer><button type="button" onClick={recovery.cancel}>取消</button><button type="button" onClick={() => recovery.choose(recovery.currentKey)}>重试原模型</button><button type="button" className="is-primary" disabled={!selected} onClick={() => recovery.choose(selected)}>切换并重试</button></footer>
  </dialog>
}
