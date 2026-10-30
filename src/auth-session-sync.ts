// Apenas um sinal de invalidação: nenhuma sessão, token, e-mail ou nome é guardado no storage.
export const authSignalKey = 'shopvax:session-changed'
export type AuthScope = 'owner' | 'customer'

export function notifyAuthChange(scope: AuthScope) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(authSignalKey, JSON.stringify({ scope, timestamp: Date.now(), id: Math.random().toString(36).slice(2) }))
  } catch { /* armazenamento restrito */ }
  window.dispatchEvent(new CustomEvent(authSignalKey, { detail: { scope } }))
}

export function listenAuthChanges(scope: AuthScope, handler: () => void) {
  const onLocal = (event: Event) => {
    if ((event as CustomEvent<{ scope?: string }>).detail?.scope === scope) handler()
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key !== authSignalKey || !event.newValue) return
    try { if (JSON.parse(event.newValue)?.scope === scope) handler() } catch { /* evento inválido */ }
  }
  window.addEventListener(authSignalKey, onLocal)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(authSignalKey, onLocal)
    window.removeEventListener('storage', onStorage)
  }
}
