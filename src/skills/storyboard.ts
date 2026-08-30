export type ComicLayout = 'spread' | 'vertical' | 'zigzag'
export type ComicStyle = '2d' | '3d'
export type ComicAssetCategory = 'cutouts' | 'props' | 'scenes' | 'backgrounds'
export type ComicWorkflowStatus = 'content' | 'visual' | 'sketches' | 'composition' | 'assets' | 'delivery' | 'completed'

export type ComicSection = { id: string; name: string; headline: string; label: string; body: string; points: string[]; visualNote: string; keepTogether: true }
export type ComicGeneratedResult = { id: string; requestId: string; url: string; mediaId?: string; fileName: string; createdAt: string; canvasNodeId?: string }
export type ComicSketch = ComicGeneratedResult & { layout: ComicLayout; name: string; detail: string }
export type ComicComposition = ComicGeneratedResult & { layout: ComicLayout; style: ComicStyle; approved?: boolean }
export type ComicAssetTask = { id: string; compositionId: string; category: ComicAssetCategory; sectionId: string; sectionName: string; panelIndex: number; name: string; enabled: boolean; status: 'pending' | 'generating' | 'completed' | 'failed' | 'skipped'; result?: ComicGeneratedResult }
export type ComicKit = { id: string; name: string; layout: ComicLayout; style: ComicStyle; compositionId: string; assetTaskIds: string[]; createdAt: number }

export type ComicWorkflowState = {
  skillKey: string; profile?: 'generic' | 'niuniu'; projectName: string; theme: string; sections: ComicSection[]; globalVisualNote: string; allowSceneOnly: boolean
  workflowNodeId?: string
  gridMode: 'auto' | 'manual'; gridCount?: number; style: ComicStyle; styleCompare: boolean; aspectRatio: string; language: 'follow-input'
  compositionCount?: number
  layoutReference?: { name: string; url: string }; layoutReferences?: Array<{ name: string; url: string }>; characterReferences?: Array<{ name: string; url: string }>; selectedLayouts: ComicLayout[]
  sketches: ComicSketch[]; compositions: ComicComposition[]; selectedCompositionIds: string[]; compositionFeedback: string
  assetTasks: ComicAssetTask[]; kits: ComicKit[]; outputTarget: 'project' | 'download' | 'folder'; filePrefix: string
  status: ComicWorkflowStatus; updatedAt: number
}

export type ComicGenerationRequest = {
  id: string; kind: 'sketch' | 'composition' | 'asset'; prompt: string; displayPrompt?: string; aspectRatio: string; referenceUrl?: string; referenceName?: string; referenceImages?: Array<{ name: string; url: string }>
  gptImagePrompt?: string; gptImageReferenceImages?: Array<{ name: string; url: string }>; nanoImagePrompt?: string
  meta: { layout?: ComicLayout; style?: ComicStyle; assetTaskId?: string; assetName?: string; category?: ComicAssetCategory; compositionId?: string; sectionId?: string; sectionName?: string; panelIndex?: number; parentNodeId?: string; parentRequestId?: string }
}

export const COMIC_LAYOUTS: Array<{ id: ComicLayout; name: string; shortName: string; detail: string; reading: string }> = [
  { id: 'spread', name: 'A · 手册对开', shortName: 'A', detail: '双主区块对照，首屏建立主题，信息分布均衡。', reading: '上方主视觉 → 左右对照 → 底部收束' },
  { id: 'vertical', name: 'B · 竖向长图', shortName: 'B', detail: '英雄格开场，沿纵轴连续阅读，适合社媒长图。', reading: '英雄格 → 连续卡片 → 结论格' },
  { id: 'zigzag', name: 'C · 折线阅读', shortName: 'C', detail: '图文左右交替，节奏更像漫画，适合转折叙事。', reading: '左上 → 右中 → 左下 → 结尾破框' },
]

export const COMIC_STYLE_LABELS: Record<ComicStyle, string> = { '2d': '2D', '3d': '3D' }
export const COMIC_ASSET_LABELS: Record<ComicAssetCategory, string> = { cutouts: '角色透明素材', props: '道具单品', scenes: '纯场景 / 元素', backgrounds: '每格背景板' }

export function createComicSection(index = 0): ComicSection {
  return { id: `section-${crypto.randomUUID()}`, name: index ? `区块 ${index + 1}` : '', headline: '', label: '', body: '', points: ['', ''], visualNote: '', keepTogether: true }
}

