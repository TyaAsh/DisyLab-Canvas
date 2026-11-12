const KEY_PREFIX = 'hfsy-reference-images/'
const EXPIRATION_SECONDS = 4 * 60 * 60
const MAX_BYTES = 20 * 1024 * 1024
const HFSY_HOSTS = new Set(['www.hfsyapi.cn', 'api.hfsyapi.cn', 'apigo.hfsyapi.cn'])
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-DisyLab-HFSY-Base',
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
}

function error(message, status) {
  return Response.json({ error: { message } }, { status, headers: HEADERS })
}

async function readImage(request) {
  const reader = request.body?.getReader()
  if (!reader) return null
  const chunks = []
  let length = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  if (!length) return null
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function matchesImageType(bytes, type) {
  const header = new TextDecoder().decode(bytes.subarray(0, 12))
  if (type === 'image/png') return bytes[0] === 0x89 && header.slice(1, 8) === 'PNG\r\n\x1a\n'
  if (type === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (type === 'image/gif') return header.startsWith('GIF87a') || header.startsWith('GIF89a')
  return header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP'
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS })
  const assets = env.HFSY_REFERENCE_ASSETS
  if (!assets) return error('DisyLab 尚未配置参考图存储', 503)
  const url = new URL(request.url)
  try {
    if (request.method === 'GET' || request.method === 'HEAD') {
      const id = url.searchParams.get('id') ?? ''
      if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/.test(id)) return new Response(null, { status: 404, headers: HEADERS })
      const { value, metadata } = await assets.getWithMetadata(KEY_PREFIX + id, { type: 'arrayBuffer' })
      if (!value || !IMAGE_TYPES.has(metadata?.contentType) || !(metadata.expiresAt > Date.now())) {
        return new Response(null, { status: 404, headers: HEADERS })
      }
      return new Response(request.method === 'HEAD' ? null : value, {
        headers: { ...HEADERS, 'Content-Type': metadata.contentType, 'Content-Length': String(value.byteLength) },
      })
    }
    if (request.method !== 'POST') return error('请求方法不受支持', 405)
    const type = request.headers.get('content-type') ?? ''
    if (!IMAGE_TYPES.has(type)) return error('参考图须为 PNG、JPEG、WebP 或 GIF', 415)
    if (Number(request.headers.get('content-length')) > MAX_BYTES) return error('参考图超过 20 MB', 413)
    const authorization = request.headers.get('authorization') ?? ''
    if (!/^Bearer [^\s]{8,512}$/.test(authorization)) return error('请配置有效的 HFSY API Key', 401)
    let base
    try { base = new URL(request.headers.get('x-disylab-hfsy-base') ?? 'https://www.hfsyapi.cn') } catch { return error('HFSY 接口地址无效', 400) }
    if (base.protocol !== 'https:' || !HFSY_HOSTS.has(base.hostname) || base.username || base.password || base.port) return error('HFSY 接口地址无效', 400)
    const check = await fetch(`${base.origin}/v1/models`, {
      headers: { Authorization: authorization }, redirect: 'manual', signal: AbortSignal.timeout(10_000),
    })
    if (check.status === 401 || check.status === 403) return error('HFSY API Key 校验失败', 401)
    if (!check.ok) return error('HFSY 暂时无法校验 API Key，请稍后重试', 502)
    const models = await check.json()
    if (!Array.isArray(models?.data) || !models.data.length) return error('HFSY API Key 未返回可用模型', 401)

    const bytes = await readImage(request)
    if (!bytes) return error('参考图超过 20 MB 或文件为空', 413)
    if (!matchesImageType(bytes, type)) return error('参考图格式与文件内容不匹配', 415)
    // Use a new key on every upload so a prior negative lookup cannot delay reads.
    const id = crypto.randomUUID()
    await assets.put(KEY_PREFIX + id, bytes.buffer, {
      expirationTtl: EXPIRATION_SECONDS,
      metadata: { contentType: type, expiresAt: Date.now() + EXPIRATION_SECONDS * 1000 },
    })
    url.search = ''
    url.searchParams.set('id', id)
    return Response.json({ url: url.href }, { status: 201, headers: HEADERS })
  } catch {
    return error('参考图存储暂时不可用，请稍后重试', 502)
  }
}
