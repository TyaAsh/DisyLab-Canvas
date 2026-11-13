import { invoke } from '@tauri-apps/api/core'

export const desktopWorkspaceFile = 'DisyLab-工作区.disy'
export const readDesktopStorage = () => invoke<string | null>('desktop_storage_location')
export const chooseDesktopStorage = () => invoke<string | null>('desktop_choose_storage')

let writes = Promise.resolve()
export function writeDesktopWorkspace(bundle: Blob, name = desktopWorkspaceFile) {
  const write = writes.then(async () => {
    const id = crypto.randomUUID()
    try {
      await invoke('desktop_start_write', { id, name })
      const chunkSize = 4 * 1024 * 1024
      for (let offset = 0; offset < bundle.size; offset += chunkSize) {
        const bytes = await bundle.slice(offset, offset + chunkSize).arrayBuffer()
        await invoke('desktop_write_chunk', bytes, { headers: { 'x-disy-write': id } })
      }
      await invoke('desktop_finish_write', { id, commit: true })
    } catch (error) {
      await invoke('desktop_finish_write', { id, commit: false }).catch(() => {})
      throw new Error(typeof error === 'string' ? error : error instanceof Error ? error.message : '无法写入存储目录')
    }
  })
  writes = write.catch(() => {})
  return write
}
