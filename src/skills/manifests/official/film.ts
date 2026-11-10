import type { SkillManifest } from '../../types'

type FilmSkill = {
  slug: string
  name: string
  description: string
  referenceVideo?: string
  sceneBeats: readonly string[]
  visualStyle: string
  useCases: string
  inputs: string
  deliverables: string
  duration: { min: number; max: number; default: number }
  workflow: string
  options?: SkillManifest['parameters']
}

const filmSkills: FilmSkill[] = [
  {
    slug: 'cartoon-ad',
    name: '皮克斯风格 3D 卡通广告',
    description: '用皮克斯风格的原创 3D 角色演绎产品卖点，从故事钩子剪到品牌收尾。',
    sceneBeats: ["建立角色和问题，突出前几秒的动作钩子。","中近景展示产品操作，给出能看懂的物理反馈。","延续同一角色与产品，展示结果并收在干净的产品英雄镜头。"],
    visualStyle: '皮克斯风格的长片级 3D 卡通渲染：富有弹性的原创角色造型，大而有神的眼睛、可读的夸张表情、细腻的织物和毛发、电影级体积光与冷暖对比。保持家庭动画广告的动作节奏与情绪表达。',
    useCases: '产品发布、品牌故事、社交媒体卡通广告。',
    inputs: '品牌和产品、核心卖点、主角身份与动作、受众、比例和目标时长。可附产品图或标识。',
    deliverables: '可播放的合成短片和可复用的关键帧、分镜视频。',
    duration: { min: 15, max: 60, default: 30 },
    options: [
      { name: 'brand', label: '品牌名 / 产品名', type: 'string', required: true },
      { name: 'performance', label: '主角职业与表演', type: 'string', required: true },
      { name: 'logo', label: '品牌 Logo 名称', type: 'string', required: true },
      { name: 'character', label: '角色类型', type: 'enum', enum: ['女主角', '男主角', '儿童', '动物或小怪物', '多角色'], default: '动物或小怪物' },
      { name: 'look', label: '角色外形方向', type: 'enum', enum: ['圆润亲和', '利落活泼', '夸张喜剧', '按参考或自定义'], default: '圆润亲和' },
      { name: 'multiscene', label: '多场景转场', type: 'boolean', default: false },
      { name: 'lyrics', label: '广告歌词 / 片尾短句（选填）', type: 'string' },
    ],
    workflow: `用原创的 3D 卡通角色和道具做一则品牌短片。角色造型强调清晰轮廓、表情和触感，避免把已有角色当作新品牌主角。
1. 提炼一个真实卖点，写出“遇到问题 → 使用产品 → 看见变化 → 品牌收尾”的一句话叙事，给出前 3 秒的视觉钩子。
2. 输出角色立绘和三视图提示词，固定职业服装、动作、产品尺寸和操作方式。产品图或品牌标识以用户提供的素材为准。
3. 按总时长拆分分镜，记录画幅安全区、关键帧、机位、动作、光线及连续性。每镜配独立图像与视频提示词。
4. 给出短广告词和一段原创广告歌词，按镜头标明入点、节拍和环境声。用户选择无配音时提供纯音效和音乐版本。
5. 设计片尾产品主视觉、品牌字标排版和行动语，给出剪辑、混音、字幕及品牌校对清单。`,
  },
  {
    slug: 'neo-chinese-tvc',
    name: '新中式品牌 TVC',
    description: '从产品卖点提炼当代东方视觉，统一妆造、布景、镜头与声音。',
    sceneBeats: ["用东方材质与主光建立当代场景和产品轮廓。","微距展示产品材质、工艺或使用动作，保持包装一致。","由场景回到品牌产品主视觉，镜头稳定留出片尾排版空间。"],
    visualStyle: '当代新中式商业摄影，用克制色材、自然光影和有节奏的留白强调产品质感。',
    useCases: '茶饮、香氛、服装、文创和其他强调东方审美的品牌广告。',
    inputs: '产品图、品牌定位、可证实的卖点、希望的审美方向和旁白语言。',
    deliverables: '新中式产品广告成片和逐镜素材。可在简报指定旁白和音乐风格。',
    duration: { min: 30, max: 120, default: 30 },
    options: [
      { name: 'brand', label: '品牌和产品', type: 'string', required: true },
      { name: 'industry', label: '行业', type: 'enum', enum: ['茶', '酒', '香氛', '服饰', '美妆', '家居', '珠宝', '餐饮', '文旅'], default: '香氛' },
      { name: 'mood', label: '情绪取向', type: 'enum', enum: ['清冷禅意', '温润人间', '秾丽宫廷', '书卷文人', '市井烟火'], default: '温润人间' },
      { name: 'structure', label: '叙事方向', type: 'enum', enum: ['器物志', '生活流', '一人一技', '诗眼式'], default: '器物志' },
      { name: 'voiceLanguages', label: '旁白语言', type: 'enum', enum: ['中文', '英文', '中英双语', '无旁白'], default: '无旁白' },
      { name: 'withCharacter', label: '包含人物', type: 'boolean', default: false },
    ],
    workflow: `从产品图或用户描述提炼外形、材质、色值与卖点，选定一个主视觉母题，用现代摄影表达东方审美。文化元素须服务产品，避免堆砌符号。
1. 输出色材板、产品锁定特征、角色妆造和三视图，以及一套可复用的场景描述。明确真实标识、包装文字和改造边界。
2. 以“氛围建立 → 材质或使用细节 → 核心卖点 → 片尾主视觉”组织时间码、景别、运镜和逐镜图像及视频提示词。
3. 按选定语言给出可在各镜头时长内念完的旁白及字幕。双语分别优化节奏，名称和产品事实一致。
4. 写出原创国风配乐方向、环境声入点、剪辑交接和片尾品牌校对。输出可用来制作广告的方案。`,
  },
  {
    slug: 'gameplay-pv',
    name: '游戏玩法概念 PV',
    description: '把玩法拆成可验证的演示片段，锁定镜头、角色和 HUD 的连续性。',
    sceneBeats: ["第三人称跟随镜头，展示任务指示和第一次输入反馈。","在同一地图延续任务目标，清楚展示交互及系统反馈。","表现挑战解决或战斗结算，保持角色、固定 HUD 锚点和世界方向。"],
    visualStyle: '游戏引擎视感，机位遵守用户指定的玩法视角。每个镜头有明确的玩家操作和画面反馈，固定 HUD 不随摄影机运动。',
    useCases: '玩法概念验证、游戏 PV、任务引导和开放世界演示。',
    inputs: '游戏类型、视角、核心操作、地图或场景、主角和已有 UI 素材。标明哪些镜头已有真实录屏。',
    deliverables: '玩法概念 PV 和带操作反馈的分镜视频。',
    duration: { min: 15, max: 120, default: 30 },
    options: [
      { name: 'game', label: '游戏名和类型', type: 'string', required: true },
      { name: 'sellingPoints', label: '核心卖点（1–3 条）', type: 'string', required: true },
      { name: 'channel', label: '投放渠道', type: 'string', required: true },
      { name: 'sourceMode', label: '素材形态', type: 'enum', enum: ['真实实机录屏', '设定图或概念图', '从零概念'], required: true },
      { name: 'demoMode', label: '演示结构', type: 'enum', enum: ['钩子／世界／循环／高光／情感／落版', '引导／剧情／战斗三段式', '连续玩法演示'], default: '钩子／世界／循环／高光／情感／落版' },
    ],
    workflow: `把概念做成可信的玩法演示，先区分真实游戏录屏和生成的概念镜头，生成内容统一标注为玩法概念演示。
1. 固定游戏视角、角色尺度与四视图、键位逻辑、地图地标和场景光线。列出 HUD 的屏幕归一化坐标、尺寸、触发状态及安全区。
2. 三段式依次表现引导、剧情任务和战斗或挑战；连续模式则展示一条完整循环。每段用“输入 → 角色动作 → 画面反馈 → 状态变化”描述。
3. 给出逐段时间码、首末帧、运镜、角色与场景锚点、视频提示词以及音效触发。HUD 优先在后期合成，静态元素保持像素位置，动态状态有明确触发条件。
4. 写出剪辑、录屏与 QA 清单，核对 HUD、按键反馈、空间方向、帧间一致性和玩法真实性。`,
  },
  {
    slug: 'symmetric-film',
    name: '对称构图电影短片',
    description: '用对称构图、分区色彩和干脆的镜头节奏，把短故事转成可拍的方案。',
    sceneBeats: ["正面固定机位在中轴上建立主角、空间和道具母题。","匹配动作硬切到对称近景或俯拍，安排一个干脆的视觉反转。","回到中轴全景或平行横移收束笑点，维持主色和空间秩序。"],
    visualStyle: '原创舞台式电影短片，强调居中对称构图、粉彩分区、正面固定机位、克制表演和硬切节奏。',
    useCases: '叙事短片、品牌故事、短广告和 MV。',
    inputs: '剧本或故事梗概、角色、对白、年代感、比例和时长。可附色彩或场景参考。',
    deliverables: '对称构图短片、关键帧和按顺序合成的分镜。',
    duration: { min: 15, max: 60, default: 30 },
    workflow: `把用户的原创故事写成具有几何秩序、舞台感和冷幽默的电影短片。以原创场景和动作体现视听语法，避免复刻现成电影镜头或角色。
1. 提炼一处人物反差或动作笑点，设置可复用的限定配色、道具母题、年代质感和角色三视图。
2. 给每个空间画出中轴、对称物和留白区。用正面固定镜头、横向移镜、俯拍物件和节拍式硬切组织信息，破坏对称时说明叙事目的。
3. 按用户时长写分段镜头表，列时间码、构图坐标、动作、对白停顿、光源和可直接使用的图像与视频提示词。长片分场规划，保持色彩与动线连续。
4. 提供原创配乐的节拍、乐器和停顿建议，标明旁白、对白、环境声与静默段落。给出片尾和交付验收表。`,
  },
  {
    slug: 'toy-animation',
    name: '手办微缩动画',
    description: '把手办图做成日式特摄、潮玩动画或毛毡定格短片，保留造型和配件。',
    sceneBeats: ["近景介绍同一手办角色及可触摸的微缩空间。","围绕一个明确小动作推进，保持配件、关节和材质连续。","用一个可读的动作结果收尾，给微缩布景和道具一个短停顿。"],
    visualStyle: '微缩实体布景和玩具尺度，保持同一手办的轮廓、上色、配件和关节位置。',
    useCases: '原创 IP 演绎、玩具展示和微缩创意短片。',
    inputs: '上传手办图，补充人物性格、短剧情、尺寸感、场景和想要的动画风格。',
    deliverables: '手办主题短片、关键帧和可单独使用的动画镜头。',
    duration: { min: 15, max: 60, default: 30 },
    options: [
      { name: 'toyStyle', label: '动画风格', type: 'enum', enum: ['日式特摄', '潮玩动画', '毛毡定格'], default: '毛毡定格' },
      { name: 'language', label: '视频语言', type: 'enum', enum: ['中文', '英文', '日文', '无台词'], default: '中文' },
      { name: 'withScene', label: '生成场景参考图', type: 'boolean', default: true },
    ],
    workflow: `让参考手办在原创微缩场景里完成一件清楚的小事。先锁定身份、轮廓、涂装、接缝、配件和可动关节。没有图时标出待补素材，不凭空描述既有手办细节。
1. 产出短剧本、三视图提示词、比例标尺、场景图和主道具，写清材质哪些保留、哪些可以风格化。
2. 日式特摄采用微缩布景、机位与实体烟尘感；潮玩采用利落剪辑、展示台灯光和色块；毛毡定格体现纤维、轻微姿态跳变和帧间手工感。
3. 给出带时间码的逐镜表、关键动作、首末帧、运镜、参考图一致性和逐镜生成提示词。
4. 编排配乐、拟音、字幕和片尾，核对同一手办的尺寸、配件、持握和场景方向在剪辑后保持一致。`,
  },
]

