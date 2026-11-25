import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

// Exercise the actual callbacks with a local model stub; no remote API calls.
const source = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function callback(name, environment) {
  let expression
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) expression = node.initializer.arguments[0]
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(expression, `Missing callback: ${name}`)
  const compiled = ts.transpileModule(`const callback = ${expression.getText(ast)}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
  return new Function(...Object.keys(environment), `${compiled}; return callback`)(...Object.values(environment))
}

function harness(data) {
  let nodes = [{ id: 'target', data }]
  let resolveModel
  let notices = []
  const env = {
    nodes,
    activeProjectIdRef: { current: 'project' }, activeCanvasIdRef: { current: 'canvas' },
    optimizingPromptNodeIds: new Set(), optimizeTextModelKey: '',
    enabledTextModels: [], preferredOptimizeModel: { connection: {}, model: {} }, selectedTextModel: null,
    setOptimizingPromptNodeIds: () => {}, setApiOpen: () => {},
    setToastMessage: (notice) => notices.push(notice),
    normalizeGenerationError: (error) => ({ message: error.message }),
    generateRemoteText: () => new Promise((resolve) => { resolveModel = resolve }),
    setNodes: (update) => { nodes = update(nodes); env.nodes = nodes },
  }
  return {
    env, get data() { return nodes[0].data }, get notices() { return notices },
    optimize: () => callback('optimizeNodePrompt', env)('target'),
    resolve: (value) => resolveModel(value),
    undo: () => callback('undoNodePromptOptimization', env)('target'),
    edit: (patch) => { nodes = nodes.map((node) => ({ ...node, data: { ...node.data, ...patch } })); env.nodes = nodes },
  }
}

for (const kind of ['text', 'image', 'video']) {
  test(`${kind}: successive optimizations undo independently and restore exact fields`, async () => {
    const h = harness({ kind, promptText: '  原稿\n', body: '正文保持独立', title: '保留标题' })
    let pending = h.optimize(); h.resolve('第一版'); await pending
    pending = h.optimize(); h.resolve('第二版'); await pending
    h.undo()
    assert.equal(h.data.promptText, '第一版')
    assert.equal(h.data.promptOptimizationHistory.length, 1)
    h.undo()
    assert.equal(h.data.promptText, '  原稿\n')
    assert.equal(h.data.body, '正文保持独立')
    assert.equal(h.data.title, '保留标题')
    assert.equal(h.data.promptOptimizationBackup, undefined)
    assert.equal(h.data.promptOptimizedAt, undefined)
  })
}

test('empty or unchanged optimization never replaces the draft or creates undo history', async () => {
  for (const output of ['', '  ', '原稿']) {
    const h = harness({ kind: 'video', body: '  原稿\n' })
    const pending = h.optimize(); h.resolve(output); await pending
    assert.equal(h.data.body, '  原稿\n')
    assert.equal(h.data.promptOptimizationHistory, undefined)
  }
})

test('late optimization cannot overwrite manual edits or another canvas', async () => {
  for (const change of [(h) => h.edit({ body: '新输入' }), (h) => { h.env.activeCanvasIdRef.current = 'other' }]) {
    const h = harness({ kind: 'image', body: '原稿' })
    const pending = h.optimize(); change(h); h.resolve('旧请求结果'); await pending
    assert.notEqual(h.data.body, '旧请求结果')
    assert.equal(h.data.promptOptimizationHistory, undefined)
  }
})

test('old saved optimization backups remain undoable', () => {
  const h = harness({ kind: 'text', body: '优化稿', promptOptimizationBackup: '原稿' })
  h.undo()
  assert.equal(h.data.body, '原稿')
  assert.equal(h.data.promptOptimizationBackup, undefined)
})
