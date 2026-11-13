import { useEffect, useMemo, useRef, useState } from 'react'
import { LogIn, UserRound } from 'lucide-react'
import './customer-account.css'
import { listenAuthChanges } from './auth-session-sync'
import { api } from './api'

type StoreConfig = {
  customerLoginEnabled: boolean
  theme: { background: string; textColor: string; font: string }
}

function go(path: string) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function fontStack(value: string) {
  if (value === 'serif') return 'Georgia, Cambria, "Times New Roman", serif'
  if (value === 'rounded') return 'ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif'
  if (value === 'modern') return 'Inter, "Helvetica Neue", Arial, system-ui, sans-serif'
  return 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
}

export default function CustomerAccountLauncher() {
  const storeSlug = useMemo(() => window.location.pathname.split('/').filter(Boolean)[0] || '', [])
  const [enabled, setEnabled] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  // Never infer store ownership from a browser flag or from the buyer session.
  // The verified /api/auth/me response must name THIS store's slug.
  const [ownerStatus, setOwnerStatus] = useState<'checking' | 'owner' | 'visitor' | 'unavailable'>('checking')
  const customerVersion = useRef(0)
  const ownerVersion = useRef(0)

  useEffect(() => {
    if (!storeSlug) return
    let mounted = true
    let customerEnabled = false
    const root = document.documentElement
    const refreshOwner = () => {
      const version = ++ownerVersion.current
      void api.me().then((identity) => {
        if (!mounted || version !== ownerVersion.current) return
        setOwnerStatus(
          typeof identity?.user?.id === 'string' &&
          typeof identity?.store?.id === 'string' &&
          identity.store.slug === storeSlug ? 'owner' : 'visitor',
        )
      }).catch((error: Error & {status?: number}) => {
        if (!mounted || version !== ownerVersion.current) return
        // A failing network call is NOT proof that the merchant logged out.
        setOwnerStatus(error.status === 401 || error.status === 403 ? 'visitor' : 'unavailable')
      })
    }
    const refreshCustomer = () => {
      if (!customerEnabled) return
      const version = ++customerVersion.current
      fetch(`/api/public/store/${encodeURIComponent(storeSlug)}/customers/me`, { credentials: 'include', cache: 'no-store' })
        .then((response) => {
          if (!mounted || version !== customerVersion.current) return
          if (response.ok) setSignedIn(true)
          else if (response.status === 401 || response.status === 403 || response.status === 404) setSignedIn(false)
        })
        .catch(() => { /* A temporary network error must not log the buyer out in the UI. */ })
    }

    // Owner recognition must work independently from the optional per-store customer login.
    refreshOwner()
    fetch(`/api/public/store/${encodeURIComponent(storeSlug)}/phase2-config`, { credentials: 'include' })
      .then(async (response) => response.ok ? response.json() as Promise<StoreConfig> : null)
      .then((config) => {
        if (!mounted || !config) return
        customerEnabled = config.customerLoginEnabled === true
        setEnabled(customerEnabled)
        root.dataset.shopvaxStoreTheme = 'true'
        root.style.setProperty('--shopvax-store-bg', config.theme?.background || '#ffffff')
        root.style.setProperty('--shopvax-store-text', config.theme?.textColor || '#17211b')
        root.style.setProperty('--shopvax-store-font', fontStack(config.theme?.font || 'system'))
        refreshCustomer()
      })
      .catch(() => undefined)

    const unsubscribeCustomer = listenAuthChanges('customer', refreshCustomer)
    const unsubscribeOwner = listenAuthChanges('owner', refreshOwner)
    let lastOwnerCheck = Date.now()
    const onFocus = () => {
      if (document.visibilityState !== 'visible') return
      refreshCustomer()
      if (Date.now() - lastOwnerCheck >= 15_000) {
        lastOwnerCheck = Date.now()
        refreshOwner()
      }
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      mounted = false
      customerVersion.current++
      ownerVersion.current++
      unsubscribeCustomer()
      unsubscribeOwner()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
      delete root.dataset.shopvaxStoreTheme
      root.style.removeProperty('--shopvax-store-bg')
      root.style.removeProperty('--shopvax-store-text')
      root.style.removeProperty('--shopvax-store-font')
    }
  }, [storeSlug])

  if (!enabled && ownerStatus !== 'owner') return null
  if (ownerStatus === 'checking') return null
  if (ownerStatus === 'owner') return <button type="button" className="shopvax-customer-launcher" onClick={() => go('/painel')}><UserRound size={16}/> Painel da loja</button>
  if (ownerStatus === 'unavailable' && !signedIn) {
    return <button type="button" className="shopvax-customer-launcher" onClick={() => window.location.reload()}><UserRound size={16}/> Verificar acesso</button>
  }
  return <button type="button" className="shopvax-customer-launcher" onClick={() => go(`/cliente/${encodeURIComponent(storeSlug)}`)}>{signedIn ? <UserRound size={16}/> : <LogIn size={16}/>} {signedIn ? 'Minha conta' : 'Entrar'}</button>
}