export function getFilmSkillShowcase(skill: Pick<SkillManifest, 'source' | 'slug'>) {
  if (skill.source !== 'official') return undefined
  return filmSkills.find(({ slug }) => slug === skill.slug)
}

export const OFFICIAL_FILM_SKILLS: SkillManifest[] = filmSkills.map((film) => ({
  id: 'official.' + film.slug,
  slug: film.slug,
  version: '1.0.0',
  name: film.name,
  description: film.description,
  kind: 'video',
  execution: 'configured',
  source: 'official',
  enabled: true,
  parameters: [
    { name: 'subject', label: '创作简报', type: 'string', bind: 'prompt', required: true },
    { name: 'duration', label: '目标时长（秒）', type: 'number', min: film.duration.min, max: film.duration.max, default: film.duration.default },
    { name: 'ratio', label: '成片画幅', type: 'enum', enum: film.slug === 'toy-animation' ? ['16:9', '9:16', '1:1', '4:3'] : ['16:9', '9:16', '1:1'], default: '16:9' },
    ...(film.options ?? []),
  ],
  inputs: [{ name: 'references', type: 'image', multiple: true }],
  output: { name: 'film', type: 'video' },
  template: {
    prompt: `你是 DisyLab 的影片策划和分镜导演。基于用户简报制作可执行的方案。优先遵守用户输入和执行参数；未提供时用 ${film.duration.default} 秒和 16:9。镜头时长之和等于目标时长，按模型能力把长镜头拆分为可生成的片段。将工作流提炼成逐镜画面、动作、声音和连续性要求。\n\n${film.workflow}\n\n用户简报\n{{subject}}`,
  },
  capability: { supportedModes: ['image2video'], allowedModelCapabilities: ['video'] },
  createdAt: 0,
  updatedAt: 0,
}))
