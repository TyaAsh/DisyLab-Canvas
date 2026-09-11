import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('./agent.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const agent = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

test('explicit planning and execution language route to different modes', () => {
  assert.equal(agent.inferAgentInteractionMode('先给我计划，暂时不要执行').mode, 'plan')
  assert.equal(agent.inferAgentInteractionMode('就按第二个方案开始制作').mode, 'execute')
  assert.equal(agent.inferAgentInteractionMode('检查一下当前画布的问题').mode, 'inspect')
  assert.equal(agent.inferAgentInteractionMode('这个？').mode, 'clarify')
})

test('structured model decision survives protocol parsing', () => {
  const parsed = agent.parseAgentReply(JSON.stringify({
    decision: { mode: 'execute', confidence: 0.91, needsApproval: true, reason: '用户已确认方案' },
    reply: '请确认后开始生成。',
  }))
  assert.deepEqual(parsed.decision, {
    mode: 'execute', confidence: 0.91, needsApproval: true, reason: '用户已确认方案',
  })
})

test('long conversations retain a compact older summary and exact recent turns', () => {
  const messages = Array.from({ length: 16 }, (_, index) => ({
    id: String(index), role: index % 2 ? 'assistant' : 'user', content: `消息 ${index}`, createdAt: '',
  }))
  const context = agent.buildAgentConversationContext(messages, 4)
  assert.match(context, /较早对话摘要/)
  assert.match(context, /消息 0/)
  assert.match(context, /最近对话/)
  assert.match(context, /消息 15/)
})
