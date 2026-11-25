import { useState } from 'react'
import { ArrowUpRight, ListTodo, LoaderCircle, Square } from 'lucide-react'
import { agentTaskIsActive, type AgentTask } from '../agentProject'

export type AgentProjectView = 'tasks' | 'guide'
const taskStatusLabels = { waiting: '待确认', running: '进行中', completed: '已完成', failed: '失败', cancelled: '已停止' }

export function AgentTasks({ tasks, onOpen, onStop }: { tasks: AgentTask[]; onOpen: (task: AgentTask) => Promise<boolean>; onStop: (id: string) => void }) {
  const [filter, setFilter] = useState<'active' | 'all'>('active')
  const [opening, setOpening] = useState<string | null>(null)
  const active = tasks.filter(agentTaskIsActive)
  const shown = filter === 'active' ? active : tasks
  return <section className="agent-project-pane" aria-label="任务中心">
    <div className="agent-project-tools"><span>{active.length} 项进行中或待确认</span><div className="agent-task-filter" aria-label="任务筛选">
      <button type="button" aria-pressed={filter === 'active'} onClick={() => setFilter('active')}>进行中</button>
      <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>全部</button>
    </div></div>
    {!shown.length && <div className="agent-project-empty"><ListTodo size={24} aria-hidden="true" /><strong>{filter === 'active' ? '暂无进行中的任务' : '还没有任务记录'}</strong></div>}
    <div className="agent-project-list">
      {shown.map((task) => <article key={task.id} className="agent-project-card">
        <div className="agent-project-card-heading"><span>{task.kind} · {task.canvasName}</span><span className={`agent-task-status is-${task.status}`}>{task.status === 'running' && <LoaderCircle size={12} className="is-spinning" aria-hidden="true" />}{taskStatusLabels[task.status]}</span></div>
        <strong>{task.title}</strong>
        {task.stage && <p>{task.stage}</p>}
        <footer><button type="button" disabled={opening !== null} onClick={async () => {
          setOpening(task.id)
          try { await onOpen(task) } finally { setOpening(null) }
        }}><ArrowUpRight size={14} aria-hidden="true" />{opening === task.id ? '正在打开…' : '查看对话'}</button>
          {task.status === 'running' && task.runId && <button type="button" onClick={() => onStop(task.runId!)}><Square size={12} aria-hidden="true" />停止</button>}
        </footer>
      </article>)}
    </div>
  </section>
}

export function AgentProjectGuide({ open, onExample }: { open: (view: AgentProjectView) => void; onExample?: (text: string) => void }) {
  const sections = [
    { view: 'tasks', title: '任务中心', text: '在「进行中」找正在运行或待确认的任务，切到「全部」查看记录。点「查看对话」回到原画布和对话。' },
  ] as const
  return <section className="agent-project-pane" aria-label="使用指南">
    <article className="agent-project-card agent-guide-card"><strong>从一句话开始</strong>
      <p>没想法也可以说目标，例如「我想做咖啡广告，但不知道什么风格」。Agent 会给不同的创意方向和推荐理由。</p>
      <p>方向卡的「按这个生成」直接开始制作，「继续细化」只讨论。也可以自由回复，或说「你帮我决定」。</p>
      {onExample && <footer><button type="button" onClick={() => onExample('帮我想三个咖啡广告的视觉方向，推荐一个，先不要生成。')}>试试找方向<ArrowUpRight size={14}/></button></footer>}
    </article>
    <article className="agent-project-card agent-guide-card"><strong>三个创作入口</strong>
      <p>Agent：构思、讨论、制作。点输入框左上角的工作方式图标，可切换智能、协作或直接生成；悬停可查看当前方式。</p>
      <dl className="agent-guide-modes"><div><dt>智能 · 默认</dt><dd>需求明确就制作，方向模糊先给建议。</dd></div><div><dt>协作</dt><dd>先完善方案，你点头后再生成。</dd></div><div><dt>直接生成</dt><dd>补齐技术参数后制作，关键歧义才追问。</dd></div></dl>
      <p>图像、视频：选择对应模型和参数后发送，默认直接制作，不再另选工作方式。你随时可以说「先给方案，先不要生成」。</p>
    </article>
    <article className="agent-project-card agent-guide-card"><strong>想清楚了，就直接告诉我</strong>
      <p>可以说明主体、效果和用途。比例、时长等有要求就写，没写的由 Agent 按用途和可用模型补齐。</p>
      <p>例如「做一张暖色咖啡海报，竖版，不要文字，直接生成」。复杂成片、多项交付或规格冲突时，仍会保留方案供你审阅。</p>
      {onExample && <footer><button type="button" onClick={() => onExample('做一张暖色咖啡海报，竖版9:16，不要文字，生成1张。')}>填入示例，不会自动发送<ArrowUpRight size={14}/></button></footer>}
    </article>
    <article className="agent-project-card agent-guide-card"><strong>带上参考素材</strong>
      <p>点输入框的「＋」上传图片或视频，也可以输入 @ 引用画布内容。说清楚素材用途，例如「保留图1的杯子，参考视频2的运镜」。</p>
      <p>图像、视频模式优先使用你选择的模型和参数；没有可用模型会显示「配置模型」。模型不支持要求时会说明具体限制，请你选择如何调整。</p>
      <p>视频有三种方式：「参考图/视频」可用文字或参考素材生成新片；「视频编辑」修改 1 段原视频，图片仅作辅助参考；「首尾帧」使用 2 张图片作为开头和结尾。素材不足或模型未接通时，发送按钮会说明原因。</p>
      <p>视频参考图会居中适配目标画幅，超出裁切、不足补边。需要保留整张图时，直接说「保留完整画面，不要裁剪」，会自动只补边；发送副本可在输出历史核对。</p>
    </article>
    <article className="agent-project-card agent-guide-card"><strong>修改、撤回与查看结果</strong>
      <p>鼠标悬停在自己发出的消息上，可复制或编辑。编辑后从该处继续，原对话与已生成素材仍保留。</p>
      <p>「优化」用于整理提示词，完成后可「撤回」恢复原稿。生成成功和失败都可在输出历史查看，错误会显示实际原因。</p>
    </article>
    {sections.map(({ view, title, text }) => <article className="agent-project-card agent-guide-card" key={view}>
      <strong>{title}</strong><p>{text}</p>
      <footer><button type="button" onClick={() => open(view)}>打开{title}<ArrowUpRight size={14} aria-hidden="true" /></button></footer>
    </article>)}
  </section>
}
