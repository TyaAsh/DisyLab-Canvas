import assert from 'node:assert/strict'
import test from 'node:test'
import { extractSharedMedia, fetchSharedMedia, parseSharedMediaUrl, resolveSharedPost } from './sharedMedia.ts'
import { fillWatermarkPatch, suggestWatermarkRegion } from './videoWatermark.ts'

const scene = (positions) => {
  const width = 160, height = 90
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const mark = positions.some(([left, top]) => x >= left && x < left + 20 && y >= top && y < top + 6)
    data.set(mark ? [255, 255, 255, 255] : [34, 100, 102, 255], (y * width + x) * 4)
  }
  return { width, height, data }
}

test('detects a small, persistent corner mark but leaves shifting or ambiguous marks for manual selection', () => {
  const first = scene([[127, 77]])
  const selection = suggestWatermarkRegion([first, scene([[127, 77]])])
  assert.ok(selection)
  assert.ok(selection.x * first.width < 127)
  assert.ok((selection.x + selection.width) * first.width > 146)
  assert.equal(suggestWatermarkRegion([first, scene([[10, 6]])]), undefined)
  assert.equal(suggestWatermarkRegion([scene([[127, 77], [10, 6]])]), undefined)
  assert.equal(suggestWatermarkRegion([scene([])]), undefined)
})

test('reconstructs the selected area from the outer edges without modifying exterior pixels', () => {
  const source = scene([[127, 77]])
  const original = source.data.slice()
  fillWatermarkPatch(source, { left: 124, right: 150, top: 74, bottom: 86 })
  const pixel = (x, y) => [...source.data.slice((y * source.width + x) * 4, (y * source.width + x) * 4 + 4)]
  assert.deepEqual(pixel(133, 79), [34, 100, 102, 255])
  assert.deepEqual(source.data.slice(0, 74 * source.width * 4), original.slice(0, 74 * source.width * 4))
})

test('reads copied share text and extracts each image in a note without treating its poster as another image', async () => {
  const short = parseSharedMediaUrl('打开小红书 http://xhslink.com/a/example，复制此条消息')
  assert.equal(short.href, 'https://xhslink.com/a/example')
  const html = `<meta property="og:image" content="https://sns-webpic.xhscdn.com/cover"><script>window.__INITIAL_STATE__={"note":{"noteDetailMap":{"abc":{"note":{"type":"normal","imageList":[{"urlDefault":"https://sns-webpic.xhscdn.com/a"},{"urlDefault":"https://sns-webpic.xhscdn.com/b"}]}}}},"unused":undefined};</script>`
  const results = await resolveSharedPost(short.href, async (url) => url.includes('xhslink.com')
    ? Response.redirect('https://www.xiaohongshu.com/explore/abc') : new Response(html))
  assert.deepEqual(results.map(({ kind, url }) => [kind, url]), [['image', 'https://sns-webpic.xhscdn.com/a'], ['image', 'https://sns-webpic.xhscdn.com/b']])
})

test('reads a public video result and does not return the cover when the video is unavailable', () => {
  const page = new URL('https://www.iesdouyin.com/share/video/123/')
  const render = encodeURIComponent(JSON.stringify({ loaderData: { detail: { video: { playAddr: { urlList: ['https://v1.douyinvod.com/test.mp4'] } } } } }))
  const cover = '<meta property="og:image" content="https://a.douyinpic.com/poster">'
  assert.equal(extractSharedMedia(`${cover}<script id="RENDER_DATA">${render}</script>`, page)[0]?.kind, 'video')
  assert.deepEqual(extractSharedMedia(cover, page), [])
})

test('media relay rejects non-platform targets, untrusted redirects and unexpected file types', async () => {
  await assert.rejects(fetchSharedMedia('https://127.0.0.1/internal', async () => assert.fail('must not request a private address')), /不支持/)
  await assert.rejects(fetchSharedMedia('https://sns-webpic.xhscdn.com/redirect', async (url) => {
    assert.match(url, /xhscdn\.com/)
    return Response.redirect('https://127.0.0.1/internal')
  }), /不支持/)
  await assert.rejects(fetchSharedMedia('https://sns-webpic.xhscdn.com/page', async () => new Response('<h1>test</h1>', { headers: { 'content-type': 'text/html' } })), /没有返回/)
})
