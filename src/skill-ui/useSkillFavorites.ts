import { useSyncExternalStore } from 'react'
import { subscribeToSkillDeletion } from '../skills/storage'

const FAVORITES_KEY = 'disylab.agent-skill-favorites'
const listeners = new Set<() => void>()

function readFavorites(): Set<string> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? '[]')
    return new Set(Array.isArray(saved) ? saved.filter((item): item is string => typeof item === 'string') : [])
  } catch {
    return new Set()
  }
}

let favorites = readFavorites()
const getFavorites = () => favorites

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useSkillFavorites() {
  return useSyncExternalStore(subscribe, getFavorites)
}

export function toggleSkillFavorite(key: string) {
  const next = new Set(favorites)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  favorites = next
  try { localStorage.setItem(FAVORITES_KEY, JSON.stringify([...next])) } catch { /* Keep favorites for this session. */ }
  listeners.forEach((listener) => listener())
}

subscribeToSkillDeletion((key) => {
  if (favorites.has(key)) toggleSkillFavorite(key)
})
