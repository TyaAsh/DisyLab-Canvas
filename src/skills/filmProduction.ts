import { generateRemoteImages, generateRemoteVideo, getGrsaiVideoCapabilities, hfsyVideoLimits, isHfsyNativeSeedance, publicImageSourceUrl, readImageSourceBlob, resolveProviderLabel, seedanceVideoDefaults, type ApiRequestSettings, type GenerationAdminLog, type ImageGenerationOptions, type VideoGenerationOptions } from '../imageApi'
import { getFilmSkillShowcase } from './manifests/official/film'
import { getFilmGuide } from './guides'
import type { SkillManifest } from './types'

type Resolution = NonNullable<VideoGenerationOptions['resolution']>
export type FilmVideoProfile = {
  ratios: readonly string[]
  minSeconds: number
  maxSeconds: number
  maxImages?: number
  durations?: readonly number[]
  promptLimit?: number
  resolution: Resolution
  resolutions: readonly Resolution[]
  requiresPublicImage: boolean
}
export const isFilmImageModel = (id: string) => /^gpt-image-2(?:$|[-.])/i.test(id.trim())
const toyStyles: Record<string, string> = {
  日式特摄: '微缩模型城市、低角度实拍机位、橡胶套装与实体道具质感、舞台烟尘和明确的特摄打光。',
  潮玩动画: '哑光搪胶或彩色树脂、潮玩设计师玩具的轮廓与色块、展示台灯光、短促利落的弹性动作。',
  毛毡定格: '羊毛毡纤维、可见针脚与手工微缩布景、逐帧定格的轻微姿态跳变和有意的动作停顿。',
}

export function filmVideoProfile(baseUrl: string, modelId: string): FilmVideoProfile | undefined {
  const grs = getGrsaiVideoCapabilities(baseUrl, modelId)
  if (grs) return { ratios: grs.ratios, minSeconds: Math.max(2, grs.minDuration), maxSeconds: grs.maxDuration, maxImages: grs.images, resolution: grs.defaultResolution, resolutions: grs.resolutions, requiresPublicImage: false }
  if (resolveProviderLabel(baseUrl) !== 'HFSY') return undefined
  const id = modelId.trim().toLowerCase()
  if (isHfsyNativeSeedance(id)) {
    const defaults = seedanceVideoDefaults(id)
    if (defaults) return { ratios: defaults.ratios, minSeconds: defaults.minDuration, maxSeconds: defaults.maxDuration, maxImages: 9, resolution: defaults.defaultResolution, resolutions: defaults.resolutions, requiresPublicImage: true }
  }
  const limits = hfsyVideoLimits(id)
  if (!limits || limits.images < 2) return undefined
  const resolution = /480|^sd-2-vip$/.test(id) ? '480p' : /1080/.test(id) ? '1080p' : '720p'
  return { ratios: limits.ratios ?? ['16:9', '9:16'], minSeconds: limits.minSeconds, maxSeconds: limits.maxSeconds, maxImages: limits.images, durations: limits.durations, promptLimit: limits.prompt, resolution, resolutions: [resolution], requiresPublicImage: true }
}

export function selectFilmResolution(profile: FilmVideoProfile, requested: string, modelId: string): FilmVideoProfile {
  const resolution = profile.resolutions.find((item) => item === requested) ?? profile.resolution
  return { ...profile, resolution, maxSeconds: modelId === 'minimax-h3' && resolution === '1080p' ? Math.min(10, profile.maxSeconds) : profile.maxSeconds }
}

export function planFilmShots(totalSeconds: number, profile: FilmVideoProfile, slug?: string) {
  const maxShot = Math.min(profile.maxSeconds, Math.max(profile.minSeconds, slug === 'neo-chinese-tvc' ? 6 : 15))
  const count = slug === 'toy-animation' ? Math.ceil(totalSeconds / maxShot) : Math.max(Math.ceil(totalSeconds / maxShot), Math.min(3, Math.floor(totalSeconds / profile.minSeconds)))
  const base = Math.floor(totalSeconds / count)
  return Array.from({ length: count }, (_, i) => {
    const duration = base + Number(i < totalSeconds % count)
    return { duration, requestSeconds: filmRequestSeconds(profile, duration) }
  })
}

