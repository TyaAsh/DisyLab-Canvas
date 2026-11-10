import { openDB } from 'idb'
import type { SkillManifest } from './types'
import { skillKey } from './types'

const dbPromise = openDB('disylab-skill-system', 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('skill_manifests')) db.createObjectStore('skill_manifests', { keyPath: 'key' })
  },
})

const deletionListeners = new Set<(key: string) => void>()

export function subscribeToSkillDeletion(listener: (key: string) => void) {
  deletionListeners.add(listener)
  return () => { deletionListeners.delete(listener) }
}

export async function listUserSkillManifests(): Promise<SkillManifest[]> {
  const rows = await (await dbPromise).getAll('skill_manifests') as Array<{ key: string; manifest: SkillManifest }>
  return rows.map((row) => row.manifest).filter((skill) => skill.source === 'user')
}

export async function saveUserSkillManifest(manifest: SkillManifest) {
  await (await dbPromise).put('skill_manifests', { key: skillKey(manifest), manifest })
}

export async function deleteUserSkillManifest(manifest: SkillManifest) {
  if (manifest.source !== 'user') throw new Error('内置 Skill 不能删除。')
  const key = skillKey(manifest)
  await (await dbPromise).delete('skill_manifests', key)
  deletionListeners.forEach((listener) => listener(key))
}
