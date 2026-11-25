import type { MediaLimits } from './referenceMediaValidation'

export type VideoReferenceImageFit = { preferredRatio?: string; forceRatio?: boolean; alignFrames?: boolean; mode?: 'center' | 'preserve' }
export type ReferenceImageFitPlan = {
  sourceWidth: number; sourceHeight: number
  sx: number; sy: number; sw: number; sh: number
  dx: number; dy: number; dw: number; dh: number
  width: number; height: number; scale: number
  cropped: boolean; padded: boolean; changed: boolean
  mode: 'center' | 'preserve'
}
export type VideoReferenceInputSnapshot = {
  mediaId: string; sha256: string; index: number; fileName: string
  originalMediaId: string; originalSha256: string
  plan: ReferenceImageFitPlan; targetRatio?: string; fitVersion: 2
  stage?: 'uploaded-reference' | 'adapter-input'
}

const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a
function ratioParts(value?: string) {
  const [width, height] = (value ?? '').split(':').map(Number)
  if (!(width > 0 && height > 0 && Number.isFinite(width + height))) return
  const w = Math.round(width * 10_000), h = Math.round(height * 10_000)
  if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || !w || !h) return
  const divisor = gcd(w, h)
  return { width: w / divisor, height: h / divisor, ratio: width / height }
}

