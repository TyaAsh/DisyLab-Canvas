import { createContext, createElement, useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { applyDocumentLocale, getLocale, subscribeLocale, type Locale } from './core'

export const LocaleContext = createContext<Locale>(getLocale())
export const PreserveTextContext = createContext(false)
export function useLocale() { return useSyncExternalStore(subscribeLocale, getLocale, getLocale) }
export function LanguageProvider({ children }: { children: ReactNode }) {
  const locale = useLocale()
  useEffect(applyDocumentLocale, [locale])
  return createElement(LocaleContext.Provider, { value: locale }, children)
}
/** Preserve names, prompts, messages, filenames and provider-originated content verbatim. */
export function OriginalText({ children }: { children: ReactNode }) {
  return createElement(PreserveTextContext.Provider, { value: true }, children)
}
