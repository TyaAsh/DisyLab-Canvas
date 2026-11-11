import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const compile = async (file) => ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const asModule = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const lifecycle = asModule(await compile('./providerLifecycle.ts'))
const { inferImageOutput, imageOutputIntent } = await import(asModule(await compile('./imageOutputIntent.ts')))
const catalog = asModule(await compile('./modelCatalog.ts'))
const transport = asModule(await compile('./providerTransport.ts'))
const providers = asModule(await compile('./apiProviders.ts'))
const jimeng = asModule((await compile('./jimengCli.ts')).replace("'./providerTransport'", JSON.stringify(transport)))
const museWeb = asModule((await compile('./museWeb.ts')).replace("'./providerTransport'", JSON.stringify(transport)))
const { resolveDesktopProviderRequest } = await import(transport)
const api = await import(asModule((await compile('./imageApi.ts'))
  .replace("'./providerLifecycle'", JSON.stringify(lifecycle))
  .replace("'./providerTransport'", JSON.stringify(transport))
  .replace("'./apiProviders'", JSON.stringify(providers))
  .replace("'./jimengCli'", JSON.stringify(jimeng))
  .replace("'./museWeb'", JSON.stringify(museWeb))
  .replaceAll("'./modelCatalog'", JSON.stringify(catalog))))

test('desktop translates browser relay paths without depending on the dev server', () => {
  const cases = [
    ['/hfsy/v1/image/query/task_1', { 'x-disylab-hfsy-base': 'https://api.hfsyapi.cn/v1' }, 'https://api.hfsyapi.cn/v1/image/query/task_1'],
    ['/hfsy/__root__/api/pricing', { 'x-disylab-hfsy-base': 'https://www.hfsyapi.cn/v1' }, 'https://www.hfsyapi.cn/api/pricing'],
    ['/apiyi/seedance/v1/contents/generations/tasks', { 'x-disylab-apiyi-origin': 'https://vip.apiyi.com' }, 'https://vip.apiyi.com/v1/contents/generations/tasks'],
    ['/visionary/tasks/job_1', {}, 'https://api.visionary.beer/v1/tasks/job_1'],
    ['/evolink/tasks/job_1', {}, 'https://api.evolink.ai/v1/tasks/job_1'],
  ]
  for (const [path, headers, target] of cases) {
    const request = resolveDesktopProviderRequest(path, { headers: { ...headers, Authorization: 'Bearer test' } })
    assert.equal(request.url.href, target)
    assert.deepEqual([...request.init.headers.keys()].filter((name) => name.startsWith('x-disylab-')), [])
    assert.equal(request.init.headers.get('authorization'), 'Bearer test')
  }
  assert.equal(resolveDesktopProviderRequest('/prompt-library/catalog.json'), undefined)
  assert.equal(resolveDesktopProviderRequest('data:image/png;base64,AA=='), undefined)
  assert.equal(resolveDesktopProviderRequest('http://tauri.localhost/apiyi/media?url=https%3A%2F%2Ffile.hfsyapi.cn%2Fimage.png', undefined, 'http://tauri.localhost').url.href, 'https://file.hfsyapi.cn/image.png')
  assert.throws(() => resolveDesktopProviderRequest('/hfsy/v1/models', { headers: { 'x-disylab-hfsy-base': 'https://example.test/v1' } }))
})

test('desktop media keeps HFSY authorization scoped to its known CDN hosts', () => {
  const headers = { 'x-disylab-media-authorization': 'Bearer test' }
  const trusted = resolveDesktopProviderRequest('/apiyi/media?url=https%3A%2F%2Fwww.qixinai.net%2Ffile.mp4', { headers })
  assert.equal(trusted.init.headers.get('authorization'), 'Bearer test')
  assert.equal(trusted.init.headers.get('referer'), 'https://www.hfsyapi.cn/')
  assert.equal(trusted.init.maxRedirections, 0)
  const unknown = resolveDesktopProviderRequest('/apiyi/media?url=https%3A%2F%2Fexample.test%2Ffile.mp4', { headers })
  assert.equal(unknown.init.headers.get('authorization'), null)
  assert.equal(unknown.init.headers.get('x-disylab-media-authorization'), null)
})

test('prompt output detection separates requested formats from reference and negated formats', () => {
  const examples = [
    ['一只猫点头，做成 GIF 动图', 'gif'],
    ['制作循环动图', 'gif'],
    ['生成 ＳＶＧ 标志', 'svg'],
    ['背景设置为透明，保存为 PNG', 'transparent-png'],
    ['生成透明的 PNG 图标', 'transparent-png'],
    ['Make an icon with a transparent background', 'transparent-png'],
    ['做个无背景 SVG', 'svg'],
    ['参考 SVG，做成 GIF', 'gif'],
    ['参照这个 GIF 做一个 SVG 标志', 'svg'],
    ['Use the reference image and make a transparent PNG', 'transparent-png'],
    ['把 GIF 转成透明底 PNG', 'transparent-png'],
    ['不用 GIF 或 SVG，输出 PNG', 'png'],
    ['不要输出 GIF', undefined],
    ['Do not export SVG', undefined],
    ['Output a PNG, not an animated GIF', 'png'],
    ['参考上传的 GIF，画一张海报', undefined],
    ['用 GIF 字样做一张海报', undefined],
    ['https://example.test/logo.svg 画一个城市剪影', undefined],
    ['@[node:reference.gif] 输出一张静态图', undefined],
    ['生成一张普通照片', undefined],
  ]
  for (const [prompt, expected] of examples) assert.equal(inferImageOutput(prompt), expected, prompt)
})

test('format detection allows documented model support and blocks unsupported special requests', () => {
  const base = 'https://grsaiapi.com/v1'
  const flare = api.getGrsaiImageCapabilities(base, 'gpt-image-2.6-flare').outputs
  const legacy = api.getGrsaiImageCapabilities(base, 'gpt-image-2.5').outputs
  assert.equal(imageOutputIntent('请输出 GIF', flare).output, 'gif')
  assert.equal(imageOutputIntent('背景透明', flare).output, 'transparent-png')
  assert.equal(imageOutputIntent('请输出 GIF', legacy).blocked, true)
  assert.equal(imageOutputIntent('请输出 SVG', flare).blocked, true)
  assert.match(imageOutputIntent('生成动图').message, /尚未确认支持 GIF/)
  assert.equal(imageOutputIntent('输出 PNG').blocked, false)
})

