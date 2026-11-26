import { useEffect, useState } from 'react'
import { Download, RotateCcw, X } from 'lucide-react'
import { loadHistoryMedia, type HistoryMediaRecord } from './localDb'
import { OriginalText } from './i18n/react'

export function StorageMediaPreview({mediaId,onRestore,onClose}:{mediaId:string;onRestore:(id:string)=>Promise<void>;onClose:()=>void}) {
  const [record,setRecord]=useState<HistoryMediaRecord|null>(null)
  const [url,setUrl]=useState('')
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  useEffect(()=>{
    let disposed=false,objectUrl=''
    setRecord(null);setUrl('');setError('')
    void loadHistoryMedia(mediaId).then(value=>{
      if(disposed)return
      if(!value || !(value.blob instanceof Blob) || !value.blob.size)throw Error('文件本体已缺失，无法预览或恢复。可检查导出的项目包或导入恢复备份。')
      objectUrl=URL.createObjectURL(value.blob);setRecord(value);setUrl(objectUrl)
    }).catch(error=>{if(!disposed)setError(error instanceof Error ? error.message : '文件读取失败')})
    return()=>{disposed=true;if(objectUrl)URL.revokeObjectURL(objectUrl)}
  },[mediaId])
  const video=record && (record.blob.type.startsWith('video/') || /\.(mp4|webm|mov|m4v|mkv)$/i.test(record.fileName))
  const download=()=>{if(!record||!url)return;const anchor=document.createElement('a');anchor.href=url;anchor.download=record.fileName;document.body.append(anchor);anchor.click();anchor.remove()}
  const restore=async()=>{setBusy(true);try{await onRestore(mediaId)}catch(error){setError(error instanceof Error ? error.message : '恢复失败，请重试。')}finally{setBusy(false)}}
  return <section className="storage-media-preview" aria-label="留存媒体预览">
    <header><strong><OriginalText>{record?.fileName ?? '读取文件中…'}</OriginalText></strong><button type="button" aria-label="关闭媒体预览" onClick={onClose}><X size={14}/></button></header>
    {url&&<div className="storage-media-preview-content">{video?<video src={url} controls playsInline preload="metadata" onError={()=>setError('浏览器无法播放此格式，可以下载原文件后查看。')}/>:<img src={url} alt={record?.fileName ?? ''} onError={()=>setError('浏览器无法预览此格式，可以下载原文件后查看。')}/>}</div>}
    {error&&<p role="alert">{error}</p>}
    {!url&&!error&&<p role="status">正在读取数据库文件…</p>}
    {record&&<footer><span>原文件仍保留在数据库中</span><button type="button" onClick={download} disabled={busy}><Download size={13}/>下载原文件</button><button type="button" onClick={()=>void restore()} disabled={busy}><RotateCcw size={13}/>{busy?'正在恢复…':'恢复到画布'}</button></footer>}
  </section>
}
