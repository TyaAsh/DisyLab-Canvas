const KEY_PREFIX = 'hfsy-reference-images/'
const EXPIRATION_SECONDS = 4 * 60 * 60
const VIDEO_MAX_BYTES = 24 * 1024 * 1024
const IMAGE_MAX_BYTES = 20 * 1024 * 1024
const VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime'])
const HFSY_HOSTS = new Set(['www.hfsyapi.cn', 'api.hfsyapi.cn', 'apigo.hfsyapi.cn'])
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range, X-DisyLab-HFSY-Base',
  'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges',
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
}

function error(message, status) {
  return Response.json({ error: { message } }, { status, headers: HEADERS })
}

async function readAsset(request, maxBytes) {
  const reader = request.body?.getReader()
  if (!reader) return null
  const chunks = []
  let length = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > maxBytes) {
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
  if (!assets) return error('DisyLab 尚未配置参考素材存储', 503)
  const url = new URL(request.url)
  try {
    if (request.method === 'GET' || request.method === 'HEAD') {
      const id = url.searchParams.get('id') ?? ''
      if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/.test(id)) return new Response(null, { status: 404, headers: HEADERS })
      const { value, metadata } = await assets.getWithMetadata(KEY_PREFIX + id, { type: 'arrayBuffer' })
      if (!value || (!IMAGE_TYPES.has(metadata?.contentType) && !VIDEO_TYPES.has(metadata?.contentType)) || !(metadata.expiresAt > Date.now())) {
        return new Response(null, { status: 404, headers: HEADERS })
      }
      const headers = { ...HEADERS, 'Content-Type': metadata.contentType, 'Content-Length': String(value.byteLength) }
      if (VIDEO_TYPES.has(metadata.contentType)) {
        headers['Accept-Ranges'] = 'bytes'
        const range = request.method === 'GET' ? request.headers.get('Range') : null
        if (range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range)
          const size = value.byteLength
          const start = match?.[1] ? Number(match[1]) : Math.max(0, size - Number(match?.[2] || 0))
          const end = match?.[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1
          if (!match || (!match[1] && !match[2]) || start >= size || start > end) {
            return new Response(null, { status: 416, headers: { ...HEADERS, 'Content-Range': `bytes */${size}` } })
          }
          return new Response(value.slice(start, end + 1), { status: 206, headers: {
            ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1),
          } })
        }
      }
      return new Response(request.method === 'HEAD' ? null : value, { headers })
    }
    if (request.method !== 'POST') return error('请求方法不受支持', 405)
    const type = request.headers.get('content-type') ?? ''
    const video = VIDEO_TYPES.has(type)
    if (!video && !IMAGE_TYPES.has(type)) return error('参考素材须为 PNG、JPEG、WebP、GIF、MP4 或 MOV', 415)
    const maxBytes = video ? VIDEO_MAX_BYTES : IMAGE_MAX_BYTES
    const label = video ? '参考视频' : '参考图'
    if (Number(request.headers.get('content-length')) > maxBytes) return error(`${label}超过 ${maxBytes / 1024 / 1024} MB`, 413)
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

    const bytes = await readAsset(request, maxBytes)
    if (!bytes) return error(`${label}超过 ${maxBytes / 1024 / 1024} MB 或文件为空`, 413)
    const valid = video
      ? bytes.length >= 12 && ['ftyp', 'moov', 'mdat', 'wide', 'free'].includes(new TextDecoder().decode(bytes.subarray(4, 8)))
      : matchesImageType(bytes, type)
    if (!valid) return error(`${label}格式与文件内容不匹配`, 415)
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
    return error('参考素材存储暂时不可用，请稍后重试', 502)
  }
}
