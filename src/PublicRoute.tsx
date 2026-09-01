import PublicStoreV2 from './PublicStoreV2'
import SocialProfileHeader from './SocialProfileHeader'
import DemoBackButton from './DemoBackButton'
import PublicPerformanceRuntime from './PublicPerformanceRuntime'
import './feed-arrow-fix.css'
import './demo-back-button.css'
import './public-performance.css'
import './product-gallery.css'
import './social-profile.css'

export default function PublicRoute() {
  return <>
    <SocialProfileHeader />
    <PublicStoreV2 />
    <PublicPerformanceRuntime />
    <DemoBackButton />
  </>
}