test('unknown model IDs stay unclassified instead of being silently treated as text', () => {
  assert.equal(api.inferModelCapability('vendor-next-gen-2026'), 'unknown')
  assert.equal(api.isModelAutoEnabled({ id: 'vendor-next-gen-2026', name: 'Next Gen', capability: 'unknown' }), false)
  assert.equal(api.inferModelCapability('gpt-image-2'), 'image')
  assert.equal(api.inferModelCapability('wan2.7-t2v'), 'video')
  assert.equal(api.inferModelCapability('gemini-2.5-flash'), 'text')
  assert.equal(api.inferModelCapability('gpt-5.4'), 'text')
  assert.equal(api.inferModelCapability('nano-banana-pro'), 'image')
})

test('GPT Image 2 preserves exact portrait ratios while legacy image models retain compatible buckets', () => {
  assert.equal(api.resolveImageRequestSize('gpt-image-2', '9:16', '1K'), '1024x1824')
  assert.equal(api.resolveImageRequestSize('gpt-image-2-2026-04-21', '16:9', '2K'), '2560x1440')
  assert.equal(api.resolveImageRequestSize('gpt-image-1.5', '9:16', '1K'), '1024x1536')
})

test('HFSY credit lookup points users to the console because no public balance API is documented', async () => {
  await assert.rejects(
    () => api.fetchProviderCredits({ baseUrl: 'https://www.hfsyapi.cn/v1', apiKey: 'test' }),
    /HFSY 官方公开 API 暂未提供余额查询接口/,
  )
})

function browserGlobal(t, name, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name)
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : delete globalThis[name])
}

test('GRS GPT Image uses documented format, quality and resolution fields', async (t) => {
  const bodies = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    bodies.push({ url: String(url), body: init.body instanceof FormData ? Object.fromEntries(init.body) : JSON.parse(init.body) })
    return Response.json({ id: 'image-1', status: 'succeeded', results: [{ url: 'https://file1.aitohumanize.com/file/result.gif' }] })
  })
  const settings = { baseUrl: 'https://grsai.dakka.com.cn/v1', apiKey: 'test' }
  const options = { prompt: 'animate', count: 1, aspectRatio: '9:16', resolution: '2K', detail: 'high' }
  await api.generateRemoteImages({ ...settings, model: 'gpt-image-2.6-sunburst' }, { ...options, output: 'gif' })
  await api.generateRemoteImages({ ...settings, model: 'gpt-image-2.6' }, { ...options, output: 'svg' })
  await api.generateRemoteImages({ ...settings, model: 'gpt-image-2.5-sunburst' }, { ...options, detail: 'xhigh', output: 'transparent-png' })
  await api.generateRemoteImages({ ...settings, model: 'nano-banana-2.1' }, { ...options, aspectRatio: '1:4' })
  await api.generateRemoteImages({ ...settings, baseUrl: settings.baseUrl + '/images/generations', model: 'gpt-image-2.6-flare' }, { ...options, output: 'gif' })
  await api.generateRemoteImages({ ...settings, baseUrl: settings.baseUrl + '/images/edits', model: 'gpt-image-2.6' }, { ...options, output: 'gif', referenceImages: ['https://example.test/source.png'] })
  await assert.rejects(() => api.generateRemoteImages({ ...settings, model: 'gpt-image-2.5' }, { ...options, output: 'gif' }), /不支持此输出格式/)
  assert.equal(bodies.length, 6)
  assert.deepEqual(bodies[0], { url: `${settings.baseUrl}/api/generate`, body: { model: 'gpt-image-2.6-sunburst', prompt: 'animate', images: [], aspectRatio: '1152x2048', replyType: 'async', quality: 'high', outputFormat: 'gif' } })
  assert.deepEqual([bodies[1].body.aspectRatio, bodies[1].body.quality, bodies[1].body.outputFormat], ['9:16', 'auto', 'svg'])
  assert.deepEqual([bodies[2].body.quality, bodies[2].body.background, bodies[2].body.outputFormat], ['xhigh', 'transparent', 'png'])
  assert.deepEqual([bodies[3].body.aspectRatio, bodies[3].body.imageSize, bodies[3].body.outputFormat], ['1:4', '2K', undefined])
  assert.equal(bodies[4].url, `${settings.baseUrl}/images/generations`)
  assert.equal(bodies[4].body.output_format, 'gif')
  assert.equal(bodies[5].url, `${settings.baseUrl}/images/edits`)
  assert.deepEqual([bodies[5].body.image, bodies[5].body.output_format], ['https://example.test/source.png', 'gif'])
})

test('GRS images report numeric progress and keep status-only polls distinct', async (t) => {
  browserGlobal(t, 'window', { setTimeout(callback) { callback(); return 1 }, clearTimeout() {} })
  const payloads = [
    { data: { id: 'image-progress' } },
    { data: { status: 'queued', progress: 0 } },
    { status: 'success', data: { status: 'running', progress: 37 } },
    { data: { status: 'running', progress: -1 } },
    { data: { status: 'succeeded' } },
    { data: { status: 'succeeded', results: [{ url: 'https://example.test/output.gif' }] } },
  ]
  t.mock.method(globalThis, 'fetch', async () => Response.json(payloads.shift()))
  const progress = []
  const images = await api.generateRemoteImages(
    { baseUrl: 'https://grsai.dakka.com.cn/v1', apiKey: 'test', model: 'gpt-image-2.6' },
    { prompt: 'animate', count: 1, output: 'gif', onProgress: (...event) => progress.push(event) },
  )
  assert.equal(images.length, 1)
  assert.deepEqual(progress, [
    [undefined, 'queued'],
    [0, 'queued'],
    [37, 'running'],
    [undefined, 'running'],
    [undefined, 'succeeded'],
  ])
})