const NIUNIU_2D_REFERENCES = [
  // 正视母版必须是图1，作为比例与五官的主尺
  { name: '牛牛 2D 母版 1 · 基础造型正视', url: '/niuniu-ip/2d-jp/niuniu-2d-jp-05.png' },
  { name: '牛牛 2D 母版 2 · 基础造型侧前视', url: '/niuniu-ip/2d-jp/niuniu-2d-jp-02.png' },
  { name: '牛牛 2D 母版 3 · 基础造型动态', url: '/niuniu-ip/2d-jp/niuniu-2d-jp-03.png' },
  { name: '牛牛 2D 母版 4 · 基础造型后视', url: '/niuniu-ip/2d-jp/niuniu-2d-jp-04.png' },
  { name: '牛牛 2D 母版 5 · 灰色西装造型', url: '/niuniu-ip/2d-jp/niuniu-2d-jp-01.jpg' },
]
const NIUNIU_3D_REFERENCES = [
  { name: '牛牛 3D 母版 1 · 正面 0°', url: '/niuniu-ip/3d/0.png' },
  { name: '牛牛 3D 母版 2 · 右前 45°', url: '/niuniu-ip/3d/45.png' },
  { name: '牛牛 3D 母版 3 · 右侧 90°', url: '/niuniu-ip/3d/90.png' },
  { name: '牛牛 3D 母版 4 · 右后 135°', url: '/niuniu-ip/3d/135.png' },
  { name: '牛牛 3D 母版 5 · 背面 180°', url: '/niuniu-ip/3d/180.png' },
]

// 牛牛身份参考必须按媒介完全隔离。所有请求统一经过这里取图，
// 禁止调用方自行拼接 2D/3D 母版造成跨风格污染。
function niuniuReferencesForStyle(style: ComicStyle | 'sketch') {
  return style === '3d' ? NIUNIU_3D_REFERENCES : NIUNIU_2D_REFERENCES
}

/**
 * GPT Image treats every multipart edit image as an editable source. Supplying
 * several poses of the same character therefore encourages an averaged new
 * mascot, which is the opposite of an identity lock. Give GPT a single visual
 * authority and let the prompt/layout reference describe the requested pose.
 * Nano keeps the complete multi-view set through niuniuReferencesForStyle().
 */
function gptNiuniuIdentityReferences(style: ComicStyle | 'sketch') {
  return [niuniuReferencesForStyle(style)[0]]
}

function niuniuMediaBindingRule(style: ComicStyle | 'sketch') {
  if (style === '3d') {
    return '【媒介绑定·3D】当前任务只允许五张3D母版决定牛牛身份、比例、体积、材质和固有色；禁止读取或模拟任何2D牛牛母版。黑白骨架若存在，仅用于分格、位置、朝向和动作意图，不是角色外形参考。'
  }
  return `【媒介绑定·${style === 'sketch' ? '骨架' : '2D'}】当前任务只允许2D母版决定牛牛身份、比例、轮廓和五官；禁止读取或模拟任何3D牛牛母版。`
}

/**
 * 像素实测十张母版（头高 / 全身）：2D≈47–51%，3D≈50%；全身约 2.0 头身。
 * 身份锁：比例/体块/五官固定；服装/神态/动作可变。
 */
const NIUNIU_PROPORTION_LOCK = [
  '【比例硬指标·母版轮廓优先】直接复制当前风格正视母版的全身外接轮廓和纵向比例：头顶、下巴、肩线、胯线、膝部与脚底的相对高度必须一致。保持母版中清楚可见的躯干长度和直立腿长，禁止纵向压缩、压矮、缩腿、加宽身体或改成矮胖玩偶。数值只用于校验：全身约 2.0 头身、头高约占全身一半；若数值描述与母版观感有差异，逐像素轮廓与部位边界以母版为准。',
  '头：略扁宽的大圆角横椭圆；两只短小米色圆锥角；小耳在角下；头顶中央一撮短尖发。',
  '五官：两只大的纯深色竖直椭圆眼睛（高度约占头高 18%–25%，绝不是小圆点/豆眼），间距宽，无白色高光；米色大块口鼻覆盖脸部下半约 45%–55%；鼻孔两个极小短横；嘴是短细线，可随剧情改弧度，但眼型与口鼻面积不得改。',
  '躯干：复制母版圆角竖向躯干的高度、宽度和肩胯关系；米色肚皮为胸腹竖椭圆。不得横向扩张或压扁躯干。',
  '四肢：复制母版手臂、腿部和深棕平底蹄的长度、粗细与连接位置；双腿保持母版的直立纵向延伸感，不得截短或向两侧撑宽。',
  '侧后/背面保留母版同款深棕折线箭头尾；正面不凭空露尾。',
  '固有配色：暖橙身体、奶油米色口鼻/肚皮/角、深棕眼睛与蹄、亮蓝三角领巾。',
  '服装可外挂替换；不得借换装改头身比、体块或五官几何。',
].join('')

const NIUNIU_VISUAL_LOCK = `固定主角为富途牛牛官方 IP。${NIUNIU_PROPORTION_LOCK}角色无需每格出现；未要求出场的格子只画场景与元素。`

