/*!
 * Copyright (c) 2026 DisyLab. All rights reserved.
 * SPDX-License-Identifier: LicenseRef-DisyLab-Proprietary
 */
import type { AgentImageReference } from './agent'

export type ImageRegion = [left: number, top: number, right: number, bottom: number]
export type AgentImageOperation = {
  kind: 'split' | 'upscale'
  requestedCount?: number
  longEdge?: number
}
export type AgentImageOperationDraft = AgentImageOperation & {
  source: AgentImageReference
  previewUrl: string
  regions: ImageRegion[]
  completedNodeIds?: string[]
}

export function inferAgentImageOperation(request: string): AgentImageOperation | undefined {
  const text = request.normalize('NFKC').replace(/@\[node:[^\]]+\]/g, '')
  if (/^(?:请|帮我|先|只|\s)*(?:分析|检查|看一下|看看|评估|告诉我)/.test(text)
      || /(?:不要|先别|暂不)\s*(?:拆分|拆图|裁切|放大|执行)|(?:重绘|重新生成)(?:每|这些|所有)/.test(text.replace(/(?:不|不要|无需)\s*(?:重绘|重新生成)/g, ''))) return
  const split = /(?:拆|分割|裁|切分|提取|\b(?:split|extract|crop)\b)/i.test(text)
    && /(?:分镜|镜头|宫格|拼图|拼接图|每格|每一格|每个画面|storyboard|contact sheet|image grid)/i.test(text)
  const upscale = /(?:无损放大|超分|提高分辨率|放大(?:这|原|选中)?(?:张|个|图|图片)|(?:把|将).{0,15}(?:图|图片).{0,8}放大|\bupscale\b)/i.test(text)
  if (!split && !upscale) return
  const count = /(?:一共|共计|总共|共|全部|只要|只拆|前|拆成|拆出|拆分为|拆为|输出|保留)\s*(?:是|要)?\s*(\d{1,2}|[一二两三四五六七八九十]{1,3})\s*(?:张|格|镜)/.exec(text)?.[1]
  const digits = '一二三四五六七八九'
  const digit = (value: string) => value === '两' ? 2 : value ? digits.indexOf(value) + 1 : 0
  const [tens, ones] = (count ?? '').split('十')
  const requestedCount = count && /^\d+$/.test(count) ? Number(count)
    : ones !== undefined ? (digit(tens) || 1) * 10 + digit(ones) : digit(tens)
  const resolution = /(?:^|[^a-z0-9])([124])\s*K(?![a-z0-9])/i.exec(text)?.[1]
  return {
    kind: split ? 'split' : 'upscale',
    ...(split && requestedCount ? { requestedCount } : {}),
    longEdge: resolution ? Number(resolution) * 1024 : upscale || /高清|大图|高分辨率/.test(text) ? 2048 : undefined,
  }
}

export function legacyStoryboardOperation(plan: { label?: string; prompt: string }) {
  const operation = inferAgentImageOperation(`${plan.label ?? ''}\n${plan.prompt}`)
  if (operation?.kind !== 'split') return undefined
  const labelCount = /[(（]\s*(\d{1,2})\s*张/.exec(plan.label ?? '')?.[1]
  return { ...operation, requestedCount: labelCount ? Number(labelCount) : operation.requestedCount }
}

export function parseStoryboardRegions(raw: string): ImageRegion[] {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const parsed: unknown = JSON.parse(cleaned)
  const regions = parsed && typeof parsed === 'object' && 'regions' in parsed ? parsed.regions : undefined
  if (!Array.isArray(regions) || regions.length < 2 || regions.length > 60) throw new Error('未识别出可用的分镜边界')
  const valid: ImageRegion[] = regions.map((region) => {
    if (!Array.isArray(region) || region.length !== 4
      || !region.every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1000)
      || region[2] - region[0] < 10 || region[3] - region[1] < 10) throw new Error('分镜裁切范围有误')
    return [region[0], region[1], region[2], region[3]]
  })
  valid.forEach(([left, top, right, bottom], index) => {
    for (const [x1, y1, x2, y2] of valid.slice(0, index)) {
      const overlap = Math.max(0, Math.min(right, x2) - Math.max(left, x1))
        * Math.max(0, Math.min(bottom, y2) - Math.max(top, y1))
      if (overlap > Math.min((right - left) * (bottom - top), (x2 - x1) * (y2 - y1)) * 0.025) {
        throw new Error('识别出的镜头边界重叠')
      }
    }
  })
  return valid
}

export function imageRegionPixels(region: ImageRegion, width: number, height: number, longEdge?: number) {
  const left = Math.round(region[0] * width / 1000)
  const top = Math.round(region[1] * height / 1000)
  const cropWidth = Math.round(region[2] * width / 1000) - left
  const cropHeight = Math.round(region[3] * height / 1000) - top
  if (cropWidth < 1 || cropHeight < 1) throw new Error('镜头的裁切范围不足一个像素')
  const scale = Math.max(1, (longEdge ?? 0) / Math.max(cropWidth, cropHeight))
  return { left, top, cropWidth, cropHeight, width: Math.round(cropWidth * scale), height: Math.round(cropHeight * scale) }
}
