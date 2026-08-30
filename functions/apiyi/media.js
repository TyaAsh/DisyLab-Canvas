const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function mediaHostAllowed(url) {
  return url.protocol === 'https:'
    && !url.username && !url.password && !url.port
    && /(?:^|\.)apiyi\.com$|(?:^|\.)volces\.com$|(?:^|\.)aliyuncs\.com$|(?:^|\.)visionary\.beer$|(?:^|\.)aixinai\.net$|(?:^|\.)gptgod\.online$|(?:^|\.)gptgod\.com$|^www\.qixinai\.net$/i.test(url.hostname)
}

export async function onRequest({ request }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (request.method !== 'GET') return new Response('method not allowed', { status: 405, headers: CORS })
  const target = new URL(request.url).searchParams.get('url') || ''
  let current
  try { current = new URL(target) } catch { return new Response('invalid media url', { status: 400, headers: CORS }) }

  try {
    let upstream
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      if (!mediaHostAllowed(current)) return new Response('media host not allowed', { status: 403, headers: CORS })
      upstream = await fetch(current, { headers: { 'Accept-Encoding': 'identity' }, redirect: 'manual' })
      if (![301, 302, 303, 307, 308].includes(upstream.status)) break
      const location = upstream.headers.get('location')
      if (!location || redirects === 5) return new Response('invalid media redirect', { status: 502, headers: CORS })
      current = new URL(location, current)
    }
    if (!upstream) return new Response('media upstream connection failed', { status: 502, headers: CORS })
    const headers = new Headers(CORS)
    for (const name of ['content-type', 'content-length', 'cache-control', 'etag', 'last-modified']) {
      const value = upstream.headers.get(name)
      if (value) headers.set(name, value)
    }
    return new Response(upstream.body, { status: upstream.status, headers })
  } catch {
    return new Response('media upstream connection failed', { status: 502, headers: CORS })
  }
}
