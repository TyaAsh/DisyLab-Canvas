import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { setImmediate } from 'node:timers/promises'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

const program = await readFile(new URL('../src-tauri/src/muse_web.js', import.meta.url), 'utf8')

function musePage({ origin = 'https://muse.ai', loggedIn = true } = {}) {
  const turns = []
  const sent = []
  const visible = { getClientRects: () => [{}] }
  let now = 0
  class Textarea {
    get value() { return this.textContent }
    set value(value) { this.textContent = value }
    textContent = ''
    getClientRects = visible.getClientRects
    getAttribute = () => null
    matches = (query) => query.includes('[role="textbox"]')
    closest = (selector) => selector === 'form' ? form : null
    focus() {}
    dispatchEvent() {}
  }
  class TestImage {
    complete = true
    naturalWidth = 1024
    naturalHeight = 768
    src = 'data:image/png;base64,AQID'
  }
  const editor = new Textarea()
  const send = {
    ...visible,
    getAttribute: (name) => name === 'aria-label' ? 'Send message' : null,
    click() {
      sent.push(editor.value)
      editor.value = ''
    },
  }
  const form = { querySelectorAll: () => [send] }
  const document = {
    readyState: 'complete',
    querySelectorAll(selector) {
      if (selector.startsWith('textarea')) return loggedIn ? [editor] : []
      if (selector.includes('assistant')) return turns
      return []
    },
  }
  const web = runInNewContext('(' + program + ')', {
    location: { origin, href: origin + '/' }, window: {}, document,
    HTMLTextAreaElement: Textarea, HTMLImageElement: TestImage, InputEvent: Event,
    getComputedStyle: () => ({ visibility: 'visible' }), Date: { now: () => now },
    setTimeout: queueMicrotask, URL, fetch, AbortSignal, Uint8Array, btoa,
  })
  return {
    web, sent, editor,
    reply(text, media) {
      const elements = media === 'image' ? [new TestImage()]
        : media === 'video' ? [{ src: 'data:video/mp4;base64,AQID' }] : []
      turns.push({ ...visible, innerText: text, querySelectorAll: () => elements })
    },
    settle() { now += 2400 },
  }
}

test('Muse checks the site and composer before sending and preserves existing drafts', () => {
  assert.equal(musePage({ origin: 'https://muse.ai.example.org' }).web('status', {}).state, 'login')
  assert.equal(musePage({ loggedIn: false }).web('status', {}).state, 'login')
  const page = musePage()
  assert.equal(page.web('status', {}).state, 'ready')
  page.editor.value = 'existing draft'
  assert.equal(page.web('start', { id: 'job-1', kind: 'text', prompt: 'new prompt' }).state, 'draft')
  assert.deepEqual(page.sent, [])
})

test('Muse submits once and returns only the new assistant turn', async () => {
  const page = musePage()
  const request = { id: 'job-1', kind: 'text', prompt: 'new prompt' }
  page.reply('previous reply')
  assert.equal(page.web('start', request).state, 'starting')
  assert.equal(page.web('start', { ...request, id: 'job-2' }).state, 'busy')
  await setImmediate()
  assert.deepEqual(page.sent, ['new prompt'])
  assert.equal(page.web('poll', request).state, 'waiting')
  page.reply('new reply')
  assert.equal(page.web('poll', request).state, 'waiting')
  page.settle()
  assert.equal(page.web('poll', request).text, 'new reply')
  assert.equal(page.web('media', { id: 'other' }).state, 'lost')
})

test('Muse passes generated images and videos back as bounded media chunks', async () => {
  for (const [kind, type] of [['image', 'image/png'], ['video', 'video/mp4']]) {
    const page = musePage()
    const request = { id: 'job-1', kind, prompt: 'create media' }
    page.web('start', request)
    await setImmediate()
    page.reply('generated media', kind)
    page.web('poll', request)
    page.settle()
    assert.equal(page.web('poll', request).state, 'downloading')
    await setImmediate()
    const reply = page.web('poll', request)
    assert.equal(reply.size, 3)
    assert.equal(reply.type, type)
    assert.equal(page.web('media', { id: request.id, offset: 1 }).data, 'AgM=')
    assert.equal(page.web('release', request).state, 'released')
    assert.equal(page.web('media', { id: request.id, offset: 0 }).state, 'lost')
  }
})
