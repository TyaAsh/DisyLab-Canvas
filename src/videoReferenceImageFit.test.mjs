import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'
import { createHash } from 'node:crypto'
const compile=async file=>ts.transpileModule(await readFile(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const asModule=source=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const api=await import(asModule(await compile('./videoReferenceImageFit.ts')))
const {planVideoReferenceImageFit:plan,fitVideoReferenceImage:fit,videoReferenceImagePolicy:policy,videoReferenceFitMode:mode,assertVideoReferenceGeometry:guard}=api
const limits={ratio:[.4,2.5],side:[300,6000]}
const locked={preferredRatio:'21:9',forceRatio:true}

test('center placement clips excess and pads missing space without scaling source content to fill',()=>{
  const value=plan(3800,1100,limits,locked)
  assert.equal(value.width/value.height,21/9);assert.equal(value.scale,1)
  assert.equal(value.cropped,true);assert.ok(value.sx>600);assert.equal(value.sy,0)
  assert.equal(value.dw,value.sw);assert.equal(value.dh,value.sh)
  assert.equal(value.dx,(value.width-value.dw)/2);assert.equal(value.dy,(value.height-value.dh)/2)
})
test('a narrower but already legal reference gets centered padding at the exact target ratio',()=>{
  const value=plan(1920,1080,limits,locked)
  assert.equal(value.width,2520);assert.equal(value.height,1080)
  assert.equal(value.cropped,false);assert.equal(value.padded,true);assert.equal(value.scale,1)
  assert.equal(value.dx,300);assert.equal(value.dy,0);assert.equal(value.dw,1920);assert.equal(value.dh,1080)
})
test('preserve intent never crops any original content and is resolved from the prompt',()=>{
  const fitPolicy=policy('21:9','保留完整画面，不要裁剪')
  assert.equal(fitPolicy.mode,'preserve')
  const value=plan(3800,1100,limits,fitPolicy)
  assert.equal(value.cropped,false);assert.equal(value.sw,3800);assert.equal(value.sh,1100)
  assert.equal(value.sx,0);assert.equal(value.sy,0);assert.equal(value.scale,1)
  assert.equal(value.width/value.height,21/9);assert.ok(value.dy>250)
})
test('prompt treatment handles ordinary language, negation and later explicit corrections without a checkbox',()=>{
  for(const text of ['保留整张参考图','完整保留原图内容','保持完整构图','保持所有场景细节','所有画面内容都要保留','不要把参考图裁掉','不要让人物被裁剪','不要裁切图片','不需要裁剪','keep the entire image','do not crop'])assert.equal(mode(text),'preserve',text)
  for(const text of ['保持人物外观，不要拉伸','居中放置即可','不用保留完整内容','无需保留完整画面','不必保持全部内容','保留完整内容，但允许居中裁切'])assert.equal(mode(text),'center',text)
  assert.equal(mode('可以裁剪。现在改为不要裁剪。'),'preserve')
  assert.equal(policy('21:9','模型草稿遗漏了原始要求','用户说保留完整内容').mode,'preserve')
})
test('all reference modes lock legal images to the chosen output ratio, not just to a provider ratio range',()=>{
  const fitPolicy=policy('21:9','制作视频')
  assert.equal(fitPolicy.forceRatio,true);assert.equal(fitPolicy.alignFrames,true)
  for(const [w,h] of [[1920,1080],[1080,1920],[2048,2048],[2500,1000]]){
    const value=plan(w,h,limits,fitPolicy)
    assert.equal(value.width/value.height,21/9)
    assert.equal(value.dw/value.sw,value.dh/value.sh)
  }
})
test('small images are padded rather than enlarged, and both axes are centered',()=>{
  const value=plan(200,100,limits,{preferredRatio:'16:9',forceRatio:true})
  assert.equal(value.scale,1);assert.equal(value.dw,200);assert.equal(value.dh,100)
  assert.ok(value.width>=300&&value.height>=300)
  assert.equal(value.dx,(value.width-200)/2);assert.equal(value.dy,(value.height-100)/2)
})
test('only model limits downscale the whole composition and preservation survives that downscale',()=>{
  const value=plan(16000,9000,limits,{...locked,mode:'preserve'})
  assert.equal(value.cropped,false);assert.ok(value.scale<1)
  assert.equal(value.dw/value.sw,value.dh/value.sh)
  assert.ok(value.width<=6000&&value.height<=6000)
  assert.equal(value.width/value.height,21/9)
})
test('boundaries, integer dimensions and impossible constraints are validated before any request',()=>{
  for(const [w,h] of [[3800,1100],[1100,3800],[5000,2000],[400,1000],[491,200],[200,491],[6001,4001]]){
    const value=plan(w,h,limits)
    assert.ok(value.width/value.height>=.4&&value.width/value.height<=2.5)
    assert.ok(Math.min(value.width,value.height)>=300)
    assert.ok(Math.max(value.width,value.height)<=6000)
    assert.equal(value.dw/value.sw,value.dh/value.sh)
  }
  assert.throws(()=>plan(3000,1000,{side:[500,600],ratio:[2,2.5]},{preferredRatio:'2:1',forceRatio:true}),/同时满足/)
  assert.throws(()=>plan(3000,1000,limits,{preferredRatio:'3:1',forceRatio:true}),/超出/)
})
test('runtime guards reject anisotropic scaling, off-center placement and wrong target dimensions',()=>{
  const value=plan(3800,1100,limits,locked)
  assert.throws(()=>guard({...value,dw:value.dw-4},limits,locked),/拉伸/)
  assert.throws(()=>guard({...value,dx:value.dx+1},limits,locked),/居中|位置/)
  assert.throws(()=>guard({...value,width:value.width+1,dx:value.dx+.5},limits,locked),/目标/)
})
test('preflight checks the predicted final canvas while raw originals remain subject to validation',async t=>{
  const {checkReferenceMedia}=await import(asModule(await compile('./referenceMediaValidation.ts')))
  for(const [key,value]of Object.entries({window:{setTimeout,clearTimeout},Image:class{naturalWidth=3800;naturalHeight=1100;set src(_){queueMicrotask(()=>this.onload?.())}removeAttribute(){}}})){
    const before=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,value});t.after(()=>before?Object.defineProperty(globalThis,key,before):delete globalThis[key])
  }
  const entries=[{kind:'image',mediaId:'original'}],load=async()=>new Blob(['original'],{type:'image/png'}),signal=new AbortController().signal
  assert.match(await checkReferenceMedia(entries,()=>limits,load,signal),/宽高比/)
  assert.equal(await checkReferenceMedia(entries,()=>limits,load,signal,undefined,(metadata,rule)=>{const result=plan(metadata.width,metadata.height,rule,locked);return {...metadata,width:result.width,height:result.height}}),undefined)
})
test('encoding keeps the central source unfiltered, verifies final dimensions, and releases bitmaps',async t=>{
  const original=new Blob(['original'],{type:'image/png'}),output=new Blob(['canvas'],{type:'image/png'}),draws=[]
  let closed=0,canvas
  for(const [key,value]of Object.entries({createImageBitmap:async blob=>({width:blob===original?1920:canvas.width,height:blob===original?1080:canvas.height,close(){closed++}}),document:{createElement:()=>canvas={getContext:()=>({save(){},restore(){},fillRect(){},drawImage(...args){draws.push(args)}}),toBlob(callback){callback(output)}}}})){
    const before=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,value});t.after(()=>before?Object.defineProperty(globalThis,key,before):delete globalThis[key])
  }
  const value=await fit(original,limits,locked,new AbortController().signal)
  assert.equal(value.blob,output);assert.equal(closed,2)
  const foreground=draws.at(-1);assert.equal(foreground[3],foreground[7]);assert.equal(foreground[4],foreground[8])
  for(const draw of draws)assert.ok(Math.abs(draw[3]/draw[4]-draw[7]/draw[8])<1e-9)
  const controller=new AbortController();controller.abort()
  await assert.rejects(fit(original,limits,locked,controller.signal),{name:'AbortError'})
})
test('snapshots persist the exact prepared blob and a separate original with verifiable immutable hashes',async()=>{
  const original=new Blob(['original-bytes'],{type:'image/png'}),prepared=new Blob(['actual-upload-bytes'],{type:'image/png'}),saved=[]
  const value=await api.saveVideoReferenceInputSnapshot(original,prepared,plan(3800,1100,limits,locked),locked,1,async record=>saved.push(record),new AbortController().signal)
  assert.equal(saved.at(-1).blob,prepared);assert.equal(saved[0].blob,original)
  assert.equal(value.sha256,createHash('sha256').update('actual-upload-bytes').digest('hex'))
  assert.notEqual(value.originalSha256,value.sha256);assert.equal(value.index,1)
  await assert.rejects(api.saveVideoReferenceInputSnapshot(original,prepared,value.plan,locked,0,async()=>{throw new Error('storage full')},new AbortController().signal),/storage full/)
})
test('bounded reference preparation preserves ordering with at most three in flight',async()=>{
  let active=0,peak=0
  const values=await api.mapVideoReferenceInputs([0,1,2,3,4,5,6],async value=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,1));active--;return value*2})
  assert.deepEqual(values,[0,2,4,6,8,10,12]);assert.equal(peak,3)
})
test('provider output ratio mismatches are surfaced without mistaking small encoder rounding for distortion',()=>{
  assert.equal(api.videoReferenceOutputWarning(1470,630,'21:9'),undefined)
  assert.equal(api.videoReferenceOutputWarning(1472,632,'21:9'),undefined)
  assert.match(api.videoReferenceOutputWarning(1280,720,'21:9'),/厂商返回/)
  assert.equal(api.videoReferenceOutputWarning(1280,720,'auto'),undefined)
})

test('workspace exports keep both the original and prepared reference snapshots referenced by a request',async()=>{
  const transport=asModule('export const providerFetch = globalThis.fetch')
  const source=(await compile('./workspaceBundle.ts')).replace("'./providerTransport'",JSON.stringify(transport))
  const {collectReferencedMediaIds}=await import(asModule(source))
  const ids=collectReferencedMediaIds({outputHistory:[{referenceInputs:[{mediaId:'prepared',originalMediaId:'original'}]}]})
  assert.deepEqual([...ids].sort(),['original','prepared'])
})
