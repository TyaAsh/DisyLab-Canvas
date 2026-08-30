import type { ComicAssetCategory, ComicWorkflowState } from './storyboard'

type ExportEntry = { path: string; data: Uint8Array }
type DirectoryHandle = { getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandle>; getFileHandle(name: string, options?: { create?: boolean }): Promise<{ createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> }> }

const encoder = new TextEncoder()
const safeName = (value: string) => value.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').slice(0, 72) || 'comic-kit'
const bytes = (value: string) => encoder.encode(value)
const extFromType = (type: string) => type.includes('jpeg') ? 'jpg' : type.includes('webp') ? 'webp' : 'png'

async function fetchEntry(path: string, url: string): Promise<ExportEntry> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`无法读取素材：${path}`)
  const blob = await response.blob()
  const extension = extFromType(blob.type)
  return { path: path.replace(/\.png$/i, `.${extension}`), data: new Uint8Array(await blob.arrayBuffer()) }
}

async function contactSheet(title: string, items: Array<{ name: string; url: string }>): Promise<Uint8Array> {
  const columns = Math.min(3, Math.max(1, items.length)); const cellW = 320; const cellH = 340
  const canvas = document.createElement('canvas'); canvas.width = columns * cellW; canvas.height = 78 + Math.ceil(items.length / columns) * cellH
  const context = canvas.getContext('2d')!; context.fillStyle = '#141817'; context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#f0d49d'; context.font = '700 25px sans-serif'; context.fillText(title, 24, 46)
  await Promise.all(items.map(async (item, index) => {
    const image = new Image(); image.crossOrigin = 'anonymous'; image.src = item.url; await image.decode()
    const x = (index % columns) * cellW + 16; const y = 78 + Math.floor(index / columns) * cellH
    const scale = Math.min(288 / image.naturalWidth, 274 / image.naturalHeight); const w = image.naturalWidth * scale; const h = image.naturalHeight * scale
    context.fillStyle = '#202624'; context.fillRect(x, y, 288, 304); context.drawImage(image, x + (288 - w) / 2, y + 8 + (274 - h) / 2, w, h)
    context.fillStyle = '#d8ddd8'; context.font = '15px sans-serif'; context.fillText(item.name.slice(0, 28), x + 10, y + 296)
  }))
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('联系表生成失败')), 'image/png'))
  return new Uint8Array(await blob.arrayBuffer())
}

async function buildEntries(state: ComicWorkflowState): Promise<ExportEntry[]> {
  const entries: ExportEntry[] = []; const completed = state.assetTasks.filter((task) => task.status === 'completed' && task.result)
  const manifest = { format: 'disylab-comic-kit', version: 2, project: state.projectName, theme: state.theme, aspectRatio: state.aspectRatio, sections: state.sections, kits: state.kits, assets: completed, layerOrder: ['backgrounds', 'scenes/props', 'cutouts', 'editable-text'], exportedAt: new Date().toISOString() }
  entries.push({ path: 'manifest.json', data: bytes(JSON.stringify(manifest, null, 2)) })
  entries.push({ path: 'README.md', data: bytes(`# ${state.projectName}\n\nDisyLab 漫画分镜素材包。每个 Kit 都含构图、分层素材、联系表、脚本与机器可读清单。\n\n叠层顺序：backgrounds → scenes / props → cutouts → editable text。\n`) })
  for (const kit of state.kits) {
    const root = `kits/${safeName(kit.name)}`; const composition = state.compositions.find((item) => item.id === kit.compositionId)
    if (composition) entries.push(await fetchEntry(`${root}/comp/composition.png`, composition.url))
    const kitTasks = completed.filter((task) => task.compositionId === kit.compositionId)
    const contacts: Record<string, string[]> = {}
    for (const task of kitTasks) {
      const category = task.category as ComicAssetCategory; const filename = `${String(task.panelIndex).padStart(2, '0')}-${safeName(task.sectionName)}.png`
      entries.push(await fetchEntry(`${root}/${category}/${filename}`, task.result!.url)); (contacts[category] ||= []).push(filename)
    }
    for (const category of ['cutouts', 'props', 'scenes', 'backgrounds'] as ComicAssetCategory[]) {
      const tasks = kitTasks.filter((task) => task.category === category && task.result)
      if (tasks.length) entries.push({ path: `${root}/contacts/${category}-contact.png`, data: await contactSheet(`${kit.name} · ${category}`, tasks.map((task) => ({ name: `P${String(task.panelIndex).padStart(2, '0')} · ${task.sectionName}`, url: task.result!.url }))) })
    }
    entries.push({ path: `${root}/kit.json`, data: bytes(JSON.stringify({ ...kit, files: contacts }, null, 2)) })
    entries.push({ path: `${root}/script.md`, data: bytes(state.sections.map((section) => `## ${section.name}\n\n${section.label}\n\n${section.body}\n\n${section.points.map((point) => `- ${point}`).join('\n')}\n`).join('\n')) })
  }
  entries.push({ path: '_TREE.txt', data: bytes(entries.map((entry) => entry.path).sort().join('\n')) })
  return entries
}

function crc32(data: Uint8Array) { let crc = 0xffffffff; for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)) } return (crc ^ 0xffffffff) >>> 0 }
function u16(value: number) { return new Uint8Array([value & 255, value >>> 8 & 255]) }
function u32(value: number) { return new Uint8Array([value & 255, value >>> 8 & 255, value >>> 16 & 255, value >>> 24 & 255]) }
function join(chunks: Uint8Array[]) { const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0); const output = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length } return output }
function zip(entries: ExportEntry[]) {
  const local: Uint8Array[] = []; const central: Uint8Array[] = []; let offset = 0
  for (const entry of entries) {
    const name = bytes(entry.path); const crc = crc32(entry.data)
    const header = join([u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(entry.data.length), u32(entry.data.length), u16(name.length), u16(0), name])
    local.push(header, entry.data)
    central.push(join([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(entry.data.length), u32(entry.data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]))
    offset += header.length + entry.data.length
  }
  const center = join(central); return join([...local, center, u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(center.length), u32(offset), u16(0)])
}

async function writeFolder(root: DirectoryHandle, entries: ExportEntry[]) {
  for (const entry of entries) {
    const parts = entry.path.split('/'); const fileName = parts.pop()!; let directory = root
    for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: true })
    const writable = await (await directory.getFileHandle(fileName, { create: true })).createWritable(); await writable.write(new Blob([entry.data as BlobPart])); await writable.close()
  }
}

export async function exportComicKit(state: ComicWorkflowState) {
  const entries = await buildEntries(state); const fileName = `${safeName(state.filePrefix || state.projectName)}-comic-kit.zip`
  if (state.outputTarget === 'folder' && 'showDirectoryPicker' in window) {
    const root = await (window as unknown as { showDirectoryPicker(): Promise<DirectoryHandle> }).showDirectoryPicker(); await writeFolder(root, entries); return { fileName: root ? '本地文件夹' : fileName, count: entries.length }
  }
  const url = URL.createObjectURL(new Blob([zip(entries) as BlobPart], { type: 'application/zip' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = fileName; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  return { fileName, count: entries.length }
}
