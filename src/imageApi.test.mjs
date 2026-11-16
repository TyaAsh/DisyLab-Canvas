import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'
import { onRequest as referenceAssets } from '../functions/hfsy/reference-assets.js'

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
const referenceMediaModule = asModule(await compile('./referenceMediaValidation.ts'))
const api = await import(asModule((await compile('./imageApi.ts'))
  .replace("'./referenceMediaValidation'", JSON.stringify(referenceMediaModule))
  .replace("'./providerLifecycle'", JSON.stringify(lifecycle))
  .replace("'./providerTransport'", JSON.stringify(transport))
  .replace("'./apiProviders'", JSON.stringify(providers))
  .replace("'./jimengCli'", JSON.stringify(jimeng))
  .replace("'./museWeb'", JSON.stringify(museWeb))
  .replaceAll("'./modelCatalog'", JSON.stringify(catalog))))

test('HFSY fast-720 recovery queries an existing task and downloads its nested result without a POST', async (t) => {
  const source = 'https://8899c23401e9d8eb6bf66cf5e6a08877.r2.cloudflarestorage.com/video/clean/mock.mp4?signature=mock'
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    requests.push({ url: String(url), method: init.method ?? 'GET', auth: new Headers(init.headers).get('authorization') })
    if (String(url).includes('/video/query?')) return Response.json({ data: [{ status: 'SUCCESS', result: { result_url: source } }] })
    return new Response('mock-video', { headers: { 'Content-Type': 'video/mp4' } })
  })
  const progress = []
  const result = await api.resumeHfsyVideoTask({ baseUrl: 'https://api.hfsyapi.cn/v1', apiKey: 'fake', model: 'sd-2-fast-720' }, 'task-fast-720', {
    onProgress: (percent, status) => progress.push([percent, status]),
  })
  assert.equal(result.sourceUrl, source)
  assert.deepEqual(requests, [
    { url: 'https://api.hfsyapi.cn/v1/video/query?id=task-fast-720', method: 'GET', auth: 'Bearer fake' },
    { url: source, method: 'GET', auth: null },
  ])
  assert.deepEqual(progress.slice(-2), [[100, 'downloading'], [100, 'completed']])
})

test('desktop translates browser relay paths without depending on the dev server', () => {
  const cases = [
    ['/hfsy/v1/image/query/task_1', { 'x-disylab-hfsy-base': 'https://api.hfsyapi.cn/v1' }, 'https://api.hfsyapi.cn/v1/image/query/task_1'],
    ['/hfsy/__root__/api/pricing', { 'x-disylab-hfsy-base': 'https://www.hfsyapi.cn/v1' }, 'https://www.hfsyapi.cn/api/pricing'],
    ['/apiyi/seedance/v1/contents/generations/tasks', { 'x-disylab-apiyi-origin': 'https://vip.apiyi.com' }, 'https://vip.apiyi.com/v1/contents/generations/tasks'],
    ['/visionary/tasks/job_1', {}, 'https://api.visionary.beer/v1/tasks/job_1'],
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

test('HFSY can read a local reference through KV and the link expires automatically', async (t) => {
  const endpoint = 'https://disylab-hfsy-media.pages.dev/hfsy/reference-assets'
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64')
  const objects = new Map()
  const env = { HFSY_REFERENCE_ASSETS: {
    async put(key, value, { expirationTtl, metadata }) {
      assert.equal(expirationTtl, 14_400)
      objects.set(key, { value, metadata })
    },
    async getWithMetadata(key) {
      return objects.get(key) ?? { value: null, metadata: null }
    },
  } }
  const route = (request) => referenceAssets({ request, env })
  let submittedUrl
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url) === endpoint) return route(new Request(url, init))
    if (String(url) === 'https://www.hfsyapi.cn/v1/models') {
      assert.equal(new Headers(init.headers).get('authorization'), 'Bearer test-key')
      return Response.json({ data: [{ id: 'sd-2-fast-720' }] })
    }
    if (String(url).endsWith('/video/create')) {
      submittedUrl = JSON.parse(init.body).images[0]
      const reference = await route(new Request(submittedUrl))
      assert.equal(reference.status, 200)
      assert.equal(reference.headers.get('content-type'), 'image/png')
      assert.deepEqual(Buffer.from(await reference.arrayBuffer()), png)
      return Response.json({ id: 'task-with-local-image', status: 'SUCCESS', result_url: 'https://media.aixinai.net/result.mp4' })
    }
    if (String(url).includes('result.mp4')) return new Response('video', { headers: { 'content-type': 'video/mp4' } })
    throw new Error('Unexpected request')
  })
  const settings = { baseUrl: 'https://www.hfsyapi.cn/v1', apiKey: 'test-key', model: 'sd-2-fast-720' }
  const url = await api.publishHfsyReferenceImage(settings, new Blob([png], { type: 'image/png' }))
  assert.equal(objects.size, 1)
  await api.generateRemoteVideo(settings, { prompt: 'test', seconds: 6, size: '1280x720', mode: 'image2video', firstFrame: url })
  assert.equal(submittedUrl, url)
  for (const item of objects.values()) item.metadata.expiresAt = Date.now() - 1
  assert.equal((await route(new Request(url))).status, 404)
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

test('video recovery reopens an expired result with the original vendor and never resubmits', async (t) => {
  const requests = []
  browserGlobal(t, 'window', {
    location: { href: 'http://localhost/' },
    setTimeout: (callback) => setTimeout(callback, 0),
    clearTimeout,
  })
  const oldUrl = 'https://old.example.test/clip.mp4'
  const newUrl = 'https://new.example.test/clip.mp4'
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    url = String(url)
    requests.push([url, init.method ?? 'GET', new Headers(init.headers).get('authorization')])
    if (url === '/provider/xai/v1/videos/task-42') return Response.json({ status: 'done', video: { url: newUrl } })
    if (url === `/apiyi/media?url=${encodeURIComponent(newUrl)}`) return new Response('full video', { headers: { 'Content-Type': 'video/mp4' } })
    return new Response('expired', { status: 403 })
  })
  const result = await api.readRecoverableVideo({
    sourceUrl: oldUrl, taskId: 'task-42',
    settings: { baseUrl: 'https://api.x.ai/v1', model: 'grok-imagine-video-1.5', apiKey: 'vendor-key' },
  })
  assert.equal(result.sourceUrl, newUrl)
  assert.equal(await result.blob.text(), 'full video')
  assert.ok(requests.every(([, method]) => method === 'GET'))
  assert.deepEqual(requests.filter(([, , authorization]) => authorization), [['/provider/xai/v1/videos/task-42', 'GET', 'Bearer vendor-key']])
})

