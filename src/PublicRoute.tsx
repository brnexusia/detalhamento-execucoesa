import PublicStore from './PublicStore'
import DemoBackButton from './DemoBackButton'
import './feed-arrow-fix.css'
import './demo-back-button.css'

export default function PublicRoute() {
  return <>
    <PublicStore />
    <DemoBackButton />
  </>
}