const NIUNIU_STYLE_LOCK: Record<ComicStyle, string> = {
  '2d': `2D 身份源=五张 2D 母版。直接临摹正视母版的完整站立高度、头脸轮廓、躯干与腿部纵向比例、大竖直椭圆眼、米色口鼻肚皮和蓝领巾。画风：干净日式商业插画、深褐清晰外轮廓、层次明确的综合色彩。动作/神态/服装可变；禁止压矮、加宽、改脸改比例、写实牛、毛发或廉价厚涂。`,
  '3d': `3D 身份源=五张 3D 母版。直接临摹正视母版的完整站立高度、头脸体积、躯干与腿部纵向比例、大竖直椭圆眼和全部固有色块；保持母版软塑料潮玩材质。动作/神态/服装可变；禁止压矮、加宽、缩腿、改脸改比例、写实 CGI 或眼睛高光。`,
}

const NIUNIU_SKETCH_LINE_LOCK = [
  '黑白线稿：纯白底 #FFF + 纯黑线 #000。',
  '线宽强制：粗实均匀（儿童绘本/图标级描边，≥分格框线宽）；缩略图也必须一眼看清牛牛剪影与分格。严禁浅灰、棕灰、淡墨、发丝细线、发虚抗锯齿边、铅笔速写。',
  '只画外轮廓与最少结构线；禁止排线、灰阶、涂黑、照片细节。',
  '牛牛线稿必须描摹正视母版的完整纵向轮廓和部位边界：保持原始站立高度、躯干长度、腿长、大竖直椭圆眼和大块口鼻；禁止压矮、缩腿、加宽或变矮胖。',
].join('')

const NIUNIU_COMPOSITION_ART_LOCK = [
  '成片：专业可信但必须鲜明、有设计感和色彩记忆点；不是寡淡模板，也不是大面积空白的简单填色稿。',
  '整页先建立明确色彩系统：从牛牛暖橙、亮蓝领巾与深棕中提取主色，再配置一组冷色辅助色和高亮强调色；控制为 4–6 个核心色，形成冷暖对比、明暗节奏与跨格色彩呼应，禁止整页灰暗、低饱和或单一米白底。',
  '每格必须有清楚视觉焦点、前中后景和大小对比；综合使用建立镜头、中景、近景/特写、局部破框、斜向动线、色块分区和光影聚焦，让连续格之间有疏密与节奏变化。',
  '金融图表、界面、数字、场景和道具应转化为具有版式功能的视觉图形，既提供信息层级又参与构图；保持秩序但不能只摆少量孤立图标，禁止无意义堆砌。',
  '牛牛外形必须与当前风格的五张母版完全一致：逐项复制头身比例、身高、头脸轮廓、五官几何与位置、角耳尖发、躯干与腿长、四肢粗细、蹄形、领巾和固有色块；不得压矮、缩短腿、加宽身体、变矮胖或重新设计。',
  '若黑白骨架里的牛牛比例、脸型或体块与母版有任何偏差，忽略骨架中的角色外形；骨架只提供分格、位置、朝向与动作意图，角色身份和几何结构一律以五张母版为唯一准则。',
  '2D：干净描边、综合色块、局部渐变与有方向的光影；3D：软塑料潮玩、完整环境布光、空间层次与受控彩色反射。标题和必要信息简洁可读，禁止制作术语。',
].join('')

function niuniuIdentityLead(style: ComicStyle | 'sketch') {
  const styleBit = style === 'sketch' || style === '2d' ? NIUNIU_STYLE_LOCK['2d'] : NIUNIU_STYLE_LOCK['3d']
  const lineBit = style === 'sketch' ? NIUNIU_SKETCH_LINE_LOCK : ''
  return `【最高优先级·牛牛身份锁】先看名称含“IP 身份强参考”的母版图，再画任何内容。图1（正视母版）是完整身高、纵向轮廓、体块和五官的唯一主尺；不要凭“大头吉祥物”惯例重算比例。${NIUNIU_PROPORTION_LOCK}${styleBit}${lineBit}若文字与母版冲突，以母版为准。`
}

export function createComicWorkflow(content = '', profile: 'generic' | 'niuniu' = 'generic'): ComicWorkflowState {
  const section = createComicSection(); section.body = content
  const niuniu = profile === 'niuniu'
  return { skillKey: niuniu ? 'official.niuniu-comic@2.19.0' : 'official.storyboard-comic@2.0.0', profile, projectName: niuniu ? '牛牛漫画' : '未命名漫画', theme: '', sections: [section], globalVisualNote: niuniu ? `${NIUNIU_VISUAL_LOCK}画面专业可信、色彩鲜明、层次丰富、统一画风；线稿纯黑粗实；角色纵向轮廓和完整站立高度严格复制母版，禁止豆眼、压矮、缩腿和加宽。` : '角色结构准确、表情生动、角度灵活，画面连贯并符合内容。', allowSceneOnly: true, gridMode: 'auto', style: '2d', styleCompare: false, compositionCount: 1, aspectRatio: '9:16', language: 'follow-input', characterReferences: niuniu ? NIUNIU_2D_REFERENCES : [], selectedLayouts: [], sketches: [], compositions: [], selectedCompositionIds: [], compositionFeedback: '', assetTasks: [], kits: [], outputTarget: 'project', filePrefix: niuniu ? 'niuniu-comic' : 'comic', status: 'content', updatedAt: Date.now() }
}

