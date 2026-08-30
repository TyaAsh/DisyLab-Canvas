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
  for (const firstFrame of ['data:image/png;base64,AAAA', 'blob:http://localhost/image']) {
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
  assert.equal(api.hfsyVideoLimits('unknown'), undefined)
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