/** User intent, not a preservation checkbox. Last explicit instruction wins. */
export function videoReferenceFitMode(prompt: string): 'center' | 'preserve' {
  const expressions: Array<[RegExp, 'center' | 'preserve']> = [
    [/(?:保留|保持|保全).{0,6}(?:整张|全部|所有|完整).{0,6}(?:内容|画面|构图|原图|参考图|图片|图像|场景|细节)|(?:整张|完整|全部|所有).{0,8}(?:内容|画面|构图|细节|原图|参考图).{0,8}(?:保留|保全|不丢|不要丢)|(?:完整保留|完整保持)(?:原图|参考图|图片|画面|内容|场景|构图)|(?:不要|不用|无需|不需要|不允许|不能|禁止|不可|别|避免|不)[^，。；;\n]{0,12}(?:裁剪|裁切|裁掉|切掉)|(?:无损|无)裁剪/gi, 'preserve'],
    [/(?:允许|可以|可|接受|优先|需要|直接|请)(?:进行|适当|居中|自动|做)?\s*(?:裁剪|裁切)|(?:不需要|无需|不用|不必)(?:保留|保持)(?:完整|全部|整张)(?:内容|画面|构图|原图|图片)?/gi, 'center'],
    [/\b(?:do not|don't|never|no)\s+crop\b|\b(?:preserve|keep)\s+(?:the\s+)?(?:entire|whole|full)\s+(?:image|frame|composition|content)\b/gi, 'preserve'],
  ]
  let latest = -1, mode: 'center' | 'preserve' = 'center'
  for (const [expression, value] of expressions) for (const match of prompt.matchAll(expression)) {
    if (value === 'preserve' && /(?:不需要|无需|不用|不必|不要|不能|不可|do not|don't|no need to)(?:再|继续)?\s*$/i.test(prompt.slice(Math.max(0, match.index - 16), match.index))) continue
    if (value === 'center' && /不|别|勿/.test(prompt.slice(Math.max(0, match.index - 2), match.index))) continue
    if (match.index >= latest) { latest = match.index; mode = value }
  }
  return mode
}

export function videoReferenceImagePolicy(targetRatio: string | undefined, prompt: string, originalIntent?: string): VideoReferenceImageFit {
  return { preferredRatio: targetRatio, forceRatio: Boolean(ratioParts(targetRatio)), alignFrames: true,
    mode: videoReferenceFitMode(originalIntent ?? prompt) }
}

export function videoReferenceCropRatio(source: number, limits: MediaLimits, fit: VideoReferenceImageFit) {
  const preferred = ratioParts(fit.preferredRatio)?.ratio
  const min = limits.ratio?.[0] ?? 0, max = limits.ratio?.[1] ?? Infinity
  return Math.max(min, Math.min(max, (fit.forceRatio || source < min || source > max) && preferred ? preferred : source))
}

/** Center native-size content in an exact-ratio canvas. Crop excess, pad gaps.
 * Only model size limits can downscale the whole composition uniformly. */
export function planVideoReferenceImageFit(width: number, height: number, limits: MediaLimits, fit: VideoReferenceImageFit = {}): ReferenceImageFitPlan {
  if (!(width > 0 && height > 0 && Number.isInteger(width) && Number.isInteger(height))) throw new Error('参考图片尺寸无效')
  const requested = ratioParts(fit.preferredRatio)
  if (fit.forceRatio && requested && limits.ratio && (requested.ratio < limits.ratio[0] || requested.ratio > limits.ratio[1])) throw new Error(`目标画幅 ${fit.preferredRatio} 超出当前模型的参考图比例限制，请调整画幅或模型`)
  const ratio = videoReferenceCropRatio(width / height, limits, fit)
  let fraction = requested && Math.abs(requested.ratio - ratio) < 1e-10 ? requested
    : Math.abs(width / height - ratio) < 1e-10 ? ratioParts(`${width}:${height}`)!
      : ratioParts(`${ratio}:1`)!
  const minSide = Math.max(1, limits.minSide ?? 1, limits.side?.[0] ?? 1)
  const maxSide = Math.min(8192, limits.side?.[1] ?? 8192)
  if (!fit.forceRatio && Math.max(fraction.width, fraction.height) > maxSide) {
    // Auto canvas: approximate a very large irreducible source ratio without
    // stretching source pixels. Explicit target ratios never get substituted.
    let best = ratioParts(`${Math.round(ratio * 100)}:100`)!
    for (let denominator = 1; denominator <= 512; denominator++) {
      const numerator = Math.max(1, Math.round(ratio * denominator))
      if (numerator > maxSide || numerator / denominator < (limits.ratio?.[0] ?? 0) || numerator / denominator > (limits.ratio?.[1] ?? Infinity)) continue
      if (Math.abs(numerator / denominator - ratio) < Math.abs(best.ratio - ratio)) best = ratioParts(`${numerator}:${denominator}`)!
    }
    fraction = best
  }
  const p = fraction.width, q = fraction.height, mode = fit.mode ?? 'center'
  const minK = Math.max(1, Math.ceil(minSide / Math.min(p, q)), Math.ceil(Math.sqrt((limits.pixels?.[0] ?? 1) / (p * q))))
  const maxK = Math.floor(Math.min(maxSide / Math.max(p, q), Math.sqrt((limits.pixels?.[1] ?? 32_000_000) / (p * q))))
  if (minK > maxK) throw new Error('当前画幅无法同时满足模型的边长与像素限制，请调整画幅或模型')
  const baseK = Math.max(minK, mode === 'preserve' ? Math.ceil(Math.max(width / p, height / q)) : Math.max(1, Math.round(Math.min(width, height) / Math.min(p, q))))
  const outputK = Math.min(baseK, maxK), scale = outputK / baseK
  const canvasWidth = p * baseK, canvasHeight = q * baseK
  const sw = Math.min(width, canvasWidth), sh = Math.min(height, canvasHeight)
  const padded = canvasWidth > width || canvasHeight > height, cropped = canvasWidth < width || canvasHeight < height
  const plan: ReferenceImageFitPlan = {
    sourceWidth: width, sourceHeight: height, sx: (width - sw) / 2, sy: (height - sh) / 2, sw, sh,
    dx: (canvasWidth - sw) / 2 * scale, dy: (canvasHeight - sh) / 2 * scale, dw: sw * scale, dh: sh * scale,
    width: p * outputK, height: q * outputK, scale, cropped, padded,
    changed: cropped || padded || scale !== 1, mode,
  }
  assertVideoReferenceGeometry(plan, limits, fit)
  return plan
}

export function assertVideoReferenceGeometry(plan: ReferenceImageFitPlan, limits: MediaLimits, fit: VideoReferenceImageFit) {
  if (![plan.sourceWidth, plan.sourceHeight, plan.sw, plan.sh, plan.dw, plan.dh, plan.width, plan.height, plan.scale].every(value => Number.isFinite(value) && value > 0)
    || plan.scale > 1 || ![plan.sx, plan.sy, plan.dx, plan.dy].every(value => Number.isFinite(value) && value >= 0)
    || plan.sx + plan.sw > plan.sourceWidth + 1e-7 || plan.sy + plan.sh > plan.sourceHeight + 1e-7
    || plan.dx + plan.dw > plan.width + 1e-7 || plan.dy + plan.dh > plan.height + 1e-7) throw new Error('参考图处理被中止：画面尺寸或位置无效')
  const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(a), Math.abs(b)) * 1e-9
  if (!close(plan.dw / plan.sw, plan.dh / plan.sh) || !close(plan.dw / plan.sw, plan.scale)) throw new Error('参考图处理被中止：检测到非等比拉伸')
  if (!close(plan.sx, (plan.sourceWidth - plan.sw) / 2) || !close(plan.sy, (plan.sourceHeight - plan.sh) / 2)
    || !close(plan.dx, (plan.width - plan.dw) / 2) || !close(plan.dy, (plan.height - plan.dh) / 2)) throw new Error('参考图处理被中止：画面没有居中')
  const target = fit.forceRatio ? ratioParts(fit.preferredRatio)?.ratio : undefined
  if (target && !close(plan.width / plan.height, target)) throw new Error('参考图处理被中止：发送画幅与目标不一致')
  if (limits.ratio && (plan.width / plan.height < limits.ratio[0] || plan.width / plan.height > limits.ratio[1])) throw new Error('参考图处理后仍超出模型的比例限制')
  if (plan.mode === 'preserve' && plan.cropped) throw new Error('参考图处理被中止：完整保留模式不允许裁切')
}

export function originalVideoReferenceImagePlan(width: number, height: number): ReferenceImageFitPlan {
  return { sourceWidth: width, sourceHeight: height, sx: 0, sy: 0, sw: width, sh: height, dx: 0, dy: 0, dw: width, dh: height,
    width, height, scale: 1, cropped: false, padded: false, changed: false, mode: 'center' }
}

export async function fitVideoReferenceImage(blob: Blob, limits: MediaLimits, fit: VideoReferenceImageFit | undefined, signal: AbortSignal) {
  signal.throwIfAborted()
  const image = await createImageBitmap(blob)
  try {
    const plan = fit ? planVideoReferenceImageFit(image.width, image.height, limits, fit) : originalVideoReferenceImagePlan(image.width, image.height)
    if (!plan.changed) return { blob, plan }
    signal.throwIfAborted()
    const canvas = document.createElement('canvas')
    canvas.width = plan.width; canvas.height = plan.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建参考图适配画布')
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'
    if (plan.padded) {
      // Local soft padding, not AI outpainting. Source pixels are drawn sharp
      // on top. The backdrop itself also uses a uniform cover scale.
      context.fillStyle = '#202322'; context.fillRect(0, 0, plan.width, plan.height)
      const bleed = Math.max(12, Math.round(Math.min(plan.width, plan.height) * .035))
      const bw = plan.width + bleed * 2, bh = plan.height + bleed * 2, cover = Math.max(bw / image.width, bh / image.height)
      const sw = bw / cover, sh = bh / cover
      context.save(); context.filter = `blur(${bleed}px)`
      context.drawImage(image, (image.width - sw) / 2, (image.height - sh) / 2, sw, sh, -bleed, -bleed, bw, bh)
      context.restore()
    }
    assertVideoReferenceGeometry(plan, limits, fit ?? {})
    context.drawImage(image, plan.sx, plan.sy, plan.sw, plan.sh, plan.dx, plan.dy, plan.dw, plan.dh)
    const type = limits.types && !limits.types.includes('image/png') || blob.type === 'image/jpeg' ? 'image/jpeg' : 'image/png'
    const result = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('参考图适配失败')), type, .92))
    signal.throwIfAborted()
    const encoded = await createImageBitmap(result)
    try {
      if (encoded.width !== plan.width || encoded.height !== plan.height) throw new Error('参考图处理被中止：编码后的图片尺寸与预览不一致')
    } finally { encoded.close() }
    if (limits.maxMB && result.size > limits.maxMB * 1024 ** 2) throw new Error(`适配后的参考图仍超过 ${limits.maxMB} MB，请压缩图片后再试`)
    return { blob: result, plan }
  } finally { image.close() }
}

