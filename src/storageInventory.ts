export type StorageEntry = { id: string; name: string; bytes: number; updatedAt?: string; projectId?: string; canvasId?: string; unused?: boolean }
export type StorageCategory = { id: string; label: string; bytes: number; entries: StorageEntry[] }
export type StorageInventory = { categories: StorageCategory[]; bytes: number; unusedMediaIds: string[]; unusedMediaBytes: number }
type Row = Record<string, unknown>

/** Logical record size. Browser quota estimates additionally include database overhead. */
export function storedValueBytes(value: unknown, seen = new WeakSet<object>()): number {
  if (value instanceof Blob) return value.size
  if (typeof value === 'string') return new TextEncoder().encode(value).byteLength
  if (typeof value === 'number') return 8
  if (typeof value === 'boolean') return 1
  if (!value || typeof value !== 'object' || seen.has(value)) return 0
  seen.add(value)
  if (value instanceof ArrayBuffer) return value.byteLength
  return Object.entries(value).reduce((sum,[key,item]) => sum + storedValueBytes(key) + storedValueBytes(item,seen),0)
}

/** Conservatively retain every referenced media ID, including recovery backups and in-flight drafts. */
export function referencedMediaIds(values: unknown[], ids: Set<string>) {
  const found = new Set<string>(), seen = new WeakSet<object>()
  const visit = (value: unknown) => {
    if (typeof value === 'string') { if(ids.has(value)) found.add(value); return }
    if (!value || typeof value !== 'object' || value instanceof Blob || seen.has(value)) return
    seen.add(value)
    Object.values(value).forEach(visit)
  }
  values.forEach(visit)
  return found
}

export function buildStorageInventory(stores: Record<string, unknown[]>, liveReferences: unknown[] = []): StorageInventory {
  const media = (stores['history-media'] ?? []) as Row[]
  const referenced = referencedMediaIds([...Object.entries(stores).filter(([key])=>key!=='history-media').flatMap(([,values])=>values), ...liveReferences], new Set(media.map(row=>String(row.id))))
  const categories: StorageCategory[] = []
  const add = (id: string,label: string,rows: unknown[]) => {
    const entries = rows.map((value,index) => {
      const row = value && typeof value==='object' ? value as Row : {}
      const data = row.data && typeof row.data==='object' ? row.data as Row : {}
      const id = String(row.id ?? index)
      return { id, name:String(row.name ?? row.title ?? row.fileName ?? data.fileName ?? row.modelName ?? row.model ?? id), bytes:storedValueBytes(row),
        updatedAt:typeof row.updatedAt==='string' ? row.updatedAt : typeof row.createdAt==='string' ? row.createdAt : undefined,
        projectId:typeof row.projectId==='string' ? row.projectId : undefined, canvasId:typeof row.canvasId==='string' ? row.canvasId : undefined,
        ...(label==='历史媒体' ? {unused:!referenced.has(id)} : {}) }
    })
    categories.push({id,label,entries,bytes:entries.reduce((sum,item)=>sum+item.bytes,0)})
  }
  add('projects','项目',stores['workspace-projects'] ?? [])
  add('canvases','画布',stores.canvases ?? [])
  add('assets','资产',(stores.assets ?? []).flatMap(value=>(value as Row).assets as unknown[] ?? []))
  add('sessions','Agent 对话',stores['agent-sessions'] ?? [])
  add('media','历史媒体',media)
  const auxiliary = (stores['workspace-data'] ?? []).find(value=>(value as Row).id==='workspace') as Row | undefined
  add('folders','资产文件夹',auxiliary?.folders as unknown[] ?? [])
  add('generation','生成历史',auxiliary?.generationHistory as unknown[] ?? [])
  add('output','输出历史',auxiliary?.outputHistory as unknown[] ?? [])
  add('settings','已保存的设置',auxiliary?.publicSettings ? [{id:'settings',name:'模型连接与界面偏好',value:auxiliary.publicSettings}] : [])
  add('checkpoints','制作检查点',(stores['workspace-data'] ?? []).filter(value=>(value as Row).id!=='workspace'))
  add('backups','导入恢复备份',stores['import-backups'] ?? [])
  add('legacy','旧版项目数据',stores.projects ?? [])
  const known=new Set(['workspace-projects','canvases','assets','agent-sessions','history-media','workspace-data','import-backups','projects'])
  for(const [id,rows] of Object.entries(stores)) if(!known.has(id)) add(id,'其他数据库数据',rows)
  const unused = media.filter(row=>!referenced.has(String(row.id)))
  return {categories,bytes:categories.reduce((sum,item)=>sum+item.bytes,0),unusedMediaIds:unused.map(row=>String(row.id)),unusedMediaBytes:unused.reduce((sum,row)=>sum+storedValueBytes(row),0)}
}
