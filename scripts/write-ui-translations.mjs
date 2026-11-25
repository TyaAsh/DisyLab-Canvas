import fs from 'node:fs'
const [offset,file]=process.argv.slice(2)
const sources=JSON.parse(fs.readFileSync('artifacts/localization-audit/source-strings.json','utf8'))
const input=fs.readFileSync(file,'utf8')
const translations=file.endsWith('.txt')?input.trim().split(/\r?\n/).map(line=>{const match=/^(\d+)\|(.*)$/.exec(line);if(!match)throw Error('Missing translation index: '+line);return [Number(match[1]),match[2]]}):JSON.parse(input).map((value,index)=>[Number(offset)+index,value])
const target='src/locales/en.json'
const catalog=JSON.parse(fs.readFileSync(target,'utf8'))
if(!Array.isArray(translations))throw Error('Expected translation array')
translations.forEach(([index,value])=>{if(typeof value!=='string'||!value.trim())throw Error('Empty translation');catalog[sources[index].zh]=value})
fs.writeFileSync(target,JSON.stringify(catalog,null,2)+'\n')
console.log(`Saved ${translations.length} translations; catalog size ${Object.keys(catalog).length}`)
