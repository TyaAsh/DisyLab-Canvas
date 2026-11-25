import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const catalog=JSON.parse(await readFile(new URL('../locales/en.json',import.meta.url),'utf8'))
const compile=async file=>ts.transpileModule(await readFile(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const data=code=>`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const coreUrl=data((await compile('./core.ts')).replace("'opencc-js/cn2t'",JSON.stringify(import.meta.resolve('opencc-js/cn2t'))).replace("import english from '../locales/en.json'",`const english=${JSON.stringify(catalog)}`))
const core=await import(coreUrl)
const reactUrl=data((await compile('./react.ts')).replaceAll("'react'",JSON.stringify(import.meta.resolve('react'))).replaceAll("'./core'",JSON.stringify(coreUrl)))
const {LanguageProvider,OriginalText}=await import(reactUrl)
const runtime=await import(data((await compile('./jsx-runtime.ts')).replaceAll("'react'",JSON.stringify(import.meta.resolve('react'))).replaceAll("'react/jsx-runtime'",JSON.stringify(import.meta.resolve('react/jsx-runtime'))).replaceAll("'framer-motion'",JSON.stringify(import.meta.resolve('framer-motion'))).replaceAll("'./core'",JSON.stringify(coreUrl)).replaceAll("'./react'",JSON.stringify(reactUrl))))
const render=(element,locale='en')=>{core.setLocale(locale);return renderToStaticMarkup(createElement(LanguageProvider,null,element))}

test('English catalog covers the extracted source inventory without losing template parameters',async()=>{
 const sources=JSON.parse(await readFile(new URL('../locales/source-keys.json',import.meta.url),'utf8'))
 const slots=s=>[...s.matchAll(/\{(\d+)\}/g)].map(x=>x[1]).sort()
 for(const zh of sources)assert.ok(catalog[zh],zh)
 for(const [source,target]of Object.entries(catalog)){
  assert.ok(target.trim(),source);assert.equal(/[\u3400-\u9fff]/.test(target),false,source)
  assert.deepEqual(slots(target),slots(source),source)
 }
})
test('English exact strings and dynamic UI templates translate while embedded names survive',()=>{
 assert.equal(core.translateUi('资产库','en'),'Asset library')
 assert.equal(core.translateUi('已复制项目“我的咖啡店”','en'),'Copied project “我的咖啡店”')
 assert.equal(core.translateUi('我的咖啡店','en'),'我的咖啡店')
 assert.equal(core.translateUi('任意的名称','en'),'任意的名称')
 assert.equal(core.translateUi('  设置  ','en'),'  Settings  ')
 assert.equal(core.translateUi('9:21 · 2K · 1 张','en'),'9:21 · 2K · 1 image')
})
test('Traditional Chinese uses regional vocabulary and Simplified Chinese remains unchanged',()=>{
 assert.equal(core.translateUi('图像参数','zh-TW'),'影像參數')
 assert.equal(core.translateUi('选择视频模型','zh-CN'),'选择视频模型')
 assert.match(core.translateUi('设置','zh-TW'),/設定/)
})
test('rendered controls, accessible labels and tooltips localize without changing values or identifiers',()=>{
 const html=render(runtime.jsx('input',{placeholder:'搜索项目','aria-label':'设置','data-tooltip':'关闭',value:'优化',readOnly:true,id:'设置'}))
 assert.match(html,/placeholder="Search projects"/);assert.match(html,/aria-label="Settings"/)
 assert.match(html,/data-tooltip="Close"/);assert.match(html,/value="优化"/);assert.match(html,/id="设置"/)
})
test('original content boundaries preserve exact user text through nested components and attributes',()=>{
 const html=render(runtime.jsx('div',{children:[runtime.jsx('p',{translate:'no',title:'优化',children:runtime.jsx('span',{children:'优化'})}),createElement(OriginalText,null,runtime.jsx('span',{children:'设置'}))]}))
 assert.match(html,/<p translate="no" title="优化"><span>优化<\/span><\/p>/)
 assert.match(html,/<span>设置<\/span>/)
})
test('editable content and node content remain original; empty placeholders translate',()=>{
 const html=render(runtime.jsx('div',{children:[runtime.jsx('div',{contentEditable:true,suppressContentEditableWarning:true,'data-placeholder':'设置',children:'优化'}),runtime.jsx('p',{className:'node-body',children:'优化'}),runtime.jsx('p',{className:'node-body is-empty',children:'设置'})]}))
 assert.match(html,/data-placeholder="Settings">优化/);assert.match(html,/class="node-body">优化/);assert.match(html,/class="node-body is-empty">Settings/)
})
test('switching locale notifies subscribers, persists preferences, and updates the document language',()=>{
 const stored=new Map();globalThis.localStorage={setItem:(key,value)=>stored.set(key,value)};globalThis.document={documentElement:{dataset:{}}}
 let calls=0;const unsubscribe=core.subscribeLocale(()=>calls++)
 core.setLocale('zh-TW');assert.equal(stored.get(core.LANGUAGE_KEY),'zh-TW');assert.equal(document.documentElement.lang,'zh-TW');assert.equal(calls,1)
 core.setLocale('zh-TW');assert.equal(calls,1);unsubscribe();core.setLocale('en');assert.equal(calls,1)
 assert.equal(core.getIntlLocale(),'en-US');delete globalThis.document;delete globalThis.localStorage
})
