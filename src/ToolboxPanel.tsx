import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { PDFDocument } from 'pdf-lib'
import { Check, ChevronLeft, Combine, Download, FileArchive, FileImage, Film, GripVertical, LoaderCircle, PackageOpen, Trash2, Upload, X } from 'lucide-react'
import { compressPdf } from './pdfCompressor'

type ToolKind = 'image' | 'video' | 'pdf-compress' | 'pdf-merge'
type ToolFile = { id: string; file: File }

const tools: Array<{ kind: ToolKind; title: string; detail: string; icon: typeof FileImage; accept: string; multiple: boolean }> = [
  { kind: 'image', title: '图片压缩', detail: 'JPG、PNG、WebP、AVIF', icon: FileImage, accept: '.jpg,.jpeg,.png,.webp,.avif,image/jpeg,image/png,image/webp,image/avif', multiple: true },
  { kind: 'video', title: '视频压缩', detail: 'MP4、MOV、WebM、M4V、MKV', icon: Film, accept: '.mp4,.mov,.webm,.m4v,.mkv,.avi,.ogv,video/*', multiple: false },
  { kind: 'pdf-compress', title: 'PDF 压缩', detail: '重编码页面，实际减小体积', icon: FileArchive, accept: 'application/pdf', multiple: true },
  { kind: 'pdf-merge', title: 'PDF 合并', detail: '按顺序合成', icon: Combine, accept: 'application/pdf', multiple: true },
]

