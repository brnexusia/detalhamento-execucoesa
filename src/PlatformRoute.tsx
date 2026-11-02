import { useEffect } from 'react'
import PlatformAdmin from './PlatformAdmin'
import './platform-admin.css'
import './platform-admin-ops.css'

export default function PlatformRoute() {
  useEffect(() => {
    if (window.location.pathname.startsWith('/admin/lancamento')) {
      window.history.replaceState({}, '', '/admin')
    }
  }, [])
  return <PlatformAdmin/>
}