export function normalizeComicWorkflow(state: ComicWorkflowState): ComicWorkflowState {
  const legacyStyle = (state as unknown as { style?: string }).style
  const niuniu = state.profile === 'niuniu' || Boolean(state.skillKey?.includes('niuniu-comic'))
  const next: ComicWorkflowState = {
    ...state,
    profile: niuniu ? 'niuniu' : (state.profile ?? 'generic'),
    skillKey: niuniu ? 'official.niuniu-comic@2.19.0' : state.skillKey,
    style: legacyStyle === '3d' || legacyStyle === 'hybrid' ? '3d' : '2d',
    compositionCount: Math.max(1, Math.min(4, state.compositionCount ?? 1)),
    sections: state.sections.map((section) => ({ ...section, headline: section.headline ?? '' })),
    characterReferences: niuniu ? NIUNIU_2D_REFERENCES : state.characterReferences,
  }
  // 旧工作流里可能残留错误比例文案（如 42%/禁止2头身）；打开时强制刷新身份锁。
  if (niuniu) {
    next.globalVisualNote = `${NIUNIU_VISUAL_LOCK}画面专业可信、色彩鲜明、层次丰富、统一画风；线稿纯黑粗实；角色纵向轮廓和完整站立高度严格复制母版，禁止豆眼、压矮、缩腿和加宽。`
  }
  return next
}

/**
 * Create an independent workflow checkpoint when the user edits an earlier
 * stage. Results at and after the invalidated boundary must never leak into
 * the new branch as generation references.
 */
export function forkComicWorkflowAtStage(state: ComicWorkflowState, status: ComicWorkflowStatus, workflowNodeId: string): ComicWorkflowState {
  const next: ComicWorkflowState = {
    ...state,
    workflowNodeId,
    status,
    sections: state.sections.map((section) => ({ ...section, points: [...section.points] })),
    layoutReferences: state.layoutReferences?.map((reference) => ({ ...reference })),
    layoutReference: state.layoutReference ? { ...state.layoutReference } : undefined,
    characterReferences: state.characterReferences?.map((reference) => ({ ...reference })),
    selectedLayouts: [...state.selectedLayouts],
    sketches: state.sketches.map((sketch) => ({ ...sketch })),
    compositions: state.compositions.map((composition) => ({ ...composition })),
    selectedCompositionIds: [...state.selectedCompositionIds],
    assetTasks: state.assetTasks.map((task) => ({ ...task, result: task.result ? { ...task.result } : undefined })),
    kits: state.kits.map((kit) => ({ ...kit, assetTaskIds: [...kit.assetTaskIds] })),
    updatedAt: Date.now(),
  }

  if (status === 'content' || status === 'visual') {
    next.sketches = []
    next.selectedLayouts = []
    next.compositions = []
    next.selectedCompositionIds = []
    next.compositionFeedback = ''
    next.assetTasks = []
    next.kits = []
  } else if (status === 'sketches') {
    next.compositions = []
    next.selectedCompositionIds = []
    next.compositionFeedback = ''
    next.assetTasks = []
    next.kits = []
  } else if (status === 'composition') {
    next.assetTasks = []
    next.kits = []
  } else if (status === 'assets') {
    // Preserve the edited task selection, but never reuse completed media from
    // the parent branch as if it belonged to this independent branch.
    next.assetTasks = next.assetTasks.map((task) => ({
      ...task,
      id: `asset-${task.category}-${crypto.randomUUID()}`,
      status: task.enabled ? 'pending' : 'skipped',
      result: undefined,
    }))
    next.kits = []
  }

  return next
}

export function estimatePanelCount(state: Pick<ComicWorkflowState, 'sections' | 'gridMode' | 'gridCount'>) {
  if (state.gridMode === 'manual' && state.gridCount) return Math.max(1, Math.min(24, state.gridCount))
  return Math.max(1, state.sections.reduce((sum, section) => sum + Math.max(1, section.points.filter(Boolean).length), 0))
}

export function serializeComicContent(state: ComicWorkflowState) {
  const sections = state.sections.map((section) => [
    `区块：${section.name || '未命名区块'}`, section.headline ? `大标签：${section.headline}` : '', section.label ? `小标签：${section.label}` : '', section.body ? `主要内容：${section.body}` : '',
    section.points.filter(Boolean).length ? `要点：\n${section.points.filter(Boolean).map((point) => `• ${point}`).join('\n')}` : '', section.visualNote ? `画面要求：${section.visualNote}` : '',
  ].filter(Boolean).join('\n')).join('\n\n')
  return [`主题 / 脚本：${state.theme}`, sections, `格数：${state.gridMode === 'auto' ? `自动（建议 ${estimatePanelCount(state)} 格）` : state.gridCount}`, `全局画面要求：${state.globalVisualNote}`, '语言：跟随输入，不翻译'].filter(Boolean).join('\n\n')
}