test('GRS Wan and Agnes use the native frame route and retain task IDs across polling', async (t) => {
  browserGlobal(t, 'window', { setTimeout(callback) { callback(); return 1 }, clearTimeout() {} })
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body && JSON.parse(init.body) })
    if (String(url).endsWith('/api/generate')) return Response.json({ id: 'video-job', status: 'queued' })
    if (String(url).endsWith('/api/result?id=video-job')) return Response.json({ id: 'video-job', status: 'succeeded', results: [{ url: 'https://file1.aitohumanize.com/file/movie.mp4' }] })
    return new Response(new Blob(['video'], { type: 'video/mp4' }))
  })
  const settings = { baseUrl: 'https://grsaiapi.com/v1', apiKey: 'test' }
  const options = { prompt: 'motion', size: '720x1280', aspectRatio: '9:16', seconds: 12, firstFrame: 'https://example.test/first.png', lastFrame: 'https://example.test/last.png' }
  let savedTask
  for (const model of ['agnes-video-2.5', 'wan-3.0']) {
    const result = await api.generateRemoteVideo({ ...settings, model }, { ...options, onTaskId: (id) => { savedTask = id } })
    assert.equal(savedTask, 'video-job')
    assert.equal(await result.blob.text(), 'video')
  }
  assert.equal(calls[0].url, `${settings.baseUrl}/api/generate`)
  assert.deepEqual(calls[0].body, { model: 'agnes-video-2.5', prompt: 'motion', aspectRatio: '9:16', resolution: '720p', duration: 12, replyType: 'async', firstFrame: options.firstFrame, lastFrame: options.lastFrame })
  assert.equal(calls[1].url, `${settings.baseUrl}/api/result?id=video-job`)
  assert.equal(calls[1].method, 'GET')
  assert.equal(calls[3].body.model, 'wan-3.0')
  await assert.rejects(() => api.generateRemoteVideo({ ...settings, model: 'minimax-h3' }, { ...options, lastFrame: undefined, resolution: '1080p' }), /参数不受支持/)
  assert.equal(calls.length, 6)
  await api.generateRemoteVideo({ ...settings, model: 'minimax-h3' }, { ...options, lastFrame: undefined, seconds: 10, resolution: '1080p' })
  assert.equal(calls[6].body.aspectRatio, 'portrait')
  assert.deepEqual(calls[6].body.images, [options.firstFrame])
})

test('GRS uses Gemini native JSON and SSE only when the connection selects v1beta', async (t) => {
  const urls = []
  const gemini = { candidates: [{ content: { parts: [{ thought: true, text: 'private' }, { text: 'visible' }] } }] }
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    urls.push(String(url))
    if (String(url).includes(':streamGenerateContent')) return new Response(`data: ${JSON.stringify(gemini)}\n\n`, { headers: { 'content-type': 'text/event-stream' } })
    if (String(url).endsWith(':generateContent')) {
      assert.equal(JSON.parse(init.body).contents[0].parts[0].text, 'hello')
      return Response.json(gemini)
    }
    return Response.json({ choices: [{ message: { content: 'compatible' } }] })
  })
  const settings = { apiKey: 'test', model: 'gemini-3.8-flash' }
  assert.equal(await api.generateRemoteText({ ...settings, baseUrl: 'https://grsaiapi.com/v1' }, 'hello'), 'compatible')
  assert.equal(await api.generateRemoteText({ ...settings, baseUrl: 'https://grsaiapi.com/v1beta' }, 'hello'), 'visible')
  assert.equal(await api.generateRemoteText({ ...settings, baseUrl: 'https://grsaiapi.com/v1beta/models/example:streamGenerateContent' }, 'hello'), 'visible')
  assert.deepEqual(urls, ['https://grsaiapi.com/v1/chat/completions', 'https://grsaiapi.com/v1beta/models/gemini-3.8-flash:generateContent', 'https://grsaiapi.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse'])
})

test('HFSY catalogue includes account-enabled documented models beyond the public plaza', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const headers = new Headers(init.headers)
    if (String(url).endsWith('/api/pricing')) {
      assert.equal(headers.get('authorization'), null)
      return Response.json({ success: true, data: [{ model_name: 'minimax-h3', tags: ['视频'], enable_groups: ['default'], supported_endpoint_types: ['openai'] }] })
    }
    assert.equal(String(url), 'https://www.hfsyapi.cn/v1/models')
    assert.equal(headers.get('authorization'), 'Bearer test')
    return Response.json({ data: [{ id: 'gpt-image-2.6-flare' }, { id: 'wan-3.0-720' }, { id: 'retired-unrecognized-id' }] })
  })
  const result = await api.fetchRemoteModels({ baseUrl: 'https://www.hfsyapi.cn/v1', apiKey: 'test' })
  assert.deepEqual(result.map(({ id, capability }) => [id, capability]), [['gpt-image-2.6-flare', 'image'], ['wan-3.0-720', 'video']])
})

test('HFSY native images use documented pixel sizes, transparency and GET polling', async (t) => {
  browserGlobal(t, 'window', { setTimeout(callback) { callback(); return 1 }, clearTimeout() {} })
  const requests = []
  const url = 'https://file.hfsyapi.cn/2026/09/24/result.png'
  const payloads = [
    Response.json({ id: 'task_image', status: 'queued', images: [] }),
    new Response(null, { status: 504 }),
    Response.json({ data: { status: 'in_progress', progress: '42%', images: [{ url: 'https://file.hfsyapi.cn/preview.png' }] } }),
    Response.json({ id: 'task_image', status: 'completed', images: [{ url, revised_prompt: 'draw' }], error: null }),
  ]
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests.push({ url: String(url), method: init.method ?? 'GET', base: new Headers(init.headers).get('X-DisyLab-HFSY-Base'), body: init.body && JSON.parse(init.body) })
    return payloads.shift()
  })
  const settings = { baseUrl: 'https://www.hfsyapi.cn/v1/image/create', apiKey: 'test', model: 'gpt-image-2.6-flare' }
  const options = { prompt: 'draw', count: 1, aspectRatio: '16:9', resolution: '4K', detail: 'high', referenceImages: ['https://cdn.example.test/ref.png'] }
  const progress = []
  const ids = []
  const images = await api.generateRemoteImages(settings, { ...options, output: 'transparent-png', onProgress: (...event) => progress.push(event), onTaskId: (id) => ids.push(id) })
  assert.deepEqual(requests[0], {
    url: '/hfsy/v1/image/create', method: 'POST', base: 'https://www.hfsyapi.cn/v1',
    body: { model: settings.model, prompt: 'draw', size: '3840x2160', reference_images: options.referenceImages, background: 'transparent' },
  })
  assert.deepEqual(requests.slice(1).map(({ url, method, base }) => [url, method, base]), [
    ['/hfsy/v1/image/query/task_image', 'GET', 'https://www.hfsyapi.cn/v1'],
    ['/hfsy/v1/image/query/task_image', 'GET', 'https://api.hfsyapi.cn/v1'],
    ['/hfsy/v1/image/query/task_image', 'GET', 'https://api.hfsyapi.cn/v1'],
  ])
  assert.deepEqual(ids, ['task_image'])
  assert.deepEqual(progress, [[undefined, 'queued'], [42, 'in_progress']])
  assert.deepEqual(images, [{ url: `/apiyi/media?url=${encodeURIComponent(url)}`, revisedPrompt: 'draw' }])
  assert.deepEqual(api.getImageModelCapabilities(settings.baseUrl, 'gpt-image-2.6').resolutions, ['1K'])
  assert.deepEqual(api.getImageModelCapabilities(settings.baseUrl, 'gpt-image-2.6-sunburst').outputs, ['png', 'transparent-png'])
  for (const output of ['gif', 'svg']) await assert.rejects(() => api.generateRemoteImages(settings, { ...options, output }), /HFSY 图片参数/)
  await assert.rejects(() => api.generateRemoteImages({ ...settings, model: 'gpt-image-2.6' }, { ...options, referenceImages: Array(7).fill(options.referenceImages[0]) }), /HFSY 图片参数/)
  assert.equal(requests.length, 4)
})

