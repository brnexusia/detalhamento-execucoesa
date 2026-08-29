import { useEffect, useState } from 'react'
import AdminApp from './AdminApp'
import ScannerModule1 from './ScannerModule1'
import ScannerPublishModule from './ScannerPublishModule'
import BusinessFeaturesPanel from './BusinessFeaturesPanel'
import AnalyticsPanel from './AnalyticsPanel'
import AdminSectionFrame from './AdminSectionFrame'
import AdminAdditions from './AdminAdditions'
import './ux-polish.css'
import './yellow-ux-fixes.css'

function RedirectTo({ path }: { path: string }) {
  useEffect(() => {
    window.history.replaceState({}, '', path)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, [path])
  return null
}

export default function AdminRoute() {
  const [path, setPath] = useState(() => window.location.pathname)

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const analytics = path === '/painel/relatorios' || path.startsWith('/painel/relatorios/')
  if (analytics) return <AdminSectionFrame active="relatorios"><AnalyticsPanel/></AdminSectionFrame>

  const features = path === '/painel/recursos' || path.startsWith('/painel/recursos/')
  if (features) return <AdminSectionFrame active="recursos"><BusinessFeaturesPanel/></AdminSectionFrame>

  const hiddenTeam = path === '/painel/equipe' || path.startsWith('/painel/equipe/')
  if (hiddenTeam) return <RedirectTo path="/painel"/>

  const commercial = path === '/painel/comercial' || path.startsWith('/painel/comercial/')
  if (commercial) return <RedirectTo path="/painel/loja"/>

  return <>
    <AdminApp/>
    <AdminAdditions/>
    <ScannerModule1/>
    <ScannerPublishModule/>
  </>
}
