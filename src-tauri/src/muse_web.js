// Runs in the isolated Muse window. Use the visible composer and messages
// so that the website itself owns authentication, submission and media access.
function museWeb(operation, request) {
  if (location.origin !== 'https://muse.ai' && location.origin !== 'https://www.muse.ai') {
    return { state: location.href === 'about:blank' ? 'loading' : 'login' }
  }

  const visible = (element) => element.getClientRects().length > 0
    && getComputedStyle(element).visibility !== 'hidden'
  const label = (element) => [element.getAttribute('aria-label'), element.getAttribute('title'),
    element.getAttribute('data-testid'), element.textContent].filter(Boolean).join(' ').trim()
  const buttons = (root = document) => [...root.querySelectorAll('button, [role="button"]')].filter(visible)
  const composer = () => [...document.querySelectorAll('textarea, [contenteditable="true"]')]
    .filter((element) => visible(element) && !element.closest('[role="dialog"]')
      && !element.matches(':disabled, [readonly], [aria-disabled="true"]'))
    .find((element) => element.matches('[role="textbox"], [data-lexical-editor], .tiptap, .ProseMirror')
      || /muse|ask|prompt|message|send|写|问|消息/i.test([
        element.getAttribute('aria-label'), element.getAttribute('placeholder'),
        element.getAttribute('data-placeholder'), label(element.closest('form') ?? element),
      ].filter(Boolean).join(' ')))
  const scopeFor = (editor) => {
    const form = editor.closest('form')
    if (form) return form
    let scope = editor.parentElement
    for (let level = 0; scope && level < 5; level++, scope = scope.parentElement) {
      if (buttons(scope).some(isSend)) return scope
    }
    return null
  }
  const isSend = (button) => button.getAttribute('type') === 'submit'
    || /^(?:send(?: message| prompt)?|submit(?: message| prompt)?|发送(?:消息)?|提交)(?:\s|$)/i.test(label(button))
    || /(?:^|\s)(?:send-button|submit-button|send-message-button)(?:\s|$)/i.test(label(button))
  const running = () => buttons().some((button) =>
    /^(?:stop(?: generating| generation| responding| response| task| reply)?|停止(?:生成|任务|回复)?)(?:\s|$)/i.test(label(button)))
  const assistantTurns = () => {
    const turns = [...document.querySelectorAll([
    '[data-message-author-role="assistant"]', '[data-message-role="assistant"]', '[data-role="assistant"]',
    '[data-sender="assistant"]', '[data-author="assistant"]', '[data-testid*="assistant-message"]',
    '[data-testid*="agent-message"]', '[data-testid*="muse-message"]',
    'article[aria-label^="Muse" i]', 'article[aria-label^="Assistant" i]',
    '[role="article"][aria-label^="Muse" i]', '[role="article"][aria-label^="Assistant" i]',
    ].join(','))].filter(visible)
    const selected = new Set(turns)
    return turns.filter((turn) => {
      for (let parent = turn.parentElement; parent; parent = parent.parentElement) {
        if (selected.has(parent)) return false
      }
      return true
    })
  }
  const userTurns = () => [...document.querySelectorAll(
    '[data-message-author-role="user"], [data-message-role="user"], [data-role="user"], [data-sender="user"], [data-testid*="user-message"]',
  )].filter(visible)
  const hasAttachment = (scope) => buttons(scope).some((button) =>
    /remove (?:file|image|attachment)|移除(?:附件|图片)|删除(?:附件|图片)/i.test(label(button)))

  function mediaIn(turn, kind) {
    const selector = kind === 'video'
      ? 'video, video source, a[download], a[href*=".mp4"], a[href*=".webm"]'
      : 'img, a[download], a[href*=".png"], a[href*=".jpeg"], a[href*=".jpg"], a[href*=".webp"]'
    const sources = new Set()
    for (const element of turn.querySelectorAll(selector)) {
      if (element instanceof HTMLImageElement && (!element.complete || element.naturalWidth < 192 || element.naturalHeight < 192)) continue
      const source = element.currentSrc || element.src || element.href
      if (source && /^(?:https:\/\/|blob:|data:(?:image|video)\/)/.test(source)) sources.add(source)
    }
    return [...sources]
  }

  const editor = composer()
  const jobKey = '__disyMuseJob'
  const job = window[jobKey]
  if (operation === 'status') {
    if (document.readyState === 'loading') return { state: 'loading' }
    return { state: editor && scopeFor(editor) ? 'ready' : 'login' }
  }

  if (operation === 'start') {
    if (job || running()) return { state: 'busy' }
    if (!editor) return { state: 'login' }
    const scope = scopeFor(editor)
    if (!scope || !buttons(scope).some(isSend)) return { state: 'unsupported' }
    if ((editor.value ?? editor.textContent ?? '').trim() || hasAttachment(scope)) return { state: 'draft' }

    const previousTurns = assistantTurns()
    const next = {
      id: request.id, kind: request.kind, state: 'starting', baseline: new Set(previousTurns.map((turn) => turn.innerText.trim())),
      baselineNodes: new WeakSet(previousTurns), baselineUsers: new WeakSet(userTurns()),
      prompt: request.prompt.trim(), signature: '', changed: Date.now(),
    }
    window[jobKey] = next
    const fail = (state) => { if (window[jobKey] === next) next.state = state }
    async function submit() {
      const files = request.references ?? []
      if (files.length) {
        const inputs = [...scope.querySelectorAll('input[type="file"]')]
        const input = inputs.find((candidate) => !candidate.disabled && (!candidate.accept || /image|\.png|\.jpe?g|\.webp/i.test(candidate.accept)))
        if (!input || (!input.multiple && files.length > 1)) return fail('attachments')
        const transfer = new DataTransfer()
        for (const [index, url] of files.entries()) {
          if (!/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(url)) return fail('attachments')
          const blob = await (await fetch(url)).blob()
          transfer.items.add(new File([blob], 'disy-reference-' + (index + 1) + '.' + blob.type.split('/')[1], { type: blob.type }))
        }
        if (window[jobKey] !== next) return
        input.files = transfer.files
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
        await new Promise((resolve) => setTimeout(resolve, 900))
        const attachmentReady = hasAttachment(scope) || scope.textContent.includes('disy-reference-')
        if (!attachmentReady) return fail('attachments')
      }
      if (window[jobKey] !== next) return
      const currentEditor = composer()
      if (currentEditor !== editor || (editor.value ?? editor.textContent ?? '').trim()) return fail('draft')
      editor.focus()
      if (editor instanceof HTMLTextAreaElement) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(editor, request.prompt)
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: request.prompt }))
      } else if (!document.execCommand('insertText', false, request.prompt)) {
        return fail('unsupported')
      }
      for (let attempt = 0; attempt < 30; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 200))
        if (window[jobKey] !== next) return
        const send = buttons(scope).find(isSend)
        if (send && !send.disabled && send.getAttribute('aria-disabled') !== 'true') {
          next.state = 'waiting'
          send.click()
          return
        }
      }
      fail('unsupported')
    }
    void submit().catch(() => fail('unsupported'))
    return { state: 'starting' }
  }

  if (!job || job.id !== request.id) return { state: 'lost' }
  if (operation === 'release') {
    delete window[jobKey]
    return { state: 'released' }
  }
  if (operation === 'media') {
    if (!job.bytes) return { state: job.state }
    const start = Number(request.offset)
    if (!Number.isSafeInteger(start) || start < 0 || start > job.bytes.length) return { state: 'unsupported' }
    const chunk = job.bytes.subarray(start, start + 196608)
    let binary = ''
    for (let i = 0; i < chunk.length; i += 8192) binary += String.fromCharCode(...chunk.subarray(i, i + 8192))
    return { state: 'done', data: btoa(binary), type: job.type, size: job.bytes.length }
  }
  if (job.state === 'done') return { state: 'done', text: job.text, size: job.bytes?.length, type: job.type }
  if (job.state !== 'waiting') return { state: job.state, source: job.source }
  const userTurn = userTurns().findLast((turn) => !job.baselineUsers.has(turn) && turn.innerText.trim() === job.prompt)
  const turns = assistantTurns().filter((turn) => !job.baselineNodes.has(turn) && (userTurn
    ? Boolean(userTurn.compareDocumentPosition(turn) & Node.DOCUMENT_POSITION_FOLLOWING)
    : !job.baseline.has(turn.innerText.trim())))
  const turn = turns.at(-1)
  if (!turn) return { state: 'waiting' }
  const text = turn.innerText.trim()
  const media = job.kind === 'text' ? [] : mediaIn(turn, job.kind)
  const signature = JSON.stringify([text, media])
  if (signature !== job.signature) {
    job.signature = signature
    job.changed = Date.now()
    return { state: 'waiting' }
  }
  if (running() || Date.now() - job.changed < 2200) return { state: 'waiting' }
  if (job.kind === 'text') {
    if (!text) return { state: 'waiting' }
    job.text = text
    job.state = 'done'
    return { state: 'done', text }
  }
  if (!media.length) return { state: 'waiting' }
  job.state = 'downloading'
  void (async () => {
    for (const source of media) {
      try {
        const url = new URL(source)
        if (url.protocol === 'https:' && (url.username || url.password || !/(^|\.)(?:muse\.ai|meta\.ai|meta\.com|fbcdn\.net|facebook\.com|cdninstagram\.com)$/i.test(url.hostname))) continue
        if (url.protocol === 'https:') job.source ??= url.href
        const result = await fetch(url, { credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(45000) })
        if (!result.ok || Number(result.headers.get('content-length')) > 100_000_000) continue
        const blob = await result.blob()
        if (!blob.type.startsWith(job.kind + '/') || blob.type === 'image/svg+xml' || !blob.size || blob.size > 100_000_000) continue
        job.bytes = new Uint8Array(await blob.arrayBuffer())
        job.type = blob.type
        job.state = 'done'
        return
      } catch { /* Try the other visible media variants on the same reply. */ }
    }
    job.state = 'download-failed'
  })()
  return { state: 'downloading' }
}