test('HFSY text uses chat completions, handles SSE chunks and reports error envelopes', async (t) => {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests.push([String(url), JSON.parse(init.body), new Headers(init.headers).get('authorization')])
    if (requests.length === 1) return Response.json({ choices: [{ message: { content: '普通回答' } }] })
    if (requests.length === 2) return new Response([
      'data: {"choices":[{"delta":{"role":"assistant"}}]}',
      'data: {"choices":[{"delta":{"content":"你好"}}]}',
      'data: {"choices":[{"delta":{"content":"世界"}}]}',
      'data: [DONE]',
    ].join('\r\n\r\n'), { headers: { 'content-type': 'text/plain' } })
    return Response.json({ success: false, message: '模型未授权' })
  })
  const settings = { baseUrl: 'https://www.hfsyapi.cn', model: 'gpt-5.5', apiKey: 'test' }
  assert.equal(await api.generateRemoteText(settings, '你好'), '普通回答')
  assert.equal(await api.generateRemoteText(settings, '你好', { stream: true }), '你好世界')
  await assert.rejects(() => api.generateRemoteText(settings, '你好'), (error) => error.detail === '模型未授权')
  assert.deepEqual(requests[0], ['https://www.hfsyapi.cn/v1/chat/completions', { model: 'gpt-5.5', messages: [{ role: 'user', content: '你好' }], stream: false }, 'Bearer test'])
  assert.equal(requests[1][1].stream, true)
})

test('HFSY routes MiniMax, Kling, Muse and native Seedance using their own fields', async (t) => {
  const bodies = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (init?.method === 'POST') {
      bodies.push(JSON.parse(init.body))
      return Response.json({ data: { id: 'task_video', status: 'completed', result_url: 'https://file.hfsyapi.cn/video.mp4' } })
    }
    return new Response(new Blob(['video'], { type: 'video/mp4' }))
  })
  const settings = { baseUrl: 'https://www.hfsyapi.cn', apiKey: 'test' }
  const base = { prompt: 'test', seconds: 5, size: '9:16' }
  await assert.rejects(() => api.generateRemoteVideo({ ...settings, model: 'minimax-h3' }, base), /视频参数不符合模型要求/)
  await api.generateRemoteVideo({ ...settings, model: 'minimax-h3' }, { ...base, referenceImages: ['https://cdn.example.test/image.png'], referenceAudios: ['https://cdn.example.test/voice.mp3'] })
  await api.generateRemoteVideo({ ...settings, model: 'kling-o3' }, { ...base, size: 'square' })
  await api.generateRemoteVideo({ ...settings, model: 'muse_video' }, { ...base, seconds: 1 })
  await api.generateRemoteVideo({ ...settings, model: 'Doubao-Seedance-2.0-fast' }, {
    ...base, mode: 'first_last_frame', firstFrame: 'https://cdn.example.test/first.png', lastFrame: 'https://cdn.example.test/last.png',
    resolution: '720p', generateAudio: false, referenceAudios: ['asset://reviewed-audio'],
  })
  assert.deepEqual(bodies[0], { model: 'minimax-h3', prompt: 'test', duration: 5, orientation: 'portrait', images: ['https://cdn.example.test/image.png'], audios: ['https://cdn.example.test/voice.mp3'] })
  assert.equal(bodies[1].orientation, 'square')
  assert.deepEqual(bodies[2], { model: 'muse_video', prompt: 'test', duration: 1, ratio: '9:16' })
  assert.deepEqual(bodies[3], {
    model: 'Doubao-Seedance-2.0-fast', duration: 5, ratio: '9:16', resolution: '720p', generate_audio: false,
    content: [
      { type: 'text', text: 'test' },
      { type: 'image_url', image_url: { url: 'https://cdn.example.test/first.png' }, role: 'first_frame' },
      { type: 'image_url', image_url: { url: 'https://cdn.example.test/last.png' }, role: 'last_frame' },
      { type: 'audio_url', audio_url: { url: 'asset://reviewed-audio' }, role: 'reference_audio' },
    ],
  })
  assert.equal(api.hfsyVideoLimits('sd-2.5-1080').images, 30)
  assert.equal(api.hfsyVideoLimits('wan-3.0-720').maxSeconds, 30)
})