// The sketch stage needs story facts and panel notes, but not the workflow's
// color/finish direction. Mixing "色彩鲜明" into a black-and-white request is
// especially destabilizing for edit-style image models.
function serializeComicSketchContent(state: ComicWorkflowState) {
  const sections = state.sections.map((section) => [
    `区块：${section.name || '未命名区块'}`, section.headline ? `大标签：${section.headline}` : '', section.label ? `小标签：${section.label}` : '', section.body ? `主要内容：${section.body}` : '',
    section.points.filter(Boolean).length ? `要点：\n${section.points.filter(Boolean).map((point) => `• ${point}`).join('\n')}` : '', section.visualNote ? `本区画面要求：${section.visualNote}` : '',
  ].filter(Boolean).join('\n')).join('\n\n')
  return [`主题 / 脚本：${state.theme}`, sections, `格数：${state.gridMode === 'auto' ? `自动（建议 ${estimatePanelCount(state)} 格）` : state.gridCount}`, '语言：跟随输入，不翻译'].filter(Boolean).join('\n\n')
}

// Keep built-in IP/reference locks in the model request, not in the canvas UI.
// The visible prompt is deliberately limited to content the user supplied and
// the selected production stage.
function serializeComicDisplayContent(state: ComicWorkflowState) {
  const sections = state.sections.map((section) => [
    section.name ? `区块：${section.name}` : '', section.headline ? `大标签：${section.headline}` : '', section.label ? `小标签：${section.label}` : '', section.body ? `主要内容：${section.body}` : '',
    section.points.filter(Boolean).length ? `要点：\n${section.points.filter(Boolean).map((point) => `• ${point}`).join('\n')}` : '', section.visualNote ? `画面要求：${section.visualNote}` : '',
  ].filter(Boolean).join('\n')).filter(Boolean).join('\n\n')
  return [`主题 / 脚本：${state.theme}`, sections].filter(Boolean).join('\n\n')
}

function layoutPrompt(layout: ComicLayout) { const item = COMIC_LAYOUTS.find((candidate) => candidate.id === layout)!; return `${item.name}；${item.detail}；阅读动线：${item.reading}` }

