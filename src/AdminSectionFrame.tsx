import { useEffect, useState, type ReactNode } from 'react'
import { ExternalLink, LogOut, Menu, Store as StoreIcon, X } from 'lucide-react'
import { api } from './api'
import AdminNavigation, { type PrimaryAdminSection } from './AdminNavigation'
import { confirmNavigationIfDirty } from './unsaved-changes'
import './admin-section-frame.css'

type ActiveSection = 'relatorios' | 'recursos' | 'midias' | 'operacao' | 'crescimento' | 'integracoes' | 'assinatura'

function go(path: string) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export default function AdminSectionFrame({ active, children }: { active: ActiveSection; children: ReactNode }) {
  const [data, setData] = useState<{ user: { id: string; name: string; email: string }; store: { slug: string; name: string; plan_tier?: string } } | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    let mounted = true
    api.me().then((result) => { if (mounted) setData(result) }).catch(() => undefined)
    return () => { mounted = false }
  }, [])

  const closeMenu = () => setMenuOpen(false)
  const storeUrl = data ? `${window.location.origin}/${data.store.slug}` : ''
  const logout = async () => {
    await api.logout().catch(() => undefined)
    go('/entrar')
  }
  const title = active === 'relatorios' ? 'Inteligência comercial'
    : active === 'midias' ? 'Fotos dos produtos'
      : active === 'operacao' ? 'Operação da loja'
        : active === 'crescimento' ? 'Crescimento e confiança'
          : active === 'integracoes' ? 'Integrações e checkout'
            : active === 'assinatura' ? 'Plano e uso'
              : active === 'recursos' ? 'Estoque e catálogos'
                : 'Clientes e domínio'

  const primaryActive: PrimaryAdminSection = active === 'relatorios' ? 'relatorios' : active === 'midias' ? 'produtos' : 'loja'

  return <div className="panel-shell">
    <aside className={`panel-sidebar ${menuOpen ? 'is-open' : ''}`}>
      <div className="panel-brand"><span className="brand__mark">SV</span><div><strong>Shopvax</strong><small>{data?.store.name || 'Painel'}</small></div><button className="panel-close-menu" onClick={closeMenu} aria-label="Fechar menu"><X size={18}/></button></div>
      <AdminNavigation
        active={primaryActive}
        planCode={data?.store.plan_tier}
        onNavigate={closeMenu}
        beforeNavigate={confirmNavigationIfDirty}
      />
      <div className="panel-sidebar__foot">{storeUrl && <a href={storeUrl} target="_blank" rel="noreferrer"><ExternalLink size={17}/> Ver loja</a>}<button onClick={logout}><LogOut size={17}/> Sair</button></div>
    </aside>
    <main className="panel-main">
      <header className="panel-topbar"><button className="panel-menu" onClick={() => setMenuOpen(true)}><Menu size={20}/></button><div><span>Painel</span><strong>{title}</strong></div>{storeUrl && <a className="panel-store-link" href={storeUrl} target="_blank" rel="noreferrer"><StoreIcon size={17}/> Abrir loja <ExternalLink size={14}/></a>}</header>
      <div className="embedded-admin-section">{children}</div>
    </main>
  </div>
}
