import ShopvaxLoading from './ShopvaxLoading'
import ShopvaxLoginTransition from './ShopvaxLoginTransition'
import { Fragment, lazy, Suspense, useEffect, useState } from 'react'
import './intent-tracker'
import { listenAuthChanges } from './auth-session-sync'

const HomeRoute = lazy(() => import('./HomeRoute'))
const PublicRoute = lazy(() => import('./PublicRoute'))
const Phase3PublicRuntime = lazy(() => import('./Phase3PublicRuntime'))
const Phase4PublicRuntime = lazy(() => import('./Phase4PublicRuntime'))
const ShopvaxBuyerPreferences = lazy(() => import('./ShopvaxBuyerPreferences'))
const ShopvaxSupport = lazy(() => import('./ShopvaxSupport'))
const AuthRoute = lazy(() => import('./AuthRoute'))
const PlatformRoute = lazy(() => import('./PlatformRoute'))
const AdminRoute = lazy(() => import('./AdminRoute'))
const SocialFeed = lazy(() => import('./SocialFeed'))
const SocialStoreProfile = lazy(() => import('./SocialStoreProfile'))
const CustomerAccountRoute = lazy(() => import('./CustomerAccountRoute'))
const GlobalBuyerAccount = lazy(() => import('./GlobalBuyerAccount'))
const ShopvaxPartnerPortal = lazy(() => import('./ShopvaxPartnerPortal'))

function pageFor(pathname: string) {
  if (pathname === '/' || pathname === '' || pathname === '/feed' || pathname === '/descobrir') return 'social'
  if (pathname === '/para-lojas') return 'home'
  if (pathname === '/entrar' || pathname === '/login') return 'login'
  if (pathname === '/criar-conta') return 'register'
  if (pathname === '/comprador') return 'buyer'
  if (pathname === '/parceiros' || pathname.startsWith('/parceiros/')) return 'partners'
  if (pathname === '/cliente' || pathname.startsWith('/cliente/')) return 'customer'
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'platform'
  if (pathname === '/painel' || pathname.startsWith('/painel/')) return 'admin'
  if (pathname === '/perfil' || pathname.startsWith('/perfil/')) return 'profile'
  return 'store'
}

function RouteFallback() {
  return <ShopvaxLoading label="Abrindo Shopvax…" />
}

export default function App() {
  const [pathname, setPathname] = useState(() => window.location.pathname)
  const [authRevision, setAuthRevision] = useState(0)
  const page = pageFor(pathname)
  const helpAllowed = page === 'login' || page === 'register' || page === 'customer' || page === 'buyer' ||
    (page === 'admin' && ['/painel','/painel/loja','/painel/temas','/painel/assinatura','/painel/integracoes','/painel/recursos','/painel/crescimento'].includes(pathname))

  useEffect(() => {
    const onPop = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    const onSessionChange = (signal: { scope: string; action?: string }) => {
      const path = window.location.pathname
      if (signal.action === 'logout') {
        // Every protected surface is removed immediately, including a tab that
        // had a different panel section open when another tab signed out.
        if (/^\/(?:painel|admin)(?:\/|$)/.test(path)) {
          window.history.replaceState({}, '', '/entrar')
          setPathname('/entrar')
        }
        setAuthRevision((value) => value + 1)
      } else if (
        (signal.scope === 'owner' && /^\/(?:painel|admin)(?:\/|$)/.test(path)) ||
        (signal.scope === 'customer' && path === '/comprador')
      ) {
        // Account swaps also discard cached components from a previous identity.
        setAuthRevision((value) => value + 1)
      }
    }
    const stopOwner = listenAuthChanges('owner', onSessionChange)
    const stopCustomer = listenAuthChanges('customer', onSessionChange)
    return () => { stopOwner(); stopCustomer() }
  }, [])

  useEffect(() => {
    if (page === 'store' || page === 'profile') return
    const segment = window.location.pathname.split('/').filter(Boolean)[1] || ''
    const panelTitles: Record<string, string> = {
      produtos: 'Produtos', pedidos: 'Pedidos', vendedoras: 'Vendedoras', relatorios: 'Inteligência',
      operacao: 'Clientes e domínio', crescimento: 'Crescimento', recursos: 'Estoque e catálogos',
      integracoes: 'Integrações', assinatura: 'Plano e uso', loja: 'Minha loja', temas: 'Temas e paletas',
    }
    const title = page === 'admin' ? (panelTitles[segment] || 'Painel')
      : page === 'platform' ? 'Administração'
        : page === 'login' ? 'Entrar'
          : page === 'register' ? 'Criar loja'
            : page === 'partners' ? 'Portal de parceiros'
            : page === 'customer' || page === 'buyer' ? 'Minha conta'
              : page === 'social' ? 'Descobrir'
                : 'Shopvax'
    document.title = `${title} · Shopvax`
  }, [page])

  let content
  if (page === 'store') content = <Fragment key={pathname}><PublicRoute /><Phase3PublicRuntime /><Phase4PublicRuntime /></Fragment>
  else if (page === 'social') content = <SocialFeed />
  else if (page === 'profile') content = <SocialStoreProfile key={pathname} />
  else if (page === 'home') content = <HomeRoute />
  else if (page === 'login') content = <AuthRoute mode="login" />
  else if (page === 'register') content = <AuthRoute mode="register" />
  else if (page === 'buyer') content = <GlobalBuyerAccount />
  else if (page === 'partners') content = <ShopvaxPartnerPortal />
  else if (page === 'customer') content = <Fragment key={pathname}><CustomerAccountRoute /><ShopvaxBuyerPreferences /></Fragment>
  else if (page === 'platform') content = <PlatformRoute />
  else content = <AdminRoute />

  return <><Suspense fallback={<RouteFallback />}><Fragment key={authRevision}>{content}</Fragment></Suspense><Suspense fallback={null}>{helpAllowed && <ShopvaxSupport />}</Suspense><ShopvaxLoginTransition /></>
}
