import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
const sources=[]
const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory()){if(!['locales','i18n'].includes(entry.name))walk(file)}else if(/\.tsx?$/.test(file)&&!file.endsWith('.d.ts'))sources.push(file)}}
walk('src')
const entries=new Map()
for(const filename of sources){
 const source=fs.readFileSync(filename,'utf8'),file=ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true)
 const visit=node=>{
  if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isJsxText(node)||ts.isTemplateExpression(node)){
   let value=ts.isTemplateExpression(node)?node.head.text+node.templateSpans.map((span,index)=>`{${index}}`+span.literal.text).join(''):node.text
   value=value.replace(/\s+/g,' ').trim()
   const codePattern = /\(\?:|\(\?<|\\[sdbw]|\^.*\$/.test(value)
   if(/[\u3400-\u9fff]/.test(value)&&value.length<=600&&!codePattern&&!/\n.*\n/.test(node.text??'')&&!/copyright|\{\{subject\}\}|你是|只输出|\b(?:system|nanoPrompt|gptImage2Prompt)\b/i.test(value)){
    if(!entries.has(value)) entries.set(value,[])
    entries.get(value).push(filename+':'+(file.getLineAndCharacterOfPosition(node.getStart(file)).line+1))
   }
  }
  ts.forEachChild(node,visit)
 }
 visit(file)
}
const rows=[...entries].map(([zh,locations])=>({zh,locations})).sort((a,b)=>a.zh.localeCompare(b.zh,'zh-CN'))
fs.mkdirSync('artifacts/localization-audit',{recursive:true})
fs.writeFileSync('artifacts/localization-audit/source-strings.json',JSON.stringify(rows,null,2))
console.log(JSON.stringify({files:sources.length,strings:rows.length,short:rows.filter(x=>x.zh.length<=35).length,characters:rows.reduce((sum,x)=>sum+x.zh.length,0)}))
