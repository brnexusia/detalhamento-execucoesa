import PlatformAdmin from './PlatformAdmin'
import PlatformLaunchOps from './PlatformLaunchOps'
import './platform-admin.css'
import './platform-admin-ops.css'
import './platform-launch-ops.css'

export default function PlatformRoute() {
  if (window.location.pathname === '/admin/lancamento' || window.location.pathname.startsWith('/admin/lancamento/')) return <PlatformLaunchOps/>
  return <>
    <PlatformAdmin/>
    <a className="platform-launch-shortcut" href="/admin/lancamento">Fechamento para lançamento</a>
  </>
}
