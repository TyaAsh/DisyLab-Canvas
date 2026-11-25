import type { AgentRun } from './agent'

export function withoutLegacyAgentSettings<T extends object>(project: T): T {
  const clean = { ...project } as T & { agentSettings?: unknown }
  delete clean.agentSettings
  return clean
}

const TASK_HISTORY_KEY = 'disylab.agent-task-history.v1'

export function loadAgentTaskHistory(): AgentRun[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(TASK_HISTORY_KEY) ?? '[]')
    if (!Array.isArray(value)) return []
    return value.filter((run): run is AgentRun => run && typeof run.id === 'string' && typeof run.projectId === 'string'
      && typeof run.canvasId === 'string' && typeof run.conversationId === 'string' && typeof run.updatedAt === 'string'
      && ['running', 'completed', 'failed', 'cancelled'].includes(run.status)).slice(-120)
      .map((run) => run.status === 'running' ? { ...run, status: 'cancelled', stage: '应用关闭，任务中断' } : run)
  } catch { return [] }
}

export function saveAgentTaskHistory(runs: AgentRun[]) {
  try { localStorage.setItem(TASK_HISTORY_KEY, JSON.stringify(runs.slice(-120))) } catch { /* The live task list still works. */ }
}

export type AgentTask = {
  id: string
  canvasId: string
  conversationId: string
  canvasName: string
  title: string
  kind: string
  status: AgentRun['status'] | 'waiting'
  stage?: string
  date: string
  nodeId?: string
  runId?: string
}

export function agentTaskIsActive(task: AgentTask) {
  return task.status === 'running' || task.status === 'waiting'
}
