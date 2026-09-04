import { ArrowLeft, UserRound } from 'lucide-react'
import './store-social-nav.css'

function storeSlug() {
  const parts = window.location.pathname.split('/').filter(Boolean)
  return parts[0] || ''
}

function go(path: string) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export default function StoreSocialNav() {
  const slug = storeSlug()
  if (!slug) return null
  return <nav className="store-social-nav" aria-label="Navegação Shopvax">
    <button onClick={() => go('/')}><ArrowLeft size={16}/> Feed</button>
    <button onClick={() => go(`/perfil/${encodeURIComponent(slug)}`)}><UserRound size={16}/> Perfil</button>
  </nav>
}
