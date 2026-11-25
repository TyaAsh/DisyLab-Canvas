import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const compile=async file=>ts.transpileModule(await readFile(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const data=source=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const catalog=data(await compile('./modelCatalog.ts'))
const policy=data(await compile('./textModelPolicy.ts'))
const sync=data((await compile('./providerCatalogSync.ts')).replaceAll("'./modelCatalog'",JSON.stringify(catalog)).replace("'./textModelPolicy'",JSON.stringify(policy)))
const transport=data(await compile('./providerTransport.ts'))
const cli=data((await compile('./jimengCli.ts')).replace("'./providerTransport'",JSON.stringify(transport)))
const source=(await compile('./store.ts')).replace("'zustand'",JSON.stringify(import.meta.resolve('zustand'))).replace("'./modelCatalog'",JSON.stringify(catalog)).replace("'./providerCatalogSync'",JSON.stringify(sync)).replace("'./providerTransport'",JSON.stringify(transport)).replace("'./jimengCli'",JSON.stringify(cli))
let instance=0
const memory=entries=>{const values=new Map(entries);return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)}}
async function setup(t,settings,secrets={}) {
  const local=memory([['disy-api-settings',JSON.stringify(settings)]])
  const session=memory([['disy-api-secrets',JSON.stringify(secrets)],['disy-api-balance-tokens',JSON.stringify(secrets)]])
  for(const [name,value] of [['localStorage',local],['sessionStorage',session]]) {
    const before=Object.getOwnPropertyDescriptor(globalThis,name)
    Object.defineProperty(globalThis,name,{configurable:true,value})
    t.after(()=>before?Object.defineProperty(globalThis,name,before):delete globalThis[name])
  }
  const {useDisyStore}=await import(data(source+`\n// isolated store ${instance++}`))
  return {store:useDisyStore,local,session}
}
const models=[{id:'sd-2.5-720',name:'SD 2.5',capability:'video',enabled:true},{id:'MUSE_video',name:'Removed',capability:'video',enabled:true},{id:'alias',name:'Meta Muse Image',capability:'image',enabled:true}]

test('startup removes cached retired models and provider credentials while preserving other configured models',async t=>{
  const {store,local,session}=await setup(t,{connections:[{id:'hf',baseUrl:'https://www.hfsyapi.cn/v1',name:'HFSY',models},{id:'retired',baseUrl:'https://muse.ai/',models:[]}],selectedTextModel:{connectionId:'hf',modelId:'MUSE_video'}},{hf:'fake-hf',retired:'fake-retired'})
  const settings=store.getState().apiSettings
  assert.deepEqual(settings.connections.map(x=>x.id),['hf'])
  assert.deepEqual(settings.connections[0].models.map(x=>x.id),['sd-2.5-720'])
  assert.equal(settings.connections[0].apiKey,'fake-hf')
  assert.equal(settings.selectedTextModel,undefined)
  assert.deepEqual(JSON.parse(session.getItem('disy-api-secrets')),{hf:'fake-hf'})
  assert.deepEqual(JSON.parse(session.getItem('disy-api-balance-tokens')),{hf:'fake-hf'})
  assert.deepEqual(JSON.parse(local.getItem('disy-api-settings')).connections[0].models.map(x=>x.id),['sd-2.5-720'])
})

test('saving or importing old settings cannot resurrect removed models or a retired connection',async t=>{
  const {store,local,session}=await setup(t,{connections:[]})
  store.getState().saveApiSettings({connections:[{id:'hf',baseUrl:'https://www.hfsyapi.cn/v1',apiKey:'fake-hf',models},{id:'retired',baseUrl:'https://api.meta.ai/v1',apiKey:'fake-retired',models:[]}],selectedImageModel:{connectionId:'hf',modelId:'alias'}})
  const saved=store.getState().apiSettings
  assert.deepEqual(saved.connections.map(x=>x.id),['hf'])
  assert.deepEqual(saved.connections[0].models.map(x=>x.id),['sd-2.5-720'])
  assert.equal(saved.selectedImageModel,undefined)
  assert.equal(store.getState().apiConfigured,true)
  assert.deepEqual(JSON.parse(session.getItem('disy-api-secrets')),{hf:'fake-hf'})
  assert.equal(JSON.parse(local.getItem('disy-api-settings')).connections.length,1)
})

test('original single-connection settings also discard retired endpoints and their credential',async t=>{
  const {store,session}=await setup(t,{baseUrl:'https://muse.ai/',model:'muse-chat'})
  assert.deepEqual(store.getState().apiSettings.connections,[])
  assert.equal(session.getItem('disy-api-secret'),null)
})
