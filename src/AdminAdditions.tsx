import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { BarChart3, Boxes } from 'lucide-react'
import CommercialSettingsPanel from './CommercialSettingsPanel'

function go(path: string) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export default function AdminAdditions() {
  const [navTarget, setNavTarget] = useState<HTMLElement | null>(null)
  const [storeTarget, setStoreTarget] = useState<HTMLElement | null>(null)

  useEffect(() => {
    let frame = 0
    const sync = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const nextNav = document.querySelector<HTMLElement>('.panel-nav')
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
