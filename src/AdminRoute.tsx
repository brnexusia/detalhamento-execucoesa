import AdminApp from './AdminApp'
import ScannerModule1 from './ScannerModule1'
import ScannerPublishModule from './ScannerPublishModule'
import BusinessFeaturesPanel from './BusinessFeaturesPanel'
import AnalyticsPanel from './AnalyticsPanel'
import TeamPanel from './TeamPanel'
import CommercialSettingsPanel from './CommercialSettingsPanel'
import './ux-polish.css'
import './yellow-ux-fixes.css'
import './business-launchers.css'

function go(path: string) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export default function AdminRoute() {
  const analytics = window.location.pathname === '/painel/relatorios' || window.location.pathname.startsWith('/painel/relatorios/')
  if (analytics) return <AnalyticsPanel />
  const team = window.location.pathname === '/painel/equipe' || window.location.pathname.startsWith('/painel/equipe/')
  if (team) return <TeamPanel />
  const commercial = window.location.pathname === '/painel/comercial' || window.location.pathname.startsWith('/painel/comercial/')
  if (commercial) return <CommercialSettingsPanel />
  const features = window.location.pathname === '/painel/recursos' || window.location.pathname.startsWith('/painel/recursos/')
  if (features) return <BusinessFeaturesPanel />
  return <>
    <AdminApp />
    <ScannerModule1 />
    <ScannerPublishModule />
    <div className="business-launcher-group">
      <button className="business-launcher business-launcher--reports" type="button" onClick={() => go('/painel/relatorios')}>Inteligência comercial</button>
      <button className="business-launcher" type="button" onClick={() => go('/painel/equipe')}>Equipe e comissão</button>
      <button className="business-launcher" type="button" onClick={() => go('/painel/comercial')}>Pagamento e entrega</button>
      <button className="business-launcher" type="button" onClick={() => go('/painel/recursos')}>Estoque e recursos</button>
    </div>
  </>
}
