import test from 'node:test'
import assert from 'node:assert/strict'
import { onRequest as mediaRelay } from './apiyi/media.js'
import { onRequest as hfsyRelay } from './hfsy/[[path]].js'

test('Cloudflare media relay rejects a redirect to a non-approved host', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/internal' } })
  }
  try {
    const response = await mediaRelay({ request: new Request('https://app.test/apiyi/media?url=https%3A%2F%2Fapi.apiyi.com%2Fresult.mp4') })
    assert.equal(response.status, 403)
    assert.equal(calls, 1)
  } finally { globalThis.fetch = originalFetch }
})

test('Cloudflare media relay rejects lookalike hosts without fetching', async () => {
  const originalFetch = globalThis.fetch
  let called = false
  globalThis.fetch = async () => { called = true; return new Response('unexpected') }
  try {
    const response = await mediaRelay({ request: new Request('https://app.test/apiyi/media?url=https%3A%2F%2Fapi.apiyi.com.attacker.test%2Fresult.png') })
    assert.equal(response.status, 403)
    assert.equal(called, false)
  } finally { globalThis.fetch = originalFetch }
})

test('Cloudflare media relay sends HFSY anti-hotlink and scoped authorization headers to aixinai', async () => {
  const originalFetch = globalThis.fetch
  let capturedHeaders
  globalThis.fetch = async (_url, init) => {
    capturedHeaders = new Headers(init.headers)
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'video/mp4' } })
  }
  try {
    const response = await mediaRelay({ request: new Request('https://app.test/apiyi/media?url=https%3A%2F%2Fcdn.aixinai.net%2Fresult.mp4', {
      headers: { 'x-disylab-media-authorization': 'Bearer hfsy-key' },
    }) })
    assert.equal(response.status, 200)
    assert.equal(capturedHeaders.get('authorization'), 'Bearer hfsy-key')
    assert.equal(capturedHeaders.get('referer'), 'https://www.hfsyapi.cn/')
    assert.match(capturedHeaders.get('accept'), /video/)
  } finally { globalThis.fetch = originalFetch }
})

test('Cloudflare media relay sends HFSY anti-hotlink headers to qixinai results', async () => {
  const originalFetch = globalThis.fetch
  let upstreamHeaders
  globalThis.fetch = async (_url, init) => {
    upstreamHeaders = new Headers(init.headers)
    return new Response('video', { headers: { 'content-type': 'video/mp4' } })
  }
  try {
    const response = await mediaRelay({ request: new Request('https://app.test/apiyi/media?url=https%3A%2F%2Fwww.qixinai.net%2Fresult.mp4') })
    assert.equal(response.status, 200)
    assert.equal(upstreamHeaders.get('referer'), 'https://www.hfsyapi.cn/')
    assert.equal(upstreamHeaders.get('origin'), 'https://www.hfsyapi.cn')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Cloudflare HFSY relay keeps the configured version path exactly once', async () => {
  const originalFetch = globalThis.fetch
  let capturedUrl = ''
  globalThis.fetch = async (url) => { capturedUrl = String(url); return Response.json({ data: [] }) }
  try {
    const response = await hfsyRelay({ request: new Request('https://app.test/hfsy/v1/models', {
      headers: { 'x-disylab-hfsy-base': 'https://apigo.hfsyapi.cn/v1', authorization: 'Bearer test' },
    }) })
    assert.equal(response.status, 200)
    assert.equal(capturedUrl, 'https://apigo.hfsyapi.cn/v1/models')
  } finally { globalThis.fetch = originalFetch }
})

test('Cloudflare HFSY relay only exposes documented root endpoints', async () => {
  const response = await hfsyRelay({ request: new Request('https://app.test/hfsy/__root__/api/user/self') })
  assert.equal(response.status, 400)
})
