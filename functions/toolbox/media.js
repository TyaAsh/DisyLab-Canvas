import { fetchSharedMedia, resolveSharedPost } from '../../src/sharedMedia.ts'

export async function onRequestGet({ request }) {
  const params = new URL(request.url).searchParams
  const url = params.get('url') || ''
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45000)])
  const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
  try {
    if (!url || url.length > 4096) throw new Error('链接不完整或过长')
    if (params.get('action') === 'file') return await fetchSharedMedia(url, fetch, signal)
    if (params.get('action') === 'post') return Response.json(await resolveSharedPost(url, fetch, signal), { headers })
    return Response.json({ error: '不支持的操作' }, { status: 400, headers })
  } catch (error) {
    const message = signal.aborted ? '读取链接超时，请重试或导入本地文件' : error instanceof Error ? error.message : '读取链接失败'
    return Response.json({ error: message }, { status: 422, headers })
  }
}
