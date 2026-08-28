import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import DemoBackButton from './DemoBackButton'
import ScannerPublishModule from './ScannerPublishModule'
import './styles.css'
import './saas.css'
import './canvas.css'
import './platform-admin.css'
import './ux-polish.css'
import './feed-arrow-fix.css'
import './yellow-ux-fixes.css'
import './demo-back-button.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <DemoBackButton />
    <ScannerPublishModule />
  </StrictMode>,
)