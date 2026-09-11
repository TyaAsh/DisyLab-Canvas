import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const compile = async (file) => ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const asModule = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const lifecycle = asModule(await compile('./providerLifecycle.ts'))
const catalog = asModule(await compile('./modelCatalog.ts'))
const api = await import(asModule((await compile('./imageApi.ts'))
  .replace("'./providerLifecycle'", JSON.stringify(lifecycle))
  .replaceAll("'./modelCatalog'", JSON.stringify(catalog))))

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
