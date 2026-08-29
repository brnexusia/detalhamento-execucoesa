import AdminApp from './AdminApp'
import ScannerModule1 from './ScannerModule1'
import ScannerPublishModule from './ScannerPublishModule'
import BusinessFeaturesPanel from './BusinessFeaturesPanel'
import AnalyticsPanel from './AnalyticsPanel'
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
  const features = window.location.pathname === '/painel/recursos' || window.location.pathname.startsWith('/painel/recursos/')
  if (features) return <BusinessFeaturesPanel />
  return <>
    <AdminApp />
    <ScannerModule1 />
    <ScannerPublishModule />
    <div className="business-launcher-group">
      <button className="business-launcher business-launcher--reports" type="button" onClick={() => go('/painel/relatorios')}>Inteligência comercial</button>
      <button className="business-launcher" type="button" onClick={() => go('/painel/recursos')}>Estoque e recursos</button>
    </div>
  </>
}
