import ShopvaxSupport from './ShopvaxSupport'
import ShopvaxLoading from './ShopvaxLoading'
import ShopvaxLoginTransition from './ShopvaxLoginTransition'
import ShopvaxBuyerPreferences from './ShopvaxBuyerPreferences'
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
  return <ShopvaxLoading label="Abrindo Shopvax…" />
}

export default function App() {
  const [pathname, setPathname] = useState(() => window.location.pathname)
  const page = pageFor(pathname)
  const helpAllowed = page === 'login' || page === 'register' || page === 'customer' ||
    (page === 'admin' && ['/painel','/painel/loja','/painel/temas','/painel/assinatura','/painel/integracoes','/painel/recursos','/painel/crescimento'].includes(pathname))

  useEffect(() => {
    const onPop = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
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
            : page === 'customer' ? 'Minha conta'
              : page === 'social' ? 'Descobrir'
                : 'Shopvax'
    document.title = `${title} · Shopvax`
  }, [page])

  let content
  if (page === 'store') content = <><PublicRoute /><Phase3PublicRuntime /><Phase4PublicRuntime /></>
  else if (page === 'social') content = <SocialFeed />
  else if (page === 'profile') content = <SocialStoreProfile />
  else if (page === 'home') content = <HomeRoute />
  else if (page === 'login') content = <AuthRoute mode="login" />
  else if (page === 'register') content = <AuthRoute mode="register" />
  else if (page === 'customer') content = <><CustomerAccountRoute /><ShopvaxBuyerPreferences /><Phase3PublicRuntime /></>
  else if (page === 'platform') content = <PlatformRoute />
  else content = <AdminRoute />

  return <><Suspense fallback={<RouteFallback />}>{content}</Suspense>{helpAllowed && <ShopvaxSupport />}<ShopvaxLoginTransition /></>
}
