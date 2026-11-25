import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const port=1420, url=`http://127.0.0.1:${port}/`
const directory=path.join(root,'.local','run')
fs.mkdirSync(directory,{recursive:true})
const log=path.join(directory,'server.log')
const ready=async()=>{
  try { const response=await fetch(url,{signal:AbortSignal.timeout(1800)}); return response.ok && /DisyLab/.test(await response.text()) } catch { return false }
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
function openBrowser(){
  if(process.argv.includes('--no-open'))return
  const child=process.platform==='win32'
    ? spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{detached:true,stdio:'ignore',windowsHide:true})
    : spawn(process.platform==='darwin'?'open':'xdg-open',[url],{detached:true,stdio:'ignore'})
  child.on('error',()=>console.log(`Open ${url}`));child.unref()
}
try {
  if(!await ready()){
    const vite=path.join(root,'node_modules','vite','bin','vite.js')
    if(!fs.existsSync(vite))throw Error('Dependencies are missing. Run npm ci in the project folder once, then double-click the launcher again.')
    const lock=path.join(directory,'starting.lock')
    let owner=false
    try { fs.writeFileSync(lock,String(Date.now()),{flag:'wx'}); owner=true }
    catch(error){ if(error.code!=='EEXIST')throw error; if(Date.now()-Number(fs.readFileSync(lock,'utf8'))>90_000){fs.unlinkSync(lock);fs.writeFileSync(lock,String(Date.now()),{flag:'wx'});owner=true} }
    if(owner){
      const output=fs.openSync(log,'a')
      const server=spawn(process.execPath,[vite,'--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',output,output]})
      server.on('error',error=>fs.appendFileSync(log,`\n${error.message}\n`));server.unref();fs.closeSync(output)
      fs.writeFileSync(path.join(directory,'server.pid'),String(server.pid))
    }
    try { for(let attempt=0;attempt<90;attempt++){if(await ready())break;await sleep(500)} if(!await ready())throw Error(`DisyLab could not start. Port ${port} may be in use. Details: ${log}`) }
    finally {if(owner&&fs.existsSync(lock))fs.unlinkSync(lock)}
  }
  console.log(`DisyLab is ready: ${url}`)
  openBrowser()
} catch(error){
  fs.writeFileSync(path.join(directory,'startup-error.txt'),`${new Date().toISOString()}\n${error.message}\n`)
  console.error(error.message);process.exitCode=1
}
