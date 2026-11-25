import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'
const compile = async file => ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const data = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const policy = data(await compile('./textModelPolicy.ts'))
const catalogSource = data(await compile('./modelCatalog.ts'))
const catalog = await import(catalogSource)
const sync = await import(data((await compile('./providerCatalogSync.ts')).replace("'./textModelPolicy'", JSON.stringify(policy)).replaceAll("'./modelCatalog'", JSON.stringify(catalogSource))))
const model = (id, enabled = false, manuallyEnabled) => ({ id, name: id, enabled, manuallyEnabled, capability: 'text' })
test('existing unchecked lists acquire mainstream defaults exactly as new catalogs do', () => {
  const models = sync.recommendCatalogModels([model('gpt-4o'),model('gpt-6.2-sol'),model('claude-sonnet-5-5'),model('deepseek-chat')])
  assert.deepEqual(models.filter(item => item.enabled).map(item => item.id), ['gpt-6.2-sol','claude-sonnet-5-5','deepseek-chat'])
})
test('explicit user disabling and enabling survives subsequent refreshes', () => {
  const before = [model('claude-sonnet-5-5',false,false),model('gpt-4o',true,true)]
  const after = sync.mergeProviderCatalog(before, [...before,model('deepseek-chat')], () => false)
  assert.equal(after[0].enabled,false); assert.equal(after[1].enabled,true); assert.equal(after[2].enabled,true)
})
test('new catalogs remove retired models rather than retaining stale entries', () => {
  assert.deepEqual(sync.mergeProviderCatalog([model('gpt-4o',true)],[model('gpt-6.2-sol')],()=>false).map(item=>item.id), ['gpt-6.2-sol'])
  assert.throws(()=>sync.mergeProviderCatalog([model('gpt-4o',true)],[],()=>false), /空目录/)
})
test('randomized sync deadlines stay within 48–72 hours', () => {
  assert.equal(sync.nextCatalogCheck(0,0),48*3600000)
  assert.equal(sync.nextCatalogCheck(0,1),72*3600000)
  assert.equal(sync.nextCatalogCheck(0,.5),60*3600000)
})
test('Muse API and account providers are retired without removing HFSY', () => {
  for (const baseUrl of ['https://api.meta.ai/v1','https://muse.ai/','https://www.muse.ai/']) assert.equal(sync.isRetiredProvider({baseUrl}),true)
  assert.equal(sync.isRetiredProvider({baseUrl:'https://www.hfsyapi.cn/v1'}),false)
})

test('all catalog parsers exclude removed families by ID and display name without losing other vendors', () => {
  const rows=[{id:'muse-video'},{id:'MUSE_IMAGE'},{id:'vendor/model',name:'Meta Muse Spark'},{id:'wan-3.0-720'},{id:'Doubao-Seedance-2.0'}]
  assert.deepEqual(catalog.parseRemoteModelCatalog({data:{models:rows}}).map(x=>x.id).sort(),['Doubao-Seedance-2.0','wan-3.0-720'].sort())
  assert.deepEqual(catalog.parseRemoteModelCatalog(['muse_video','MUSE-chat','sd-2.5-720']).map(x=>x.id),['sd-2.5-720'])
  const marketplace=rows.map(({id,...rest})=>({model_name:id,...rest,tags:['视频'],enable_groups:['default'],supported_endpoint_types:['video']}))
  assert.deepEqual(catalog.parseHfsyMarketplaceCatalog({success:true,data:marketplace}).map(x=>x.id).sort(),['Doubao-Seedance-2.0','wan-3.0-720'].sort())
})

test('removed enabled models cannot return through recommendations or catalog refreshes', () => {
  const previous=[{...model('muse-video',true,true),capability:'video'},model('gpt-6.2-sol',true)]
  assert.deepEqual(sync.recommendCatalogModels(previous).map(x=>x.id),['gpt-6.2-sol'])
  const incoming=[...previous,{...model('gateway-alias'),name:'MUSE Image'}]
  assert.deepEqual(sync.mergeProviderCatalog(previous,incoming,()=>true).map(x=>x.id),['gpt-6.2-sol'])
  assert.deepEqual(sync.mergeProviderCatalog(previous,[previous[0]],()=>true),[])
})