export function buildSketchRequests(state: ComicWorkflowState): ComicGenerationRequest[] {
  const content = serializeComicSketchContent(state)
  const displayContent = serializeComicDisplayContent(state)
  const layoutReferences = state.layoutReferences?.length ? state.layoutReferences : state.layoutReference ? [state.layoutReference] : []
  const identityReferences = state.profile === 'niuniu' ? niuniuReferencesForStyle('sketch') : (state.characterReferences ?? [])
  const references = [
    ...identityReferences.map((reference, index) => ({ name: `IP 身份强参考 ${index + 1} · ${reference.name}`, url: reference.url })),
    ...layoutReferences.map((reference, index) => ({ name: `排版参考 ${index + 1} · ${reference.name}`, url: reference.url })),
  ]
  const lead = state.profile === 'niuniu' ? `${niuniuIdentityLead('sketch')}\n\n` : ''
  const sketchArtDirection = state.profile === 'niuniu'
    ? `只生成一张黑白漫画线稿骨架：${NIUNIU_SKETCH_LINE_LOCK}先临摹图1正视母版的头身与五官，再摆姿态；线条纯黑粗实。此阶段只比较切割与阅读动线。`
    : '只生成一张干净、精确的黑白漫画线稿骨架：使用细而均匀、边缘锐利的黑色线条，轮廓清晰克制，明确表现真实分格、人物姿态、镜头景别、场景与道具关系。白底、无灰阶渲染、无颜色、无涂黑块、无铅笔笔触、无速写感、无粗犷毛边、无粗重描边、无杂乱排线、无精细材质、无成片光影。此阶段只用于比较切割方式、视觉重心、构图和阅读动线，不是彩色构图粗稿。'
  return COMIC_LAYOUTS.map((item) => {
    const layout = item.id
    // GPT Image's edit path treats each upload as another editable source.
    // One authoritative front master preserves facial geometry and proportion
    // much more reliably than asking the model to average several poses.
    const gptIdentityReferences = state.profile === 'niuniu'
      ? gptNiuniuIdentityReferences('sketch').map((reference) => ({ name: `牛牛唯一身份母版 · ${reference.name}`, url: reference.url }))
      : identityReferences.map((reference, index) => ({ name: `角色结构参考 ${index + 1} · ${reference.name}`, url: reference.url }))
    const gptReferences = [
      ...gptIdentityReferences,
      ...layoutReferences.map((reference, index) => ({ name: `排版参考 ${index + 1} · ${reference.name}`, url: reference.url })),
    ]
    const gptImagePrompt = state.profile === 'niuniu'
      ? `【GPT Image 2 专用 · 单母版临摹型黑白骨架】\n${niuniuMediaBindingRule('sketch')}图1是唯一角色输入和不可修改的身份母版；不要重新设计角色，也不要套用通用“大头吉祥物”比例。先像描图一样复制图1的头脸外轮廓、角耳尖发、眼睛形状与间距、口鼻面积与位置、头身比、躯干长度、腿长、四肢粗细和蹄形，然后只改变四肢关节、朝向与表情。每格出现的都是图1中同一个牛牛，不是相似的小牛。任何一格都不得压缩纵向距离、缩短腿、加宽躯干、缩小眼睛、缩小口鼻或改成圆矮玩偶。每条外轮廓和关节连接线必须闭合、连续、清楚，不得省略手脚、眼睛、口鼻或分格线。\n\n${content}\n\n【版式 ${item.shortName}】${layoutPrompt(layout)}。生成一张完整漫画页的纯黑白阅读骨架：白底、纯黑清晰线条、真实分格；表现镜头景别、人物动作、场景和道具关系，不上色、不加灰阶、不排线、不涂黑大色块。先完成每格牛牛的身份复核，再完成场景；同页所有牛牛必须共享完全相同的头脸几何和头身比例。名称含“排版参考”的图片只决定格框数量、比例、切割与阅读动线，绝不能改变牛牛。不得写出“区块”“小标签”“主要内容”“要点”“文字安全区”等制作术语，不得输出字段名、编号标签、提示词原文或虚线说明框。`
      : `${content}\n\n【黑白阅读骨架 ${item.shortName}】\n版式方向：${layoutPrompt(layout)}。${sketchArtDirection}`
    const nanoImagePrompt = `${lead}${content}\n\n【黑白阅读骨架 ${item.shortName}】\n版式方向：${layoutPrompt(layout)}。${sketchArtDirection}\n\n名称含“IP 身份强参考”的图片只决定牛牛造型（图1=正视主尺）；名称含“排版参考”的图片只决定分格，绝不能覆盖牛牛身份。若提供排版参考图，必须完整学习分格数量、格框比例、切割角度、跨格关系、视觉重心与留白；不得只做宽泛参考。严格禁止写出“区块”“小标签”“主要内容”“要点”“文字安全区”等制作术语；禁止虚线说明框、字段名、编号标签和提示词原文。\n\n【Nano 骨架色彩钳制】彩色母版中的橙、蓝、米、棕只用于识别牛牛的轮廓与部位，绝不能复制到输出。整张输出只允许纯白背景与纯黑线条；禁止红、绿、蓝、橙、棕及任何其他颜色，禁止彩色文字、图表、箭头、图标或强调块。金融涨跌、对比和重点只能用黑色线型、箭头、形状与留白区分，不得使用红绿语义色。输出前进行一次全页去色检查，发现任何彩色像素都改为黑线或白底。`
    return {
      id: `sketch-${layout}-${crypto.randomUUID()}`,
      kind: 'sketch' as const,
      aspectRatio: state.aspectRatio,
      displayPrompt: `${displayContent}\n\n生成 ${item.name} 黑白阅读骨架。`.trim(),
      referenceImages: references,
      gptImagePrompt,
      gptImageReferenceImages: gptReferences,
      nanoImagePrompt,
      meta: { layout },
      prompt: `${lead}${content}\n\n【黑白阅读骨架 ${item.shortName}】\n版式方向：${layoutPrompt(layout)}。${sketchArtDirection}\n\n名称含“IP 身份强参考”的图片只决定牛牛造型（图1=正视主尺）；名称含“排版参考”的图片只决定分格，绝不能覆盖牛牛身份。若提供排版参考图，必须完整学习分格数量、格框比例、切割角度、跨格关系、视觉重心与留白；不得只做宽泛参考。严格禁止写出“区块”“小标签”“主要内容”“要点”“文字安全区”等制作术语；禁止虚线说明框、字段名、编号标签和提示词原文。`,
    }
  })
}

