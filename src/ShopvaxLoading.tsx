import { useEffect, useState } from 'react'
import ShopvaxBrandMotion from './ShopvaxBrandMotion'

/** Mostra a identidade somente se o carregamento durar mais de 180ms.
 * Evita flashes em navegações instantâneas; nunca bloqueia o término do fetch.
 */
export default function ShopvaxLoading({
  label = 'Carregando…', compact = false,
}: { label?: string; compact?: boolean }) {
  const [showMotion, setShowMotion] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setShowMotion(true), 180)
    return () => window.clearTimeout(timer)
  }, [])
  return <div className={'svx-branded-loading' + (compact ? ' svx-branded-loading--compact' : '')}
    role="status" aria-label={label} aria-live="polite">
    <span className={'svx-branded-loading__mark' + (showMotion ? ' is-visible' : '')}>
      <ShopvaxBrandMotion active={showMotion} />
    </span>
    <span className="svx-sr-only">{label}</span>
  </div>
}
