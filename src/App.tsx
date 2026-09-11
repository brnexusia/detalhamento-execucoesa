import { lazy, Suspense, useEffect, useState } from 'react'
import PublicRoute from './PublicRoute'
import Phase3PublicRuntime from './Phase3PublicRuntime'
import Phase4PublicRuntime from './Phase4PublicRuntime'
import './intent-tracker'
import './public-commercial-info'

const HomeRoute = lazy(() => import('./HomeRoute'))
const AuthRoute = lazy(() => import('./AuthRoute'))
const PlatformRoute = lazy(() => import('./PlatformRoute'))
const AdminRoute = lazy(() => import('./AdminRoute'))
const SocialFeed = lazy(() => import('./SocialFeed'))
const SocialStoreProfile = lazy(() => import('./SocialStoreProfile'))
const CustomerAccountRoute = lazy(() => import('./CustomerAccountRoute'))

function pageFor(pathname: string) {
  if (pathname === '/' || pathname === '' || pathname === '/feed' || pathname === '/descobrir') return 'social'
  if (pathname === '/para-lojas') return 'home'
  if (pathname === '/entrar') return 'login'
  if (pathname === '/criar-conta') return 'register'
  if (pathname === '/cliente' || pathname.startsWith('/cliente/')) return 'customer'
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'platform'
  if (pathname === '/painel' || pathname.startsWith('/painel/')) return 'admin'
  if (pathname === '/perfil' || pathname.startsWith('/perfil/')) return 'profile'
  return 'store'
}

function RouteFallback() {
  return <div className="store-loading"><span className="brand__mark">SV</span><strong>Carregando…</strong></div>
}

export default function App() {
  const [page, setPage] = useState(() => pageFor(window.location.pathname))

  useEffect(() => {
    const onPop = () => setPage(pageFor(window.location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  if (page === 'store') return <><PublicRoute /><Phase3PublicRuntime /><Phase4PublicRuntime /></>

  let content
  if (page === 'social') content = <SocialFeed />
  else if (page === 'profile') content = <SocialStoreProfile />
  else if (page === 'home') content = <HomeRoute />
  else if (page === 'login') content = <AuthRoute mode="login" />
  else if (page === 'register') content = <AuthRoute mode="register" />
  else if (page === 'customer') content = <><CustomerAccountRoute /><Phase3PublicRuntime /></>
  else if (page === 'platform') content = <PlatformRoute />
  else content = <AdminRoute />

  return <Suspense fallback={<RouteFallback />}>{content}</Suspense>
}
