import AdminApp from './AdminApp'
import ScannerModule1 from './ScannerModule1'
import ScannerPublishModule from './ScannerPublishModule'
import './ux-polish.css'
import './yellow-ux-fixes.css'

export default function AdminRoute() {
  return <>
    <AdminApp />
    <ScannerModule1 />
    <ScannerPublishModule />
  </>
}