test('new vendor adapters use native video paths and archive the completed result', async (t) => {
  const requests = []
  const win = { setTimeout: (run) => setTimeout(run, 0), clearTimeout }
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const path = String(url)
    requests.push({ path, method: init?.method, body: init?.body ? JSON.parse(init.body) : undefined })
    const result = 'https://cdn.example.test/video.mp4'
    if (path === '/provider/ark/api/v3/contents/generations/tasks') return Response.json({ id: 'ark-1' })
    if (path.endsWith('/tasks/ark-1')) return Response.json({ status: 'succeeded', content: { video_url: result } })
    if (path.endsWith('/videos/generations')) return Response.json({ request_id: 'xai-1' })
    if (path.endsWith('/videos/xai-1')) return Response.json({ status: 'done', video: { url: result } })
    if (path === '/provider/minimax/v2/video_generation') return Response.json({ task: { id: 'mini-1', status: 'processing' } })
    if (path.endsWith('/query/video_generation/mini-1')) return Response.json({ task: { status: 'succeeded', content: { url: result } } })
    if (path === '/hfsy/v1/video/create') return Response.json({ id: 'muse-1', status: 'IN_PROGRESS' })
    if (path.endsWith('/video/query/muse-1')) return Response.json({ success: true, data: { status: 'completed', result_url: result } })
    return new Response(new Blob(['video'], { type: 'video/mp4' }))
  })
  globalThis.window = win
  try {
    const options = { prompt: 'test', seconds: 5, size: '3:4', aspectRatio: '3:4', resolution: '720p' }
    const ark = await api.generateRemoteVideo({ baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', apiKey: 'test', model: 'doubao-seedance-2-0-260128' }, { ...options, mode: 'image2video', firstFrame: 'https://cdn.example.test/first.png' })
    assert.equal(ark.taskId, 'ark-1')
    assert.deepEqual(requests[0].body.content[1], { type: 'image_url', image_url: { url: 'https://cdn.example.test/first.png' }, role: 'first_frame' })
    const grok = await api.generateRemoteVideo({ baseUrl: 'https://api.x.ai/v1', apiKey: 'test', model: 'grok-imagine-video-1.5' }, options)
    assert.equal(grok.taskId, 'xai-1')
    assert.equal(requests.find(({ path }) => path.endsWith('/videos/generations')).body.aspect_ratio, '3:4')
    const mini = await api.generateRemoteVideo({ baseUrl: 'https://api.minimaxi.com/v1', apiKey: 'test', model: 'MiniMax-H3' }, { ...options, aspectRatio: '16:9' })
    assert.equal(mini.taskId, 'mini-1')
    assert.equal(requests.find(({ path }) => path.endsWith('/v2/video_generation')).body.ratio, '16:9')
    const muse = await api.generateRemoteVideo({ baseUrl: 'https://www.hfsyapi.cn/v1', apiKey: 'test', model: 'muse-video' }, { ...options, aspectRatio: '9:16' })
    assert.equal(muse.taskId, 'muse-1')
    assert.equal(requests.find(({ path }) => path.endsWith('/video/query/muse-1')).method, 'POST')
  } finally { delete globalThis.window }
})

test('vendor catalog supports Muse and Grok image requests and does not offer retired presets', async (t) => {
  const { API_PROVIDER_PRESETS } = await import(providers)
  assert.deepEqual(API_PROVIDER_PRESETS.slice(0, 2).map(({ id }) => id), ['grsai', 'hfsy'])
  assert.equal(API_PROVIDER_PRESETS.some(({ id }) => id === 'evolink'), false)
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push([String(url), JSON.parse(init.body)])
    return Response.json({ data: [{ url: 'https://cdn.example.test/image.png' }] })
  })
  const config = { prompt: 'test', count: 2, aspectRatio: '3:4', resolution: '2K' }
  await api.generateRemoteImages({ baseUrl: 'https://api.x.ai/v1', apiKey: 'test', model: 'grok-imagine-image-2.0' }, config)
  await api.generateRemoteImages({ baseUrl: 'https://api.meta.ai/v1', apiKey: 'test', model: 'muse-image-1.0' }, config)
  assert.deepEqual(calls[0], ['https://api.x.ai/v1/images/generations', { model: 'grok-imagine-image-2.0', prompt: 'test', n: 2, aspect_ratio: '3:4', resolution: '2k', quality: 'low', response_format: 'b64_json' }])
  assert.equal(calls[1][0], 'https://api.meta.ai/v1/images/generations')
  assert.equal(calls[1][1].n, 2)
})

test('Jimeng extracts its device flow and model choices without accepting other authorization hosts', async () => {
  const { parseJimengChallenge, parseJimengModelHelp } = await import(jimeng)
  const plain = 'verification_uri: https://jimeng.jianying.com/passport/open/scan_user_code?user_code=mock\nuser_code: MOCK-1234\ndevice_code: dev-mock'
  const parsed = parseJimengChallenge(plain)
  assert.equal(new URL(parsed.url).pathname, '/ai-tool/cli-auth')
  assert.equal(parsed.userCode, 'MOCK-1234')
  assert.equal(parsed.deviceCode, 'dev-mock')
  assert.equal(parseJimengChallenge(plain.replace('jimeng.jianying.com', 'example.test')), undefined)
  const images = parseJimengModelHelp('Supported combinations:\n- model_version: 3.0, 4.7, 5.0Pro\n- ratio: 1:1', 'image')
  assert.deepEqual(images.map(({ id, capability }) => [id, capability]), [['3.0', 'image'], ['4.7', 'image'], ['5.0Pro', 'image']])
})

test('HFSY requires public media URLs before submitting a task', async (t) => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('unexpected request') })
  for (const firstFrame of ['data:image/png;base64,AAAA', 'blob:http://localhost/image', 'http://169.254.169.254/frame.png', 'http://localhost./frame.png']) {
    await assert.rejects(() => api.generateRemoteVideo({ baseUrl: 'https://api.hfsyapi.cn/v1', apiKey: 'test', model: 'sd-2-mini-720' }, {
      prompt: 'test', seconds: 6, size: '720x1280', mode: 'image2video', firstFrame,
    }), /HFSY 仅支持公网素材链接/)
  }
  assert.equal(calls, 0)
})


test('HFSY rejects unsupported duration and video references before network calls', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected network') })
  for (const options of [
    { seconds: 4, mode: 'text2video' },
    { seconds: 6, mode: 'all_reference', referenceVideo: 'https://www.qixinai.net/ref.mp4' },
  ]) {
    await assert.rejects(() => api.generateRemoteVideo({ baseUrl: 'https://www.hfsyapi.cn', apiKey: 'test', model: 'minimax-h3' }, {
      prompt: 'test', size: '720x1280', ...options,
    }), /参数不符合模型要求/)
  }
  assert.equal(api.hfsyVideoLimits('sd-2.5-720').images, 30)
  assert.equal(api.hfsyVideoLimits('sd-2.5-720').videos, 10)
  assert.equal(api.hfsyVideoLimits('minimax-h3').images, 9)
  assert.equal(api.hfsyVideoLimits('unknown'), undefined)
})

