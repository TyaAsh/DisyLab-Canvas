import { isDesktopApp } from './providerTransport'

export const JIMENG_LOCAL_BASE = 'https://jimeng.jianying.com/cli'
export const JIMENG_LOCAL_CREDENTIAL = 'disy-desktop-jimeng'
export const isJimengCliBase = (baseUrl: string) => baseUrl.trim().replace(/\/$/, '') === JIMENG_LOCAL_BASE

type CliAction = 'status' | 'begin' | 'relogin' | 'finish' | 'image_models' | 'video_models' | 'image' | 'video' | 'query' | 'download'
type CliArgs = { id?: string; model?: string; prompt?: string; ratio?: string; resolution?: string; duration?: number; inputs?: number[][] }
export type JimengChallenge = { url: string; userCode: string; deviceCode: string }

async function invokeJimeng<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (!isDesktopApp()) throw new Error('即梦账号授权仅在 Disy 桌面版可用')
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<T>(name, args)
  } catch (error) {
    throw new Error(typeof error === 'string' ? error : error instanceof Error ? error.message : '即梦 CLI 不可用')
  }
}

export function runJimengCli(action: CliAction, args?: CliArgs) {
  return invokeJimeng<string>('jimeng_cli', { action, ...args })
}

export function parseJimengJson(output: string): Record<string, unknown> | undefined {
  const trimmed = output.trim()
  for (const value of [trimmed, ...trimmed.split(/\r?\n/).reverse()]) {
    try {
      const parsed = JSON.parse(value)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch { /* CLI also prints human-readable status lines */ }
  }
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try { return JSON.parse(trimmed.slice(start, end + 1)) } catch { /* no structured output */ }
  }
  return undefined
}

export function parseJimengChallenge(output: string): JimengChallenge | undefined {
  const json = parseJimengJson(output)
  const nested = json?.data && typeof json.data === 'object' ? json.data as Record<string, unknown> : json
  const read = (name: string) => String(nested?.[name] ?? new RegExp('(?:^|\\n)\\s*' + name + '\\s*[:=：]\\s*([^\\s]+)', 'i').exec(output)?.[1] ?? '').trim()
  const verification = read('verification_uri_complete') || read('verification_uri')
  const userCode = read('user_code')
  const deviceCode = read('device_code')
  if (!verification || !/^[\w-]{4,256}$/.test(deviceCode) || !/^[\w-]{4,256}$/.test(userCode)) return undefined
  let url: URL
  try { url = new URL(verification) } catch { return undefined }
  if (url.origin !== 'https://jimeng.jianying.com' || url.username || url.password || !['/ai-tool/cli-auth', '/passport/open/scan_user_code'].includes(url.pathname)) return undefined
  if (url.pathname === '/passport/open/scan_user_code') {
    const authorize = new URL('/ai-tool/cli-auth', url.origin)
    authorize.searchParams.set('verification_uri', url.href)
    url = authorize
  }
  return { url: url.href, userCode, deviceCode }
}

export async function checkJimengAccount() {
  const response = await runJimengCli('status')
  const account = parseJimengJson(response)
  if (!account || account.success === false || account.error || /(?:未登录|login required|not logged)/i.test(response)) throw new Error('请先登录即梦账号')
  return account
}

export async function beginJimengLogin(relogin = false) {
  const response = await runJimengCli(relogin ? 'relogin' : 'begin')
  const challenge = parseJimengChallenge(response)
  if (challenge) return challenge
  await checkJimengAccount()
  return undefined
}

export function openJimengLogin(url: string) {
  return invokeJimeng<void>('jimeng_open_login', { url })
}

export function readJimengMedia(id: string, video: boolean) {
  return invokeJimeng<ArrayBuffer | number[]>('jimeng_downloaded_media', { id, video }).then((data) => data instanceof ArrayBuffer ? new Uint8Array(data) : Uint8Array.from(data))
}

export function parseJimengModelHelp(help: string, capability: 'image' | 'video') {
  const modelList = /^- model_version(?: values)?:\s*([^\n\r]+)/im.exec(help)?.[1] ?? ''
  return modelList.split(',').map((id) => id.trim()).filter((id) => /^[\w.-]+$/.test(id))
    .map((id) => ({ id, name: capability === 'image' ? '即梦 ' + id : '即梦 ' + id.replace('seedance', 'Seedance '), capability }))
}

export async function listJimengModels() {
  const [image, video] = await Promise.all([runJimengCli('image_models'), runJimengCli('video_models')])
  const models = [...parseJimengModelHelp(image, 'image'), ...parseJimengModelHelp(video, 'video')]
  if (!models.length) throw new Error('即梦 CLI 未列出模型，请从官网更新后再试')
  return models
}

export const jimengImageRatios = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9']
export const jimengVideoRatios = ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9']
export const jimengImageResolutions = (model: string): readonly ('1K' | '2K' | '4K')[] => /^3\./.test(model) ? ['1K', '2K'] : ['2K', '4K']
