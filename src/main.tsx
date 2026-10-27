import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './saas.css'
import './canvas.css'
import './product-picker-responsive.css'
import './shopvax-brand.css'
import './shopvax-commerce.css'
import './shopvax-dashboard.css'
import './shopvax-plans.css'
import './shopvax-orders.css'
import './shopvax-feed-redesign.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
