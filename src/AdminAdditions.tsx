import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { BarChart3, Boxes, Images, Settings, TrendingUp, UsersRound } from 'lucide-react'
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

function hideGeneratedValueMetric() {
  const metrics = document.querySelector<HTMLElement>('.metric-row')
  if (!metrics) return
  for (const card of Array.from(metrics.children)) {
    const element = card as HTMLElement
    const label = element.querySelector('span')?.textContent?.trim().toLowerCase()
    if (label === 'valor gerado') element.style.display = 'none'
  }
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

        hideGeneratedValueMetric()

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
      <button onClick={() => go('/painel/midias')}><Images size={18}/><span>Fotos dos produtos</span></button>
      <button onClick={() => go('/painel/operacao')}><UsersRound size={18}/><span>Operação da loja</span></button>
      <button onClick={() => go('/painel/relatorios')}><BarChart3 size={18}/><span>Inteligência comercial</span></button>
      <button onClick={() => go('/painel/crescimento')}><TrendingUp size={18}/><span>Crescimento</span></button>
      <button onClick={() => go('/painel/recursos')}><Boxes size={18}/><span>Estoque e recursos</span></button>
      <button onClick={() => go('/painel/integracoes')}><Settings size={18}/><span>Integrações</span></button>
    </>, navTarget)}
    {storeTarget && createPortal(<CommercialSettingsPanel embedded/>, storeTarget)}
  </>
}