test('HFSY submits text, image, frame, image-reference and mixed-material routes with public URLs', async (t) => {
  const bodies = []
  let frameAdminLog
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url).includes('/video/create')) {
      bodies.push(JSON.parse(init.body))
      return Response.json({ id: `task-${bodies.length}`, status: 'SUCCESS', result_url: `https://media.aixinai.net/${bodies.length}.mp4` })
    }
    return new Response(new Blob(['video'], { type: 'video/mp4' }), { headers: { 'content-type': 'video/mp4' } })
  })
  const settings = { baseUrl: 'https://www.hfsyapi.cn/v1', apiKey: 'test', model: 'sd-2-mini-720' }
  const base = { prompt: 'test', seconds: 5, size: '720x1280' }
  await api.generateRemoteVideo(settings, { ...base, mode: 'text2video' })
  await api.generateRemoteVideo(settings, { ...base, mode: 'image2video', firstFrame: 'https://cdn.example.com/first.png' })
  await api.generateRemoteVideo(settings, { ...base, mode: 'first_last_frame', firstFrame: 'https://cdn.example.com/first.png', lastFrame: 'https://cdn.example.com/last.png' })
  await api.generateRemoteVideo(settings, { ...base, mode: 'first_last_frame', firstFrame: 'https://cdn.example.com/same.png', lastFrame: 'https://cdn.example.com/same.png', captureAdminLog: (log) => { frameAdminLog = log } })
  await api.generateRemoteVideo(settings, { ...base, mode: 'image_reference', referenceImages: ['https://cdn.example.com/a.png', 'https://cdn.example.com/b.png'] })
  await api.generateRemoteVideo(settings, { ...base, mode: 'all_reference', referenceImages: ['https://cdn.example.com/a.png'], referenceVideos: ['https://cdn.example.com/motion.mp4'] })
  await api.generateRemoteVideo(settings, { ...base, size: '3:4', mode: 'text2video' })
  assert.equal('images' in bodies[0], false)
  assert.deepEqual(bodies[1].images, ['https://cdn.example.com/first.png'])
  assert.deepEqual(bodies[2].images, ['https://cdn.example.com/first.png', 'https://cdn.example.com/last.png'])
  assert.deepEqual(bodies[3].images, ['https://cdn.example.com/same.png', 'https://cdn.example.com/same.png'])
  assert.deepEqual(bodies[4].images, ['https://cdn.example.com/a.png', 'https://cdn.example.com/b.png'])
  assert.deepEqual(bodies[5].videos, ['https://cdn.example.com/motion.mp4'])
  assert.equal(bodies[6].orientation, 'portrait')
  assert.equal(JSON.parse(frameAdminLog.requestJson).referenceImageCount, 2)
})

test('HFSY stops immediately on documented asynchronous failure states', async (t) => {
  browserGlobal(t, 'window', { setTimeout(callback) { callback(); return 1 }, clearTimeout() {} })
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1
    if (calls === 1) return Response.json({ id: 'failed-task', status: 'queued' })
    return Response.json({ id: 'failed-task', status: 'FAILURE', fail_reason: 'vendor rejected material' })
  })
  await assert.rejects(() => api.generateRemoteVideo({ baseUrl: 'https://api.hfsyapi.cn/v1', apiKey: 'test', model: 'sd-2-mini-720' }, {
    prompt: 'test', seconds: 5, size: '9:16', mode: 'text2video',
  }), (error) => {
    assert.match(error.message, /HFSY 视频生成失败/)
    assert.match(error.detail, /vendor rejected material/)
    return true
  })
  assert.equal(calls, 2)
})

test('Seedance families expose and submit their own defaults and limits', async (t) => {
  assert.deepEqual(api.seedanceVideoDefaults('doubao-seedance-1-0-lite-i2v-250428'), {
    resolutions: ['480p', '720p'], ratios: ['auto', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'], minDuration: 2, maxDuration: 12, defaultDuration: 5, defaultRatio: '16:9', defaultResolution: '720p', defaultGenerateAudio: false,
  })
  assert.equal(api.seedanceVideoDefaults('doubao-seedance-1-5-pro-251215').defaultRatio, 'auto')
  assert.equal(api.seedanceVideoDefaults('Seedance 1.0 Pro').defaultImageRatio, 'auto')
  assert.deepEqual(api.seedanceVideoDefaults('seedance2.0fast').resolutions, ['480p', '720p'])
  assert.deepEqual(api.seedanceVideoDefaults('seedance-v2.0').resolutions, ['480p', '720p', '1080p', '4k'])
  assert.equal(api.seedanceVideoDefaults('dreamina-seedance-2-0-fast-260128').maxDuration, 15)
  assert.equal(api.seedanceVideoDefaults('dreamina-seedance-2-5-260628').maxDuration, 30)
  const bodies = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url).includes('/contents/generations/tasks')) {
      bodies.push(JSON.parse(init.body))
      return Response.json({ id: `seedance-${bodies.length}`, status: 'succeeded', content: { video_url: `https://cdn.example.com/seedance-${bodies.length}.mp4` } })
    }
    return new Response(new Blob(['video'], { type: 'video/mp4' }))
  })
  await api.generateRemoteVideo({ baseUrl: 'https://api.apiyi.com/v1', apiKey: 'key', model: 'doubao-seedance-1-0-lite-i2v-250428' }, { prompt: 'x', seconds: 1, size: '16:9', resolution: '720p' })
  await api.generateRemoteVideo({ baseUrl: 'https://api.apiyi.com/v1', apiKey: 'key', model: 'dreamina-seedance-2-0-fast-260128' }, { prompt: 'x', seconds: 99, size: 'adaptive', resolution: '1080p' })
  await api.generateRemoteVideo({ baseUrl: 'https://api.apiyi.com/v1', apiKey: 'key', model: 'dreamina-seedance-2-5-260628' }, { prompt: 'x', seconds: 99, size: 'adaptive', resolution: '720p' })
  assert.equal(bodies[0].duration, 2)
  assert.equal('generate_audio' in bodies[0], false)
  assert.equal(bodies[1].resolution, '720p')
  assert.equal(bodies[1].duration, 15)
  assert.equal(bodies[1].ratio, 'adaptive')
  assert.equal(bodies[1].generate_audio, true)
  assert.equal(bodies[2].duration, 30)
})

test('custom OpenAI-compatible bases preserve explicit paths and parse nested model catalogues', async (t) => {
  let calledUrl = ''
  t.mock.method(globalThis, 'fetch', async (url) => {
    calledUrl = String(url)
    return Response.json({ result: { list: [{ model_name: 'gpt-5.4', display_name: 'GPT 5.4' }] } })
  })
  const models = await api.fetchRemoteModels({ baseUrl: 'https://gateway.example.com/v1', apiKey: 'key' })
  assert.equal(calledUrl, 'https://gateway.example.com/v1/models')
  assert.deepEqual(models.map((model) => model.id), ['gpt-5.4'])
})

