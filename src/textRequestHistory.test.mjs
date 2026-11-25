import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const policy = await import(`data:text/javascript;base64,${Buffer.from(compile(await readFile(new URL('./textModelPolicy.ts', import.meta.url), 'utf8'))).toString('base64')}`)
const source = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let expression
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'generateRemoteText') expression = node.initializer
  ts.forEachChild(node, visit)
}
visit(ast)
assert.ok(expression)
const compiled = compile(`const callback = ${expression.getText(ast)}`)

function harness(outcomes) {
  const models = ['primary', 'backup'].map(id => ({ connection: { id, baseUrl: `https://${id}.example.com`, apiKey: `${id}-secret`, name: id, models: [{ id, enabled: true, capability: 'text' }] }, model: { id, name: id } }))
  let recoveries = []
  const history = []; const attempted = []
  const env = {
    enabledTextModels: models, activeProjectId: 'original-project', activeCanvasId: 'canvas',
    runTextModelRecovery: policy.runTextModelRecovery,
    requestRemoteText: async settings => { attempted.push(settings.model); const outcome = outcomes.shift(); if (outcome instanceof Error) throw outcome; return outcome },
    appendOutputHistory: (record, projectId) => history.push({ ...record, projectId }),
    normalizeGenerationError: error => ({ category: 'api', message: '厂商提示余额或可用额度不足', detail: error.message, status: 429, requestId: 'req-123' }),
    setTextModelRecoveries: update => { recoveries = update(recoveries) },
    useDisyStore: { getState: () => ({ apiSettings: { connections: models.map(model => model.connection) } }) },
    isConnectionUsable: () => true,
  }
  const request = new Function(...Object.keys(env), `${compiled}; return callback`)(...Object.values(env))
  return { models, history, attempted, request, get recovery() { return recoveries[0] } }
}

test('a successful Agent request is visible in ordinary output history', async () => {
  const h = harness(['完整回复'])
  const output = await h.request({ ...h.models[0].connection, model: 'primary' }, 'internal instructions', { history: { prompt: '用户需求', canvasId: 'canvas', label: 'Agent 对话' } })
  assert.equal(output, '完整回复')
  assert.equal(h.history.length, 1)
  assert.equal(h.history[0].status, 'success')
  assert.equal(h.history[0].prompt, '用户需求')
  assert.equal(h.history[0].projectId, 'original-project')
  assert.match(h.history[0].preview, /完整回复/)
})

test('balance failure is visible before approval and a successful retry keeps both attempts', async () => {
  const h = harness([new Error('insufficient_quota; primary-secret'), '重试成功'])
  const pending = h.request({ ...h.models[0].connection, model: 'primary' }, 'instructions')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(h.attempted, ['primary'])
  assert.equal(h.history.length, 1)
  assert.equal(h.history[0].status, 'failed')
  assert.equal(h.history[0].error.status, 429)
  assert.equal(h.history[0].error.requestId, 'req-123')
  assert.match(h.history[0].error.detail, /insufficient_quota/)
  assert.doesNotMatch(h.history[0].error.detail, /primary-secret/)
  assert.match(h.recovery.detail, /insufficient_quota/)
  h.recovery.choose('backup::backup')
  assert.equal(await pending, '重试成功')
  assert.deepEqual(h.history.map(record => [record.modelId, record.status]), [['primary', 'failed'], ['backup', 'success']])
})

test('declining retry leaves the real failure in output history without another request', async () => {
  const h = harness([new Error('insufficient_quota')])
  const pending = h.request({ ...h.models[0].connection, model: 'primary' }, 'instructions')
  const rejection = assert.rejects(pending, /insufficient_quota/)
  await new Promise(resolve => setImmediate(resolve))
  h.recovery.cancel()
  await rejection
  assert.equal(h.history.length, 1)
  assert.equal(h.history[0].status, 'failed')
  assert.deepEqual(h.attempted, ['primary'])
})
