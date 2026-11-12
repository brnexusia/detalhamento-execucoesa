import { useEffect, useState } from 'react'
import ShopvaxLoading from './ShopvaxLoading'
import { apiRequest } from './api'
import AdminApp from './AdminApp'
import ScannerModule1 from './ScannerModule1'
import ScannerPublishModule from './ScannerPublishModule'
import BusinessFeaturesPanel from './BusinessFeaturesPanel'
import AnalyticsPanel from './AnalyticsPanel'
import Phase2Panel from './Phase2Panel'
import Phase3Panel from './Phase3Panel'
import Phase4Panel from './Phase4Panel'
import ShopvaxStripeBilling from './ShopvaxStripeBilling'
import AdminSectionFrame from './AdminSectionFrame'
import './ux-polish.css'
import './yellow-ux-fixes.css'
import './stripe-billing.css'

function RedirectTo({ path }: { path: string }) {
  useEffect(() => {
    window.history.replaceState({}, '', path)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, [path])
  return null
}

type BillingGate = 'checking' | 'paid' | 'payment' | 'anonymous' | 'unavailable'

export default function AdminRoute() {
  const [path, setPath] = useState(() => window.location.pathname)
  const [billingGate, setBillingGate] = useState<BillingGate>('checking')
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let live = true
    // Revalidate on navigation without replacing the current panel with an
    // intermediate billing screen. Initial mount still waits for server authorization.
    apiRequest<{ required: boolean; accessGranted: boolean }>('/api/billing/status')
      .then((result) => { if (live) setBillingGate(!result.required || result.accessGranted ? 'paid' : 'payment') })
      .catch((error: Error & { status?: number }) => {
        if (live) setBillingGate(error.status === 401 ? 'anonymous' : 'unavailable')
      })
    return () => { live = false }
  }, [revision])

  useEffect(() => {
    const onPop = () => { setPath(window.location.pathname); setRevision(current => current + 1) }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const subscription = path === '/painel/assinatura' || path.startsWith('/painel/assinatura/')
  // Não renderizar nem montar módulos do painel antes da confirmação no servidor.
  // A tela de pagamento fica acessível mesmo sem assinatura ativa.
  // During the first load, keep the protected panel unmounted until the
  // backend confirms access; do not flash a full-screen payment verification.
  if (billingGate === 'checking') return <main className="svx-panel-access-check" role="status" aria-live="polite">
    <ShopvaxLoading label="Verificando acesso ao painel…" />
    <p>Verificando acesso ao painel…</p>
  </main>
  if (billingGate === 'anonymous') return <RedirectTo path="/entrar" />
  if (billingGate === 'unavailable') return <section className="svx-billing" role="alert"><h1>Não foi possível confirmar a assinatura.</h1><p>Por segurança, o painel permanece bloqueado até que a verificação funcione.</p><button type="button" onClick={() => setRevision(x => x + 1)}>Verificar novamente</button></section>
  if (billingGate === 'payment' && !subscription) return <RedirectTo path="/painel/assinatura" />
  if (billingGate === 'payment') return <ShopvaxStripeBilling />

  const analytics = path === '/painel/relatorios' || path.startsWith('/painel/relatorios/')
  if (analytics) return <AdminSectionFrame active="relatorios"><AnalyticsPanel/></AdminSectionFrame>

  const features = path === '/painel/recursos' || path.startsWith('/painel/recursos/')
  if (features) return <AdminSectionFrame active="recursos"><BusinessFeaturesPanel/></AdminSectionFrame>

  const media = path === '/painel/midias' || path.startsWith('/painel/midias/')
  if (media) return <RedirectTo path="/painel/produtos"/>

  const operation = path === '/painel/operacao' || path.startsWith('/painel/operacao/')
  if (operation) return <AdminSectionFrame active="operacao"><Phase2Panel/></AdminSectionFrame>

  const growth = path === '/painel/crescimento' || path.startsWith('/painel/crescimento/')
  if (growth) return <AdminSectionFrame active="crescimento"><Phase3Panel/></AdminSectionFrame>

  const integrations = path === '/painel/integracoes' || path.startsWith('/painel/integracoes/')
  if (integrations) return <AdminSectionFrame active="integracoes"><Phase4Panel/></AdminSectionFrame>

  if (subscription) return <AdminSectionFrame active="assinatura"><ShopvaxStripeBilling/></AdminSectionFrame>

  const hiddenTeam = path === '/painel/equipe' || path.startsWith('/painel/equipe/')
  if (hiddenTeam) return <RedirectTo path="/painel"/>

  const commercial = path === '/painel/comercial' || path.startsWith('/painel/comercial/')
  if (commercial) return <RedirectTo path="/painel/loja"/>

  return <>
    <AdminApp/>
    <ScannerModule1/>
    <ScannerPublishModule/>
  </>
}