const formatBytes = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(.1, bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`
const downloadBlob = (blob: Blob, name: string) => { const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
const pdfBlob = (bytes: Uint8Array) => new Blob([Uint8Array.from(bytes).buffer], { type: 'application/pdf' })
const outputName = (name: string, suffix: string, extension?: string) => `${name.replace(/\.[^.]+$/, '')}-${suffix}.${extension || name.split('.').pop() || 'bin'}`

const panelClass = 'fixed bottom-5 left-[74px] isolate w-[360px] max-h-[min(680px,calc(100vh-40px))] overflow-hidden rounded-3xl border border-white/18 bg-[linear-gradient(145deg,rgba(49,54,58,.7),rgba(20,23,25,.56)_58%,rgba(23,27,31,.7))] text-ink shadow-[inset_0_1px_0_rgba(255,255,255,.2),inset_0_-1px_0_rgba(255,255,255,.04),0_32px_90px_rgba(0,0,0,.58)] backdrop-blur-[38px] backdrop-saturate-[1.7] before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:bg-[radial-gradient(ellipse_at_18%_-8%,rgba(255,255,255,.18),transparent_35%),radial-gradient(circle_at_92%_110%,rgba(92,139,255,.12),transparent_38%)] max-[620px]:inset-x-2 max-[620px]:bottom-2 max-[620px]:w-auto max-[620px]:max-h-[calc(100dvh-16px)]'
const iconButtonClass = 'grid size-[30px] place-items-center rounded-[9px] border border-transparent bg-transparent text-muted transition-[color,background,border-color,transform] duration-200 hover:border-white/13 hover:bg-white/10 hover:text-white hover:shadow-[inset_0_1px_rgba(255,255,255,.12)]'
const glassCardClass = 'border border-white/10 bg-[linear-gradient(145deg,rgba(255,255,255,.065),rgba(255,255,255,.018))] shadow-[inset_0_1px_rgba(255,255,255,.07)] backdrop-blur-[14px]'

async function compressImage(file: File, quality: number, maxEdge: number) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext('2d', { alpha: file.type === 'image/png' })?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  const type = file.type || ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif' } as Record<string, string>)[extension]
  if (!type) throw new Error(`暂不支持 ${extension.toUpperCase()} 原格式编码`)
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('图片编码失败')), type, quality))
  if (blob.type !== type) throw new Error(`当前浏览器不能输出 ${extension.toUpperCase()}，已停止处理以保持原格式`)
  return { blob, name: outputName(file.name, 'compressed', extension) }
}

async function compressVideo(file: File, quality: number) {
  const video = document.createElement('video'); video.src = URL.createObjectURL(file); video.muted = true; video.playsInline = true
  await new Promise<void>((resolve, reject) => { video.onloadedmetadata = () => resolve(); video.onerror = () => reject(new Error('无法读取视频')) })
  const capture = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream
  if (!capture || typeof MediaRecorder === 'undefined') { URL.revokeObjectURL(video.src); throw new Error('当前浏览器不支持本地视频压缩') }
  const stream = capture.call(video)
  const sourceExtension = file.name.split('.').pop()?.toLowerCase() || 'webm'
  const sameContainer = file.type && MediaRecorder.isTypeSupported(file.type) ? file.type : ''
  const mimeType = sameContainer || (MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' : 'video/webm')
  const chunks: BlobPart[] = []; const bitrate = Math.round(400_000 + quality * 3_600_000)
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitrate })
  const result = new Promise<Blob>((resolve, reject) => { recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data); recorder.onerror = () => reject(new Error('视频编码失败')); recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType.split(';')[0] })) })
  video.onended = () => recorder.state !== 'inactive' && recorder.stop(); recorder.start(500); await video.play(); const blob = await result
  stream.getTracks().forEach((track) => track.stop()); URL.revokeObjectURL(video.src)
  return { blob, name: outputName(file.name, 'compressed', sameContainer ? sourceExtension : 'webm'), converted: !sameContainer }
}

export function ToolboxPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [active, setActive] = useState<ToolKind | null>(null)
  const [files, setFiles] = useState<ToolFile[]>([])
  const [quality, setQuality] = useState(72)
  const [maxEdge, setMaxEdge] = useState(2560)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const definition = tools.find((tool) => tool.kind === active)
  const totalSize = useMemo(() => files.reduce((sum, item) => sum + item.file.size, 0), [files])

  useEffect(() => { if (!open) { setActive(null); setFiles([]); setStatus('') } }, [open])
  useEffect(() => { const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose(); if (open) window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close) }, [open, onClose])

  const addFiles = (list: FileList | null) => {
    if (!list || !definition) return
    const acceptedExtensions = definition.accept.split(',').filter((value) => value.startsWith('.'))
    const incoming = Array.from(list).filter((file) => file.type.startsWith(active === 'video' ? 'video/' : active === 'image' ? 'image/' : 'application/pdf') || acceptedExtensions.some((extension) => file.name.toLowerCase().endsWith(extension)))
    setFiles((current) => (definition.multiple ? [...current, ...incoming.map((file) => ({ id: crypto.randomUUID(), file }))] : incoming.slice(0, 1).map((file) => ({ id: crypto.randomUUID(), file }))))
    setStatus('')
  }

  const run = async () => {
    if (!active || !files.length) return
    setBusy(true); setStatus('处理中…')
    try {
      if (active === 'image') {
        for (const item of files) { const result = await compressImage(item.file, quality / 100, maxEdge); downloadBlob(result.blob, result.name) }
      } else if (active === 'video') {
        const result = await compressVideo(files[0].file, quality / 100); downloadBlob(result.blob, result.name); if (result.converted) setStatus('处理完成 · 当前浏览器以 WebM 输出')
      } else if (active === 'pdf-merge') {
        const merged = await PDFDocument.create()
        for (const item of files) { const source = await PDFDocument.load(await item.file.arrayBuffer()); const pages = await merged.copyPages(source, source.getPageIndices()); pages.forEach((page) => merged.addPage(page)) }
        downloadBlob(pdfBlob(await merged.save({ useObjectStreams: true })), 'disy-merged.pdf')
      } else {
        let savedBytes = 0
        let originalBytes = 0
        let downloaded = 0
        for (const item of files) {
          const result = await compressPdf(item.file, quality / 100, maxEdge)
          originalBytes += result.originalSize
          if (result.compressedSize >= result.originalSize) continue
          savedBytes += result.originalSize - result.compressedSize
          downloaded += 1
          downloadBlob(result.blob, outputName(item.file.name, 'compressed', 'pdf'))
        }
        if (!downloaded) setStatus('未生成文件：原 PDF 已较小，重编码后不会更省空间')
        else {
          const percent = Math.round(savedBytes / originalBytes * 100)
          setStatus(`压缩完成 · 已下载 ${downloaded} 个 · 节省 ${formatBytes(savedBytes)}（${percent}%）`)
        }
      }
      setStatus((current) => current === '处理中…' ? '处理完成，文件已下载' : current)
    } catch (error) { setStatus(error instanceof Error ? error.message : '处理失败，请重试') } finally { setBusy(false) }
  }

  return <AnimatePresence>{open && <motion.div className="fixed inset-0 z-[var(--z-modal)] bg-[rgba(3,5,4,.22)]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
    <motion.aside className={panelClass} role="dialog" aria-modal="true" aria-label="文件工具箱" initial={{ opacity: 0, x: -12, y: 8, scale: .975 }} animate={{ opacity: 1, x: 0, y: 0, scale: 1 }} exit={{ opacity: 0, x: -8, y: 6, scale: .98 }} transition={{ duration: .18 }} onMouseDown={(event) => event.stopPropagation()}>
      <header className="flex h-[66px] items-center justify-between border-b border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,.055),transparent)] pr-[14px] pl-4">
        <div className="flex items-center gap-[10px]">
          <span className="grid size-[34px] place-items-center rounded-full border border-white/16 bg-[linear-gradient(145deg,rgba(255,255,255,.17),rgba(107,151,255,.12))] text-[#dce8ff] shadow-[inset_0_1px_rgba(255,255,255,.22),0_8px_18px_rgba(0,0,0,.2)]"><PackageOpen size={17} /></span>
          <div className="grid gap-[3px]"><strong className="text-xs">{active ? definition?.title : '文件工具箱'}</strong><small className="text-[8px] text-muted">{active ? '本地处理 · 文件不会上传' : '轻量处理，随用随走'}</small></div>
        </div>
        <button className={iconButtonClass} onClick={onClose} aria-label="关闭工具箱"><X size={16} /></button>
      </header>
      {!active ? <div className="grid grid-cols-2 gap-[7px] p-[10px]">{tools.map((tool) => <button className="group relative grid min-h-[92px] grid-cols-[32px_minmax(0,1fr)] items-center gap-[9px] overflow-hidden rounded-[17px] border border-white/11 bg-[linear-gradient(145deg,rgba(255,255,255,.09),rgba(255,255,255,.025))] p-3 text-left text-ink shadow-[inset_0_1px_rgba(255,255,255,.12),0_8px_24px_rgba(0,0,0,.1)] backdrop-blur-[18px] backdrop-saturate-150 transition-[border-color,background,box-shadow,transform] duration-200 after:pointer-events-none after:absolute after:inset-0 after:translate-x-[-45%] after:bg-[linear-gradient(115deg,transparent_20%,rgba(255,255,255,.12)_45%,transparent_68%)] after:opacity-0 after:transition-[opacity,transform] after:duration-500 hover:-translate-y-0.5 hover:scale-[1.012] hover:border-[rgba(155,190,255,.32)] hover:bg-[linear-gradient(145deg,rgba(255,255,255,.14),rgba(103,146,255,.09))] hover:shadow-[inset_0_1px_rgba(255,255,255,.2),0_14px_32px_rgba(0,0,0,.2)] hover:after:translate-x-[45%] hover:after:opacity-100 max-[620px]:min-h-[104px]" key={tool.kind} onClick={() => { setActive(tool.kind); setFiles([]); setStatus('') }}><span className="grid size-8 place-items-center rounded-full border border-white/12 bg-[linear-gradient(145deg,rgba(255,255,255,.15),rgba(100,147,255,.1))] text-[#d8e7ff] shadow-[inset_0_1px_rgba(255,255,255,.17)]"><tool.icon size={18} /></span><div className="grid gap-[5px]"><strong className="text-[10px]">{tool.title}</strong><small className="text-[8px] text-muted">{tool.detail}</small></div><ChevronLeft className="hidden" size={14} /></button>)}</div> : <div className="max-h-[calc(min(680px,100vh-40px)-66px)] overflow-auto p-3 max-[620px]:max-h-[calc(100dvh-82px)]">
        <button className="mb-2 flex h-7 items-center gap-1 rounded-lg border border-transparent bg-transparent px-[7px] text-[8px] font-bold text-muted transition-colors hover:border-white/13 hover:bg-white/10 hover:text-white" onClick={() => { setActive(null); setFiles([]); setStatus('') }}><ChevronLeft size={13} />全部工具</button>
        <input ref={inputRef} hidden type="file" accept={definition?.accept} multiple={definition?.multiple} onChange={(event) => { addFiles(event.target.files); event.currentTarget.value = '' }} />
        <button className="flex h-[116px] w-full flex-col items-center justify-center gap-[7px] rounded-[18px] border border-dashed border-white/18 bg-[linear-gradient(145deg,rgba(255,255,255,.055),rgba(255,255,255,.018))] text-muted shadow-[inset_0_1px_rgba(255,255,255,.08)] transition-[color,border-color,background,box-shadow] duration-200 hover:border-[rgba(142,181,255,.48)] hover:bg-[linear-gradient(145deg,rgba(255,255,255,.11),rgba(102,148,255,.1))] hover:text-[#dce9ff] hover:shadow-[inset_0_1px_rgba(255,255,255,.16),0_0_24px_rgba(104,151,255,.08)]" onClick={() => inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files) }}><Upload size={20} /><strong className="text-[10px] text-ink">拖入文件，或点击选择</strong><small className="text-[8px]">{definition?.detail} · {definition?.multiple ? '支持批量' : '单个文件'}</small></button>
        {!!files.length && <div className="mt-[9px] grid gap-[5px]">{files.map((item, index) => <article className={`${glassCardClass} flex min-h-[49px] items-center gap-2 rounded-[10px] py-1.5 pr-[7px] pl-[9px]`} key={item.id} draggable={active === 'pdf-merge'} onDragStart={(event) => event.dataTransfer.setData('text/toolbox-file', item.id)} onDragOver={(event) => active === 'pdf-merge' && event.preventDefault()} onDrop={(event) => { const sourceId = event.dataTransfer.getData('text/toolbox-file'); if (!sourceId || sourceId === item.id) return; setFiles((current) => { const next = [...current]; const from = next.findIndex((entry) => entry.id === sourceId); const to = next.findIndex((entry) => entry.id === item.id); if (from < 0 || to < 0) return current; const [moved] = next.splice(from, 1); next.splice(to, 0, moved); return next }) }}><span className="grid size-7 flex-none place-items-center rounded-full border border-white/10 bg-[rgba(126,170,255,.12)] text-[#d9e7ff]">{active === 'video' ? <Film size={14} /> : active === 'image' ? <FileImage size={14} /> : <FileArchive size={14} />}</span><div className="grid min-w-0 flex-1 gap-[3px]"><strong className="overflow-hidden text-[8px] text-ellipsis whitespace-nowrap">{item.file.name}</strong><small className="text-[7px] text-muted">{formatBytes(item.file.size)}{active === 'pdf-merge' ? ` · 顺序 ${index + 1}` : ''}</small></div>{active === 'pdf-merge' && <GripVertical className="text-muted" size={13} />}<button className="grid size-[27px] place-items-center rounded-[7px] border border-transparent bg-transparent text-muted transition-colors hover:bg-[rgba(255,92,80,.1)] hover:text-[#ff8278]" onClick={() => setFiles((current) => current.filter((file) => file.id !== item.id))}><Trash2 size={13} /></button></article>)}</div>}
        {(active === 'image' || active === 'video' || active === 'pdf-compress') && <section className={`${glassCardClass} mt-[9px] grid gap-[11px] rounded-[11px] p-[11px]`}><label className="grid gap-[7px]"><span className="flex items-center justify-between text-[8px] text-muted">{active === 'pdf-compress' ? '页面质量' : '压缩质量'} <b className="text-ink">{quality}%</b></span><input className="w-full accent-[var(--accent)]" type="range" min="30" max="90" value={quality} onChange={(event) => setQuality(Number(event.target.value))} /></label>{(active === 'image' || active === 'pdf-compress') && <label className="grid gap-[7px]"><span className="flex items-center justify-between text-[8px] text-muted">{active === 'pdf-compress' ? '页面最长边' : '最长边'}</span><select className="h-[31px] rounded-lg border border-white/12 bg-white/7 px-2 text-[8px] text-ink shadow-[inset_0_1px_rgba(255,255,255,.07)]" value={maxEdge} onChange={(event) => setMaxEdge(Number(event.target.value))}><option value="1280">1280 px</option><option value="1920">1920 px</option><option value="2560">2560 px</option><option value="4096">4096 px</option></select></label>}{active === 'pdf-compress' && <small className="text-[8px] text-muted">压缩会将每页重编码为图片，适合扫描件和图片型 PDF；可选文字、链接与表单不会保留。</small>}</section>}
        {!!files.length && <footer className="mt-[10px] flex items-center justify-between gap-3 border-t border-white/10 pt-[10px] max-[620px]:items-stretch max-[620px]:flex-col"><div className="grid min-w-0 gap-1 text-[8px] text-muted"><span>{files.length} 个文件 · {formatBytes(totalSize)}</span>{status && <small className={`flex items-center gap-1 text-[7px] ${status.includes('完成') ? 'text-accent' : 'text-[#ff9c8f]'}`}>{status.includes('完成') && <Check size={11} />}{status}</small>}</div><button className="relative flex h-9 min-w-[120px] items-center justify-center gap-1.5 overflow-hidden rounded-full border border-white/25 bg-[linear-gradient(145deg,rgba(138,177,255,.42),rgba(87,128,224,.27))] px-[13px] text-[9px] font-extrabold text-[#f3f7ff] shadow-[inset_0_1px_1px_rgba(255,255,255,.34),inset_0_-1px_rgba(0,0,0,.12),0_10px_25px_rgba(43,77,153,.22)] backdrop-blur-[18px] backdrop-saturate-[1.7] transition-[transform,background,box-shadow] hover:not-disabled:-translate-y-px hover:not-disabled:scale-[1.018] hover:not-disabled:bg-[linear-gradient(145deg,rgba(171,201,255,.52),rgba(96,140,239,.34))] hover:not-disabled:shadow-[inset_0_1px_1px_rgba(255,255,255,.45),0_13px_30px_rgba(46,83,172,.3),0_0_20px_rgba(111,159,255,.13)] active:not-disabled:scale-[.975] disabled:cursor-not-allowed disabled:border-white/8 disabled:bg-white/[.055] disabled:text-[rgba(230,237,249,.42)] disabled:shadow-none max-[620px]:w-full max-[620px]:min-w-0" disabled={busy || (active === 'pdf-merge' && files.length < 2)} onClick={() => void run()}>{busy ? <LoaderCircle className="is-spinning" size={14} /> : <Download size={14} />}{busy ? '处理中' : active === 'pdf-merge' ? '合并并下载' : '压缩并下载'}</button></footer>}
      </div>}
    </motion.aside>
  </motion.div>}</AnimatePresence>
}
