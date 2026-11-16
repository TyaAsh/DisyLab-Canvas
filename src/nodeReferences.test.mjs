import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('./nodeReferences.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const references = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

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
