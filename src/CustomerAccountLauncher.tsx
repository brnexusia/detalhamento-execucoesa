import { useEffect, useMemo, useState } from 'react'
import { LogIn, UserRound } from 'lucide-react'
import './customer-account.css'

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

  useEffect(() => {
    if (!storeSlug) return
    let mounted = true
    const root = document.documentElement

    fetch(`/api/public/store/${encodeURIComponent(storeSlug)}/phase2-config`, { credentials: 'include' })
      .then(async (response) => response.ok ? response.json() as Promise<StoreConfig> : null)
      .then((config) => {
        if (!mounted || !config) return
        setEnabled(config.customerLoginEnabled === true)
        root.dataset.shopvaxStoreTheme = 'true'
        root.style.setProperty('--shopvax-store-bg', config.theme?.background || '#ffffff')
        root.style.setProperty('--shopvax-store-text', config.theme?.textColor || '#17211b')
        root.style.setProperty('--shopvax-store-font', fontStack(config.theme?.font || 'system'))
        if (config.customerLoginEnabled) {
          fetch(`/api/public/store/${encodeURIComponent(storeSlug)}/customers/me`, { credentials: 'include' })
            .then((response) => { if (mounted) setSignedIn(response.ok) })
            .catch(() => undefined)
        }
      })
      .catch(() => undefined)

    return () => {
      mounted = false
      delete root.dataset.shopvaxStoreTheme
      root.style.removeProperty('--shopvax-store-bg')
      root.style.removeProperty('--shopvax-store-text')
      root.style.removeProperty('--shopvax-store-font')
    }
  }, [storeSlug])

  if (!enabled) return null
  return <button className="shopvax-customer-launcher" onClick={() => go(`/cliente/${storeSlug}`)}>{signedIn ? <UserRound size={16}/> : <LogIn size={16}/>} {signedIn ? 'Minha conta' : 'Entrar'}</button>
}
