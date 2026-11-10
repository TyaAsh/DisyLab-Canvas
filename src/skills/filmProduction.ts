import { generateRemoteImages, generateRemoteVideo, getGrsaiVideoCapabilities, hfsyVideoLimits, publicImageSourceUrl, readImageSourceBlob, resolveProviderLabel, type ApiRequestSettings, type GenerationAdminLog, type VideoGenerationOptions } from '../imageApi'
import { getFilmSkillShowcase } from './manifests/official/film'
import { getFilmGuide } from './guides'
import type { SkillManifest } from './types'

type Resolution = NonNullable<VideoGenerationOptions['resolution']>
export type FilmVideoProfile = {
  ratios: readonly string[]
  minSeconds: number
  maxSeconds: number
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
  if (!/^(?:minimax-h3|wan-3\.0(?:-(?:480|720|1080))?)$/i.test(modelId)) return undefined
  const grs = getGrsaiVideoCapabilities(baseUrl, modelId)
  if (grs) return { ratios: grs.ratios, minSeconds: Math.max(2, grs.minDuration), maxSeconds: grs.maxDuration, resolution: grs.defaultResolution, resolutions: grs.resolutions, requiresPublicImage: false }
  const hfsy = resolveProviderLabel(baseUrl) === 'HFSY' ? hfsyVideoLimits(modelId) : undefined
  if (!hfsy) return undefined
  const resolution = modelId.endsWith('-480') ? '480p' : modelId.endsWith('-1080') ? '1080p' : '720p'
  return { ratios: hfsy.ratios ?? ['16:9', '9:16'], minSeconds: hfsy.minSeconds, maxSeconds: hfsy.maxSeconds, resolution, resolutions: [resolution], requiresPublicImage: true }
}

export function selectFilmResolution(profile: FilmVideoProfile, requested: string, modelId: string): FilmVideoProfile {
  const resolution = profile.resolutions.find((item) => item === requested) ?? profile.resolution
  return { ...profile, resolution, maxSeconds: modelId === 'minimax-h3' && resolution === '1080p' ? Math.min(10, profile.maxSeconds) : profile.maxSeconds }
}

