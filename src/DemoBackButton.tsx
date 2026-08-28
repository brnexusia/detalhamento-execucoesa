import { useEffect, useState } from 'react'
import { ArrowLeft } from 'lucide-react'

const DEMO_STORE_SLUG = 'casa-norte'

function isDemoRoute() {
  const [storeSlug] = window.location.pathname.split('/').filter(Boolean)
  return storeSlug === DEMO_STORE_SLUG
}

export default function DemoBackButton() {
  const [visible, setVisible] = useState(isDemoRoute)

  useEffect(() => {
    const sync = () => setVisible(isDemoRoute())
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])

  if (!visible) return null

  const goHome = () => {
    window.history.pushState({}, '', '/')
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  return (
    <button type="button" className="demo-back-button" onClick={goHome} aria-label="Voltar para a página inicial">
      <ArrowLeft size={16} />
      Voltar
    </button>
  )
}
