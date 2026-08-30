import fs from 'node:fs'
import ts from 'typescript'

const file = new URL('../src/WorkflowTemplatePanel.tsx', import.meta.url)
const sourceText = fs.readFileSync(file, 'utf8')
const source = ts.createSourceFile('WorkflowTemplatePanel.tsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const textOf = (node) => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : ''
const property = (object, name) => object.properties.find((item) => ts.isPropertyAssignment(item) && item.name.getText(source) === name)?.initializer
const stringsIn = (node) => {
  const values = []
  const visit = (item) => { const value = textOf(item); if (value) values.push(value); ts.forEachChild(item, visit) }
  if (node) visit(node)
  return values
}

const retired = new Set()
const EXPECTED_BUILT_IN_COUNT = 30
const templates = []
const visit = (node) => {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'RETIRED_DUPLICATE_TEMPLATE_IDS') stringsIn(node.initializer).forEach((id) => retired.add(id))
  if (ts.isObjectLiteralExpression(node)) {
    const id = textOf(property(node, 'id')); const title = textOf(property(node, 'title')); const category = textOf(property(node, 'category'))
    const description = textOf(property(node, 'description')); const nodes = property(node, 'nodes')
    if (id && title && category && description && nodes) templates.push({ id, title, category, corpus: [title, description, ...stringsIn(property(node, 'tags')), ...stringsIn(nodes)].join(' '), nodeKinds: stringsIn(nodes).filter((value) => ['text', 'image', 'video', 'upload'].includes(value)) })
  }
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'productionTemplate') {
    const [idNode, titleNode, categoryNode, descriptionNode, tagsNode, briefNode, stepsNode] = node.arguments
    const id = textOf(idNode); const title = textOf(titleNode); const category = textOf(categoryNode); const description = textOf(descriptionNode)
    if (id && title) templates.push({ id, title, category, corpus: [title, description, ...stringsIn(tagsNode), textOf(briefNode), ...stringsIn(stepsNode)].join(' '), nodeKinds: stringsIn(stepsNode).map(() => 'image') })
  }
  ts.forEachChild(node, visit)
}
visit(source)

const unique = [...new Map(templates.map((item) => [item.id, item])).values()].filter((item) => !retired.has(item.id))
const tokens = (value) => {
  const normalized = value.toLowerCase().replace(/[·，。、“”‘’：；（）()【】\-_/]/g, ' ').replace(/\s+/g, ' ')
  const words = normalized.match(/[a-z0-9]+|[\u3400-\u9fff]/g) ?? []
  const result = new Set(words)
  const han = normalized.replace(/[^\u3400-\u9fff]/g, '')
  for (let index = 0; index < han.length - 1; index++) result.add(han.slice(index, index + 2))
  return result
}
const jaccard = (a, b) => { let shared = 0; for (const item of a) if (b.has(item)) shared++; return shared / Math.max(1, a.size + b.size - shared) }
const rows = []
for (let left = 0; left < unique.length; left++) for (let right = left + 1; right < unique.length; right++) {
  const a = unique[left]; const b = unique[right]
  const lexical = jaccard(tokens(a.corpus), tokens(b.corpus))
  const sameCategory = a.category === b.category ? .08 : 0
  const sizeSimilarity = 1 - Math.min(1, Math.abs(a.nodeKinds.length - b.nodeKinds.length) / Math.max(1, a.nodeKinds.length, b.nodeKinds.length))
  const score = lexical * .8 + sameCategory + sizeSimilarity * .12
  rows.push({ score, lexical, a: `${a.id}｜${a.title}`, b: `${b.id}｜${b.title}` })
}
rows.sort((a, b) => b.score - a.score)
console.log(JSON.stringify({ active: unique.length, retired: retired.size, duplicateIds: templates.length - new Set(templates.map((item) => item.id)).size, ...(process.argv.includes('--list') ? { activeTemplates: unique.map(({ id, title, category }) => ({ id, title, category })) } : {}), topPairs: rows.slice(0, 20) }, null, 2))
const duplicateIdCount = templates.length - new Set(templates.map((item) => item.id)).size
const sourceGuardsPresent = sourceText.includes('.filter((template) => !RETIRED_DUPLICATE_TEMPLATE_IDS.has(template.id))')
  && sourceText.includes('value.custom.filter((item) => !isRetired(item))')
  && sourceText.includes('value.overrides.filter((item) => !isRetired(item))')
if (duplicateIdCount) throw new Error(`发现 ${duplicateIdCount} 个重复工作流 ID`)
if (unique.length !== EXPECTED_BUILT_IN_COUNT) throw new Error(`内置工作流应为 ${EXPECTED_BUILT_IN_COUNT} 个，当前为 ${unique.length} 个`)
if (!sourceGuardsPresent) throw new Error('退休工作流的源码过滤或旧缓存迁移保护已缺失')
if (rows[0]?.score >= .45) throw new Error(`发现疑似高度重复工作流：${rows[0].a} / ${rows[0].b}`)
