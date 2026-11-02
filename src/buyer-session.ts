import { useEffect, useState } from 'react'
import { apiRequest } from './api'
import { listenAuthChanges } from './auth-session-sync'

// A sessão global de comprador é validada exclusivamente pelo cookie HttpOnly do servidor.
export type BuyerSessionStatus = 'checking' | 'authenticated' | 'anonymous' | 'unavailable'

export async function verifyBuyerSession(): Promise<BuyerSessionStatus> {
  try {
    const identity = await apiRequest<{ buyer?: { id?: string } }>('/api/public/buyer-auth/me')
    return identity?.buyer && typeof identity.buyer.id === 'string' ? 'authenticated' : 'unavailable'
  } catch (error) {
    const status = (error as Error & { status?: number }).status
    return status === 401 || status === 403 ? 'anonymous' : 'unavailable'
  }
}

export function useBuyerSession(): BuyerSessionStatus {
  const [status, setStatus] = useState<BuyerSessionStatus>('checking')
  useEffect(() => {
    let mounted = true
    let version = 0
    const refresh = () => {
      const current = ++version
      void verifyBuyerSession().then((next) => {
        if (mounted && version === current) setStatus(next)
      })
    }
    refresh()
    const unsubscribe = listenAuthChanges('customer', refresh)
    const onFocus = () => { if (document.visibilityState === 'visible') refresh() }
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
