import { useEffect, useState } from 'react'
import { loadHistoryMedia } from './localDb'
import type { VideoReferenceInputSnapshot } from './videoReferenceImageFit'

/** Lazy viewer for the immutable bytes saved with this specific request. */
export function VideoReferenceSnapshots({ snapshots }: { snapshots: VideoReferenceInputSnapshot[] }) {
  const [open, setOpen] = useState(false)
  const [images, setImages] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const key = JSON.stringify(snapshots.map(item => [item.mediaId, item.originalMediaId]))
  useEffect(() => {
    if (!open) return
    let disposed = false
    const urls: string[] = []
    setImages({}); setError('')
    void Promise.all([...new Set(snapshots.flatMap(item => [item.mediaId, item.originalMediaId]))].map(async id => {
      const stored = await loadHistoryMedia(id)
      if (!stored) throw new Error('发送参考图的本地副本已丢失')
      if (disposed) return [id, '']
      const url = URL.createObjectURL(stored.blob); urls.push(url)
      return [id, url]
    })).then(entries => { if (!disposed) setImages(Object.fromEntries(entries)) })
      .catch(reason => { if (!disposed) setError(reason instanceof Error ? reason.message : '无法读取发送参考图') })
    return () => { disposed = true; urls.forEach(url => URL.revokeObjectURL(url)) }
  }, [open, key])
  return <details className="video-reference-snapshots" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>查看本次参考图 · {snapshots.length} 张</summary>
    {open && <div>
      {error && <p role="alert">{error}</p>}
      {!error && !Object.keys(images).length && <p role="status">正在读取保存副本…</p>}
      {snapshots.map(item => <article key={item.index}>
        <strong>参考图 {item.index + 1} · {item.stage === 'uploaded-reference' ? '实际上传副本' : '接口处理前副本'} · {item.plan.width} × {item.plan.height}</strong>
        <div className="video-reference-fit-pair">
          <figure>{images[item.originalMediaId] && <img src={images[item.originalMediaId]} alt={`参考图 ${item.index + 1} 保存原图`}/>}<figcaption>原图 · {item.plan.sourceWidth} × {item.plan.sourceHeight}</figcaption></figure>
          <figure>{images[item.mediaId] && <img src={images[item.mediaId]} alt={`参考图 ${item.index + 1} 本次发送副本`}/>}<figcaption>{!item.plan.changed ? '原图发送' : item.plan.mode === 'preserve' ? '完整保留' : '居中适配'}{item.plan.padded ? ' · 柔化补边' : ''}</figcaption></figure>
        </div>
        <footer><code title={item.sha256}>SHA-256 · {item.sha256.slice(0, 16)}…</code>{images[item.mediaId] && <a href={images[item.mediaId]} download={item.fileName}>下载本次副本</a>}</footer>
      </article>)}
      <small>该副本对应本次请求，不随当前参考图或提示词的修改而改变。</small>
    </div>}
  </details>
}
