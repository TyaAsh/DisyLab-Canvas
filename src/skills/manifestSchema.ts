import { z } from 'zod'

const parameterSchema = z.object({
  name: z.string().min(1).max(64), label: z.string().min(1).max(80),
  type: z.enum(['string', 'number', 'boolean', 'enum']), required: z.boolean().optional(),
  default: z.union([z.string(), z.number().finite(), z.boolean()]).optional(),
  enum: z.array(z.string().max(80)).max(30).optional(), min: z.number().finite().optional(), max: z.number().finite().optional(),
  bind: z.enum(['prompt', 'aspectRatio', 'seconds', 'referenceImages', 'firstFrame', 'lastFrame']).optional(),
}).strict()

const portSchema = z.object({
  name: z.string().min(1).max(64), type: z.enum(['text', 'image', 'video']), required: z.boolean().optional(), multiple: z.boolean().optional(),
}).strict()

export const skillManifestSchema = z.object({
  id: z.string().min(1).max(120), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/), name: z.string().min(1).max(80),
  description: z.string().min(1).max(300), kind: z.enum(['text', 'image', 'video', 'storyboard_comic', 'composite']), execution: z.enum(['instant', 'configured']).default('configured'), source: z.enum(['official', 'user']),
  enabled: z.boolean(), factoryVisible: z.boolean().optional(), parameters: z.array(parameterSchema).max(40), inputs: z.array(portSchema).max(20), output: portSchema,
  template: z.object({ prompt: z.string().min(1).max(24000), negativePrompt: z.string().max(8000).optional() }).strict(),
  capability: z.object({ supportedModes: z.array(z.string().min(1).max(60)).max(20), requiresReference: z.boolean().optional(), allowedModelCapabilities: z.array(z.enum(['text', 'image', 'video'])).min(1).max(3) }).strict(),
  composite: z.object({
    blueprint: z.enum(['idea-to-film', 'character-world', 'commerce-campaign']),
    eyebrow: z.string().min(1).max(80), promise: z.string().min(1).max(240),
    stages: z.array(z.object({ id: z.string().min(1).max(40), label: z.string().min(1).max(40), description: z.string().min(1).max(160), output: z.string().min(1).max(100) }).strict()).min(3).max(8),
  }).strict().optional(),
  createdAt: z.number().finite().nonnegative(), updatedAt: z.number().finite().nonnegative(),
}).strict().superRefine((skill, ctx) => {
  const names = new Set<string>()
  for (const item of [...skill.parameters, ...skill.inputs]) {
    if (names.has(item.name)) ctx.addIssue({ code: 'custom', message: `重复字段：${item.name}` })
    names.add(item.name)
  }
  if (skill.kind === 'composite' && !skill.composite) ctx.addIssue({ code: 'custom', message: '复合 Skill 缺少 composite 定义' })
  if (skill.kind !== 'composite' && skill.composite) ctx.addIssue({ code: 'custom', message: '只有复合 Skill 可以声明 composite 定义' })
})

export const parseSkillManifest = (value: unknown) => skillManifestSchema.parse(value)
