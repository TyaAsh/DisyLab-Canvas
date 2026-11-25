import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'
const code=ts.transpileModule(await readFile(new URL('./imageParameterOptions.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const {uniqueImageRatios}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
test('node fallback and explicit model lists contain exactly one Auto, including duplicate remote values',()=>{
 for(const ratios of [undefined,['auto','1:1'],['1:1'],['auto','auto','21:9','9:21']]){
  const values=uniqueImageRatios(ratios,['auto','1:1'],true)
  assert.equal(values.filter(value=>value==='auto').length,1)
  assert.equal(new Set(values).size,values.length)
 }
 assert.deepEqual(uniqueImageRatios(['21:9','9:21'],[],false),['21:9','9:21'])
})
