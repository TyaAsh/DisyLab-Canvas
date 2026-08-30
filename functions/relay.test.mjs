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
