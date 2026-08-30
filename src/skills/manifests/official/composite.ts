import type { CompositeSkillDefinition, SkillManifest } from '../../types'

const stages = (items: Array<[string, string, string, string]>): CompositeSkillDefinition['stages'] => items.map(([id, label, description, output]) => ({ id, label, description, output }))

const make = (
  slug: string,
  name: string,
  description: string,
  blueprint: CompositeSkillDefinition['blueprint'],
  eyebrow: string,
  promise: string,
  stageList: CompositeSkillDefinition['stages'],
  output: SkillManifest['output'],
): SkillManifest => ({
  id: `official.${slug}`,
  slug,
  version: '1.0.0',
  name,
  description,
  kind: 'composite',
  execution: 'configured',
  source: 'official',
  enabled: true,
  parameters: [{ name: 'subject', label: '核心目标', type: 'string', required: true, bind: 'prompt' }],
  inputs: [
    { name: 'brief', type: 'text', multiple: true },
    { name: 'references', type: 'image', multiple: true },
    { name: 'videoReferences', type: 'video', multiple: true },
  ],
  output,
  template: { prompt: `{{subject}}\n\n按“${name}”的阶段门依次执行。上一步必须审核通过后才执行下一步；上游母版变更时，标记所有受影响的下游节点重新审核。` },
  capability: { supportedModes: ['guided_pipeline', 'workflow_composition'], allowedModelCapabilities: ['text', 'image', 'video'] },
  composite: { blueprint, eyebrow, promise, stages: stageList },
  createdAt: 0,
  updatedAt: 0,
})

export const OFFICIAL_COMPOSITE_SKILLS: SkillManifest[] = [
  make(
    'idea-to-film',
    '从想法到成片',
    '从一个想法开始，依次完成剧本、资产、分镜、逐镜视频和多版本成片交付。',
    'idea-to-film',
    'ONE WORKBENCH · FILM PIPELINE',
    '把创作决策前置，把昂贵生成拆成可审核的小步。',
    stages([
      ['script', '写剧本', '锁定故事、受众、时长、节奏与镜头任务。', '剧本与逐镜表'],
      ['assets', '定角色', '建立角色、产品、场景和不可变连续性母版。', '资产圣经'],
      ['storyboard', '画分镜', '确认构图、首尾帧、轴线、动作和声音点。', '分镜与首尾帧'],
      ['video', '生成视频', '按镜头串行生成；上一镜通过后才解锁下一镜。', '审核通过的视频镜头'],
      ['delivery', '输出成片', '剪辑、声音、字幕、调色并适配各发布平台。', '主版与多画幅交付包'],
    ]),
    { name: 'film', type: 'video' },
  ),
  make(
    'character-world-factory',
    '角色与世界资产工厂',
    '把角色三视图、表情动作、场景设定和连续分镜合并为一个可审核资产系统。',
    'character-world',
    'IDENTITY SYSTEM · CHARACTER & WORLD',
    '先建立身份事实，再批量生产不会换脸、换装或换世界的镜头资产。',
    stages([
      ['brief', '角色圣经', '定义身份锚点、轮廓、比例、服装层级和禁止项。', '角色连续性规则'],
      ['identity', '身份母版', '生成正侧背、脸部近景、材质与标志道具。', '角色标准设定板'],
      ['world', '世界母版', '锁定场景平面、地标、动线、主色和光源。', '场景标准设定板'],
      ['performance', '表演资产', '扩展表情、动作、机位和景别，但不改变身份。', '表情动作与多机位库'],
      ['continuity', '连续性交付', '用连续分镜验证身份、空间、服装和道具稳定性。', '可复用角色世界 Kit'],
    ]),
    { name: 'characterKit', type: 'image', multiple: true },
  ),
  make(
    'commerce-campaign-factory',
    '商品上市全渠道工厂',
    '从产品结构母版出发，统一生产电商套图、内容平台素材、短视频和渠道交付。',
    'commerce-campaign',
    'COMMERCE SYSTEM · ONE PRODUCT, MANY CHANNELS',
    '同一产品事实只建立一次，之后针对渠道重组信息，不再重复碰运气。',
    stages([
      ['strategy', '整理卖点', '确定受众、利益点、证据、渠道和合规边界。', '上市 Brief'],
      ['product', '锁定产品', '固定结构、包装、Logo面、孔位、材质和比例。', '产品视觉母版'],
      ['images', '生产套图', '生成白底、场景、细节、卖点和品牌英雄图。', '电商与社媒图像包'],
      ['video', '生产短视频', '设计钩子、功能证据、使用场景和品牌收束。', '短视频镜头包'],
      ['delivery', '渠道交付', '按淘宝、抖音、Amazon和社媒规格重排与质检。', '全渠道 Campaign 包'],
    ]),
    { name: 'campaign', type: 'image', multiple: true },
  ),
]
