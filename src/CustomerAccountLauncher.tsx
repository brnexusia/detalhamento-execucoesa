import { useEffect, useMemo, useRef, useState } from 'react'
import { LogIn, Store, UserRound } from 'lucide-react'
import { api } from './api'
import './customer-account.css'
import { listenAuthChanges } from './auth-session-sync'

type StoreConfig = {
  customerLoginEnabled: boolean
  theme: { background: string; textColor: string; font: string }
}

type Entry = 'checking' | 'owner' | 'customer' | 'visitor'
type Check = 'owner' | 'customer' | 'visitor' | 'unavailable'

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
  const [entry, setEntry] = useState<Entry>('checking')
  const statusVersion = useRef(0)

  useEffect(() => {
    if (!storeSlug) return
    let mounted = true
    let lastFocusCheck = Date.now()
    const root = document.documentElement

    // The owner cookie is authoritative ONLY for that owner's own store.
    // A logged-in owner visiting another business is not that shop's customer.
    const refresh = () => {
      const version = ++statusVersion.current
      const owner: Promise<Check> = api.me()
        .then(identity => identity?.store?.slug === storeSlug ? 'owner' as const : 'visitor' as const)
        .catch(error => {
          const status = (error as Error & { status?: number }).status
          return status === 401 || status === 403 ? 'visitor' as const : 'unavailable' as const
        })
      const customer: Promise<Check> = fetch(`/api/public/store/${encodeURIComponent(storeSlug)}/customers/me`, {
        credentials:'include',cache:'no-store',
      }).then(response =>
        response.ok ? 'customer' as const :
          response.status === 401 || response.status === 403 ? 'visitor' as const : 'unavailable' as const
      ).catch(() => 'unavailable' as const)

      void Promise.all([owner, customer]).then(([ownerRole, customerRole]) => {
        if (!mounted || version !== statusVersion.current) return
        if (ownerRole === 'owner') setEntry('owner')
        else if (customerRole === 'customer') setEntry('customer')
        else if (ownerRole === 'unavailable' || customerRole === 'unavailable') {
          // A transient API failure must not falsely log someone out.
          setEntry(previous => previous === 'checking' ? 'checking' : previous)
        } else setEntry('visitor')
      })
    }

    fetch(`/api/public/store/${encodeURIComponent(storeSlug)}/phase2-config`, { credentials:'include' })
      .then(async response => response.ok ? response.json() as Promise<StoreConfig> : null)
      .then(config => {
        if (!mounted || !config) return
        setEnabled(config.customerLoginEnabled === true)
        root.dataset.shopvaxStoreTheme = 'true'
        root.style.setProperty('--shopvax-store-bg', config.theme?.background || '#ffffff')
        root.style.setProperty('--shopvax-store-text', config.theme?.textColor || '#17211b')
        root.style.setProperty('--shopvax-store-font', fontStack(config.theme?.font || 'system'))
      })
      .catch(() => undefined)

    refresh()
    const unsubscribeOwner = listenAuthChanges('owner', refresh)
    const unsubscribeCustomer = listenAuthChanges('customer', refresh)
    const onFocus = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastFocusCheck < 15_000) return
      lastFocusCheck = Date.now()
      refresh()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)

    return () => {
      mounted = false
      statusVersion.current++
      unsubscribeOwner()
      unsubscribeCustomer()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
      delete root.dataset.shopvaxStoreTheme
      root.style.removeProperty('--shopvax-store-bg')
      root.style.removeProperty('--shopvax-store-text')
      root.style.removeProperty('--shopvax-store-font')
    }
  }, [storeSlug])

  // Never flash "Entrar" while the server is checking a valid owner session.
  if (entry === 'checking' || (entry !== 'owner' && !enabled)) return null
  const owner = entry === 'owner'
  const customer = entry === 'customer'
  return <button
    type="button"
    className="shopvax-customer-launcher"
    onClick={() => go(owner ? '/painel' : `/cliente/${storeSlug}`)}
  >{owner ? <Store size={16}/> : customer ? <UserRound size={16}/> : <LogIn size={16}/>}
    {owner ? 'Meu painel' : customer ? 'Minha conta' : 'Entrar'}
  </button>
}