test('video recovery uses each provider task and content route with the original authentication mode', async (t) => {
  const requests = []
  const fixtures = {
    'https://example.test/v1/videos/task-a': { status: 'completed' },
    'https://api.minimaxi.com/v1/query/video_generation?task_id=task-a': { status: 'success', file_id: 'file-a' },
    'https://api.minimaxi.com/v1/files/retrieve?file_id=file-a': { file: { download_url: 'https://media.example.test/full.mp4' } },
    'https://api.apiyi.com/v1/tasks/task-a': { status: 'succeeded', output: { video_url: 'https://media.example.test/full.mp4' } },
    'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/task-a': { status: 'succeeded', content: { video_url: 'https://media.example.test/full.mp4' } },
  }
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    url = String(url)
    requests.push([url, init.method ?? 'GET', new Headers(init.headers)])
    if (url in fixtures) return Response.json(fixtures[url])
    if (url === 'https://media.example.test/full.mp4' || url.endsWith('/videos/task-a/content')) {
      return new Response('video', { headers: { 'Content-Type': 'video/mp4' } })
    }
    throw new Error(`Unexpected URL ${url}`)
  })
  for (const [baseUrl, model] of [
    ['https://example.test/v1', 'custom-video'],
    ['https://api.minimaxi.com/v1', 'MiniMax-Hailuo-02'],
    ['https://api.apiyi.com/v1', 'wan2.6'],
    ['https://ark.cn-beijing.volces.com/api/v3', 'doubao-seedance'],
  ]) {
    const result = await api.recoverGeneratedVideoTask({ baseUrl, model, apiKey: 'provider-key', authMode: 'x-api-key' }, 'task-a')
    assert.equal(await result.blob.text(), 'video')
  }
  assert.ok(requests.every(([, method]) => method === 'GET'))
  assert.equal(requests[1][2].get('x-api-key'), 'provider-key')
  assert.ok(requests.filter(([url]) => url === 'https://media.example.test/full.mp4').every(([, , headers]) => !headers.has('authorization') && !headers.has('x-api-key')))
})

