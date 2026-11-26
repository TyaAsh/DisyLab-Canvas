import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'
const code=ts.transpileModule(await readFile(new URL('./storageInventory.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const {buildStorageInventory,storedValueBytes}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const media=id=>({id,blob:new Blob(['1234567890']),fileName:`${id}.png`})

test('all retained database categories are inventoried, including nested assets and workspace history',()=>{
 const result=buildStorageInventory({assets:[{id:'library',assets:[{id:'a',title:'A',data:{imageUrl:'data:image/png;base64,abc'}}]}], 'workspace-data':[{id:'workspace',folders:[{id:'f',name:'Folder'}],outputHistory:[{id:'o'}],generationHistory:[{id:'g'}],publicSettings:{connections:[]}},{id:'film-checkpoint:n',checkpoint:{stage:'render'}}],'agent-sessions':[{id:'s',title:'Conversation'}],canvases:[{id:'c',name:'Canvas'}],'workspace-projects':[{id:'p',name:'Project'}],projects:[{id:'legacy'}],'import-backups':[{id:'latest'}],custom:[{id:'custom'}]})
 for(const category of result.categories)assert.equal(category.entries.length,category.id==='media'?0:1,category.id)
 assert.equal(result.categories.find(c=>c.id==='assets').entries[0].name,'A')
 assert.ok(result.bytes>0)
})

test('cleanup protects canvas, asset, history, conversation, backup and live draft media',()=>{
 const ids=['canvas','asset','history','conversation','backup','live','orphan']
 const stores={'history-media':ids.map(media),canvases:[{nodes:[{data:{imageMediaId:'canvas'}}]}],assets:[{id:'library',assets:[{data:{mediaId:'asset'}}]}],'workspace-data':[{id:'workspace',outputHistory:[{mediaId:'history'}]}],'agent-sessions':[{messages:[{references:[{mediaId:'conversation'}]}]}],'import-backups':[{historyMedia:[media('backup')]}]}
 const result=buildStorageInventory(stores,[{unsavedNode:{videoMediaId:'live'}}])
 assert.deepEqual(result.unusedMediaIds,['orphan'])
 assert.ok(result.unusedMediaBytes>=10)
 assert.equal(result.categories.find(c=>c.id==='media').entries.filter(e=>e.unused).length,1)
 stores.canvases.push({nodes:[{data:{mediaId:'orphan'}}]})
 assert.deepEqual(buildStorageInventory(stores,[{mediaId:'live'}]).unusedMediaIds,[])
})

test('storage sizing counts lazy blobs without reading or serializing their data',()=>{
 const blob=new Blob(['abc'])
 blob.arrayBuffer=()=>{throw Error('Blob bytes should not be read')}
 assert.equal(storedValueBytes(blob),3)
 assert.ok(storedValueBytes({blob,text:'中文'})>=9)
 const cyclic={};cyclic.self=cyclic;assert.ok(Number.isFinite(storedValueBytes(cyclic)))
})
