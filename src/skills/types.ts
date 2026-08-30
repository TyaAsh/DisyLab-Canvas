export type SkillKind = 'text' | 'image' | 'video' | 'storyboard_comic' | 'composite'
export type SkillExecutionMode = 'instant' | 'configured'
export type SkillPortType = 'text' | 'image' | 'video'

export type SkillParameter = {
  name: string
  label: string
  type: 'string' | 'number' | 'boolean' | 'enum'
  required?: boolean
  default?: string | number | boolean
  enum?: string[]
  min?: number
  max?: number
  bind?: 'prompt' | 'aspectRatio' | 'seconds' | 'referenceImages' | 'firstFrame' | 'lastFrame'
}

export type SkillPort = { name: string; type: SkillPortType; required?: boolean; multiple?: boolean }

export type CompositeSkillStage = {
  id: string
  label: string
  description: string
  output: string
}

export type CompositeSkillDefinition = {
  blueprint: 'idea-to-film' | 'character-world' | 'commerce-campaign'
  eyebrow: string
  promise: string
  stages: CompositeSkillStage[]
}

export type SkillManifest = {
  id: string
  slug: string
  version: string
  name: string
  description: string
  kind: SkillKind
  execution: SkillExecutionMode
  source: 'official' | 'user'
  enabled: boolean
  factoryVisible?: boolean
  parameters: SkillParameter[]
  inputs: SkillPort[]
  output: SkillPort
  template: { prompt: string; negativePrompt?: string }
  capability: { supportedModes: string[]; requiresReference?: boolean; allowedModelCapabilities: ('text' | 'image' | 'video')[] }
  composite?: CompositeSkillDefinition
  createdAt: number
  updatedAt: number
}

export const skillKey = (skill: Pick<SkillManifest, 'id' | 'version'>) => `${skill.id}@${skill.version}`
