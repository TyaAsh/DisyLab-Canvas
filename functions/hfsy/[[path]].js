const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type,X-DisyLab-HFSY-Base',
  'Access-Control-Max-Age': '86400',
}

const ALLOWED_HOSTS = new Set(['www.hfsyapi.cn', 'api.hfsyapi.cn', 'apigo.hfsyapi.cn'])

export async function onRequest({ request }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  const requestUrl = new URL(request.url)
  const requestedBase = request.headers.get('x-disylab-hfsy-base') || 'https://apigo.hfsyapi.cn/v1'
  let base
  try { base = new URL(requestedBase) } catch {
    return Response.json({ error: { message: 'HFSY 上游地址无效' } }, { status: 400, headers: CORS })
  }
  if (base.protocol !== 'https:' || !ALLOWED_HOSTS.has(base.hostname.toLowerCase()) || base.username || base.password || base.port || !/^\/v1(?:beta)?(?:\/|$)/i.test(base.pathname)) {
    return Response.json({ error: { message: '不支持的 HFSY 上游地址' } }, { status: 400, headers: CORS })
  }
  const rawPath = requestUrl.pathname.replace(/^\/hfsy\/?/, '').replace(/^\/+/, '')
  const rootCatalog = request.method === 'GET' && rawPath === '__root__/api/pricing'
  const rootUpload = request.method === 'POST' && /^__root__\/pg\/creative-center\/(image|video)-upload$/.test(rawPath)
  if (rawPath.startsWith('__root__/') && !rootCatalog && !rootUpload) {
    return Response.json({ error: { message: '不支持的 HFSY 根路径' } }, { status: 400, headers: CORS })
  }
  const upstreamPath = rootCatalog || rootUpload ? rawPath.replace(/^__root__\//, '') : rawPath.replace(/^v1(?:beta)?\//i, '')
  const target = new URL(upstreamPath + requestUrl.search, rootCatalog || rootUpload ? `${base.origin}/` : `${base.origin}${base.pathname.replace(/\/$/, '')}/`)
  const headers = new Headers(request.headers)
  for (const name of ['host', 'content-length', 'content-encoding', 'connection', 'x-disylab-hfsy-base']) headers.delete(name)
  headers.set('accept-encoding', 'identity')
  try {
    const upstream = await fetch(target, { method: request.method, headers, body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body })
    const output = new Headers(CORS)
    for (const name of ['content-type', 'content-length', 'cache-control', 'etag', 'last-modified', 'x-request-id']) {
      const value = upstream.headers.get(name)
      if (value) output.set(name, value)
    }
    return new Response(upstream.body, { status: upstream.status, headers: output })
  } catch {
    return Response.json({ error: { message: 'HFSY 上游连接失败' } }, { status: 502, headers: CORS })
  }
}