test('video downloads reject partial responses and can read local blob URLs without a relay', async (t) => {
  browserGlobal(t, 'window', {
    location: { href: 'http://localhost/' },
    setTimeout: (callback) => setTimeout(callback, 0),
    clearTimeout,
  })
  const seen = []
  t.mock.method(globalThis, 'fetch', async (url) => {
    seen.push(String(url))
    if (String(url).startsWith('blob:')) return new Response('local video', { headers: { 'Content-Type': 'video/mp4' } })
    return new Response('part', { status: 206, headers: { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-3/100' } })
  })
  assert.equal(await (await api.downloadGeneratedVideoBlob('blob:http://localhost/video')).text(), 'local video')
  assert.deepEqual(seen, ['blob:http://localhost/video'])
  await assert.rejects(() => api.downloadGeneratedVideoBlob('https://cdn.example.test/video.mp4'), (error) => {
    assert.match(error.detail, /partial-video/)
    return true
  })
})

test('HFSY publishes a local MP4 before creating an omni video task and serves byte ranges', async (t) => {
  const endpoint = 'https://disylab-hfsy-media.pages.dev/hfsy/reference-assets'
  const video = Buffer.from('000000186674797069736f6d0000000069736f6d6d703432', 'hex')
  const assets = new Map()
  const env = { HFSY_REFERENCE_ASSETS: {
    async put(key, value, { metadata }) { assets.set(key, { value, metadata }) },
    async getWithMetadata(key) { return assets.get(key) ?? { value: null, metadata: null } },
  } }
  const route = (request) => referenceAssets({ request, env })
  let submitted = false
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url) === endpoint) return route(new Request(url, init))
    if (String(url) === 'https://www.hfsyapi.cn/v1/models') return Response.json({ data: [{ id: 'sd-2-fast-480' }] })
    if (String(url).endsWith('/video/create')) {
      const body = JSON.parse(init.body)
      const published = body.videos[0]
      const full = await route(new Request(published))
      assert.equal(full.headers.get('content-type'), 'video/mp4')
      assert.deepEqual(Buffer.from(await full.arrayBuffer()), video)
      const part = await route(new Request(published, { headers: { Range: 'bytes=4-7' } }))
      assert.equal(part.status, 206)
      assert.equal(part.headers.get('content-range'), 'bytes 4-7/24')
      assert.equal(await part.text(), 'ftyp')
      const invalid = await route(new Request(published, { headers: { Range: 'bytes=200-' } }))
      assert.equal(invalid.status, 416)
      submitted = true
      return Response.json({ id: 'task-local-video', status: 'SUCCESS', result_url: 'https://media.aixinai.net/result.mp4' })
    }
    if (String(url).includes('result.mp4')) return new Response('video', { headers: { 'content-type': 'video/mp4' } })
    throw new Error('Unexpected request')
  })
  const settings = { baseUrl: 'https://www.hfsyapi.cn/v1', apiKey: 'test-key', model: 'sd-2-fast-480' }
  const published = await api.publishHfsyVideoReferenceVideo(settings, new Blob([video], { type: 'video/mp4' }))
  await api.generateRemoteVideo(settings, { prompt: 'test', seconds: 8, size: '1008x480', aspectRatio: '21:9', resolution: '480p', mode: 'all_reference', referenceVideos: [published] })
  assert.equal(submitted, true)
})

test('HFSY local video preflight enforces the relay format and upload size', async () => {
  const { referenceMediaIssue } = await import(asModule(await compile('./referenceMediaValidation.ts')))
  const rules = api.videoReferenceRules('https://api.hfsyapi.cn/v1', 'sd-2-fast-480')
  const local = rules.media({ kind: 'video', mediaId: 'local-clip' })
  assert.equal(local.publicOnly, false)
  assert.equal(local.requireReadable, true)
  assert.match(referenceMediaIssue({ type:'video/webm' }, local), /MP4、MOV/)
  assert.match(referenceMediaIssue({ type:'video/mp4', bytes:25 * 1024 ** 2 }, local), /24 MB/)
  assert.equal(referenceMediaIssue({ type:'video/mp4', bytes:4 * 1024 ** 2, duration:5 }, local), undefined)
  const remote = rules.media({ kind: 'video', publicUrl:'https://example.test/video.mp4' })
  assert.equal(referenceMediaIssue({ type:'video/mp4', bytes:25 * 1024 ** 2, duration:5 }, remote), undefined)
})

test('reference rules report model limits with the actual image or video dimensions', async () => {
  const { referenceMediaIssue } = await import(asModule(await compile('./referenceMediaValidation.ts')))
  const ark = api.videoReferenceRules('https://ark.cn-beijing.volces.com/api/v3', 'doubao-seedance-2.0')
  assert.match(referenceMediaIssue({ width: 2700, height: 900 }, ark.media({ kind: 'image' })), /宽高比须在 0.4 到 2.5/)
  assert.equal(referenceMediaIssue({ width: 1200, height: 900 }, ark.media({ kind: 'image' })), undefined)
  assert.match(referenceMediaIssue({ width: 640, height: 480, duration: 5 }, ark.media({ kind: 'video' })), /总像素数须在 407,696 到 8,295,044/)
  const hfsy = api.videoReferenceRules('https://www.hfsyapi.cn/v1', 'minimax-h3')
  assert.equal(hfsy.videos, 0)
  assert.equal(hfsy.minImages, 1)
  assert.match(referenceMediaIssue({ width: 900, height: 900, bytes: 21 * 1024 ** 2 }, hfsy.media({ kind: 'image' })), /不能超过 20 MB/)
  assert.equal(api.videoReferenceRules('https://grsaiapi.com/v1', 'minimax-h3').frames, false)
  assert.equal(api.videoReferenceRules('https://api.x.ai/v1', 'grok-imagine-video-1.5').videos, 0)
})

