import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import ScannerPublishModule from './ScannerPublishModule'
import './styles.css'
import './saas.css'
import './canvas.css'
import './platform-admin.css'
import './ux-polish.css'
import './feed-arrow-fix.css'
import './yellow-ux-fixes.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <ScannerPublishModule />
  </StrictMode>,
)
