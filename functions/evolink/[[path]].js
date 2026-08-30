const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization,Content-Type,X-DisyLab-Evolink-Base' }
export async function onRequest({ request }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  const url = new URL(request.url)
  const path = url.pathname.replace(/^\/evolink\/?/, '').replace(/^\/+/, '')
  const headers = new Headers(request.headers)
  for (const name of ['host', 'content-length', 'content-encoding', 'connection', 'x-disylab-evolink-base']) headers.delete(name)
  headers.set('accept-encoding', 'identity')
  try {
    const upstream = await fetch(new URL(path + url.search, 'https://api.evolink.ai/v1/'), { method: request.method, headers, body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body })
    const output = new Headers(CORS); output.set('content-type', upstream.headers.get('content-type') || 'application/json')
    return new Response(upstream.body, { status: upstream.status, headers: output })
  } catch { return Response.json({ error: { message: 'Evolink 上游连接失败' } }, { status: 502, headers: CORS }) }
}