test('HFSY Seedream 5.5 exposes 2K and six references and sends a native image request', async (t) => {
  const settings = { baseUrl: 'https://www.hfsyapi.cn/v1', apiKey: 'test', model: 'seedream-5.5' }
  const caps = api.getHfsyImageCapabilities(settings.baseUrl, settings.model)
  assert.deepEqual(caps.resolutions, ['2K'])
  assert.equal(caps.images, 6)
  assert.equal(api.imageReferenceRules(settings.baseUrl, settings.model).totals.maxImageBytes, 25 * 1024 ** 2)
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests.push([String(url), JSON.parse(init.body)])
    return Response.json({ status: 'completed', images: [{ url: 'https://example.test/output.png' }] })
  })
  const options = { prompt: 'draw', count: 1, aspectRatio: '16:9', resolution: '2K', referenceImages: ['https://example.test/reference.png'] }
  await assert.rejects(() => api.generateRemoteImages(settings, { ...options, referenceImages: Array(7).fill(options.referenceImages[0]) }), { detail: /最多支持 6 张参考图/ })
  assert.equal(requests.length, 0)
  assert.deepEqual((await api.generateRemoteImages(settings, options)).map(({ url }) => url), ['https://example.test/output.png'])
  assert.deepEqual(requests, [[
    'https://www.hfsyapi.cn/v1/image/create',
    { model: settings.model, prompt: 'draw', size: '2048x1152', reference_images: options.referenceImages },
  ]])
})


test('HFSY H3 preflight and relay accept JPEG bytes from old records with missing or incorrect MIME', async (t) => {
  const { checkReferenceMedia, imageMimeFromBytes } = await import(referenceMediaModule)
  const baseUrl = 'https://www.hfsyapi.cn/v1'
  const model = 'minimax-h3'
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])
  const media = { kind: 'image', mediaId: 'old-image' }
  const uploaded = 'https://disylab-hfsy-media.pages.dev/hfsy/reference-assets?id=test'
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(new URL(url).pathname, '/hfsy/reference-assets')
    assert.equal(new Headers(init.headers).get('Content-Type'), 'image/jpeg')
    assert.deepEqual(new Uint8Array(await init.body.arrayBuffer()), bytes)
    return Response.json({ url: uploaded }, { status: 201 })
  })
  for (const type of ['', 'application/octet-stream', 'image/jpg', 'image/png']) {
    const stored = new Blob([bytes], { type })
    assert.equal(await imageMimeFromBytes(stored), 'image/jpeg')
    assert.equal(await checkReferenceMedia([media], api.videoReferenceRules(baseUrl, model).media, async () => stored, new AbortController().signal), undefined)
    assert.equal(await api.publishHfsyReferenceImage({ baseUrl, apiKey: 'mock' }, stored), uploaded)
  }
})

test('preflight skips unavailable remote measurements and keeps relay rules separate from Ark', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 403 }))
  const { checkReferenceMedia } = await import(referenceMediaModule)
  const ark = api.videoReferenceRules('https://ark.cn-beijing.volces.com/api/v3', 'doubao-seedance-2.0')
  const remote = { kind: 'image', url: 'https://example.test/preview', publicUrl: 'https://example.test/source' }
  assert.equal(await checkReferenceMedia([remote], ark.media, async () => undefined, new AbortController().signal), undefined)
  const hfsy = api.videoReferenceRules('https://www.hfsyapi.cn/v1', 'doubao-seedance-2.0')
  assert.equal(hfsy.media({ kind: 'image' }).ratio, undefined)
  assert.equal(hfsy.media({ kind: 'video' }).pixels, undefined)
  const apiYi = api.videoReferenceRules('https://api.apiyi.com/v1', 'doubao-seedance-2.0')
  assert.equal(apiYi.media({ kind: 'video' }).pixels, undefined)
  const hfsy25 = api.videoReferenceRules('https://www.hfsyapi.cn/v1', 'sd-2.5-720')
  assert.deepEqual(hfsy25.media({ kind: 'image' }).ratio, [0.4, 2.5])
  assert.deepEqual(hfsy25.media({ kind: 'image' }).side, [300, 6000])
  assert.equal(hfsy25.media({ kind: 'video' }).pixels, undefined)
  const officialH3 = api.videoReferenceRules('https://api.minimaxi.com/v1', 'MiniMax-H3')
  assert.deepEqual(officialH3.media({ kind: 'image' }).side, [256, 5760])
  assert.equal(api.videoReferenceRules('https://www.hfsyapi.cn/v1', 'minimax-h3').media({ kind: 'image' }).side, undefined)
  assert.equal(api.videoReferenceRules('https://api.apiyi.com/v1', 'wan2.7-r2v').maxAssets, 5)
  const custom = api.videoReferenceRules('https://example.test/v1', 'provider-specific-model')
  assert.equal(custom.images, undefined)
  assert.equal(custom.videos, undefined)
})

