/*!
 * Copyright (c) 2026 DisyLab. All rights reserved.
 * Proprietary source-available software under LicenseRef-DisyLab-Proprietary.
 * Unauthorized commercial use, redistribution, white-labeling, relicensing,
 * or removal of this copyright notice is prohibited.
 * Repository: https://github.com/TyaAsh/DisyLab-Canvas
 * SPDX-FileCopyrightText: 2026 DisyLab
 * SPDX-License-Identifier: LicenseRef-DisyLab-Proprietary
 */
import { create } from 'zustand'

const API_SETTINGS_KEY = 'disy-api-settings'
const API_SECRETS_KEY = 'disy-api-secrets'
const API_BALANCE_TOKENS_KEY = 'disy-api-balance-tokens'
const LEGACY_API_SECRET_KEY = 'disy-api-secret'

export type ActivePanel = 'canvas' | 'assets' | 'settings'
export type ModelCapability = 'text' | 'image' | 'video' | 'audio' | 'unknown'

export type ApiModelConfig = {
  id: string
  name: string
  capability: ModelCapability
  enabled: boolean
}

export type ApiConnection = {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  balanceToken?: string
  models: ApiModelConfig[]
  modelsFetchedAt?: string
  /** Master switch for whether this connection's models participate in selection. Defaults to true. */
  enabled?: boolean
  /** Soft disconnect state: API Key remains stored, but the connection and its models are hidden from all model selectors until re-linked. Defaults to false. */
  disconnected?: boolean
}

/** A connection is usable only when it is enabled and not in a disconnected state. */
export function isConnectionUsable(connection: ApiConnection): boolean {
  return connection.enabled !== false
    && !connection.disconnected
    && Boolean(connection.baseUrl.trim() && connection.apiKey.trim())
}

export type ModelSelection = {
  connectionId: string
  modelId: string
}

export type ApiSettings = {
  connections: ApiConnection[]
  selectedTextModel?: ModelSelection
  selectedImageModel?: ModelSelection
}

function inferLegacyCapability(modelId: string): ModelCapability | null {
  if (/image|seedream|imagen|flux|banana|dall-e|gpt-image/i.test(modelId)) return 'image'
  if (/video|seedance|sora|veo|kling|runway|hailuo|happyhorse|wan(?:2\.\d)?|(?:^|[-_.])sd-2(?:[.\d-]|$)|(?:^|[-_.])(?:t2v|i2v|r2v)(?:[-_.]|$)/i.test(modelId)) return 'video'
  if (/tts|speech|audio|voice|whisper/i.test(modelId)) return null
  return 'text'
}

function readSecretMap() {
  try {
    const value = JSON.parse(sessionStorage.getItem(API_SECRETS_KEY) ?? '{}') as Record<string, unknown>
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  } catch {
    return {}
  }
}

function isApiYiConnection(connection: Pick<ApiConnection, 'baseUrl'>) {
  return /(?:^|\.)apiyi\.com(?:[/:]|$)/i.test(connection.baseUrl.trim())
}

function removeSessionCredentials(connectionIds: string[]) {
  if (!connectionIds.length) return
  const removed = new Set(connectionIds)
  for (const key of [API_SECRETS_KEY, API_BALANCE_TOKENS_KEY]) {
    try {
      const stored = JSON.parse(sessionStorage.getItem(key) ?? '{}') as Record<string, unknown>
      const retained = Object.fromEntries(Object.entries(stored).filter(([id]) => !removed.has(id)))
      sessionStorage.setItem(key, JSON.stringify(retained))
    } catch {
      // A malformed session cache is ignored; the connection record is still removed.
    }
  }
}

