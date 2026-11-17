import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('./nodeReferences.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const references = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const layerSource = await readFile(new URL('./canvasLayers.ts', import.meta.url), 'utf8')
const layerModule = ts.transpileModule(layerSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const { frontToBackCanvasLayers, moveCanvasLayer } = await import(`data:text/javascript;base64,${Buffer.from(layerModule).toString('base64')}`)

test('cover layer traversal follows the panel through groups and changes when a layer moves to the top', () => {
  const nodes = [
    { id: 'uploaded-photo', media: 'image' },
    { id: 'group' },
    { id: 'child-image', parentId: 'group', media: 'image' },
    { id: 'child-video', parentId: 'group', media: 'video' },
    { id: 'text' },
  ]
  assert.deepEqual([...frontToBackCanvasLayers(nodes)].map(({ id }) => id), ['text', 'group', 'child-video', 'child-image', 'uploaded-photo'])
  const firstMedia = (layers) => [...frontToBackCanvasLayers(layers)].find((node) => node.media)?.id
  assert.equal(firstMedia(nodes), 'child-video')
  assert.equal(firstMedia(moveCanvasLayer(nodes, { sourceId: 'uploaded-photo', targetId: 'text', placement: 'before' })), 'uploaded-photo')
})
const versionSource = await readFile(new URL('./videoVersions.ts', import.meta.url), 'utf8')
const versionModule = ts.transpileModule(versionSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const { appendVideoVariant, selectedVideoVariant, videoVariantSelection } = await import(`data:text/javascript;base64,${Buffer.from(versionModule).toString('base64')}`)

test('video regeneration and recovered candidates preserve the chosen main and earlier results', () => {
  const oldBinding = { connectionId: 'original', modelId: 'original-model' }
  const newBinding = { connectionId: 'different', modelId: 'other-model' }
  const first = { id: 'first', mediaId: 'blob-1', fileName: 'first.mp4', createdAt: '2026-01-01', taskId: 'task-1', binding: oldBinding }
  const second = { id: 'second', mediaId: 'blob-2', fileName: 'second.mp4', createdAt: '2026-01-02', taskId: 'task-2', binding: newBinding }
  const recovered = { id: 'third', mediaId: 'blob-3', fileName: 'third.mp4', createdAt: '2026-01-03', taskId: 'task-3', binding: newBinding }
  let node = appendVideoVariant({}, first)
  node = { ...node, ...appendVideoVariant(node, second) }
  assert.equal(node.videoMediaId, 'blob-1')
  assert.equal(node.videoTaskId, 'task-1')
  assert.deepEqual(node.videoResultBinding, oldBinding)
  node = { ...node, ...videoVariantSelection(second) }
  node = { ...node, ...appendVideoVariant(node, recovered) }
  assert.equal(node.activeVideoVariantId, 'second')
  assert.equal(node.videoMediaId, 'blob-2')
  assert.deepEqual(node.videoVariants.map(({ id }) => id), ['first', 'second', 'third'])
  assert.deepEqual(appendVideoVariant(node, recovered), {})
})

test('a legacy video with just a saved media ID or URL becomes a selectable original', () => {
  const next = { id: 'new', mediaId: 'new-blob', fileName: 'new.mp4', createdAt: '2026-01-02', taskId: 'new-task' }
  for (const source of [{ videoMediaId: 'old-blob' }, { videoUrl: 'https://example.test/old.mp4' }]) {
    const old = { ...source, fileName: 'old.mp4', videoTaskId: 'old-task' }
    const node = { ...old, ...appendVideoVariant(old, next) }
    const original = selectedVideoVariant(node)
    assert.equal(original?.taskId, 'old-task')
    assert.equal(original?.mediaId, source.videoMediaId)
    assert.equal(original?.sourceUrl, source.videoUrl)
    assert.equal(node.videoVariants.length, 2)
  }
})

test('group references include nested members once in canvas order', () => {
  const nodes = [{ id: 'image2', parentId: 'nested' }, { id: 'unrelated' }, { id: 'root' }, { id: 'nested', parentId: 'root' }, { id: 'image1', parentId: 'root' }]
  assert.deepEqual(references.nodesWithGroupChildren(nodes, ['root', 'image2']).map(({ id }) => id), ['image2', 'root', 'nested', 'image1'])
})

test('connected text content is expanded before a downstream generation request', () => {
  const result = references.expandConnectedTextReferences('根据 @[node:script-1] 生成视频', [{
    mention: '@[node:script-1]',
    name: '分镜脚本',
    text: '镜头从产品特写缓慢拉远，角色向右转身。',
  }])
  assert.equal(result.prompt, '根据 @分镜脚本 生成视频')
  assert.match(result.guide, /镜头从产品特写缓慢拉远/)
  assert.doesNotMatch(`${result.prompt}\n${result.guide}`, /@\[node:/)
})

test('missing upstream text never leaks an internal node token', () => {
  const result = references.expandConnectedTextReferences('使用 @[node:empty] 完成任务', [])
  assert.equal(result.prompt, '使用 完成任务')
  assert.equal(result.guide, '')
})

test('confirmed video frame slots keep their order when one source is also connected to the canvas', () => {
  const first = { id: 'first', mediaId: 'local-a' }
  const last = { id: 'last', url: 'https://example.test/b.png' }
  const connected = [{ ...last, id: 'connection-b' }, { id: 'connection-c', url: 'https://example.test/c.png' }]
  assert.deepEqual(references.resolveVideoFrameSources([first, last], connected).slice(0, 2), [first, last])
  assert.deepEqual(references.resolveVideoFrameSources([{ id: 'first' }, last], connected).slice(0, 2), [connected[1], last])
})