test('APIYI Veo sends both frames under input_reference and recovers binary or linked videos', async (t) => {
  const baseUrl = 'https://api.apiyi.com/v1'
  const settings = { baseUrl, model: 'veo-3.1-landscape-fl', apiKey: 'apiyi-key' }
  const firstFrame = 'https://media.example.test/first'
  const lastFrame = 'https://media.example.test/last'
  const video = 'https://veo-video.gptkey.asia/assets/flow/clip.mp4'
  const calls = []
  browserGlobal(t, 'window', { location: { href: 'http://localhost/' }, setTimeout: (callback) => setTimeout(callback, 0), clearTimeout })
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    url = String(url)
    const headers = new Headers(init.headers)
    calls.push([url, init.method ?? 'GET', headers.get('authorization')])
    if (url === firstFrame) return new Response(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), { headers: { 'Content-Type': 'image/png' } })
    if (url === lastFrame) return new Response(Buffer.from('89504e470d0a1a0a', 'hex'))
    if (url === '/apiyi/veo/v1/videos') {
      assert.equal(headers.get('content-type'), null)
      assert.deepEqual(init.body.getAll('input_reference').map(({ name, type }) => [name, type]), [
        ['frame-1.jpg', 'image/jpeg'], ['frame-2.png', 'image/png'],
      ])
      return Response.json({ id: 'veo-one', status: 'queued' })
    }
    if (url.endsWith('/videos/veo-one')) return Response.json({ status: 'completed' })
    if (url.endsWith('/veo-one/content')) return Response.json({ url: video })
    if (url.endsWith('/veo-two/content') || url === `/apiyi/media?url=${encodeURIComponent(video)}`) {
      assert.equal(headers.has('authorization'), url.endsWith('/content'))
      return new Response('mp4 bytes', { headers: { 'Content-Type': 'video/mp4' } })
    }
    throw new Error(`Unexpected URL ${url}`)
  })
  const taskIds = []
  const options = { prompt: 'test', seconds: 8, size: '1280x720', mode: 'first_last_frame', firstFrame, lastFrame }
  const generated = await api.generateRemoteVideo(settings, { ...options, onTaskId: (id) => taskIds.push(id) })
  assert.deepEqual(taskIds, ['veo-one'])
  assert.equal(generated.sourceUrl, video)
  assert.equal(await generated.blob.text(), 'mp4 bytes')
  assert.equal(await (await api.recoverGeneratedVideoTask(settings, 'veo-two')).blob.text(), 'mp4 bytes')
  await assert.rejects(() => api.generateRemoteVideo({ ...settings, model: 'veo-3.1' }, options), /模式不匹配/)
  assert.equal(calls.filter(([, method]) => method === 'POST').length, 1)
  assert.equal(api.videoReferenceRules(baseUrl, settings.model).framesOnly, true)
  assert.equal(api.videoReferenceRules(baseUrl, 'veo-3.1').textOnly, true)
})

test('constant-rate MP4 metadata enforces the documented FPS without trusting stale MIME', async (t) => {
  const { checkReferenceMedia, readIsoVideoFrameRate, referenceMediaIssue } = await import(referenceMediaModule)
  const box = (type, ...children) => {
    const data = Buffer.concat(children)
    const header = Buffer.alloc(8)
    header.writeUInt32BE(data.byteLength + 8)
    header.write(type, 4, 'ascii')
    return Buffer.concat([header, data])
  }
  const video = (ticks, entries = 1) => {
    const timescale = Buffer.alloc(24)
    timescale.writeUInt32BE(30_000, 12)
    const handler = Buffer.alloc(24)
    handler.write('vide', 8, 'ascii')
    const timing = Buffer.alloc(8 + entries * 8)
    timing.writeUInt32BE(entries, 4)
    timing.writeUInt32BE(45, 8)
    timing.writeUInt32BE(ticks, 12)
    return Buffer.concat([box('ftyp', Buffer.from('isom0000')), box('moov', box('trak',
      box('mdia', box('hdlr', handler), box('mdhd', timescale), box('minf', box('stbl', box('stts', timing)))),
    ))])
  }
  assert.equal(await readIsoVideoFrameRate(new Blob([video(1_200)])), 25)
  assert.equal(await readIsoVideoFrameRate(new Blob([video(2_000, 2)])), undefined)
  const bytes = video(2_000)
  const url = 'https://media.example.test/input.mp4'
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    assert.equal(new Headers(init.headers).get('Range'), 'bytes=0-262143')
    return new Response(bytes, { status: 206, headers: { 'Content-Range': `bytes 0-${bytes.length - 1}/${bytes.length}`, 'Content-Type': 'application/octet-stream' } })
  })
  const rules = api.videoReferenceRules('https://ark.cn-beijing.volces.com/api/v3', 'doubao-seedance-2-0-260128')
  assert.match(await checkReferenceMedia([{ kind: 'video', url, publicUrl: url }], rules.media, async () => undefined, new AbortController().signal), /24 到 60 FPS.*15 FPS/)
  assert.match(referenceMediaIssue({ width: 420, height: 720 }, rules.media({ kind: 'video' })), /407,696 到 8,295,044/)
})

