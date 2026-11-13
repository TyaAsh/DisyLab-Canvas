import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Check, LoaderCircle, Scissors, X } from 'lucide-react'
import './local-cutout.css'

type Source = { url: string; mediaId?: string }
type WorkerMessage =
  | { type: 'progress'; stage: string; progress?: number; detail?: string }
  | { type: 'complete'; blob: Blob }
  | { type: 'error'; message: string }

type Props = {
  sourceUrl: string
  prepareSource: () => Promise<Source>
  onAdd: (blob: Blob, source: Source) => Promise<void>
  onClose: () => void
}

export function LocalCutoutDialog({ sourceUrl, prepareSource, onAdd, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const jobRef = useRef<{ worker?: Worker } | null>(null)
  const [status, setStatus] = useState<Extract<WorkerMessage, { type: 'progress' }> | null>(null)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ blob: Blob; source: Source; url: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [view, setView] = useState<'original' | 'result'>('original')
  const [background, setBackground] = useState<'checker' | 'light' | 'dark'>('checker')
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [previewError, setPreviewError] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current!
    dialog.showModal()
    return () => dialog.close()
  }, [])

  useEffect(() => () => {
    jobRef.current?.worker?.terminate()
    jobRef.current = null
  }, [])

  useEffect(() => {
    if (result) return () => URL.revokeObjectURL(result.url)
  }, [result])

  const stop = () => {
    jobRef.current?.worker?.terminate()
    jobRef.current = null
    setStatus(null)
  }

  const start = async () => {
    if (jobRef.current) return
    const job: { worker?: Worker } = {}
    jobRef.current = job
    setError('')
    setStatus({ type: 'progress', stage: '正在读取原图' })
    const fail = (message: string) => {
      if (jobRef.current !== job) return
      stop()
      setError(message)
    }
    try {
      const source = await prepareSource()
      if (jobRef.current !== job) return
      const worker = new Worker(new URL('./backgroundRemoval.worker.ts', import.meta.url), { type: 'module' })
      job.worker = worker
      worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
        if (jobRef.current !== job) return
        if (data.type === 'progress') setStatus(data)
        else if (data.type === 'error') fail(data.message)
        else {
          stop()
          setResult({ blob: data.blob, source, url: URL.createObjectURL(data.blob) })
          setView('result')
        }
      }
      worker.onerror = (event) => fail(event.message || '无法启动本地抠图引擎')
      worker.postMessage({ type: 'start', source: source.url })
    } catch (cause) {
      fail(cause instanceof Error ? cause.message : '无法读取原图')
    }
  }

  const add = async () => {
    if (!result || saving) return
    setSaving(true)
    setError('')
    try {
      await onAdd(result.blob, result.source)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法保存透明 PNG')
      setSaving(false)
    }
  }

  return <dialog ref={dialogRef} className="local-cutout-dialog" aria-labelledby="local-cutout-title"
    onKeyDown={(event) => event.stopPropagation()}
    onCancel={(event) => { event.preventDefault(); if (status) stop(); else if (!saving) onClose() }}>
    <header className="local-cutout-header">
      <span className="local-cutout-mark"><Scissors size={18} aria-hidden="true" /></span>
      <div><h2 id="local-cutout-title">本地抠图</h2><p>自动识别主体 · 输出透明 PNG</p></div>
      <button type="button" className="local-cutout-close" aria-label="关闭抠图" disabled={saving} onClick={onClose}><X size={18} /></button>
    </header>
    <div className="local-cutout-toolbar">
      <div role="group" aria-label="预览内容">
        <button type="button" aria-pressed={view === 'original'} onClick={() => setView('original')}>原图</button>
        <button type="button" disabled={!result} aria-pressed={view === 'result'} onClick={() => setView('result')}>抠图结果</button>
      </div>
      {result && view === 'result' && <div role="group" aria-label="预览背景">
        <button type="button" aria-pressed={background === 'checker'} onClick={() => setBackground('checker')}>棋盘格</button>
        <button type="button" aria-pressed={background === 'light'} onClick={() => setBackground('light')}>浅色</button>
        <button type="button" aria-pressed={background === 'dark'} onClick={() => setBackground('dark')}>深色</button>
      </div>}
    </div>
    <div className="local-cutout-preview" data-background={view === 'result' ? background : 'dark'} aria-busy={Boolean(status)}>
      {previewError ? <p role="alert">原图加载失败。请重新上传图片后再试。</p> :
        <img key={view} src={view === 'result' ? result?.url : sourceUrl} alt={view === 'result' ? '透明抠图预览' : '完整原图预览'}
          draggable={false} onLoad={({ currentTarget }) => {
            if (view === 'original') setSize({ width: currentTarget.naturalWidth, height: currentTarget.naturalHeight })
          }} onError={() => {
            if (view === 'original') setPreviewError(true)
            else setError('透明预览加载失败，可切回原图检查。')
          }} />}
    </div>
    <div className="local-cutout-status" aria-live="polite">
      {error ? <span className="local-cutout-error" role="alert"><AlertCircle size={16} />{error}</span> : status ?
        <><span><LoaderCircle size={16} className="is-spinning" />{status.stage}</span>
          {status.progress !== undefined && <progress aria-label={status.stage} max={100} value={status.progress} />}</> :
        <span>{result ? '切换原图和结果检查边缘。预览底色仅用于检查透明区域。' : '首次运行需下载模型。原图在本机处理，不消耗积分。'}</span>}
      {size && !status && <span className="local-cutout-size">{size.width} × {size.height} px</span>}
    </div>
    <footer className="local-cutout-footer">
      <button type="button" disabled={saving} onClick={status ? stop : onClose}>{status ? '停止处理' : '取消'}</button>
      <button type="button" className="local-cutout-primary" disabled={Boolean(status) || saving || (!result && !size)}
        onClick={() => void (result ? add() : start())}>
        {result ? <Check size={16} /> : <Scissors size={16} />}
        {saving ? '正在保存…' : result ? '添加到画布' : status ? '处理中…' : error ? '重新尝试' : '开始抠图'}
      </button>
    </footer>
  </dialog>
}