export function buildCompositionRequests(state: ComicWorkflowState): ComicGenerationRequest[] {
  const content = serializeComicContent(state); const displayContent = serializeComicDisplayContent(state); const styles = state.styleCompare ? (['2d', '3d'] as ComicStyle[]) : [state.style]
  const count = Math.max(1, Math.min(4, state.compositionCount ?? 1))
  return state.selectedLayouts.flatMap((layout) => styles.flatMap((style) => Array.from({ length: count }, (_, variantIndex) => {
    const selectedSkeleton = state.sketches.find((sketch) => sketch.layout === layout)
    const profileReferences = state.profile === 'niuniu' ? niuniuReferencesForStyle(style) : []
    // IP 母版必须排在骨架前面，避免错误骨架比例覆盖身份。
    const references = [
      ...(profileReferences.length ? profileReferences : (state.characterReferences ?? [])).map((reference, index) => ({ name: `IP 身份强参考 ${index + 1} · ${reference.name}`, url: reference.url })),
      ...(selectedSkeleton ? [{ name: `已选 ${layout.toUpperCase()} 黑白阅读骨架（仅结构参考）`, url: selectedSkeleton.url }] : []),
    ]
    const lead = state.profile === 'niuniu' ? `${niuniuIdentityLead(style)}\n\n` : ''
    const styleDirection = state.profile === 'niuniu'
      ? `${NIUNIU_COMPOSITION_ART_LOCK}版面风格按“${COMIC_STYLE_LABELS[style]}”执行。`
      : `优先遵循用户文本中的画风、审美、时代、媒介和情绪描述；若请求中存在 IP / 角色参考图，保持其身份、外形、服装、配色和关键识别特征，并围绕该 IP 自主建立统一画风；若两者都没有，则依据当前内容语气和“${COMIC_STYLE_LABELS[style]}”自动设计适合主题的专业画风。`
    const finishDirection = state.profile === 'niuniu'
      ? `生成一张具有完整视觉设计的彩色专业漫画整页：先逐格锁定牛牛母版身份，再建立主次焦点、镜头节奏、跨格色彩呼应、空间层次和富有表现力的金融视觉语言。专业不等于寡淡或空白；画面必须鲜明、丰富、统一且可直接作为彩色成片。禁止照片级写实与风格杂糅。`
      : `生成一张彩色、高完成度、接近最终成片的漫画整页构图，明确每格角色动作与表情、道具、场景、配色和光影，整体效果应可直接用于判断最终画面。`
    const prompt = `${lead}${content}\n\n【彩色成片构图 · 候选 ${variantIndex + 1}/${count}】\n切割骨架：${layoutPrompt(layout)}。版面风格：${COMIC_STYLE_LABELS[style]}。名为“已选 ${layout.toUpperCase()} 黑白阅读骨架（仅结构参考）”的图片只决定分格数量、格框边界和阅读动线，不得覆盖牛牛身份，也不得限制彩色阶段重新设计格内景别、前后景、色块、光影和视觉焦点；IP 身份强参考（图1正视）才是角色主尺。在保持格框和内容顺序的前提下，把整页发展为具有完整视觉系统的彩色成片。${styleDirection}\n\n${finishDirection}保持内容顺序。不要出现制作术语或虚线说明框；保留简洁、必要且可读的标题与信息。${state.compositionFeedback ? `\n修改反馈：${state.compositionFeedback}` : ''}`
    const gptImagePrompt = state.profile === 'niuniu'
      ? `【GPT Image 2 专用 · ${COMIC_STYLE_LABELS[style]}身份绑定】\n${niuniuMediaBindingRule(style)}输入图1是当前${COMIC_STYLE_LABELS[style]}风格下牛牛完整身高、头脸、五官、躯干和腿长的唯一主尺；其余同媒介母版只校验转角和背面。不要平均重算比例，不要把牛牛压矮、缩腿或加宽。${style === '3d' ? '逐格复制3D母版的立体体积、软塑料材质、灯光响应和五官深度；禁止生成2D扁平描边角色。' : '逐格复制2D母版的平面轮廓、五官几何、综合色块和清晰描边；禁止生成3D潮玩或CG体积。'}\n\n${content}\n\n【彩色成片构图 · 候选 ${variantIndex + 1}/${count}】\n版式：${layoutPrompt(layout)}。最后一张黑白骨架只锁定分格边界、阅读顺序、角色位置和动作意图；若骨架角色比例与母版冲突，必须完全忽略骨架外形并按图1重画。${styleDirection}\n\n${finishDirection}保持内容顺序，保留必要可读信息，不出现制作术语或虚线说明框。${state.compositionFeedback ? `\n修改反馈：${state.compositionFeedback}` : ''}`
      : prompt
    const nanoImagePrompt = state.profile === 'niuniu'
      ? `${niuniuMediaBindingRule(style)}\n${prompt}`
      : prompt
    return {
      id: `composition-${layout}-${style}-${variantIndex + 1}-${crypto.randomUUID()}`,
      kind: 'composition' as const,
      aspectRatio: state.aspectRatio,
      displayPrompt: `${displayContent}\n\n生成 ${COMIC_STYLE_LABELS[style]} 彩色成片构图${state.compositionFeedback ? `。修改反馈：${state.compositionFeedback}` : '。'}`.trim(),
      referenceImages: references,
      gptImagePrompt,
      gptImageReferenceImages: references,
      nanoImagePrompt,
      meta: { layout, style, parentNodeId: selectedSkeleton?.canvasNodeId, parentRequestId: selectedSkeleton?.requestId },
      prompt,
    }
  })))
}

