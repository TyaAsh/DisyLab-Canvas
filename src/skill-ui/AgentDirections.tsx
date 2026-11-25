import { ArrowUpRight, Sparkles } from 'lucide-react'
import type { AgentCreativeDirection } from '../agentInteraction'

export function AgentDirections({ directions, disabled, onChoose }: {
  directions: AgentCreativeDirection[]
  disabled: boolean
  onChoose: (direction: AgentCreativeDirection, action: 'generate' | 'refine') => void
}) {
  return <div className="agent-creative-directions" aria-label="创意方向">
    {directions.map(direction => <section key={direction.id} className={`agent-direction-card ${direction.recommended ? 'is-recommended' : ''}`}>
      <header><strong>{direction.title}</strong>{direction.recommended && <span><Sparkles size={11} aria-hidden="true"/>推荐</span>}</header>
      <p>{direction.description}</p>
      <details><summary>查看方向细节</summary><p>{direction.brief}</p></details>
      <footer><button type="button" disabled={disabled} onClick={() => onChoose(direction, 'refine')}>继续细化</button>
        <button type="button" className="agent-direction-generate" disabled={disabled} onClick={() => onChoose(direction, 'generate')}>按这个生成<ArrowUpRight size={13} aria-hidden="true"/></button></footer>
    </section>)}
  </div>
}
