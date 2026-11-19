import { mainstreamTextModelIds } from './textModelPolicy'
import type { ApiModelConfig, ApiConnection } from './store'

export const CATALOG_SYNC_KEY = 'disylab.provider-catalog-sync.v1'
export function nextCatalogCheck(now = Date.now(), random = Math.random()) {
  return now + (48 + Math.max(0, Math.min(1, random)) * 24) * 60 * 60 * 1000
}
export function recommendCatalogModels(models: ApiModelConfig[]) {
  const recommended = mainstreamTextModelIds(models.filter(model => model.capability === 'text'))
  return models.map(model => ({ ...model, enabled: model.manuallyEnabled ?? (recommended.has(model.id) || model.enabled) }))
}
export function mergeProviderCatalog(previous: ApiModelConfig[], incoming: Omit<ApiModelConfig, 'enabled'>[], autoEnable: (model: Omit<ApiModelConfig, 'enabled'>) => boolean) {
  if (!incoming.length) throw new Error('厂商返回空目录，保留已有模型')
  const old = new Map(previous.map(model => [model.id, model]))
  return recommendCatalogModels(incoming.map(model => {
    const saved = old.get(model.id)
    return { ...model, manuallyEnabled: saved?.manuallyEnabled, enabled: saved?.enabled ?? autoEnable(model) }
  }))
}
export function isRetiredProvider(connection: Pick<ApiConnection, 'baseUrl'>) {
  try { return /^(?:api\.)?meta\.ai$|^(?:www\.)?muse\.ai$/i.test(new URL(connection.baseUrl).hostname) } catch { return false }
}