export function buildAssetPlan(state: ComicWorkflowState): ComicAssetTask[] {
  const tasks: ComicAssetTask[] = []
  const sections = state.sections.length ? state.sections : [createComicSection(0)]
  const panelCount = estimatePanelCount(state)
  for (const compositionId of state.selectedCompositionIds) { for (let panelIndex = 1; panelIndex <= panelCount; panelIndex += 1) { const section = sections[Math.min(sections.length - 1, Math.floor((panelIndex - 1) * sections.length / panelCount))]; const base = { compositionId, sectionId: section.id, sectionName: section.name || `区块 ${panelIndex}`, panelIndex, enabled: true, status: 'pending' as const }; tasks.push(
    { ...base, id: `asset-cutouts-${crypto.randomUUID()}`, category: 'cutouts', name: `p${String(panelIndex).padStart(2, '0')}_character` },
    { ...base, id: `asset-props-${crypto.randomUUID()}`, category: 'props', name: `p${String(panelIndex).padStart(2, '0')}_props` },
    { ...base, id: `asset-scenes-${crypto.randomUUID()}`, category: 'scenes', name: `p${String(panelIndex).padStart(2, '0')}_scene` },
    { ...base, id: `asset-backgrounds-${crypto.randomUUID()}`, category: 'backgrounds', name: `p${String(panelIndex).padStart(2, '0')}_bg` },
  ) } }
  return tasks
}

export function buildAssetRequests(state: ComicWorkflowState, composition: ComicComposition): ComicGenerationRequest[] {
  const content = serializeComicContent(state)
  const displayContent = serializeComicDisplayContent(state)
  const identityReferences = state.profile === 'niuniu' ? niuniuReferencesForStyle(composition.style) : []
  return state.assetTasks.filter((task) => task.compositionId === composition.id && task.enabled && task.status !== 'completed').map((task) => {
    const rule: Record<ComicAssetCategory, string> = {
      cutouts: state.profile === 'niuniu'
        ? `只生成该格所需的牛牛单一姿态，全身完整，透明背景。必须直接复制对应风格母版的完整站立高度、纵向轮廓、头脸、五官、躯干、腿长、四肢、固有配色与蹄形；禁止压矮、缩腿、加宽或变矮胖。神态、动作和服装按该格剧情执行。干净利落，无场景、无道具堆叠、无文字。`
        : '只生成该格所需的角色单一姿态，全身完整，透明背景，无场景、无道具堆叠、无文字。',
      props: state.profile === 'niuniu'
        ? '只生成该格最关键的可复用符号化道具单品，透明背景，造型简洁扁平，无角色、无文字、无照片级材质。'
        : '只生成该格最关键的可复用道具单品，透明背景，物体完整分离，造型简洁，无角色、无文字。',
      scenes: state.profile === 'niuniu'
        ? '只生成该格的纯场景或组合环境元素，透明背景，符号化、简洁、留白充足；不出现角色、文字、边框或照片级复杂细节。'
        : '只生成该格的纯场景或组合环境元素，透明背景，不出现角色、文字或边框。',
      backgrounds: state.profile === 'niuniu'
        ? '只生成该格的完整背景板，不透明，大面积留白或浅色块/轻渐变，高级透气；不出现角色、正式文字、边框、气泡或照片级杂物。'
        : '只生成该格的完整背景板，不透明，不出现角色、正式文字、边框或气泡。',
    }
    const referenceImages = [{ name: '已确认构图粗稿', url: composition.url }, ...identityReferences.map((reference, index) => ({ name: `IP 身份强参考 ${index + 1} · ${reference.name}`, url: reference.url }))]
    const identityLock = state.profile === 'niuniu' && task.category === 'cutouts' ? ` ${niuniuIdentityLead(composition.style)}` : ''
    return { id: `request-${task.id}`, kind: 'asset' as const, aspectRatio: task.category === 'backgrounds' ? state.aspectRatio : '1:1', displayPrompt: `${displayContent}\n\n生成 ${task.sectionName} 第 ${task.panelIndex} 格的${COMIC_ASSET_LABELS[task.category]}。`.trim(), referenceImages: state.profile === 'niuniu' && task.category === 'cutouts'
      ? [...identityReferences.map((reference, index) => ({ name: `IP 身份强参考 ${index + 1} · ${reference.name}`, url: reference.url })), { name: '已确认构图粗稿（仅姿态参考）', url: composition.url }]
      : referenceImages, meta: { assetTaskId: task.id, assetName: task.name, category: task.category, compositionId: task.compositionId, sectionId: task.sectionId, sectionName: task.sectionName, panelIndex: task.panelIndex, parentNodeId: composition.canvasNodeId, parentRequestId: composition.requestId }, prompt: `${state.profile === 'niuniu' && task.category === 'cutouts' ? `${niuniuIdentityLead(composition.style)}\n\n` : ''}${content}\n\n【已确认构图后的素材生产】\n参考已确认构图，只生产 ${task.sectionName} 第 ${task.panelIndex} 格的“${COMIC_ASSET_LABELS[task.category]}”。沿用 ${COMIC_STYLE_LABELS[composition.style]}、角色结构、配色、镜头关系和光线。${rule[task.category]}${identityLock} 不生成最终排版，不烤入文案，不增加编号或水印。文件语义名：${task.name}。` }
  })
}
