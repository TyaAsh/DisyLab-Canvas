const routes = {
  relayon: { host: 'relayonapi.com', get: /^(?:\/api\/pricing|\/v1\/(?:models|videos\/[\w.-]+(?:\/content)?))$/, post: /^\/v1\/(?:chat\/completions|messages|responses|images\/(?:generations|edits)|videos)$/ },
  xai: { host: 'api.x.ai', get: /^\/v1\/(?:models|(?:image-|video-|language-)models|videos\/[\w.-]+)$/, post: /^\/v1\/(?:chat\/completions|images\/(?:generations|edits)|videos\/(?:generations|edits))$/ },
  ark: { host: 'ark.cn-beijing.volces.com', get: /^\/api\/v3\/(?:models|contents\/generations\/tasks(?:\/[\w.-]+)?)$/, post: /^\/api\/v3\/(?:chat\/completions|images\/generations|contents\/generations\/tasks)$/ },
  minimax: { host: 'api.minimaxi.com', get: /^\/v(?:1\/(?:models|query\/video_generation|files\/retrieve)|2\/query\/video_generation\/[\w.-]+)$/, post: /^\/v(?:1\/(?:chat\/completions|text\/chatcompletion_v2|video_generation|t2a_v2)|2\/video_generation)$/ },
  muse: { host: 'api.meta.ai', get: /^\/v1\/models$/, post: /^\/v1\/(?:chat\/completions|responses|images\/(?:generations|edits))$/ },
}

export async function onRequest({ request }) {
  const url = new URL(request.url)
  const match = /^\/provider\/([a-z]+)(\/.*)$/.exec(url.pathname)
  const route = match && Object.hasOwn(routes, match[1]) ? routes[match[1]] : undefined
  const allowed = request.method === 'GET' ? route?.get : request.method === 'POST' ? route?.post : undefined
  if (!match || !route || !allowed?.test(match[2])) return Response.json({ error: { message: '不支持的厂商接口' } }, { status: 404 })

  const headers = new Headers()
  for (const name of ['authorization', 'content-type', 'accept', 'anthropic-version']) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  try {
    const response = await fetch('https://' + route.host + match[2] + url.search, {
      method: request.method, headers, redirect: 'error', signal: request.signal,
      ...(request.method === 'POST' ? { body: request.body, duplex: 'half' } : {}),
    })
    const output = new Headers({ 'cache-control': 'no-store' })
    for (const name of ['content-type', 'x-request-id', 'retry-after']) {
      const value = response.headers.get(name)
      if (value) output.set(name, value)
    }
    return new Response(response.body, { status: response.status, headers: output })
  } catch {
    return Response.json({ error: { message: '无法连接厂商 API，请稍后重试' } }, { status: 502 })
  }
}
