import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'
const compiled = ts.transpileModule(await readFile(new URL('./textModelPolicy.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { rankTextModels, mainstreamTextModelIds, runTextModelRecovery } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const models = ids => ids.map(id => ({ id, name: id }))

test('default selects latest standard GPT independent of catalog ordering', () => {
  assert.equal(rankTextModels(models(['gpt-4o', 'claude-sonnet-5-5', 'gpt-6.2-mini', 'gpt-6.2-sol', 'gpt-6.1-sol', 'gpt-6.2-astra']))[0].id, 'gpt-6.2-sol')
  assert.equal(rankTextModels(models(['gpt-5.9', 'gpt-5.10']))[0].id, 'gpt-5.10')
})
test('auto checks only mainstream representatives; excludes image/audio and experimental specialists', () => {
  assert.deepEqual([...mainstreamTextModelIds(models(['gpt-image-2','gpt-4o','gpt-6.2-sol','claude-opus-5-5','claude-sonnet-5-5','claude-sonnet-4-6','deepseek-chat','deepseek-reasoner','gemini-3']))], ['gpt-6.2-sol','claude-sonnet-5-5','deepseek-chat'])
})
test('optimization ranking prefers latest standard Claude; no hardcoded version IDs', () => {
  assert.equal(rankTextModels(models(['gpt-9', 'claude-sonnet-4-6','claude-sonnet-5-5','claude-haiku-5-5']), 'claude')[0].id, 'claude-sonnet-5-5')
})
test('failure never invokes another model without confirmation', async () => {
  const attempted = []
  await assert.rejects(runTextModelRecovery('gpt', async candidate => { attempted.push(candidate); throw new Error('503') }), /503/)
  assert.deepEqual(attempted, ['gpt'])
})
test('a confirmed alternative retries with original request and stops on success', async () => {
  const attempted = []; const confirmations = []
  const result = await runTextModelRecovery('gpt', async candidate => {
    attempted.push(candidate)
    if (candidate === 'gpt') throw new Error('503')
    return 'answer'
  }, { chooseNext: async (current, error) => { confirmations.push([current, error.message]); return 'claude' } })
  assert.equal(result, 'answer'); assert.deepEqual(attempted, ['gpt', 'claude']); assert.deepEqual(confirmations, [['gpt','503']])
})
test('model requests have no local deadline and can finish after hours', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let finish; let asked = false; let signal
  const result = runTextModelRecovery('model', (_, attemptSignal) => {
    signal = attemptSignal
    return new Promise(resolve => { finish = resolve })
  }, { chooseNext: async () => { asked = true; return undefined } })
  t.mock.timers.tick(24 * 60 * 60_000)
  assert.equal(signal.aborted, false)
  assert.equal(asked, false)
  finish('模型完成了回复')
  assert.equal(await result, '模型完成了回复')
})
test('user cancellation aborts the active provider without opening recovery', async () => {
  const controller = new AbortController(); let asked = false
  const promise = runTextModelRecovery(1, async () => new Promise(() => {}), { signal: controller.signal, chooseNext: async () => { asked = true; return 2 } })
  controller.abort()
  await assert.rejects(promise, { name: 'AbortError' }); assert.equal(asked, false)
})
test('empty replies request confirmation; declining never starts another request', async () => {
  let calls = 0; let asked = false
  await assert.rejects(runTextModelRecovery(1, async () => { calls++; return ' ' }, { chooseNext: async (_, error) => { asked = true; assert.match(error.message, /有效文本/); return undefined } }), /有效文本/)
  assert.equal(calls, 1); assert.equal(asked, true)
})
test('retrying the same model is allowed only when explicitly chosen', async () => {
  let calls = 0
  const result = await runTextModelRecovery(1, async () => { if (++calls === 1) throw new Error('busy'); return 'ok' }, { chooseNext: async current => current })
  assert.equal(result, 'ok'); assert.equal(calls, 2)
})
test('caller already aborted never starts a paid request', async () => {
  const controller = new AbortController(); controller.abort(); let called = false
  await assert.rejects(runTextModelRecovery(1, async () => { called = true; return 'text' }, { signal: controller.signal }), { name: 'AbortError' })
  assert.equal(called, false)
})
test('aborting while confirmation is pending prevents the approved retry', async () => {
  const controller = new AbortController(); let approve
  const promise = runTextModelRecovery(1, async () => { throw new Error('busy') }, { signal: controller.signal, chooseNext: () => new Promise(resolve => { approve = resolve }) })
  await new Promise(resolve => setTimeout(resolve, 0)); controller.abort(); approve(2)
  await assert.rejects(promise, { name: 'AbortError' })
})