test('Google Omni uploads the reference to Google Files and resumes the Interaction without another POST', async (t) => {
  const origin = 'https://generativelanguage.googleapis.com'
  const settings = { baseUrl: `${origin}/v1beta/openai`, model: 'gemini-omni-1.2-flash', apiKey: 'gemini-key' }
  browserGlobal(t, 'window', { location: { href: 'http://localhost/' }, setTimeout: (callback) => setTimeout(callback, 0), clearTimeout })
  const source = 'blob:http://localhost/omni-reference'
  const upload = `${origin}/upload/v1beta/files?upload_id=mock`
  const interaction = `${origin}/v1beta/interactions`
  const calls = []
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = String(input)
    const headers = new Headers(init.headers)
    calls.push([url, init.method ?? 'GET', headers.get('x-goog-api-key')])
    if (url === source) return new Response('input bytes', { headers: { 'content-type': 'video/mp4' } })
    if (url === `${origin}/upload/v1beta/files`) {
      assert.equal(headers.get('x-goog-upload-header-content-type'), 'video/mp4')
      return new Response('{}', { headers: { 'x-goog-upload-url': upload } })
    }
    if (url === upload) {
      assert.equal(headers.get('x-goog-api-key'), null)
      assert.equal(headers.get('x-goog-upload-command'), 'upload, finalize')
      assert.equal(await init.body.text(), 'input bytes')
      return Response.json({ file: { name: 'files/source-video', state: 'PROCESSING' } })
    }
    if (url === `${origin}/v1beta/files/source-video`) return Response.json({ state: 'ACTIVE' })
    if (url === interaction) {
      const { input, response_format, generation_config, background, store } = JSON.parse(init.body)
      assert.deepEqual(input, [
        { type: 'video', mime_type: 'video/mp4', uri: `${origin}/v1beta/files/source-video` },
        { type: 'text', text: 'test' },
      ])
      assert.deepEqual(response_format, { type: 'video', aspect_ratio: '9:16', duration: '9s', resolution: '1080p', delivery: 'uri' })
      assert.equal(generation_config.video_config.task, 'reference_to_video')
      assert.equal(background && store, true)
      return Response.json({ id: 'v1_omni', status: 'in_progress' })
    }
    if (url === `${interaction}/v1_omni`) return Response.json({
      id: 'v1_omni', status: 'completed', steps: [{ type: 'model_output', content: [{
        type: 'video', mime_type: 'video/mp4', data: Buffer.from('output bytes').toString('base64'),
      }] }],
    })
    if (url === `${interaction}/v1_uri`) return Response.json({
      id: 'v1_uri', status: 'completed', output_video: { uri: `${origin}/v1beta/files/result-video:download?alt=media` },
    })
    if (url === `${origin}/v1beta/files/result-video`) return Response.json({ state: 'ACTIVE' })
    if (url === `${origin}/v1beta/files/result-video:download?alt=media`) return new Response('result bytes', { headers: { 'content-type': 'video/mp4' } })
    throw new Error(`Unexpected URL ${url}`)
  })
  assert.equal(api.inferModelCapability(settings.model), 'video')
  assert.equal(api.isModelAutoEnabled({ ...settings, id: settings.model, name: 'Omni', capability: 'video' }), true)
  assert.match(api.videoReferenceSettingsIssue(settings.baseUrl, settings.model, 'first_last_frame', 12, 0), /3 到 10 秒/)
  assert.match(api.videoReferenceSettingsIssue(settings.baseUrl, settings.model, 'all_reference', 12, 2), /最多可用 1 个/)
  assert.deepEqual(api.videoReferenceRules(settings.baseUrl, settings.model).media({ kind: 'video' }).seconds, [0, 3])
  const tasks = []
  const result = await api.generateRemoteVideo(settings, {
    prompt: 'test', seconds: 9, size: '1080x1920', aspectRatio: '9:16', resolution: '1080p',
    mode: 'all_reference', referenceVideos: [source], onTaskId: (id) => tasks.push(id),
  })
  assert.deepEqual(tasks, ['v1_omni'])
  assert.equal(await result.blob.text(), 'output bytes')
  const before = calls.length
  assert.equal(await (await api.recoverGeneratedVideoTask(settings, result.taskId)).blob.text(), 'output bytes')
  assert.equal(await (await api.recoverGeneratedVideoTask(settings, 'v1_uri')).blob.text(), 'result bytes')
  assert.ok(calls.slice(before).every(([, method]) => method === 'GET'))
  assert.ok(calls.filter(([, , key]) => key).every(([url]) => url.startsWith(origin + '/')))
})

