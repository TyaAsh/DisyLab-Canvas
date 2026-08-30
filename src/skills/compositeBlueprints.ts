import type { WorkflowTemplate, WorkflowTemplateEdge, WorkflowTemplateNode } from '../WorkflowTemplatePanel'
import type { SkillManifest } from './types'

export type CompositeWorkbenchConfig = {
  projectName: string
  concept: string
  audience: string
  platform: string
  duration: string
  aspectRatio: string
  visualStyle: string
  assetNotes: string
  pacing: string
  audio: string
  shotCount: number
}

const rules = `执行规则：严格沿连线顺序工作。每个阶段完成后停止，等待用户审核；未明确通过不得执行下一阶段。上游母版发生变化时，所有引用它的下游节点必须标记为待复核。只输出可供下游直接使用的结果，不解释思考过程。`

const node = (id: string, kind: 'text' | 'image' | 'upload' | 'video', title: string, prompt: string, x: number, y: number, stage: number, ratio = '16:9'): WorkflowTemplateNode => ({
  id,
  type: 'disy',
  position: { x, y },
  style: { width: kind === 'text' ? 310 : kind === 'video' ? 300 : 280, height: kind === 'text' ? 230 : kind === 'video' ? 250 : 300 },
  data: {
    kind,
    title,
    body: prompt,
    promptText: prompt,
    status: kind === 'upload' ? '等待上传' : '待生成',
    compositeStage: stage,
    stageGate: 'review_required',
    ...(kind === 'image' ? { imageAspectRatio: ratio, imageResolution: '2K', imageDetail: 'high' } : {}),
    ...(kind === 'video' ? { videoAspectRatio: ratio, videoDuration: '5s', videoQuality: 'professional', videoGenerateCount: 1, videoGenerationMethod: 'image' } : {}),
  },
})

const edge = (source: string, target: string): WorkflowTemplateEdge => ({ id: `edge-${source}-${target}`, source, target, type: 'luminous' })
const brief = (config: CompositeWorkbenchConfig) => `项目：${config.projectName}\n核心目标：${config.concept}\n受众：${config.audience}\n平台：${config.platform}\n目标时长：${config.duration}\n画幅：${config.aspectRatio}\n视觉方向：${config.visualStyle}\n资产与连续性要求：${config.assetNotes}\n节奏：${config.pacing}\n声音：${config.audio}\n\n${rules}`

