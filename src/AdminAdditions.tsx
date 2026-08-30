import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { BarChart3, Boxes } from 'lucide-react'
import CommercialSettingsPanel from './CommercialSettingsPanel'

function go(path: string) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function ensureNavigationMount(nav: HTMLElement | null) {
  if (!nav) return null
  let mount = nav.querySelector<HTMLElement>('[data-panel-extra-navigation="true"]')
  if (mount) return mount

  mount = document.createElement('span')
  mount.dataset.panelExtraNavigation = 'true'
  mount.style.display = 'contents'

  const storeButton = Array.from(nav.querySelectorAll<HTMLButtonElement>(':scope > button')).find((button) =>
    button.textContent?.trim().toLowerCase().includes('minha loja'),
  )
  nav.insertBefore(mount, storeButton || null)
  return mount
}

export default function AdminAdditions() {
  const [navTarget, setNavTarget] = useState<HTMLElement | null>(null)
  const [storeTarget, setStoreTarget] = useState<HTMLElement | null>(null)

  useEffect(() => {
    let frame = 0
    let ownedMount: HTMLElement | null = null

    const sync = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const nav = document.querySelector<HTMLElement>('.panel-nav')
        const nextNav = ensureNavigationMount(nav)
        if (nextNav) ownedMount = nextNav

        const isStore = window.location.pathname === '/painel/loja' || window.location.pathname.startsWith('/painel/loja/')
        const nextStore = isStore ? document.querySelector<HTMLElement>('.panel-main .panel-page') : null
        setNavTarget((current) => current === nextNav ? current : nextNav)
        setStoreTarget((current) => current === nextStore ? current : nextStore)
      })
    }

    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('popstate', sync)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('popstate', sync)
      ownedMount?.remove()
    }
  }, [])

  return <>
    {navTarget && createPortal(<>
      <button onClick={() => go('/painel/relatorios')}><BarChart3 size={18}/><span>Inteligência comercial</span></button>
      <button onClick={() => go('/painel/recursos')}><Boxes size={18}/><span>Estoque e recursos</span></button>
    </>, navTarget)}
    {storeTarget && createPortal(<CommercialSettingsPanel embedded/>, storeTarget)}
  </>
}
