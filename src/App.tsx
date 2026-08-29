import { lazy, Suspense, useEffect, useState } from 'react'
import PublicRoute from './PublicRoute'

const HomeRoute = lazy(() => import('./HomeRoute'))
const AuthRoute = lazy(() => import('./AuthRoute'))
const PlatformRoute = lazy(() => import('./PlatformRoute'))
const AdminRoute = lazy(() => import('./AdminRoute'))

function pageFor(pathname: string) {
  if (pathname === '/' || pathname === '') return 'home'
  if (pathname === '/entrar') return 'login'
  if (pathname === '/criar-conta') return 'register'
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'platform'
  if (pathname === '/painel' || pathname.startsWith('/painel/')) return 'admin'
  return 'store'
}

function RouteFallback() {
  return <div className="store-loading"><span className="brand__mark">AS</span><strong>Carregando…</strong></div>
}

export default function App() {
  const [page, setPage] = useState(() => pageFor(window.location.pathname))

  useEffect(() => {
    const onPop = () => setPage(pageFor(window.location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // A vitrine é o caminho crítico: fica no bundle inicial. Painel, auth e plataforma
  // são carregados somente quando alguém realmente entra nessas áreas.
  if (page === 'store') return <PublicRoute />

  let content
  if (page === 'home') content = <HomeRoute />
  else if (page === 'login') content = <AuthRoute mode="login" />
  else if (page === 'register') content = <AuthRoute mode="register" />
  else if (page === 'platform') content = <PlatformRoute />
  else content = <AdminRoute />

  return <Suspense fallback={<RouteFallback />}>{content}</Suspense>
}
