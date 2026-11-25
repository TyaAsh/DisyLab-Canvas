import { createElement, useContext, type ElementType, type ReactNode } from 'react'
import { jsx as reactJsx, jsxs as reactJsxs, Fragment } from 'react/jsx-runtime'
import { isMotionComponent } from 'framer-motion'
import { PreserveTextContext, useLocale } from './react'
import { translateUi } from './core'
export type { JSX } from 'react/jsx-runtime'
export { Fragment }

const wrappers = new Map<ElementType, ElementType>()
const textAttributes = ['title', 'placeholder', 'aria-label', 'aria-description', 'aria-valuetext', 'alt', 'data-placeholder', 'data-tooltip']
const protectedClass = /(?:^|\s)(?:node-title|agent-message-original|output-record-prompt|agent-plan-prompt|agent-reference-name|original-text)(?:\s|$)/
function localizedType(type: ElementType) {
  let existing = wrappers.get(type)
  if (existing) return existing
  function LocalizedSurface(props: Record<string, unknown>) {
    const locale = useLocale(), inherited = useContext(PreserveTextContext)
    const classes = String(props.className ?? '')
    const original = props.translate === 'no' || props['data-i18n'] === 'original'
    const preserve = inherited || original || props.contentEditable === true || protectedClass.test(classes) || (/(?:^|\s)node-body(?:\s|$)/.test(classes) && !classes.includes('is-empty'))
    const output = { ...props }
    // Editable values, IDs, callbacks, options and data attributes retain their original values.
    for (const attribute of textAttributes) if (typeof output[attribute] === 'string' && !inherited && !original) output[attribute] = translateUi(output[attribute] as string, locale)
    const content = (child: unknown): unknown => {
      if (Array.isArray(child)) {
        const translated = child.map(content)
        // JSX often separates counts from labels: {count} 个模型. English needs
        // a word boundary even when the original CJK fragment has no space.
        return locale === 'en' && !preserve ? translated.map((entry, index) => {
          if (typeof entry !== 'string' || entry === child[index]) return entry
          let item: string = entry
          const before = translated[index - 1], after = translated[index + 1]
          if (/^[A-Za-z]/.test(item) && (typeof before === 'number' || typeof before === 'string' && /[\p{L}\d]$/u.test(before))) item = ' ' + item
          if (/[A-Za-z]$/.test(item) && (typeof after === 'number' || typeof after === 'string' && /^[\p{L}\d]/u.test(after))) item += ' '
          return item
        }) : translated
      }
      return typeof child === 'string' && !preserve ? translateUi(child, locale) : child
    }
    output.children = content(props.children)
    const children = preserve && !inherited && output.children !== undefined && output.children !== null ? createElement(PreserveTextContext.Provider, { value: true }, output.children as ReactNode) : output.children
    return (Array.isArray(children) ? reactJsxs : reactJsx)(type, { ...output, children })
  }
  LocalizedSurface.displayName = `Localized(${typeof type === 'string' ? type : 'motion'})`
  existing = LocalizedSurface as ElementType
  wrappers.set(type, existing)
  return existing
}

export function jsx(type: ElementType, props: Record<string, unknown>, key?: string) {
  // Component props may carry business data. Only DOM and motion surfaces localize visible text.
  return reactJsx(typeof type === 'string' || isMotionComponent(type) ? localizedType(type) : type, props, key)
}
export const jsxs = jsx
