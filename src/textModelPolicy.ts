/** Catalog-driven defaults: never invent a model ID or enable a disabled connection. */
export type TextModelDescriptor = { id: string; name: string }
export function textModelFamily(model: TextModelDescriptor) {
  const text = `${model.id} ${model.name}`.toLowerCase()
  if (/gpt/.test(text)) return 'gpt'
  if (/claude/.test(text)) return 'claude'
  if (/deepseek/.test(text)) return 'deepseek'
  return 'other'
}
function rank(model: TextModelDescriptor): number[] {
  const text = `${model.id} ${model.name}`.toLowerCase()
  const family = textModelFamily(model)
  const specialized = /image|audio|realtime|transcri|tts|embedding|moderation|search|codex|instruct|base\b/.test(text)
  // Prefer general flagship/standard tiers over premium, small or slow reasoning variants.
  const light = /mini|nano|lite|haiku|luna/.test(text)
  const premium = /\bpro\b|astra|opus|reasoner|\br1\b|thinking/.test(text)
  const version = text.match(/gpt[\s-]*(\d+)(?:[.-](\d+))?/)
    ?? text.match(/claude[\s-]*(?:sonnet|opus|haiku)?[\s-]*(\d+)(?:[.-](\d+))?/)
    ?? text.match(/(?:sonnet|opus|haiku)[\s-]*(\d+)(?:[.-](\d+))?/)
    ?? text.match(/deepseek[\s-]*v?(\d+)(?:[.-](\d+))?/)
  return [specialized ? 0 : 1, light ? 0 : premium ? 1 : 2,
    Number(version?.[1] ?? 0), Number(version?.[2] ?? 0),
    /preview|experimental/.test(text) ? 0 : 1,
    family === 'gpt' && /sol/.test(text) ? 1 : 0,
    family === 'deepseek' && /chat/.test(text) ? 1 : 0]
}
export function rankTextModels<T extends TextModelDescriptor>(models: readonly T[], preferredFamily = 'gpt'): T[] {
  const families = [preferredFamily, ...['gpt', 'claude', 'deepseek', 'other'].filter(family => family !== preferredFamily)]
  return [...models].sort((a, b) => {
    const familyOrder = families.indexOf(textModelFamily(a)) - families.indexOf(textModelFamily(b))
    if (familyOrder) return familyOrder
    const ar = rank(a), br = rank(b)
    for (let i = 0; i < ar.length; i++) if (ar[i] !== br[i]) return br[i] - ar[i]
    return a.id.localeCompare(b.id, undefined, { numeric: true })
  })
}
export function mainstreamTextModelIds<T extends TextModelDescriptor>(models: readonly T[]): Set<string> {
  return new Set(['gpt', 'claude', 'deepseek'].flatMap(family => {
    const best = rankTextModels(models.filter(model => textModelFamily(model) === family && rank(model)[0] === 1), family)[0]
    return best ? [best.id] : []
  }))
}

/** Wait for completion or explicit cancellation; retries require user approval. */
export async function runTextModelRecovery<T>(initial: T, request: (candidate: T, signal: AbortSignal) => Promise<string>, options: {
  signal?: AbortSignal
  chooseNext?: (current: T, error: unknown) => Promise<T | undefined>
  onAttempt?: (candidate: T) => void
} = {}): Promise<string> {
  let current = initial
  while (true) {
    options.signal?.throwIfAborted()
    const controller = new AbortController()
    const forwardAbort = () => controller.abort(options.signal?.reason)
    options.signal?.addEventListener('abort', forwardAbort, { once: true })
    let onAbort: (() => void) | undefined
    let failure: unknown
    try {
      options.onAttempt?.(current)
      controller.signal.throwIfAborted()
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(controller.signal.reason)
        controller.signal.addEventListener('abort', onAbort, { once: true })
      })
      const text = await Promise.race([request(current, controller.signal), aborted])
      if (!text.trim()) throw new Error('模型未返回有效文本')
      return text
    } catch (error) {
      options.signal?.throwIfAborted()
      failure = error
    } finally {
      options.signal?.removeEventListener('abort', forwardAbort)
      if (onAbort) controller.signal.removeEventListener('abort', onAbort)
    }
    options.signal?.throwIfAborted()
    const next = await options.chooseNext?.(current, failure)
    options.signal?.throwIfAborted()
    if (next === undefined) throw failure
    current = next
  }
}