test('xAI video editing accepts local MP4 and uses only the documented edit fields', async (t) => {
  const source = 'blob:http://localhost/xai-reference'
  const clip = Buffer.from('000000146674797069736f6d0000000069736f6d', 'hex')
  const expected = `data:video/mp4;base64,${clip.toString('base64')}`
  browserGlobal(t, 'window', { location: { href: 'http://localhost/' }, setTimeout: (callback) => setTimeout(callback, 0), clearTimeout })
  browserGlobal(t, 'FileReader', class {
    readAsDataURL(blob) {
      void blob.arrayBuffer().then((bytes) => {
        this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`
        this.onload()
      })
    }
  })
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    if (url === source) return new Response(clip, { headers: { 'Content-Type': 'application/octet-stream' } })
    if (url === '/provider/xai/v1/videos/edits') {
      assert.deepEqual(JSON.parse(init.body), { model: 'grok-imagine-video', prompt: 'test', video: { url: expected } })
      return Response.json({ request_id: 'edit-one' })
    }
    if (url === '/provider/xai/v1/videos/edit-one') return Response.json({ status: 'done', video: { url: 'https://vidgen.x.ai/result.mp4' } })
    return new Response('edited bytes', { headers: { 'Content-Type': 'video/mp4' } })
  })
  const settings = { baseUrl: 'https://api.x.ai/v1', model: 'grok-imagine-video', apiKey: 'xai-key' }
  const rules = api.videoReferenceRules(settings.baseUrl, settings.model)
  assert.equal(rules.media({ kind: 'video' }).publicOnly, undefined)
  const result = await api.generateRemoteVideo(settings, { prompt: 'test', seconds: 5, size: '16:9', mode: 'all_reference', referenceVideos: [source] })
  assert.equal(await result.blob.text(), 'edited bytes')
})

test('APIMart uploads the local first frame, saves the task ID and archives the returned video URL', async (t) => {
  const settings = { baseUrl: 'https://api.apimart.ai/v1', model: 'apimart-zoe', apiKey: 'apimart-key' }
  const image = 'blob:http://localhost/apimart-reference'
  const hosted = 'https://media.example.test/first.png'
  const video = 'https://media.example.test/result.mp4'
  const calls = []
  browserGlobal(t, 'window', { location: { href: 'http://localhost/' }, setTimeout: (callback) => setTimeout(callback, 0), clearTimeout })
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    calls.push([url, init.method ?? 'GET'])
    if (url === image) return new Response(Buffer.from('89504e470d0a1a0a', 'hex'), { headers: { 'Content-Type': 'image/png' } })
    if (url === '/provider/apimart/v1/uploads/images?retention_days=3') {
      assert.equal(init.body.get('file').type, 'image/png')
      return Response.json({ data: { url: hosted } })
    }
    if (url === '/provider/apimart/v1/videos/generations') {
      assert.deepEqual(JSON.parse(init.body), {
        model: 'apimart-zoe', prompt: 'test', duration: 8, size: 'adaptive', resolution: '720p',
        image_with_roles: [{ url: hosted, role: 'first_frame' }],
      })
      return Response.json({ code: 200, data: [{ status: 'submitted', task_id: 'task_zoe' }] })
    }
    if (url === '/provider/apimart/v1/tasks/task_zoe') return Response.json({ code: 200, data: { status: 'completed', result: { videos: [{ url: [video] }] } } })
    if (url === `/apiyi/media?url=${encodeURIComponent(video)}`) {
      assert.equal(new Headers(init.headers).get('authorization'), null)
      return new Response('archived video', { headers: { 'Content-Type': 'video/mp4' } })
    }
    throw new Error(`Unexpected URL ${url}`)
  })
  const taskIds = []
  const result = await api.generateRemoteVideo(settings, { prompt: 'test', seconds: 8, size: '1280x720', mode: 'image2video', firstFrame: image, onTaskId: (id) => taskIds.push(id) })
  assert.deepEqual(taskIds, ['task_zoe'])
  assert.equal(await result.blob.text(), 'archived video')
  assert.equal(await (await api.recoverGeneratedVideoTask(settings, result.taskId)).blob.text(), 'archived video')
  assert.equal(calls.filter(([, method]) => method === 'POST').length, 2)
  assert.deepEqual(api.videoReferenceRules(settings.baseUrl, settings.model).media({ kind: 'video' }).pixels, [409600, 8295044])
})

test('Google Nano Banana preflight and native edit use the documented interactions image fields', async (t) => {
  const settings = { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-nano-banana-2.1', apiKey: 'gemini-key' }
  const image = 'blob:http://localhost/google-image'
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString('base64')
  browserGlobal(t, 'window', { location: { href: 'http://localhost/' }, setTimeout, clearTimeout })
  browserGlobal(t, 'FileReader', class {
    readAsDataURL(blob) {
      void blob.arrayBuffer().then((bytes) => {
        this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`
        this.onload()
      })
    }
  })
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    if (url === image) return new Response(Buffer.from(jpeg, 'base64'), { headers: { 'content-type': 'image/png' } })
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/interactions')
    assert.equal(new Headers(init.headers).get('x-goog-api-key'), 'gemini-key')
    assert.deepEqual(JSON.parse(init.body), {
      model: settings.model,
      input: [{ type: 'text', text: 'edit' }, { type: 'image', mime_type: 'image/jpeg', data: jpeg }],
      response_format: { type: 'image', mime_type: 'image/png', image_size: '2K', aspect_ratio: '4:3' },
    })
    return Response.json({ status: 'completed', output_image: { type: 'image', mime_type: 'image/png', data: 'bW9jaw==' } })
  })
  assert.equal(api.imageReferenceRules(settings.baseUrl, settings.model).count, 14)
  const result = await api.generateRemoteImages(settings, { prompt: 'edit', count: 1, referenceImages: [image], resolution: '2K', aspectRatio: '4:3' })
  assert.deepEqual(result, [{ url: 'data:image/png;base64,bW9jaw==' }])
})

