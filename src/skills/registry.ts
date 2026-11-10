import { parseSkillManifest } from './manifestSchema'
import { OFFICIAL_IMAGE_SKILLS } from './manifests/official/image'
import { OFFICIAL_FILM_SKILLS } from './manifests/official/film'
import { OFFICIAL_TEXT_SKILLS } from './manifests/official/text'
import { listUserSkillManifests } from './storage'
import type { SkillManifest } from './types'

export const officialSkills: SkillManifest[] = [...OFFICIAL_FILM_SKILLS, ...OFFICIAL_IMAGE_SKILLS, ...OFFICIAL_TEXT_SKILLS].map((skill) => parseSkillManifest(skill) as SkillManifest)

export async function listSkills(kind?: SkillManifest['kind']) {
  const all = [...officialSkills, ...await listUserSkillManifests()]
  return all.filter((skill) => skill.enabled && skill.kind !== 'composite' && (!kind || skill.kind === kind))
}