const ideaToFilm = (config: CompositeWorkbenchConfig): WorkflowTemplate => {
  const nodes: WorkflowTemplateNode[] = [
    node('script', 'text', '01 · 剧本与逐镜表', `${brief(config)}\n\n写出可执行剧本：一句话梗概、人物动机、情绪曲线、场次、${config.shotCount} 个镜头的叙事任务、可见动作、景别、焦段、机位、光线、对白/旁白、声音点与连续性不可变项。每镜只推进一个主要动作。`, 0, 170, 1),
    node('character', 'image', '02A · 角色 / 产品母版', `依据上游剧本建立身份与结构母版。角色需包含正侧背、三分之二侧面、面部近景、服装层级和标志道具；如果项目以产品为主，则替换为产品正侧背、英雄角度、接口、Logo面与材质微距。${config.assetNotes}\n\n${rules}`, 370, 0, 2, config.aspectRatio),
    node('world', 'image', '02B · 场景与光线母版', `依据剧本建立同一世界的空间母版：主全景、反向视角、关键区域、平面关系、地标、动线、时间、天气、主色、材质和主光方向。视觉方向：${config.visualStyle}。不生成无关人物或文字。\n\n${rules}`, 370, 360, 2, config.aspectRatio),
    node('storyboard', 'image', '03 · 分镜与首尾帧', `引用剧本、身份母版和场景母版，生成 ${config.shotCount} 镜连续分镜接触表。每镜必须给出首帧和尾帧，保持身份、服装、产品、场景布局、动作方向和光线连续；标注信息只写入节点结果说明，不要画进图片。\n\n${rules}`, 740, 170, 3, config.aspectRatio),
  ]
  const edges: WorkflowTemplateEdge[] = [edge('script', 'character'), edge('script', 'world'), edge('script', 'storyboard'), edge('character', 'storyboard'), edge('world', 'storyboard')]
  const videoIds: string[] = []
  for (let index = 0; index < config.shotCount; index += 1) {
    const id = `shot-${index + 1}`
    videoIds.push(id)
    nodes.push(node(id, 'video', `04 · 视频镜头 ${String(index + 1).padStart(2, '0')}`, `只生成分镜中的第 ${index + 1} 镜。严格引用上游首尾帧、角色/产品母版与场景母版；保持指定机位、焦段、动作方向和速度曲线。动作必须完整落定并保留呼吸帧。上一镜未审核通过时不要执行本镜。\n\n${rules}`, 1110 + index * 330, index % 2 ? 350 : 0, 4, config.aspectRatio))
    edges.push(edge('storyboard', id), edge('character', id), edge('world', id))
    if (index > 0) edges.push(edge(videoIds[index - 1], id))
  }
  nodes.push(node('delivery', 'text', '05 · 剪辑与成片交付', `把所有审核通过的视频镜头按剧本顺序剪辑。节奏：${config.pacing}；声音：${config.audio}。完成对白/旁白、环境声、动作音效、音乐、字幕、统一调色和响度；输出 ${config.aspectRatio} ${config.platform} 主版、9:16信息流版、16:9横版、静音字幕版和无字素材版。逐项检查身份漂移、闪帧、爆音、黑场、错字、Logo与安全区。\n\n${rules}`, 1110 + config.shotCount * 330, 170, 5))
  videoIds.forEach((id) => edges.push(edge(id, 'delivery')))
  return { id: 'composite-idea-to-film', title: `从想法到成片 · ${config.projectName}`, description: '五阶段、逐镜审核的视频生产工作流。', category: '精选工业化', tags: ['复合Skill', '成片', '串行审核'], accent: '#d3a85f', nodes, edges }
}

const characterWorld = (config: CompositeWorkbenchConfig): WorkflowTemplate => {
  const b = brief(config)
  const nodes = [
    node('bible', 'text', '01 · 角色与世界圣经', `${b}\n\n定义角色/IP的身份锚点、头身比、轮廓、五官、配色、服装层级、材质、标志道具、表情边界与禁止项；同时定义世界规则、地标、空间关系和光线。`, 0, 170, 1),
    node('identity', 'image', '02 · 身份标准母版', `生成同一角色正侧背全身、三分之二侧面、脸部三视图、服装拆层与道具。所有视图必须是同一身份、同一比例、同一材质。${config.assetNotes}\n\n${rules}`, 370, 0, 2, '16:9'),
    node('world', 'image', '03 · 世界与场景母版', `生成主场景全景、反向视角、关键区域、平面关系和光线变化；固定建筑位置、动线、地标、主色、材质和主光方向。视觉方向：${config.visualStyle}。\n\n${rules}`, 370, 360, 3, '16:9'),
    node('expression', 'image', '04A · 表情动作库', `引用身份母版，生成基础、喜、怒、哀、惊、专注、疲惫等表情，以及站、走、跑、坐、转身和手部关键动作；只改变表情和姿势，不改变身份服装。\n\n${rules}`, 740, 0, 4, '16:9'),
    node('angles', 'image', '04B · 多机位景别库', `引用身份与场景母版，生成同一主体的正面、左右45度、侧面、背面、俯拍、低机位和细节近景。只改变机位和景别。\n\n${rules}`, 740, 360, 4, '16:9'),
    node('continuity', 'image', '05 · 连续性验证板', `引用全部母版，生成 5×5 连续动作与镜头接触表，验证身份、服装、道具、空间、光线和动作轴线。任何漂移都标记返工来源，不用风格化掩盖。\n\n${rules}`, 1110, 170, 5, config.aspectRatio),
  ]
  return { id: 'composite-character-world', title: `角色与世界资产工厂 · ${config.projectName}`, description: '从身份规则到连续性验证的可复用资产系统。', category: '角色与 IP', tags: ['复合Skill', '角色一致性', '世界观'], accent: '#9c8fe8', nodes, edges: [edge('bible', 'identity'), edge('bible', 'world'), edge('identity', 'expression'), edge('identity', 'angles'), edge('world', 'angles'), edge('identity', 'continuity'), edge('world', 'continuity'), edge('expression', 'continuity'), edge('angles', 'continuity')] }
}