test('APIMart uploads a local reference clip before requesting Kling 4 Flash', async (t) => {
  const settings = { baseUrl: 'https://api.apimart.ai/v1', model: 'kling-v4-flash', apiKey: 'apimart-key' }
  const local = 'blob:http://localhost/kling-clip'
  const uploaded = 'https://media.example.test/clip.mp4'
  const resultUrl = 'https://media.example.test/result.mp4'
  const clip = Buffer.from('000000146674797069736f6d0000000069736f6d', 'hex')
  browserGlobal(t, 'window', { location: { href: 'http://localhost/' }, setTimeout: (callback) => setTimeout(callback, 0), clearTimeout })
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    if (url === local) return new Response(clip, { headers: { 'Content-Type': 'application/octet-stream' } })
    if (url === '/provider/apimart/v1/uploads/videos?retention_days=3') {
      assert.equal(init.body.get('file').type, 'video/mp4')
      assert.deepEqual(Buffer.from(await init.body.get('file').arrayBuffer()), clip)
      return Response.json({ url: uploaded })
    }
    if (url === '/provider/apimart/v1/videos/generations') {
      const { video_urls, omni_reference_task_type } = JSON.parse(init.body)
      assert.deepEqual(video_urls, [uploaded])
      assert.equal(omni_reference_task_type, 'reference')
      return Response.json({ code: 200, data: [{ status: 'submitted', task_id: 'task_kling' }] })
    }
    if (url === '/provider/apimart/v1/tasks/task_kling') return Response.json({ data: { status: 'completed', result: { videos: [{ url: [resultUrl] }] } } })
    if (url === `/apiyi/media?url=${encodeURIComponent(resultUrl)}`) return new Response('ready video', { headers: { 'Content-Type': 'video/mp4' } })
    throw new Error(`Unexpected URL ${url}`)
  })
  const rules = api.videoReferenceRules(settings.baseUrl, settings.model)
  assert.equal(rules.frames, false)
  assert.equal(rules.totals.maxVideoSeconds, 20)
  assert.equal(rules.media({ kind: 'video', url: local }).maxMB, 50)
  assert.equal(rules.media({ kind: 'video', url: uploaded }).maxMB, undefined)
  const result = await api.generateRemoteVideo(settings, { prompt: 'test', seconds: 5, size: '16:9', mode: 'all_reference', referenceVideos: [local] })
  assert.equal(await result.blob.text(), 'ready video')
})
