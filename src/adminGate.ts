/*!
 * Copyright (c) 2026 DisyLab. All rights reserved.
 * Proprietary source-available software under LicenseRef-DisyLab-Proprietary.
 * Unauthorized commercial use, redistribution, white-labeling, relicensing,
 * or removal of this copyright notice is prohibited.
 * Repository: https://github.com/TyaAsh/DisyLab-Canvas
 * SPDX-FileCopyrightText: 2026 DisyLab
 * SPDX-License-Identifier: LicenseRef-DisyLab-Proprietary
 */
const LOG_KEY = String.fromCharCode(100, 108, 45, 111, 112, 45, 108, 111, 103, 115, 45, 118, 49)

export type OperatorRecoveryLog = {
  id: string
  createdAt: string
  projectId?: string
  provider: string
  taskId?: string
  model: string
  modelName?: string
  connectionName?: string
  prompt: string
  durationMs: number
  resultType: 'success' | 'failed'
  kind?: 'image' | 'text' | 'video' | 'audio'
  requestJson: string
  resultJson: string
  resultUrls?: string[]
}

function readOperatorLogsRaw(): OperatorRecoveryLog[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]') as OperatorRecoveryLog[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function listOperatorRecoveryLogs(projectId?: string) {
  const logs = readOperatorLogsRaw()
  if (!projectId) return logs
  return logs.filter((log) => !log.projectId || log.projectId === projectId)
}

export function appendOperatorRecoveryLog(log: Omit<OperatorRecoveryLog, 'id' | 'createdAt'> & { createdAt?: string }) {
  const next: OperatorRecoveryLog = {
    ...log,
    id: `op-${Date.now()}-${crypto.randomUUID()}`,
    createdAt: log.createdAt ?? new Date().toISOString(),
  }
  const retained = [next, ...readOperatorLogsRaw()]
    .filter((item) => Date.now() - Date.parse(item.createdAt) < 7 * 24 * 60 * 60 * 1000)
    .slice(0, 120)
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(retained))
  } catch {
    // Never break generation if operator log storage is full.
  }
  return next
}
