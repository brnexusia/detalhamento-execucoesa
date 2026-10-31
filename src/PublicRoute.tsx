import PublicStoreV2 from './PublicStoreV2'
import ShopvaxAcquisition from './ShopvaxAcquisition'
import DemoBackButton from './DemoBackButton'
import PublicPerformanceRuntime from './PublicPerformanceRuntime'
import './feed-arrow-fix.css'
import './demo-back-button.css'
import './public-performance.css'
import './product-gallery.css'

export default function PublicRoute() {
  return <>
    <PublicStoreV2 />
    <ShopvaxAcquisition />
    <PublicPerformanceRuntime />
    <DemoBackButton />
  </>
}
