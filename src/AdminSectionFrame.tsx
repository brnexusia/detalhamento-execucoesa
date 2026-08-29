import { useEffect, useState, type ReactNode } from 'react'
import { BarChart3, Boxes, ExternalLink, Home, LogOut, Menu, Package, ReceiptText, Settings, Store as StoreIcon, Users, X } from 'lucide-react'
import { api } from './api'
import type { AdminBootstrap } from './types'
import './admin-section-frame.css'

type ActiveSection = 'relatorios' | 'recursos'

function go(path: string) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function FrameNavItem({ active, icon, label, count, path, onNavigate }: { active?: boolean; icon: ReactNode; label: string; count?: number; path: string; onNavigate: () => void }) {
  return <button className={active ? 'is-active' : ''} onClick={() => { onNavigate(); go(path) }}>{icon}<span>{label}</span>{typeof count === 'number' && <b>{count}</b>}</button>
}

export default function AdminSectionFrame({ active, children }: { active: ActiveSection; children: ReactNode }) {
  const [data, setData] = useState<AdminBootstrap | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    let mounted = true
    api.bootstrap().then((result) => { if (mounted) setData(result) }).catch(() => undefined)
    return () => { mounted = false }
  }, [])

  const closeMenu = () => setMenuOpen(false)
  const storeUrl = data ? `${window.location.origin}/${data.store.slug}` : ''
  const logout = async () => {
    await api.logout().catch(() => undefined)
    go('/entrar')
  }

  return <div className="panel-shell">
    <aside className={`panel-sidebar ${menuOpen ? 'is-open' : ''}`}>
      <div className="panel-brand"><span className="brand__mark">AS</span><div><strong>Atacado Shop</strong><small>{data?.store.name || 'Painel'}</small></div><button className="panel-close-menu" onClick={closeMenu}><X size={18}/></button></div>
      <nav className="panel-nav">
        <FrameNavItem icon={<Home size={18}/>} label="Início" path="/painel" onNavigate={closeMenu}/>
        <FrameNavItem icon={<Package size={18}/>} label="Produtos" count={data?.products.length} path="/painel/produtos" onNavigate={closeMenu}/>
        <FrameNavItem icon={<ReceiptText size={18}/>} label="Pedidos" count={data?.orders.length} path="/painel/pedidos" onNavigate={closeMenu}/>
        <FrameNavItem icon={<Users size={18}/>} label="Vendedoras" count={data?.sellers.length} path="/painel/vendedoras" onNavigate={closeMenu}/>
        <FrameNavItem active={active === 'relatorios'} icon={<BarChart3 size={18}/>} label="Inteligência comercial" path="/painel/relatorios" onNavigate={closeMenu}/>
        <FrameNavItem active={active === 'recursos'} icon={<Boxes size={18}/>} label="Estoque e recursos" path="/painel/recursos" onNavigate={closeMenu}/>
        <FrameNavItem icon={<Settings size={18}/>} label="Minha loja" path="/painel/loja" onNavigate={closeMenu}/>
      </nav>
      <div className="panel-sidebar__foot">{storeUrl && <a href={storeUrl} target="_blank" rel="noreferrer"><ExternalLink size={17}/> Ver loja</a>}<button onClick={logout}><LogOut size={17}/> Sair</button></div>
    </aside>
    <main className="panel-main">
      <header className="panel-topbar"><button className="panel-menu" onClick={() => setMenuOpen(true)}><Menu size={20}/></button><div><span>Painel</span><strong>{active === 'relatorios' ? 'Inteligência comercial' : 'Estoque e recursos'}</strong></div>{storeUrl && <a className="panel-store-link" href={storeUrl} target="_blank" rel="noreferrer"><StoreIcon size={17}/> Abrir loja <ExternalLink size={14}/></a>}</header>
      <div className="embedded-admin-section">{children}</div>
    </main>
  </div>
}
