export type ApiProviderPreset = {
  id: string
  name: string
  badge: string
  detail: string
  baseUrl: string
  consoleUrl?: string
  docsUrl?: string
  featured?: boolean
  accountOnly?: boolean
}

export const API_PROVIDER_PRESETS: readonly ApiProviderPreset[] = [
  { id: 'grsai', name: 'GRS AI', badge: 'GR', baseUrl: 'https://grsai.dakka.com.cn/v1', detail: '文本 · 图像 · 视频', consoleUrl: 'https://grsai.com/', featured: true },
  { id: 'hfsy', name: 'HFSY API', badge: 'HF', baseUrl: 'https://www.hfsyapi.cn/v1', detail: '多模型聚合 · Muse 视频', consoleUrl: 'https://www.hfsyapi.cn/', docsUrl: 'https://www.hfsyapi.cn/docs/api?model=muse-video', featured: true },
  { id: 'relayon', name: '万象 API', badge: 'RA', baseUrl: 'https://relayonapi.com/v1', detail: 'RelayOnAPI · 多模型聚合', consoleUrl: 'https://relayonapi.com/', docsUrl: 'https://relayonapi.com/docs' },
  { id: 'minimax', name: 'MiniMax 官方', badge: 'MM', baseUrl: 'https://api.minimaxi.com/v1', detail: '文本 · 海螺视频 · 语音', consoleUrl: 'https://platform.minimaxi.com/', docsUrl: 'https://platform.minimax.io/docs/api-reference/video-generation-v2-create' },
  { id: 'xai', name: 'xAI / Grok 官方', badge: 'xAI', baseUrl: 'https://api.x.ai/v1', detail: '文本 · 图像 · 视频', consoleUrl: 'https://console.x.ai/', docsUrl: 'https://docs.x.ai/' },
  { id: 'ark', name: '火山方舟', badge: '方舟', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', detail: '豆包 · Seedream · Seedance', consoleUrl: 'https://console.volcengine.com/ark/region:cn-beijing/overview', docsUrl: 'https://docs.volcengine.com/docs/ark/video-generation-tutorial?lang=zh' },
  { id: 'jimeng', name: '即梦', badge: '即梦', baseUrl: 'https://jimeng.jianying.com/cli', detail: '官方账号授权 · 桌面版', consoleUrl: 'https://jimeng.jianying.com/', docsUrl: 'https://bytedance.larkoffice.com/wiki/FVTwwm0bGiishxkKOoScdHR2nsg', accountOnly: true },
  { id: 'muse-web', name: 'Muse 账号', badge: 'MU', baseUrl: 'https://muse.ai/', detail: '网页登录 · 仅桌面版', consoleUrl: 'https://muse.ai/', accountOnly: true },
  { id: 'muse', name: 'Muse API', badge: 'MU', baseUrl: 'https://api.meta.ai/v1', detail: 'Meta Model API Key', consoleUrl: 'https://dev.meta.ai/', docsUrl: 'https://dev.meta.ai/docs/overview' },
  { id: 'apimart', name: 'APIMart', badge: 'AP', baseUrl: 'https://api.apimart.ai/v1', detail: 'OpenAI 兼容 · 余额查询', consoleUrl: 'https://apimart.ai/' },
  { id: 'openai', name: 'OpenAI', badge: 'OA', baseUrl: 'https://api.openai.com/v1', detail: 'GPT · 图像模型', consoleUrl: 'https://platform.openai.com/' },
  { id: 'gemini', name: 'Google Gemini', badge: 'G', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', detail: '官方 Gemini · OpenAI 兼容', consoleUrl: 'https://aistudio.google.com/' },
  { id: 'runninghub', name: 'RunningHub', badge: 'RH', baseUrl: 'https://www.runninghub.ai/openapi/v1', detail: '工作流 · 媒体生成', consoleUrl: 'https://www.runninghub.ai/' },
  { id: 'custom', name: '自定义接口', badge: 'API', baseUrl: '', detail: '填写 OpenAI 兼容地址' },
]

export function apiProviderForBase(baseUrl: string) {
  let host: string
  try { host = new URL(baseUrl.trim()).hostname } catch { return undefined }
  const aliases: Record<string, string> = {
    'grsaiapi.com': 'grsai', 'www.grsaiapi.com': 'grsai',
    'api.hfsyapi.cn': 'hfsy', 'apigo.hfsyapi.cn': 'hfsy',
    'api.minimax.io': 'minimax', 'api.relayonapi.com': 'relayon', 'www.relayonapi.com': 'relayon',
  }
  return API_PROVIDER_PRESETS.find((preset) => preset.baseUrl && (preset.id === aliases[host] || new URL(preset.baseUrl).hostname === host))
}

export function customApiConsoleUrl(baseUrl: string) {
  try {
    const url = new URL(baseUrl)
    return url.protocol === 'https:' && !url.username && !url.password ? url.origin : undefined
  } catch { return undefined }
}