export function planFilmShots(totalSeconds: number, profile: FilmVideoProfile, slug?: string) {
  const maxShot = Math.min(profile.maxSeconds, slug === 'neo-chinese-tvc' ? 6 : 15)
  const count = slug === 'toy-animation' ? Math.ceil(totalSeconds / maxShot) : Math.max(Math.ceil(totalSeconds / maxShot), Math.min(3, Math.floor(totalSeconds / profile.minSeconds)))
  const base = Math.floor(totalSeconds / count)
  return Array.from({ length: count }, (_, i) => {
    const duration = base + Number(i < totalSeconds % count)
    return { duration, requestSeconds: Math.max(profile.minSeconds, duration) }
  })
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
type ProductionOptions = {
  skill: SkillManifest
  subject: string
  ratio: string
  duration: number
  values: Record<string, string | number | boolean>
  image: ApiRequestSettings
  video: ApiRequestSettings
  profile: FilmVideoProfile
  references: string[]
  signal: AbortSignal
  onProgress: (label: string, progress: number) => void
  onLog: (log: GenerationAdminLog, prompt: string) => void
  onMedia: (media: { blob: Blob; kind: 'image' | 'video'; prompt: string; index: number; model: string; sourceUrl?: string }) => Promise<void>
  review: (stage: FilmReview) => Promise<FilmReviewAnswer>
}

export function filmRequestCounts(skill: SkillManifest, duration: number, profile: FilmVideoProfile, values: ProductionOptions['values']) {
  const anchors = getFilmGuide(skill)?.anchors.filter((anchor) => !anchor.optionalField || values[anchor.optionalField]).reduce((sum, anchor) => sum + (anchor.count ?? 1), 0) ?? 0
  const transition = skill.slug === 'cartoon-ad' && values.multiscene ? 1 : 0
  const videos = planFilmShots(duration - transition * 3, profile, skill.slug).length + transition
  return { images: anchors + videos + (skill.slug === 'cartoon-ad' ? Math.ceil(duration / 15) : 0), videos }
}

export async function generateFilmClips({ skill, subject, ratio, duration, values, image, video, profile, references, signal, onProgress, onLog, onMedia, review }: ProductionOptions) {
  const film = getFilmSkillShowcase(skill)
  const guide = getFilmGuide(skill)
  if (!film || !guide) throw new Error('这个 Skill 没有视频制作流程。')
  if (!Number.isInteger(duration) || duration < film.duration.min || duration > film.duration.max || !profile.ratios.includes(ratio)) {
    throw new Error('请选择视频模型支持的画幅和有效的成片时长。')
  }
  const isToy = film.slug === 'toy-animation'
  if (isToy && !references.length) throw new Error('请先上传手办原图或三视图。')
  const useTransition = film.slug === 'cartoon-ad' && values.multiscene === true
  const baseShots = planFilmShots(duration - (useTransition ? 3 : 0), profile, film.slug)
  const shots = baseShots.map((shot, index) => ({
    ...shot,
    beat: isToy && baseShots.length < film.sceneBeats.length
      ? film.sceneBeats.filter((_, beat) => beat % baseShots.length === index).join(' ')
      : film.sceneBeats[Math.round(index * (film.sceneBeats.length - 1) / Math.max(1, baseShots.length - 1))],
  }))
  if (useTransition) shots.splice(Math.ceil(shots.length / 2), 0, {
    duration: 3,
    requestSeconds: Math.max(3, profile.minSeconds),
    beat: '由前一个场景自然过渡到下一个场景。使用光影接力、遮挡或匹配动作，不增加剧情。',
  })
  const { width, height } = filmVideoSize(ratio, Number.parseInt(profile.resolution, 10))
  const options = (film.options ?? []).filter(({ name }) => name !== 'lyrics').map((field) => field.label + '：' + (values[field.name] ?? field.default ?? '')).join('。')
  const selectedToyStyle = isToy ? toyStyles[String(values.toyStyle ?? '毛毡定格')] : undefined
  const style = [film.visualStyle, selectedToyStyle].filter(Boolean).join(' ')
  const cleanSubject = subject.split(/[。；\n]/).filter((line) => !/背景音乐|BGM|配乐|广告歌/i.test(line)).join('。').trim()
  let brief = '原创短片「' + skill.name + '」\n简报：' + (cleanSubject || subject).slice(0, 1600) + '\n' + options + '\n风格：' + style + '\n统一角色、产品、环境和光源。画幅 ' + ratio + '。'
  const storyboard = shots.map((shot, index) => (index + 1) + '. ' + shot.duration + ' 秒｜' + shot.beat).join('\n')
  const editText = async (title: string, summary: string) => {
    let notes = ''
    for (;;) {
      signal.throwIfAborted()
      const answer = await review({ title, summary: notes ? summary + '\n\n修订：' + notes : summary })
      if (answer.action === 'continue') {
        if (notes) brief += '\n' + title + '确认：' + notes
        return
      }
      notes = [notes, answer.notes].filter(Boolean).join('\n').slice(-1400)
    }
  }
  let assetIndex = 0
  const makeImage = async (title: string, prompt: string, aspectRatio: string, inputs: string[]) => {
    signal.throwIfAborted()
    const [result] = await generateRemoteImages(image, { prompt, aspectRatio, resolution: '1K', count: 1, referenceImages: [...new Set(inputs)].slice(0, 8), signal, captureAdminLog: (log) => onLog(log, prompt) })
    if (!result?.url) throw new Error(title + '返回为空。')
    const blob = await readImageSourceBlob(result.url, signal, title)
    await onMedia({ blob, kind: 'image', index: assetIndex++, prompt, model: image.model, sourceUrl: publicImageSourceUrl(result.url) })
    return { url: result.url, label: title, blob, kind: 'image' as const }
  }
  type Frame = Awaited<ReturnType<typeof makeImage>>
  const reviewedImages = async (title: string, summary: string, make: (notes: string) => Promise<Frame[]>, chooseAsset = false) => {
    let notes = ''
    for (;;) {
      const assets = await make(notes)
      const answer = await review({ title, summary, assets, paidRevision: true, chooseAsset })
      if (answer.action === 'continue') {
        if (notes) brief += '\n' + title + '确认：' + notes
        return chooseAsset ? [assets[answer.selected ?? 0] ?? assets[0]] : assets
      }
      notes = [notes, answer.notes].filter(Boolean).join('\n').slice(-1400)
    }
  }
  let anchors: Frame[] = []
  const anchorSpecs = guide.anchors.filter((anchor) => !anchor.optionalField || values[anchor.optionalField])
  const makeAnchor = async (spec: (typeof anchorSpecs)[number], notes: string) => {
    onProgress('生成' + spec.title, 4)
    const candidates: Frame[] = []
    for (let index = 0; index < (spec.count ?? 1); index++) {
      const title = spec.title + ((spec.count ?? 1) > 1 ? ' ' + (index + 1) : '')
      const input = [...anchors.map(({ url }) => url), ...references]
      candidates.push(await makeImage(title, brief + '\n' + spec.prompt + '\n候选 ' + (index + 1) + '。\n' + notes, spec.title.includes('道具') || spec.title.includes('材质') ? '1:1' : '16:9', input))
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
    for (const spec of anchorSpecs) anchors.push(...await reviewedImages(spec.title, spec.prompt, (notes) => makeAnchor(spec, notes), Boolean(spec.count && spec.count > 1)))
  }

  const anchorUrls = anchors.map(({ url }) => url)
  const boards: Frame[] = []
  if (film.slug === 'cartoon-ad') {
    await editText('时长确认', duration + ' 秒 · ' + ratio + '\n' + storyboard)
    await editText('风格锁定与叙事', style + '\n' + storyboard)
    const boardCount = Math.ceil(duration / 15)
    for (let index = 0; index < boardCount; index++) {
      const title = '分镜草图 ' + (index + 1) + '/' + boardCount
      onProgress('生成' + title, 10)
      const render = (notes: string) => makeImage(title, brief + '\n绘制 9 宫格黑白铅笔线稿，镜号从 ' + (index * 9 + 1) + ' 开始。锁定参考角色和道具。按故事顺序表达第 ' + (index + 1) + ' 段动作、景别和运镜。' + (index + 1 < boardCount ? '最后一格动作继续，不做收尾。' : '最后一格允许品牌定格。') + '\n' + storyboard + '\n' + notes, '16:9', [...anchorUrls, ...boards.slice(0, 1).map(({ url }) => url)])
      if (index === 0) boards.push(...await reviewedImages(title, '先确认首张线稿风格，后续草图将沿用它。', async (notes) => [await render(notes)]))
      else boards.push(await render(''))
    }
  } else if (!isToy) {
    if (film.slug === 'neo-chinese-tvc') await editText('结构与旁白', options + '\n' + subject)
    await editText('分镜表', storyboard)
  }

  const frames = await (async () => {
    const make = async (notes: string) => {
      const assets: Frame[] = []
      for (const [index, shot] of shots.entries()) {
        onProgress('生成关键帧 ' + (index + 1) + '/' + shots.length, 15 + index * 20 / shots.length)
        const board = boards.length ? [boards[Math.floor(index * boards.length / shots.length)].url] : []
        assets.push(await makeImage('首帧 ' + (index + 1), brief + '\n镜头 ' + (index + 1) + '：' + shot.beat + '\n单画面，无分屏和字幕。参考图用于造型锁定，九宫格只作为分镜指导。' + '\n' + notes, ratio, [...anchorUrls, ...references, ...board]))
      }
      return assets
    }
    return isToy ? make('') : reviewedImages('分镜关键帧', storyboard, make)
  })()

  const renderVideo = async (shot: (typeof shots)[number], index: number, notes: string) => {
    signal.throwIfAborted()
    const label = (index + 1) + '/' + shots.length
    const referencesForShot = [...new Set([frames[index].url, ...anchorUrls])].slice(0, 8)
    const urls = referencesForShot.map((url) => publicImageSourceUrl(url) ?? url)
    if (profile.requiresPublicImage && urls.some((url) => !publicImageSourceUrl(url))) throw new Error('当前视频连接需要 HTTPS 参考图。已生成的关键帧保存在历史中。')
    const prompt = brief + '\n镜头 ' + label + '：' + shot.beat + '\n第 1 张参考图是首帧，随后为锁定造型与场景的锚点。' + (isToy && values.withScene ? ' 场景图按该镜头对应子场景引用。' : '') + ' 在 ' + shot.requestSeconds + ' 秒内完成动作，声音只保留环境声、音效与约定台词，不加背景音乐。画面无字幕和水印。\n' + notes
    onProgress('生成视频镜头 ' + label, 38 + index * 44 / shots.length)
    const clip = await generateRemoteVideo(video, {
      prompt, seconds: shot.requestSeconds, size: width + 'x' + height, resolution: profile.resolution, aspectRatio: ratio,
      mode: 'image_reference', referenceImages: urls, generateAudio: true, signal,
      onProgress: (percent) => onProgress('生成视频镜头 ' + label, 38 + (index + percent / 100) * 44 / shots.length),
      captureAdminLog: (log) => onLog(log, prompt),
    })
    await onMedia({ blob: clip.blob, kind: 'video', index, prompt, model: video.model, sourceUrl: clip.sourceUrl })
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
    const answer = await review({
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
