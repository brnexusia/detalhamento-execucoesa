// Apenas um sinal de invalidação: nenhuma sessão, token, e-mail ou nome é guardado no storage.
export const authSignalKey = 'shopvax:session-changed'
const channelKey = 'shopvax:auth-broadcast'
let sharedChannel: BroadcastChannel | null = null

function channel() {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null
  try { return sharedChannel || (sharedChannel = new BroadcastChannel(channelKey)) } catch { return null }
}
export type AuthScope = 'owner' | 'customer'

export function notifyAuthChange(scope: AuthScope) {
  if (typeof window === 'undefined') return
  const signal = { scope, timestamp: Date.now(), id: Math.random().toString(36).slice(2) }
  try { window.localStorage.setItem(authSignalKey, JSON.stringify(signal)) } catch { /* armazenamento restrito */ }
  try { channel()?.postMessage(signal) } catch { /* BroadcastChannel indisponível */ }
  window.dispatchEvent(new CustomEvent(authSignalKey, { detail: signal }))
}

export function listenAuthChanges(scope: AuthScope, handler: () => void) {
  let latestId = ''
  const deliver = (value: { scope?: string; id?: string } | null) => {
    if (value?.scope !== scope || (value.id && latestId === value.id)) return
    if (value.id) latestId = value.id
    handler()
  }
  const onLocal = (event: Event) => deliver((event as CustomEvent<{ scope?: string; id?: string }>).detail)
  const onStorage = (event: StorageEvent) => {
    if (event.key !== authSignalKey || !event.newValue) return
    try { deliver(JSON.parse(event.newValue)) } catch { /* evento inválido */ }
  }
  const onBroadcast = (event: MessageEvent) => deliver(event.data)
  window.addEventListener(authSignalKey, onLocal)
  window.addEventListener('storage', onStorage)
  channel()?.addEventListener('message', onBroadcast)
  return () => {
    window.removeEventListener(authSignalKey, onLocal)
    window.removeEventListener('storage', onStorage)
    channel()?.removeEventListener('message', onBroadcast)
  }
}