function filmRequestSeconds(profile: FilmVideoProfile, duration: number) {
  return profile.durations?.find((seconds) => seconds >= duration && seconds <= profile.maxSeconds) ?? Math.max(profile.minSeconds, duration)
}

export function filmResolutionHeight(resolution: Resolution) {
  return resolution === '4k' ? 2160 : resolution === '2k' ? 1440 : Number.parseInt(resolution, 10)
}

export function filmVideoSize(ratio: string, height: number) {
  const [widthUnits, heightUnits] = ratio.split(':').map(Number)
  const shortSide = Math.round(height / 2) * 2
  const longSide = Math.round(shortSide * Math.max(widthUnits, heightUnits) / Math.min(widthUnits, heightUnits) / 2) * 2
  return widthUnits >= heightUnits ? { width: longSide, height: shortSide } : { width: shortSide, height: longSide }
}

export type FilmClip = { blob: Blob; duration: number }
export type FilmReview = { title: string; summary: string; assets?: { label: string; blob: Blob; kind: 'image' | 'video' }[]; paidRevision?: boolean; chooseAsset?: boolean }
export type FilmReviewAnswer = { action: 'continue' | 'revise'; notes: string; selected?: number }
export type FilmImageTask = { index: number; stage: 'anchor' | 'storyboard' | 'keyframe'; title: string; prompt: string; aspectRatio: string }
export type FilmMediaKey = { kind: 'image' | 'video'; index: number; attempt?: number; prompt: string; model: string }
export type RestoredFilmMedia = { mediaId: string; blob: Blob; fileName: string; url?: string }
export type FilmCheckpoint = {
  media: Array<FilmMediaKey & { mediaId: string; sourceUrl?: string }>
  reviews: Array<{ title: string; answer: FilmReviewAnswer }>
  videoTasks?: Array<FilmMediaKey & { taskId: string }>
  recoveredClips?: Array<{ index: number; attempt: number; mediaId: string; sourceUrl?: string }>
  mapStoryboardPanels?: boolean
}
type ProductionOptions = {
  skill: SkillManifest
  subject: string
  ratio: string
  duration: number
  values: Record<string, string | number | boolean>
  image: ApiRequestSettings
  imageResolution?: ImageGenerationOptions['resolution']
  imageReferenceLimit?: number
  mapStoryboardPanels?: boolean
  video: ApiRequestSettings
  profile: FilmVideoProfile
  references: string[]
  signal: AbortSignal
  onProgress: (label: string, progress: number) => void
  onImageStart: (task: FilmImageTask, restored?: RestoredFilmMedia) => Promise<void>
  onImageProgress?: (index: number, percent: number | undefined, status: string) => void
  onVideoStart: (firstFrameIndices: number[]) => Promise<void>
  onVideoProgress?: (percent: number, status: string) => void
  onVideoTask?: (media: FilmMediaKey, taskId: string) => Promise<void>
  onLog: (log: GenerationAdminLog, prompt: string) => void
  onMedia: (media: FilmMediaKey & { blob: Blob; sourceUrl?: string }) => Promise<void>
  restoreMedia?: (media: FilmMediaKey, title?: string) => Promise<RestoredFilmMedia | undefined>
  review: (stage: FilmReview, nextImageIndex: number) => Promise<FilmReviewAnswer>
}

function filmAnchorCount(anchor: NonNullable<ReturnType<typeof getFilmGuide>>['anchors'][number], values: ProductionOptions['values']) {
  return anchor.separateCharacters && values.character === '多角色' ? Number(values.characterCount ?? 2) : anchor.count ?? 1
}

function filmSegmentDurations(skill: SkillManifest, duration: number, values: ProductionOptions['values']) {
  const transition = skill.slug === 'cartoon-ad' && values.multiscene ? 1 : 0
  const brandEnd = skill.slug === 'cartoon-ad' && Boolean(values.logo) && values.logoInLastFrame !== true ? 4 : 0
  return { transition, brandEnd, main: duration - transition * 3 - brandEnd }
}

