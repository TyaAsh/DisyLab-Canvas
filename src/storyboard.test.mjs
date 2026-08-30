import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('./skills/storyboard.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const storyboard = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

test('GPT Image 2 skeleton requests use one authoritative IP master while Nano retains all views', () => {
  const state = storyboard.createComicWorkflow('测试内容', 'niuniu')
  const request = storyboard.buildSketchRequests(state)[0]

  assert.equal(request.gptImageReferenceImages.length, 1)
  assert.match(request.gptImageReferenceImages[0].name, /唯一身份母版/)
  assert.match(request.gptImageReferenceImages[0].url, /niuniu-2d-jp-05\.png$/)
  assert.equal(request.referenceImages.length, 5)
  assert.match(request.gptImagePrompt, /图1是唯一角色输入/)
  assert.doesNotMatch(request.gptImagePrompt, /图2至图4/)
})
