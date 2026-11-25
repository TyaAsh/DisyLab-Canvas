import { useEffect, useRef } from 'react'
import { CircleAlert, X } from 'lucide-react'

type Failure = {
  modelName: string
  connectionName: string
  error: { summary: string; detail: string; status?: number; requestId?: string }
}

export function GenerationFailureDialog({ failure, onClose, onHistory }: { failure: Failure; onClose: () => void; onHistory: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close() }, [])
  return <dialog ref={dialog} className="text-model-recovery" aria-labelledby="generation-failure-title" onCancel={event => { event.preventDefault(); onClose() }}>
    <header><span><CircleAlert size={19}/><strong id="generation-failure-title">{failure.error.summary}</strong></span><button type="button" aria-label="关闭错误提示" onClick={onClose}><X size={18}/></button></header>
    <p translate="no">{failure.connectionName} · {failure.modelName}</p>
    <div className="text-model-recovery-error" translate="no">{failure.error.detail}</div>
    {failure.error.status !== undefined && <small>HTTP {failure.error.status}</small>}
    {failure.error.requestId && <small>请求编号：{failure.error.requestId}</small>}
    <small>失败原因已保存在输出历史中。请根据厂商提示处理账户、额度或权限后再试。</small>
    <footer><button type="button" onClick={onHistory}>查看输出历史</button><button type="button" className="is-primary" onClick={onClose}>知道了</button></footer>
  </dialog>
}
