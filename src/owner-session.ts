import { useEffect, useState } from 'react'
import { api } from './api'
import { listenAuthChanges } from './auth-session-sync'

// Never persist owner identity or tokens in browser storage. The backend session
// cookie and /api/auth/me are the only authority.
export type OwnerSessionStatus = 'checking' | 'authenticated' | 'anonymous' | 'unavailable'

export async function verifyOwnerSession(): Promise<OwnerSessionStatus> {
  try {
    const identity = await api.me()
    // A 200 com HTML do proxy (ou JSON incompleto) não comprova autenticação.
    if (!identity || typeof identity.user?.id !== 'string' || typeof identity.store?.id !== 'string') return 'unavailable'
    return 'authenticated'
  } catch (error) {
    const status = (error as Error & { status?: number }).status
    // A transient 5xx/offline response must not be mistaken for logout.
    return status === 401 || status === 403 ? 'anonymous' : 'unavailable'
  }
}

export function useOwnerSession(): OwnerSessionStatus {
  const [status, setStatus] = useState<OwnerSessionStatus>('checking')
  useEffect(() => {
    let mounted = true
    let version = 0
    const refresh = () => {
      const current = ++version
      void verifyOwnerSession().then((next) => {
        if (mounted && version === current) setStatus(next)
      })
    }
    refresh()
    let lastFocusCheck = Date.now()
    const unsubscribe = listenAuthChanges('owner', refresh)
    const onFocus = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastFocusCheck < 15_000) return
      lastFocusCheck = Date.now()
      refresh()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      mounted = false
      version++
      unsubscribe()
      window.removeEventListener('focus', onFocus)
    }
  }, [])
  return status
}
