import { hasUnsavedChanges } from './unsaved-changes'

const guardKey = 'shopvax:chunk-recovery:last-attempt'
const cooldownMs = 90_000

/** Match only asset-version failures, not arbitrary React, API or network errors. */
export function isMissingAppModule(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error || '')
  return /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|loading chunk [^ ]+ failed|failed to load module script|unable to preload css/i.test(message)
}

/** A one-time refresh heals old JS references after EasyPanel replaces hashed chunks. */
export function recoverMissingAppModule(error: unknown): boolean {
  if (!isMissingAppModule(error) || typeof window === 'undefined') return false
  if (navigator.onLine === false || hasUnsavedChanges()) return false
  try {
    const last = Number(window.sessionStorage.getItem(guardKey) || '0')
    if (Date.now() - last < cooldownMs) return false
    // Set the guard BEFORE reloading. If the new deployment also fails, present
    // the manual recovery screen instead of creating an infinite refresh loop.
    window.sessionStorage.setItem(guardKey, String(Date.now()))
  } catch {
    return false
  }
  window.location.reload()
  return true
}