test('custom text API accepts array content and SSE chunks', async (t) => {
  const responses = [
    Response.json({ choices: [{ message: { content: [{ type: 'text', text: 'array result' }] } }] }),
    new Response('data: {"choices":[{"delta":{"content":"stream "}}]}\n\ndata: {"choices":[{"delta":{"content":"result"}}]}\n\ndata: [DONE]\n', { headers: { 'content-type': 'text/event-stream' } }),
  ]
  t.mock.method(globalThis, 'fetch', async () => responses.shift())
  const settings = { baseUrl: 'https://gateway.example.com/v1', apiKey: 'key', model: 'gpt-5.4' }
  assert.equal(await api.generateRemoteText(settings, 'hello'), 'array result')
  assert.equal(await api.generateRemoteText(settings, 'hello'), 'stream result')
})

test('custom text API supports copied Responses and native Anthropic Messages endpoints', async (t) => {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) })
    if (String(url).endsWith('/responses')) return Response.json({ output: [{ content: [{ type: 'output_text', text: 'responses ok' }] }] })
    return Response.json({ content: [{ type: 'text', text: 'messages ok' }] })
  })
  assert.equal(await api.generateRemoteText({ baseUrl: 'https://gateway.example.com/v1/responses', apiKey: 'key', model: 'gpt-next' }, 'hello'), 'responses ok')
  assert.equal(await api.generateRemoteText({ baseUrl: 'https://api.anthropic.com/v1/messages', apiKey: 'anthropic-key', model: 'claude-next' }, 'hello'), 'messages ok')
  assert.equal(requests[0].url, 'https://gateway.example.com/v1/responses')
  assert.equal(requests[0].body.input, 'hello')
  assert.equal(requests[1].url, 'https://api.anthropic.com/v1/messages')
  assert.equal(requests[1].headers.get('x-api-key'), 'anthropic-key')
  assert.equal(requests[1].headers.has('authorization'), false)
  assert.equal(requests[1].body.max_tokens, 4096)
})

test('custom text API preserves endpoint queries, configurable auth and native Anthropic images', async (t) => {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) })
    return Response.json({ content: [{ type: 'text', text: 'ok' }] })
  })
  await api.generateRemoteText({
    baseUrl: 'https://azure.example.com/openai/deployments/demo/chat/completions?api-version=2026-01-01',
    apiKey: 'azure-key', authMode: 'api-key', model: 'deployment-model',
  }, 'hello')
  await api.generateRemoteText({ baseUrl: 'https://api.anthropic.com', apiKey: 'anthropic-key', model: 'claude-next' }, 'describe', {
    referenceImages: ['https://cdn.example.com/reference.png'],
  })
  assert.equal(requests[0].url, 'https://azure.example.com/openai/deployments/demo/chat/completions?api-version=2026-01-01')
  assert.equal(requests[0].headers.get('api-key'), 'azure-key')
  assert.equal(requests[0].headers.has('authorization'), false)
  assert.equal(requests[1].url, 'https://api.anthropic.com/v1/messages')
  assert.deepEqual(requests[1].body.messages[0].content[1], { type: 'image', source: { type: 'url', url: 'https://cdn.example.com/reference.png' } })
})

test('Responses SSE prefers the completed text instead of duplicating deltas', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response([
    'data: {"type":"response.output_text.delta","delta":"hel"}',
    'data: {"type":"response.output_text.delta","delta":"lo"}',
    'data: {"type":"response.output_text.done","text":"hello"}',
    'data: [DONE]',
    '',
  ].join('\n\n'), { headers: { 'content-type': 'text/event-stream' } }))
  assert.equal(await api.generateRemoteText({ baseUrl: 'https://gateway.example.com/v1/responses', apiKey: 'key', model: 'gpt-next' }, 'hello'), 'hello')
})

test('custom auth modes are used consistently for image and video requests', async (t) => {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    requests.push({ url: String(url), headers: new Headers(init.headers) })
    if (String(url).endsWith('/images/generations')) return Response.json({ data: [{ url: 'https://cdn.example.com/image.png' }] })
    if (String(url).endsWith('/videos')) return Response.json({ id: 'video-auth-task', status: 'succeeded', url: 'https://cdn.example.com/video.mp4' })
    return new Response(new Blob(['video'], { type: 'video/mp4' }))
  })
  await api.generateRemoteImages({ baseUrl: 'https://gateway.example.com/v1', apiKey: 'google-key', authMode: 'x-goog-api-key', model: 'image-model' }, {
    prompt: 'image', count: 1,
  })
  await api.generateRemoteVideo({ baseUrl: 'https://gateway.example.com/v1', apiKey: 'azure-key', authMode: 'api-key', model: 'video-model' }, {
    prompt: 'video', seconds: 5, size: '16:9', mode: 'text2video',
  })
  assert.equal(requests[0].headers.get('x-goog-api-key'), 'google-key')
  assert.equal(requests[0].headers.has('authorization'), false)
  assert.equal(requests[1].headers.get('api-key'), 'azure-key')
  assert.equal(requests[1].headers.has('authorization'), false)
})

test('HFSY unwraps the image relay URL and surfaces provider parameter rejection', async (t) => {
  let body
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    body = JSON.parse(init.body)
    return Response.json({ success: false, message: '图片 1 格式不支持' })
  })
  await assert.rejects(() => api.generateRemoteVideo({ baseUrl: 'https://api.hfsyapi.cn/v1', apiKey: 'test', model: 'sd-2-mini-720' }, {
    prompt: 'test', seconds: 6, size: '720x1280', mode: 'image2video',
    firstFrame: '/apiyi/media?url=https%3A%2F%2Fwww.qixinai.net%2Fframe.png',
  }), (error) => {
    assert.match(error.message, /拒绝了生成参数/)
    assert.match(error.detail, /格式不支持/)
    return true
  })
  assert.deepEqual(body.images, ['https://www.qixinai.net/frame.png'])
  assert.equal(body.ratio, '9:16')
})

test('archive reader routes existing Qixinai URLs through the relay and preserves original bytes', async (t) => {
  browserGlobal(t, 'window', { setTimeout, clearTimeout, location: { href: 'http://localhost/' } })
  const original = new Blob(['original-image-bytes'], { type: 'image/png' })
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(url)
    return new Response(original)
  })
  const url = 'https://www.qixinai.net/image.png?signature=private'
  const image = await api.readImageSourceBlob(url)
  assert.deepEqual(calls, [`/apiyi/media?url=${encodeURIComponent(url)}`])
  assert.equal(await image.text(), await original.text())
})

