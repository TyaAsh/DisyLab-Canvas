import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('./nodeReferences.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const references = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

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