export function filmRequestCounts(skill: SkillManifest, duration: number, profile: FilmVideoProfile, values: ProductionOptions['values']) {
  const anchors = getFilmGuide(skill)?.anchors.filter((anchor) => !anchor.optionalField || values[anchor.optionalField]).reduce((sum, anchor) => sum + filmAnchorCount(anchor, values), 0) ?? 0
  const { transition, brandEnd, main } = filmSegmentDurations(skill, duration, values)
  const videos = planFilmShots(main, profile, skill.slug).length + transition + Number(Boolean(brandEnd))
  return { images: anchors + videos + (skill.slug === 'cartoon-ad' ? Math.ceil(duration / 15) : 0), videos }
}

export function filmStoryboardPanels(start: number, length: number, duration: number) {
  const end = start + length
  return Array.from({ length: Math.ceil(duration / 15) }, (_, board) => {
    const offset = board * 15
    const seconds = Math.min(15, duration - offset)
    const from = Math.max(start, offset)
    const to = Math.min(end, offset + seconds)
    return to > from ? { board, first: board * 9 + Math.floor((from - offset) * 9 / seconds) + 1, last: board * 9 + Math.ceil((to - offset) * 9 / seconds) } : undefined
  }).filter((range) => range !== undefined)
}

export async function generateFilmClips({ skill, subject, ratio, duration, values, image, imageResolution = '1K', imageReferenceLimit = 8, mapStoryboardPanels, video, profile, references, signal, onProgress, onImageStart, onImageProgress, onVideoStart, onVideoProgress, onVideoTask, onLog, onMedia, restoreMedia, review }: ProductionOptions) {
  const film = getFilmSkillShowcase(skill)
  const guide = getFilmGuide(skill)
  if (!film || !guide) throw new Error('这个 Skill 没有视频制作流程。')
  if (!Number.isInteger(duration) || duration < film.duration.min || duration > film.duration.max || !profile.ratios.includes(ratio)) {
    throw new Error('请选择视频模型支持的画幅和有效的成片时长。')
  }
  const isToy = film.slug === 'toy-animation'
  if (isToy && !references.length) throw new Error('请先上传手办原图或三视图。')
  const isCartoon = film.slug === 'cartoon-ad'
  const { transition, brandEnd, main } = filmSegmentDurations(skill, duration, values)
  const baseShots = planFilmShots(main, profile, film.slug)
  const shots: Array<{ duration: number; requestSeconds: number; beat: string; brandEnd?: true }> = baseShots.map((shot, index) => ({
    ...shot,
    beat: isToy && baseShots.length < film.sceneBeats.length
      ? film.sceneBeats.filter((_, beat) => beat % baseShots.length === index).join(' ')
      : film.sceneBeats[Math.round(index * (film.sceneBeats.length - 1) / Math.max(1, baseShots.length - 1))],
  }))
  if (transition) shots.splice(Math.ceil(shots.length / 2), 0, {
    duration: 3,
    requestSeconds: filmRequestSeconds(profile, 3),
    beat: '由前一个场景自然过渡到下一个场景。使用光影接力、遮挡或匹配动作，不增加剧情。',
  })
  if (brandEnd) shots.push({ duration: brandEnd, requestSeconds: filmRequestSeconds(profile, brandEnd), beat: `品牌落版：${values.logo} 字标以光影扫过的方式登场，文字准确，画面稳定。`, brandEnd: true })
  const options = (film.options ?? []).filter(({ name }) => name !== 'lyrics').map((field) => field.label + '：' + (values[field.name] ?? field.default ?? '')).join('。')
  const selectedToyStyle = isToy ? toyStyles[String(values.toyStyle ?? '毛毡定格')] : undefined
  const style = [film.visualStyle, selectedToyStyle].filter(Boolean).join(' ')
  const cleanSubject = subject.split(/[。；\n]/).filter((line) => !/背景音乐|BGM|配乐|广告歌/i.test(line)).join('。').trim()
  let brief = '原创短片「' + skill.name + '」\n简报：' + cleanSubject.slice(0, 1600) + '\n' + options + '\n风格：' + style + '\n统一角色、产品、环境和光源。画幅 ' + ratio + '。'
  let shotStart = 0
  const panelRanges = shots.map((shot) => {
    const ranges = mapStoryboardPanels && isCartoon ? filmStoryboardPanels(shotStart, shot.duration, duration) : []
    shotStart += shot.duration
    return ranges
  })
  const panelLabel = (index: number) => panelRanges[index].map(({ first, last }) => first === last ? `第 ${first} 格` : `第 ${first}–${last} 格`).join('、')
  const storyboard = shots.map((shot, index) => (index + 1) + '. ' + shot.duration + ' 秒｜' + shot.beat + (panelLabel(index) ? `｜九宫格${panelLabel(index)}` : '')).join('\n')
  let assetIndex = 0
  const reviewStage = (stage: FilmReview) => review(stage, assetIndex)
  const editText = async (title: string, summary: string) => {
    let notes = ''
    for (;;) {
      signal.throwIfAborted()
      const answer = await reviewStage({ title, summary: notes ? summary + '\n\n修订：' + notes : summary })
      if (answer.action === 'continue') {
        if (notes) brief += '\n' + title + '确认：' + notes
        return
      }
      notes = [notes, answer.notes].filter(Boolean).join('\n').slice(-1400)
    }
  }
  const makeImage = async (stage: FilmImageTask['stage'], title: string, prompt: string, aspectRatio: string, inputs: string[]) => {
    signal.throwIfAborted()
    const index = assetIndex++
    const media = { kind: 'image', index, prompt, model: image.model } as const
    const restored = await restoreMedia?.(media, title)
    await onImageStart({ index, stage, title, prompt, aspectRatio }, restored)
    signal.throwIfAborted()
    if (restored?.url) return { index, url: restored.url, label: title, blob: restored.blob, kind: 'image' as const }
    const [result] = await generateRemoteImages(image, { prompt, aspectRatio, resolution: imageResolution, count: 1, referenceImages: [...new Set(inputs)].slice(0, imageReferenceLimit), signal, onProgress: (percent, status) => onImageProgress?.(index, percent, status), captureAdminLog: (log) => onLog(log, prompt) })
    if (!result?.url) throw new Error(title + '返回为空。')
    onImageProgress?.(index, undefined, 'completed')
    const blob = await readImageSourceBlob(result.url, signal, title)
    await onMedia({ ...media, blob, sourceUrl: publicImageSourceUrl(result.url) })
    return { index, url: result.url, label: title, blob, kind: 'image' as const }
  }
  type Frame = Awaited<ReturnType<typeof makeImage>>
  const reviewedImages = async (title: string, summary: string, make: (notes: string) => Promise<Frame[]>, chooseAsset = false) => {
    let notes = ''
    for (;;) {
      const assets = await make(notes)
      const answer = await reviewStage({ title, summary, assets, paidRevision: true, chooseAsset })
      if (answer.action === 'continue') {
        if (notes) brief += '\n' + title + '确认：' + notes
        return chooseAsset ? [assets[answer.selected ?? 0] ?? assets[0]] : assets
      }
      notes = [notes, answer.notes].filter(Boolean).join('\n').slice(-1400)
    }
  }
  let anchors: Frame[] = []
  let roleAnchors: Frame[] = []
  const anchorSpecs = guide.anchors.filter((anchor) => !anchor.optionalField || values[anchor.optionalField])
  const makeAnchor = async (spec: (typeof anchorSpecs)[number], notes: string) => {
    onProgress('生成' + spec.title, 4)
    const candidates: Frame[] = []
    const count = filmAnchorCount(spec, values)
    for (let index = 0; index < count; index++) {
      const title = spec.title + (count > 1 ? ' ' + (index + 1) : '')
      const input = [...anchors.map(({ url }) => url), ...references, ...candidates.map(({ url }) => url)]
      const direction = spec.separateCharacters ? `只画简报中的第 ${index + 1} 位角色。与其他角色的外形明显区分，渲染风格保持一致。` : `候选 ${index + 1}。`
      const anchorRatio = spec.aspectRatio ?? (spec.title.includes('道具') || spec.title.includes('材质') ? '1:1' : '16:9')
      candidates.push(await makeImage('anchor', title, `${brief}\n${spec.prompt}\n${direction}\n${notes}`, anchorRatio, input))
    }
    return candidates
  }
  if (isToy) {
    anchors = await reviewedImages('三视图与场景图', '核对外貌、配件和所选动画风格。通过后进入分组生成。', async (notes) => {
      anchors = []
      for (const spec of anchorSpecs) anchors.push(...await makeAnchor(spec, notes))
      return anchors
    })
  } else {
    for (const spec of anchorSpecs) {
      const approved = await reviewedImages(spec.title, spec.prompt, (notes) => makeAnchor(spec, notes), !spec.separateCharacters && (spec.count ?? 1) > 1)
      anchors.push(...approved)
      if (spec.separateCharacters) roleAnchors = approved
    }
  }

  const anchorUrls = anchors.map(({ url }) => url)
  const boards: Frame[] = []
  if (isCartoon) {
    await editText('时长确认', duration + ' 秒 · ' + ratio + '\n' + storyboard)
    await editText('风格锁定与叙事', `${style}\n\n${subject}\n\n${storyboard}`)
    const boardCount = Math.ceil(duration / 15)
    for (let index = 0; index < boardCount; index++) {
      const title = '分镜草图 ' + (index + 1) + '/' + boardCount
      onProgress('生成' + title, 10)
      const render = (notes: string) => makeImage('storyboard', title, `${brief}\n绘制第 ${index + 1} 段九宫格分镜。只用黑白铅笔线条，不上色、不填灰。镜号从 ${index * 9 + 1} 连续标注，每格标运镜。锁定角色造型、身体特征与道具展示面。按该段时间码画动作、场景和已定台词，大特写与近景交替，避免连续同景别，适当用荷兰角。${index ? '与第一张分镜参考图的绘画风格和线条质感完全一致。' : ''}${index + 1 < boardCount ? '末格停在动作中，不得收尾。' : brandEnd ? '末格完成主剧情，独立品牌落版另出。' : '末格按已确认方案做品牌定格。'}\n${storyboard}\n${notes}`, '16:9', [...roleAnchors.map(({ url }) => url), ...boards.slice(0, 1).map(({ url }) => url), ...anchorUrls])
      if (index === 0) boards.push(...await reviewedImages(title, '先确认首张线稿风格，后续草图将沿用它。', async (notes) => [await render(notes)]))
      else boards.push(await render(''))
    }
  } else if (!isToy) {
    if (film.slug === 'neo-chinese-tvc') await editText('结构与旁白', options + '\n' + subject)
    await editText('分镜表', storyboard)
  }

  const boardsForShot = (index: number) => panelRanges[index].length
    ? panelRanges[index].map(({ board }) => boards[board].url)
    : boards.length ? [boards[Math.min(boards.length - 1, Math.floor(index * boards.length / shots.length))].url] : []
  const roleUrls = roleAnchors.map(({ url }) => url)

  const frames = await (async () => {
    const make = async (notes: string) => {
      const assets: Frame[] = []
      for (const [index, shot] of shots.entries()) {
        onProgress('生成关键帧 ' + (index + 1) + '/' + shots.length, 15 + index * 20 / shots.length)
        const shotBoards = boardsForShot(index)
        const title = shot.brandEnd ? '品牌落版图' : `镜头 ${index + 1} 首帧`
        const direction = shot.brandEnd ? '单独画一张品牌落版图，确认字标拼写、留白和安全区。' : '单画面，无分屏和字幕。参考图用于造型锁定，九宫格只作为分镜指导。'
        const panel = panelLabel(index) ? `\n只把九宫格${panelLabel(index)}的第一格作为这一段首帧构图，按该格的机位、景别和场景出图。` : ''
        assets.push(await makeImage('keyframe', title, `${brief}\n镜头 ${index + 1}：${shot.beat}\n${direction}${panel}\n${notes}`, ratio, [...roleUrls, ...shotBoards, ...anchorUrls, ...references]))
      }
      return assets
    }
    return reviewedImages('分镜关键帧', '确认每个镜头的首帧后，再生成视频。\n' + storyboard, make)
  })()

  signal.throwIfAborted()
  await onVideoStart(frames.map(({ index }) => index))

  const videoAttempts = new Map<number, number>()
  const shotProgress = new Array<number>(shots.length).fill(0)
  const renderVideo = async (shot: (typeof shots)[number], index: number, notes: string) => {
    signal.throwIfAborted()
    const label = (index + 1) + '/' + shots.length
    const shotBoards = boardsForShot(index)
    const referencesForShot = [...new Set([frames[index].url, ...roleUrls, ...shotBoards, ...anchorUrls])].slice(0, profile.maxImages ?? 8)
    const urls = referencesForShot.map((url) => publicImageSourceUrl(url) ?? url)
    const direction = isCartoon ? `保持角色造型与身体特征，每位角色只出现一次。道具保持指定展示面。${shotBoards.length ? (panelLabel(index) ? `只按九宫格${panelLabel(index)}内的镜号顺序推进动作和运镜，分镜图只指导拍摄。` : '沿九宫格的镜号剪辑，分镜图只指导拍摄。') : ''}使用电影感的 C4D 与 Octane 渲染。` : ''
    const shotPrompt = `镜头 ${label}：${shot.beat}\n第 1 张参考图是首帧，其余参考图用于锁定角色、场景与分镜。${direction}${isToy && values.withScene ? '场景图按该镜头对应子场景引用。' : ''}在 ${shot.requestSeconds} 秒内完成动作。画面无字幕和水印。\n【音效】保留动作声、环境声与已约定台词。\n${notes}`
    const prompt = Array.from(`${shotPrompt}\n${brief}`.split('\n').filter((line) => !/背景音乐|\bBGM\b|配乐|广告歌/i.test(line)).join('\n')).slice(0, profile.promptLimit).join('')
    const attempt = videoAttempts.get(index) ?? 0
    videoAttempts.set(index, attempt + 1)
    const media = { kind: 'video', index, attempt, prompt, model: video.model } as const
    const restored = await restoreMedia?.(media)
    if (restored) {
      shotProgress[index] = 100
      return { blob: restored.blob, duration: shot.duration }
    }
    signal.throwIfAborted()
    if (profile.requiresPublicImage && urls.some((url) => !publicImageSourceUrl(url))) throw new Error('当前视频连接需要 HTTPS 参考图。已生成的关键帧保留在画布。')
    const resolution = shot.brandEnd && profile.resolutions.includes('480p') ? '480p' : profile.resolution
    const { width, height } = filmVideoSize(ratio, filmResolutionHeight(resolution))
    onProgress('生成视频镜头 ' + label, 38 + index * 44 / shots.length)
    const clip = await generateRemoteVideo(video, {
      prompt, seconds: shot.requestSeconds, size: width + 'x' + height, resolution, aspectRatio: ratio,
      mode: 'image_reference', referenceImages: urls, generateAudio: true, signal,
      onTaskId: (taskId) => onVideoTask?.(media, taskId),
      onProgress: (percent, status) => {
        shotProgress[index] = Math.max(0, Math.min(100, percent))
        const overall = shotProgress.reduce((sum, value) => sum + value, 0) / shots.length
        onVideoProgress?.(overall, status === 'downloading' ? `正在下载镜头 ${label}` : `生成视频镜头 ${label}`)
        onProgress('生成视频镜头 ' + label, 38 + overall * .44)
      },
      captureAdminLog: (log) => onLog(log, prompt),
    })
    await onMedia({ ...media, blob: clip.blob, sourceUrl: clip.sourceUrl })
    shotProgress[index] = 100
    return { blob: clip.blob, duration: shot.duration }
  }
  const clips: FilmClip[] = []
  if (isToy) {
    for (let index = 0; index < shots.length; index += 2) {
      clips.push(...await Promise.all(shots.slice(index, index + 2).map((shot, offset) => renderVideo(shot, index + offset, ''))))
    }
  } else {
    for (const [index, shot] of shots.entries()) clips.push(await renderVideo(shot, index, ''))
  }
  for (;;) {
    const answer = await reviewStage({
      title: '检查视频镜头',
      summary: '核对角色、动作、道具、画面衔接和原声。通过后按顺序进入合成。修改时先选中需要重做的镜头。',
      assets: clips.map((clip, index) => ({ ...clip, kind: 'video', label: '镜头 ' + (index + 1) })),
      paidRevision: true, chooseAsset: true,
    })
    if (answer.action === 'continue') return clips
    const index = answer.selected ?? 0
    clips[index] = await renderVideo(shots[index], index, answer.notes)
  }
}
