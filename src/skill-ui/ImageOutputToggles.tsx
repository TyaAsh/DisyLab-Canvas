import type { ImageOutput } from '../imageApi'

/** Unsupported formats stay hidden. PNG transparency and GIF are separate outputs. */
export function ImageOutputToggles({ supported, value, onChange }: { supported?: readonly ImageOutput[]; value?: ImageOutput; onChange:(value:ImageOutput)=>void }) {
  const options = ([['transparent-png','透明背景'],['gif','生成 GIF']] as const).filter(([format])=>supported?.includes(format))
  if (!options.length) return null
  return <section className="image-output-toggles" aria-label="输出格式">{options.map(([format,label])=><button type="button" role="switch" aria-checked={value===format} key={format} onClick={()=>onChange(value===format?'png':format)} title={format==='gif'?'生成动画 GIF；与透明 PNG 分开输出。':'生成带真实透明通道的 PNG。'}><span>{label}</span><i aria-hidden="true"/></button>)}</section>
}
