import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

let compiled = ts.transpileModule(await readFile(new URL('./VideoReferenceThumbnail.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText
const db = 'data:text/javascript,' + encodeURIComponent('export async function loadHistoryMedia(){return {blob:new Blob(["local video"],{type:"video/webm"})}}')
compiled = compiled.replaceAll("'./localDb'", JSON.stringify(db))
for (const name of ['react/jsx-runtime', 'react', 'lucide-react']) compiled = compiled.replaceAll(`"${name}"`, JSON.stringify(import.meta.resolve(name))).replaceAll(`'${name}'`, JSON.stringify(import.meta.resolve(name)))
const { loadVideoThumbnailPoster } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

test('video posters resolve durable media, install listeners before loading and release decoding resources', async () => {
  const previous = globalThis.document
  const videos = [], draws = [], canvases = []
  let broken = false
  globalThis.document = { createElement(kind) {
    if (kind === 'video') {
      const video = { duration: 4, videoWidth: 1920, videoHeight: 1080, currentTime: 0,
        load() { if (this.src) queueMicrotask(() => { if (broken) this.onerror?.(); else { this.onloadedmetadata?.(); this.onloadeddata?.(); this.onseeked?.() } }) },
        removeAttribute() { this.src = '' },
      }
      videos.push(video)
      return video
    }
    const canvas = { width:0, height:0, getContext:()=>({drawImage:(...args)=>draws.push(args)}), toDataURL:()=> 'data:image/jpeg;base64,cG9zdGVy' }
    canvases.push(canvas)
    return canvas
  } }
  try {
    const first = loadVideoThumbnailPoster({mediaId:'thumbnail-good',url:'blob:expired-old-url'})
    const duplicate = loadVideoThumbnailPoster({mediaId:'thumbnail-good'})
    assert.equal(first, duplicate)
    assert.match(await first, /^data:image\/jpeg/)
    assert.equal(videos.length,1)
    assert.equal(videos[0].currentTime,.2)
    assert.equal(draws.length,1)
    assert.equal(canvases[0].width,160); assert.equal(canvases[0].height,90)
    assert.equal(videos[0].src,''); assert.equal(videos[0].onseeked,null)
    broken=true
    await assert.rejects(loadVideoThumbnailPoster({mediaId:'thumbnail-retry'}),/无法读取/)
    assert.equal(videos[1].src,'')
    broken=false
    assert.match(await loadVideoThumbnailPoster({mediaId:'thumbnail-retry'}),/^data:image/)
    assert.equal(videos.length,3)
  } finally { globalThis.document = previous }
})
