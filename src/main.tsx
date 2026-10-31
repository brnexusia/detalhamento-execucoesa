import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './saas.css'
import './canvas.css'
import './product-picker-responsive.css'
import './shopvax-brand.css'
import './shopvax-home.css'
import './shopvax-commerce.css'
import './shopvax-dashboard.css'
import './shopvax-plans.css'
import './shopvax-onboarding.css'
import './shopvax-product-operations.css'
import './shopvax-orders.css'
import './shopvax-feed-redesign.css'
import './shopvax-final-motion.css'
import './shopvax-cross-surface.css'
import './shopvax-brand-assets.css'
import './shopvax-accessibility-polish.css'
import './shopvax-visual-front-04.css'

// Evita arrastar a marca como arquivo/objeto sem interferir no gesto de fotos de produtos.
document.addEventListener('dragstart', (event) => {
  const target = event.target
  if (target instanceof HTMLImageElement && target.matches(
    '.svx-brand-symbol, .svx-brand-wordmark, .brand__logo, .store-intro__logo, .panel-brand img, .customer-store-head img',
  )) event.preventDefault()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
