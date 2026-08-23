import { useEffect, useState } from 'react'
import AdminApp from './AdminApp'
import { AuthPage } from './Auth'
import Home from './Home'
import PlatformAdmin from './PlatformAdmin'
import PublicStore from './PublicStore'

function pageFor(pathname: string) {
  if (pathname === '/' || pathname === '') return 'home'
  if (pathname === '/entrar') return 'login'
  if (pathname === '/criar-conta') return 'register'
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'platform'
  if (pathname === '/painel' || pathname.startsWith('/painel/')) return 'admin'
  return 'store'
}

export default function App() {
  const [page, setPage] = useState(() => pageFor(window.location.pathname))

  useEffect(() => {
    const onPop = () => setPage(pageFor(window.location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  if (page === 'home') return <Home />
  if (page === 'login') return <AuthPage mode="login" />
  if (page === 'register') return <AuthPage mode="register" />
  if (page === 'platform') return <PlatformAdmin />
  if (page === 'admin') return <AdminApp />
  return <PublicStore />
}
