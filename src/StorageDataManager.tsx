import { useState } from 'react'
import { ChevronDown, Download, FolderOpen, Trash2 } from 'lucide-react'
import type { StorageEntry, StorageInventory } from './storageInventory'
import { OriginalText } from './i18n/react'
import { getIntlLocale } from './i18n/core'
import { StorageMediaPreview } from './StorageMediaPreview'

export function StorageDataManager({ inventory, busy, formatBytes, onManage, onClean, onDeleteBackup, onDeleteArchive, onExport, onRestoreMedia }: {
  inventory: StorageInventory; busy: boolean; formatBytes:(bytes:number)=>string
  onManage:(category:string,entry?:StorageEntry)=>void; onClean:()=>void; onDeleteBackup:()=>void; onDeleteArchive:(kind:'legacy'|'checkpoints')=>void; onExport:()=>void
  onRestoreMedia:(id:string)=>Promise<void>
}) {
  const [query,setQuery]=useState('')
  const [pages,setPages]=useState<Record<string,number>>({})
  const [previewMediaId,setPreviewMediaId]=useState<string|null>(null)
  return <section className="storage-data-manager" aria-labelledby="storage-data-title">
    <header><div><h3 id="storage-data-title">本机数据管理</h3><p>查看数据库留存的内容，按类别管理或导出备份。</p></div><button type="button" disabled={busy} onClick={onExport}><Download size={14}/>导出全部项目</button></header>
    <input type="search" value={query} onChange={event=>{setQuery(event.target.value);setPages({})}} placeholder="搜索项目、素材或对话" aria-label="搜索存储数据"/>
    <div className="storage-data-categories">
      {inventory.categories.map(category=>{
        const entries=category.entries.filter(entry=>!query.trim() || `${entry.name} ${entry.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
        if(query.trim()&&!entries.length)return null
        const page=Math.min(pages[category.id]??0,Math.max(0,Math.ceil(entries.length/12)-1))
        return <details key={category.id} className="storage-data-category">
          <summary><ChevronDown size={13}/><strong>{category.label}</strong><span>{category.entries.length} 项</span><b>{formatBytes(category.bytes)}</b></summary>
          <div className="storage-data-content">
            <div className="storage-data-actions"><button type="button" onClick={()=>onManage(category.id)}><FolderOpen size={13}/>管理</button>{category.id==='backups'&&category.entries.length>0&&<button type="button" disabled={busy} onClick={onDeleteBackup}><Trash2 size={13}/>删除恢复备份</button>}{(category.id==='legacy'||category.id==='checkpoints')&&category.entries.length>0&&<button type="button" disabled={busy} onClick={()=>onDeleteArchive(category.id as 'legacy'|'checkpoints')}><Trash2 size={13}/>清除此类留存</button>}</div>
            {entries.slice(page*12,page*12+12).map(entry=><div key={entry.id} className="storage-data-item"><div className="storage-data-row"><div><strong><OriginalText>{entry.name}</OriginalText></strong><small>{entry.unused ? '未被项目、资产、对话或备份引用' : entry.updatedAt ? new Date(entry.updatedAt).toLocaleDateString(getIntlLocale()) : category.label}</small></div><span>{formatBytes(entry.bytes)}</span>{category.id==='media'?<button type="button" aria-expanded={previewMediaId===entry.id} onClick={()=>setPreviewMediaId(previewMediaId===entry.id?null:entry.id)}>预览与找回</button>:['projects','canvases','sessions','assets'].includes(category.id)&&<button type="button" onClick={()=>onManage(category.id,entry)}>打开</button>}</div>{category.id==='media'&&previewMediaId===entry.id&&<StorageMediaPreview key={entry.id} mediaId={entry.id} onRestore={onRestoreMedia} onClose={()=>setPreviewMediaId(null)}/>}</div>)}
            {!entries.length&&<p className="storage-data-empty">此类别暂无留存数据</p>}
            {entries.length>12&&<nav className="storage-data-pagination" aria-label="存储数据分页"><button type="button" disabled={page===0} onClick={()=>setPages({...pages,[category.id]:page-1})}>上一页</button><span>{page+1} / {Math.ceil(entries.length/12)}</span><button type="button" disabled={(page+1)*12>=entries.length} onClick={()=>setPages({...pages,[category.id]:page+1})}>下一页</button></nav>}
          </div>
        </details>
      })}
    </div>
    <div className="storage-unused-media"><div><strong>未引用媒体</strong><p>{inventory.unusedMediaIds.length} 项 · {formatBytes(inventory.unusedMediaBytes)}</p><small>仅清理没有被项目、资产、历史、对话及恢复备份引用的媒体。正在使用的素材会保留。</small></div><button type="button" disabled={busy||!inventory.unusedMediaIds.length} onClick={onClean}><Trash2 size={14}/>清理未引用媒体</button></div>
    <p className="storage-data-note">分类占用为记录内容估算，浏览器总占用还包括数据库索引与缓存。删除项目、资产或对话，请进入对应管理页确认。</p>
  </section>
}
