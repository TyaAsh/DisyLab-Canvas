import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('./nodeReferences.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const references = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

test('removing video frame references clears durable IDs, legacy aliases and cached prompt across save/load', () => {
  for (const [id,urlKey,mediaKey] of [['video-first-frame','videoFirstFrameUrl','videoFirstFrameMediaId'],['video-last-frame','videoLastFrameUrl','videoLastFrameMediaId'],['video-reference-image','videoReferenceImageUrl','videoReferenceImageMediaId'],['video-reference-video','videoReferenceUrl','videoReferenceMediaId']]) {
    const original={body:'@素材 做视频',promptText:'@素材 old cached prompt',[urlKey]:'blob:old',[mediaKey]:'durable-original',referenceImages:[{id:'legacy-alias',url:'blob:old',mediaId:'durable-original'}],videoReferenceOrder:[id,'legacy-alias','other'],videoLastFrameUrl:id==='video-last-frame'?'blob:old':'blob:other',videoLastFrameMediaId:id==='video-last-frame'?'durable-original':'durable-other'}
    const saved=JSON.parse(JSON.stringify(references.clearVideoReference(original,{id,mention:'@素材',mediaId:'durable-original'})))
    assert.equal(saved[urlKey],undefined);assert.equal(saved[mediaKey],undefined)
    assert.equal(saved.promptText,undefined);assert.equal(saved.body.includes('@素材'),false)
    assert.deepEqual(saved.referenceImages,[]);assert.deepEqual(saved.videoReferenceOrder,['other'])
    assert.equal(original[mediaKey],'durable-original')
    if(id!=='video-last-frame')assert.equal(saved.videoLastFrameMediaId,'durable-other')
  }
})
test('removing an ordinary video reference preserves unrelated assets and clears matching primary aliases',()=>{
  const original={body:'@one @two',videoReferenceImageUrl:'blob:one',videoReferenceImageMediaId:'one',referenceImages:[{id:'one',url:'blob:one',mediaId:'one'},{id:'two',url:'blob:two',mediaId:'two'}]}
  const next=references.clearVideoReference(original,{id:'one',mention:'@one',mediaId:'one'})
  assert.equal(next.videoReferenceImageMediaId,undefined);assert.equal(next.videoReferenceImageUrl,undefined)
  assert.deepEqual(next.referenceImages,[original.referenceImages[1]])
  assert.equal(next.body,'@two')
})
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