export async function mapVideoReferenceInputs<T, R>(entries: readonly T[], use: (entry: T, index: number) => Promise<R>) {
  const output: R[] = []
  for (let start = 0; start < entries.length; start += 3) output.push(...await Promise.all(entries.slice(start, start + 3).map((entry, index) => use(entry, start + index))))
  return output
}

export async function videoReferenceInputDigest(blob: Blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export function videoReferenceOutputWarning(width: number, height: number, targetRatio?: string) {
  const target = ratioParts(targetRatio)
  if (!target || !(width > 0 && height > 0)) return
  if (Math.abs(Math.log(width / height / target.ratio)) > .01) return `厂商返回 ${width} × ${height}，与目标 ${targetRatio} 画幅不一致。发送参考图已留存，可在本次记录中核对。`
}

/** The persisted and uploaded blobs are the exact same prepared bytes. */
export async function saveVideoReferenceInputSnapshot(original: Blob, prepared: Blob, plan: ReferenceImageFitPlan,
  fit: VideoReferenceImageFit, index: number, persist: (record: { id: string; blob: Blob; fileName: string; createdAt: string }) => Promise<unknown>, signal: AbortSignal): Promise<VideoReferenceInputSnapshot> {
  signal.throwIfAborted()
  const sha256 = await videoReferenceInputDigest(prepared)
  const originalSha256 = original === prepared ? sha256 : await videoReferenceInputDigest(original)
  const mediaId = `video-reference-input-${sha256}`
  const originalMediaId = originalSha256 === sha256 ? mediaId : `video-reference-original-${originalSha256}`
  const ext = (blob: Blob) => blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : blob.type === 'image/gif' ? 'gif' : 'png'
  const fileName = `reference-${index + 1}-${sha256.slice(0, 12)}.${ext(prepared)}`
  const createdAt = new Date().toISOString()
  if (originalMediaId !== mediaId) await persist({ id: originalMediaId, blob: original, fileName: `reference-${index + 1}-original.${ext(original)}`, createdAt })
  signal.throwIfAborted()
  await persist({ id: mediaId, blob: prepared, fileName, createdAt })
  signal.throwIfAborted()
  return { mediaId, originalMediaId, sha256, originalSha256, index, fileName, plan, targetRatio: fit.preferredRatio, fitVersion: 2 }
}
