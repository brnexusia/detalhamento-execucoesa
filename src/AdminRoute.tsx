import AdminApp from './AdminApp'
import ScannerModule1 from './ScannerModule1'
import ScannerPublishModule from './ScannerPublishModule'
import BusinessFeaturesPanel from './BusinessFeaturesPanel'
import './ux-polish.css'
import './yellow-ux-fixes.css'

function go(path: string) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export default function AdminRoute() {
  const features = window.location.pathname === '/painel/recursos' || window.location.pathname.startsWith('/painel/recursos/')
  if (features) return <BusinessFeaturesPanel />
  return <>
    <AdminApp />
    <ScannerModule1 />
    <ScannerPublishModule />
    <button className="business-launcher" type="button" onClick={() => go('/painel/recursos')}>Estoque e recursos</button>
  </>
}