function readApiSettings(): ApiSettings {
  const secrets = readSecretMap()
  // HFSY does not publish a self-service upload-token flow. Clear the
  // retired session-only upload credential from earlier builds.
  sessionStorage.removeItem('disy-api-upload-tokens')
  let balanceTokens: Record<string, string> = {}
  try {
    balanceTokens = JSON.parse(sessionStorage.getItem(API_BALANCE_TOKENS_KEY) ?? '{}') as Record<string, string>
  } catch {
    balanceTokens = {}
  }
  try {
    const value = JSON.parse(localStorage.getItem(API_SETTINGS_KEY) ?? '{}') as Record<string, unknown>
    if (Array.isArray(value.connections)) {
      const loadedConnections = value.connections.map((item) => {
        const connection = item as Partial<ApiConnection>
        const id = typeof connection.id === 'string' ? connection.id : crypto.randomUUID()
        return {
          id,
          name: typeof connection.name === 'string' ? connection.name : 'API 连接',
          baseUrl: typeof connection.baseUrl === 'string' ? connection.baseUrl : '',
          apiKey: secrets[id] ?? '',
          balanceToken: typeof balanceTokens[id] === 'string' ? balanceTokens[id] : '',
          models: Array.isArray(connection.models)
            ? connection.models.flatMap((candidate) => {
                if (!candidate || typeof candidate !== 'object') return []
                const model = candidate as Partial<ApiModelConfig>
                if (typeof model.id !== 'string' || !model.id.trim() || !['text', 'image', 'video', 'audio', 'unknown'].includes(String(model.capability))) return []
                // Older saved catalogs may have treated unrecognised HFSY
                // video IDs (such as sd-2.5-720) as text. Correct those
                // entries on load without changing user-selected image/audio types.
                const inferred = inferLegacyCapability(model.id)
                const capability = model.capability === 'text' && inferred === 'video' ? 'video' : model.capability as ModelCapability
                return [{
                  id: model.id,
                  name: typeof model.name === 'string' && model.name.trim() ? model.name : model.id,
                  capability,
                  enabled: model.enabled !== false,
                }]
              })
            : [],
          modelsFetchedAt: typeof connection.modelsFetchedAt === 'string' ? connection.modelsFetchedAt : undefined,
          enabled: connection.enabled === false ? false : true,
          disconnected: connection.disconnected === true,
        }
      })
      // APIYI is no longer offered by DisyLab. Remove old saved entries during
      // loading so they cannot remain selectable after this update, and erase
      // their session-only credentials at the same time.
      const removedApiYiIds = loadedConnections.filter(isApiYiConnection).map((connection) => connection.id)
      const connections = loadedConnections.filter((connection) => !isApiYiConnection(connection))
      if (removedApiYiIds.length) {
        removeSessionCredentials(removedApiYiIds)
        try {
          localStorage.setItem(API_SETTINGS_KEY, JSON.stringify({
            ...value,
            connections: value.connections.filter((item) => !isApiYiConnection({ baseUrl: typeof (item as Partial<ApiConnection>).baseUrl === 'string' ? (item as Partial<ApiConnection>).baseUrl! : '' })),
          }))
        } catch {
          // The in-memory migration still prevents the removed connections from use.
        }
      }
      const validateSelection = (candidate: unknown, capability: ModelCapability): ModelSelection | undefined => {
        if (!candidate || typeof candidate !== 'object') return undefined
        const { connectionId, modelId } = candidate as Partial<ModelSelection>
        if (typeof connectionId !== 'string' || typeof modelId !== 'string') return undefined
        const connection = connections.find((item) => item.id === connectionId)
        if (!connection || connection.enabled === false || connection.disconnected) return undefined
        const model = connection.models.find((item) => item.id === modelId)
        return model?.enabled && model.capability === capability ? { connectionId, modelId } : undefined
      }
      return {
        connections,
        selectedTextModel: validateSelection(value.selectedTextModel, 'text'),
        selectedImageModel: validateSelection(value.selectedImageModel, 'image'),
      }
    }

    // Migrate the original single-connection shape.
    const baseUrl = typeof value.baseUrl === 'string' ? value.baseUrl : ''
    const legacySecret = sessionStorage.getItem(LEGACY_API_SECRET_KEY) ?? ''
    if (baseUrl || legacySecret) {
      const id = 'connection-migrated'
      const modelId = typeof value.model === 'string' ? value.model : ''
      const legacyCapability = inferLegacyCapability(modelId)
      return {
        connections: [{
          id,
          name: '默认连接',
          baseUrl,
          apiKey: legacySecret,
          models: modelId && legacyCapability ? [{ id: modelId, name: modelId, capability: legacyCapability, enabled: true }] : [],
        }],
        selectedTextModel: modelId && legacyCapability === 'text' ? { connectionId: id, modelId } : undefined,
        selectedImageModel: modelId && legacyCapability === 'image' ? { connectionId: id, modelId } : undefined,
      }
    }
  } catch {
    // Fall through to an empty configuration.
  }
  return { connections: [] }
}

function persistApiSettings(settings: ApiSettings) {
  const publicSettings = {
    ...settings,
    connections: settings.connections.map(({ apiKey: _apiKey, balanceToken: _balanceToken, ...connection }) => connection),
  }
  const secretMap = Object.fromEntries(settings.connections.filter((connection) => connection.apiKey).map((connection) => [connection.id, connection.apiKey]))
  const balanceTokenMap = Object.fromEntries(settings.connections.filter((connection) => connection.balanceToken).map((connection) => [connection.id, connection.balanceToken]))
  const previousSecrets = sessionStorage.getItem(API_SECRETS_KEY)
  sessionStorage.setItem(API_SECRETS_KEY, JSON.stringify(secretMap))
  sessionStorage.setItem(API_BALANCE_TOKENS_KEY, JSON.stringify(balanceTokenMap))
  try {
    localStorage.setItem(API_SETTINGS_KEY, JSON.stringify(publicSettings))
    sessionStorage.removeItem(LEGACY_API_SECRET_KEY)
  } catch (error) {
    if (previousSecrets === null) sessionStorage.removeItem(API_SECRETS_KEY)
    else sessionStorage.setItem(API_SECRETS_KEY, previousSecrets)
    throw error
  }
}

const initialApiSettings = readApiSettings()

type DisyStore = {
  activePanel: ActivePanel
  apiConfigured: boolean
  apiSettings: ApiSettings
  setActivePanel: (panel: ActivePanel) => void
  saveApiSettings: (settings: ApiSettings) => void
  clearApiSettings: () => void
}

export const useDisyStore = create<DisyStore>((set) => ({
  activePanel: 'canvas',
  apiConfigured: initialApiSettings.connections.some((connection) => isConnectionUsable(connection) && Boolean(connection.baseUrl && connection.apiKey)),
  apiSettings: initialApiSettings,
  setActivePanel: (activePanel) => set({ activePanel }),
  saveApiSettings: (apiSettings) => {
    persistApiSettings(apiSettings)
    set({
      apiSettings,
      apiConfigured: apiSettings.connections.some((connection) => isConnectionUsable(connection) && Boolean(connection.baseUrl && connection.apiKey)),
    })
  },
  clearApiSettings: () => {
    localStorage.removeItem(API_SETTINGS_KEY)
    sessionStorage.removeItem(API_SECRETS_KEY)
    sessionStorage.removeItem(API_BALANCE_TOKENS_KEY)
    sessionStorage.removeItem('disy-api-upload-tokens')
    sessionStorage.removeItem(LEGACY_API_SECRET_KEY)
    set({ apiSettings: { connections: [] }, apiConfigured: false })
  },
}))