const commerceCampaign = (config: CompositeWorkbenchConfig): WorkflowTemplate => {
  const b = brief(config)
  const nodes = [
    node('product-upload', 'upload', '产品标准参考', '上传正面、侧面、包装、Logo面和关键结构参考。', 0, 0, 1),
    node('strategy', 'text', '01 · 上市策略与信息结构', `${b}\n\n输出受众、使用场景、核心利益点、可视证据、疑虑消除、渠道差异、禁用承诺、CTA和验收标准。`, 0, 310, 1),
    node('product-master', 'image', '02 · 产品结构母版', `引用产品标准参考与策略，生成正侧背、顶底、三分之二英雄角度、接口、Logo面、包装文字结构和材质微距。结构、比例、孔位与Logo不可变化。\n\n${rules}`, 370, 150, 2, '16:9'),
    node('hero', 'image', '03A · 白底与英雄主图', `引用产品母版，生成合规白底主图和品牌英雄图；产品结构完全一致，分别满足电商识别与品牌质感。\n\n${rules}`, 740, 0, 3, '4:5'),
    node('lifestyle', 'image', '03B · 场景与卖点套图', `引用产品母版，为核心受众生成使用场景、功能证据、材质细节和规格信息安全区；不要伪造产品能力或错误文字。\n\n${rules}`, 740, 340, 3, '4:5'),
    node('storyboard', 'image', '04 · 短视频钩子分镜', `生成竖屏短视频分镜：0–2秒识别商品与钩子、功能动作、可视证据、使用场景、疑虑消除和品牌收束。每镜提供首尾帧并保持产品结构一致。\n\n${rules}`, 1110, 0, 4, '9:16'),
    node('video', 'video', '04 · 商品短视频镜头包', `引用产品母版和短视频分镜，逐镜串行生成。只改变当前镜头动作和机位，产品结构、包装、Logo面与材质不可变化；上一镜未审核通过不得执行下一镜。\n\n${rules}`, 1480, 0, 4, '9:16'),
    node('delivery', 'text', '05 · 全渠道交付清单', `整理淘宝/天猫主图与详情页、抖音商品卡与9:16视频、Amazon七图与A+、小红书3:4图文、品牌官网16:9首屏。逐项核对裁切锚点、平台安全区、卖点证据、单位、套装数量、Logo和禁用承诺。\n\n${rules}`, 1850, 170, 5),
  ]
  return { id: 'composite-commerce-campaign', title: `商品上市全渠道工厂 · ${config.projectName}`, description: '一次锁定产品事实，批量生产多渠道上市资产。', category: '商业电商', tags: ['复合Skill', '商品上市', '全渠道'], accent: '#5fc5a2', nodes, edges: [edge('product-upload', 'product-master'), edge('strategy', 'product-master'), edge('product-master', 'hero'), edge('product-master', 'lifestyle'), edge('strategy', 'hero'), edge('strategy', 'lifestyle'), edge('product-master', 'storyboard'), edge('strategy', 'storyboard'), edge('storyboard', 'video'), edge('product-master', 'video'), edge('hero', 'delivery'), edge('lifestyle', 'delivery'), edge('video', 'delivery')] }
}

export function buildCompositeWorkflow(skill: SkillManifest, config: CompositeWorkbenchConfig): WorkflowTemplate {
  if (skill.composite?.blueprint === 'character-world') return characterWorld(config)
  if (skill.composite?.blueprint === 'commerce-campaign') return commerceCampaign(config)
  return ideaToFilm(config)
}