test('archive reader repairs mislabeled GIF and PNG MIME types without re-encoding', async (t) => {
  browserGlobal(t, 'window', { setTimeout, clearTimeout, location: { href: 'http://localhost/' } })
  const samples = [
    { bytes: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'), type: 'image/gif' },
    { bytes: Buffer.from('89504e470d0a1a0a', 'hex'), type: 'image/png' },
  ]
  let next = 0
  t.mock.method(globalThis, 'fetch', async () => new Response(samples[next++].bytes, { headers: { 'Content-Type': 'application/octet-stream' } }))
  for (const { bytes, type } of samples) {
    const result = await api.readImageSourceBlob('https://example.test/image')
    assert.equal(result.type, type)
    assert.deepEqual(Buffer.from(await result.arrayBuffer()), bytes)
  }
})

test('local stored image bytes can be prepared without fetching an external or blob URL', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not fetch') })
  browserGlobal(t, 'createImageBitmap', async () => ({ width: 10, height: 10, close() {} }))
  browserGlobal(t, 'FileReader', class {
    readAsDataURL(blob) {
      void blob.arrayBuffer().then((bytes) => {
        this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`
        this.onload()
      })
    }
  })
  const blob = new Blob(['saved-bytes'], { type: 'image/png' })
  assert.equal(await api.prepareReferenceImageForRequest(blob), `data:image/png;base64,${Buffer.from('saved-bytes').toString('base64')}`)
})

test('reference read errors report the host without leaking signed URL parameters', async (t) => {
  browserGlobal(t, 'window', { setTimeout, clearTimeout, location: { href: 'http://localhost/' } })
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch') })
  await assert.rejects(() => api.prepareReferenceImageForRequest('https://www.qixinai.net/image.png?signature=private', undefined, '参考图1'), (error) => {
    assert.match(error.detail, /www\.qixinai\.net/)
    assert.match(error.detail, /同源媒体转发/)
    assert.match(error.detail, /尚未发送/)
    assert.doesNotMatch(error.detail, /signature|private/)
    return true
  })
})

test('HFSY Nano Banana reads Gemini fileData.fileUri generation results', () => {
  const payload = {
    candidates: [{
      content: {
        parts: [{
          fileData: { mimeType: 'image/png', fileUri: 'https://www.qixinai.net/generated/nano-banana.png' },
        }],
      },
    }],
  }
  assert.deepEqual(api.extractImageUrlsFromAdminResult(JSON.stringify(payload)), ['https://www.qixinai.net/generated/nano-banana.png'])
})

test('GRS AI model catalogue uses the host-root getModelList control endpoint', async (t) => {
  let calledUrl = ''
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calledUrl = String(url)
    assert.equal(init?.method, 'POST')
    return Response.json({
      code: 0,
      data: {
        list: [
          { name: 'gpt-image-2', desc: 'image model', maintenance: '' },
          { name: 'gpt-5.4', desc: 'text model', maintenance: '' },
          { name: 'offline-model', maintenance: '维护中' },
        ],
      },
    })
  })
  const models = await api.fetchRemoteModels({ baseUrl: 'https://grsai.dakka.com.cn/v1', apiKey: 'test-key' })
  assert.equal(calledUrl, 'https://grsai.dakka.com.cn/client/serverGrsai/getModelList')
  assert.deepEqual(models.map((model) => model.id), ['gpt-5.4', 'gpt-image-2'])
  assert.equal(models.find((model) => model.id === 'gpt-image-2')?.capability, 'image')
  assert.equal(models.find((model) => model.id === 'gpt-5.4')?.capability, 'text')
  assert.equal(api.isModelAutoEnabled(models.find((model) => model.id === 'gpt-5.4')), true)
})

test('GRS AI model catalogue fails clearly when getModelList is unavailable', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }))
  await assert.rejects(
    () => api.fetchRemoteModels({ baseUrl: 'https://grsaiapi.com/v1', apiKey: 'test-key' }),
    /GRS AI 当前模型目录不可用/,
  )
})

test('completed videos retry relay without provider auth and reject error documents', async (t) => {
  browserGlobal(t, 'window', { setTimeout, clearTimeout, location: { href: 'http://localhost/' } })
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    requests.push({ url: String(url), authorization: new Headers(init.headers).get('x-disylab-media-authorization') })
    if (requests.length === 1) return new Response('forbidden', { status: 403, headers: { 'content-type': 'text/plain' } })
    return new Response(new Blob(['video-bytes'], { type: 'video/mp4' }), { headers: { 'content-type': 'video/mp4' } })
  })
  const blob = await api.downloadGeneratedVideoBlob('https://cdn.aixinai.net/result.mp4', { authorization: 'Bearer key' })
  assert.equal(await blob.text(), 'video-bytes')
  assert.equal(requests[0].authorization, 'Bearer key')
  assert.equal(requests[1].authorization, null)
  assert.match(requests[0].url, /^\/apiyi\/media\?url=/)
})

test('GRS AI balance reports the current API key limit instead of the account pool', async (t) => {
  let calledUrl = ''
  let requestBody
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calledUrl = String(url)
    requestBody = JSON.parse(init.body)
    return Response.json({ code: 0, data: { credits: 30000 } })
  })
  const credits = await api.fetchProviderCredits({ baseUrl: 'https://grsai.dakka.com.cn/v1', apiKey: 'limited-key' })
  assert.equal(calledUrl, 'https://grsai.dakka.com.cn/client/openapi/getAPIKeyCredits')
  assert.deepEqual(requestBody, { apiKey: 'limited-key' })
  assert.equal(credits.amount, 30000)
  assert.equal(credits.scope, 'api-key')
})

test('GRS AI balance falls back to the shared account pool for an unlimited key', async (t) => {
  const calledUrls = []
  t.mock.method(globalThis, 'fetch', async (url) => {
    calledUrls.push(String(url))
    return calledUrls.length === 1
      ? Response.json({ code: 0, data: { credits: 0 } })
      : Response.json({ code: 0, data: { credits: '608575' } })
  })
  const credits = await api.fetchProviderCredits({ baseUrl: 'https://grsai.dakka.com.cn/v1', apiKey: 'shared-key' })
  assert.deepEqual(calledUrls, [
    'https://grsai.dakka.com.cn/client/openapi/getAPIKeyCredits',
    'https://grsai.dakka.com.cn/client/common/getCredits?apikey=shared-key',
  ])
  assert.equal(credits.amount, 608575)
  assert.equal(credits.scope, 'account')
})
