import { useEffect, useState } from 'react'
import ShopvaxBrandMotion from './ShopvaxBrandMotion'

/** Mostra a identidade somente se o carregamento durar mais de 180ms.
 * Evita flashes em navegações instantâneas; nunca bloqueia o término do fetch.
 */
export default function ShopvaxLoading({
  label = 'Carregando…', compact = false,
}: { label?: string; compact?: boolean }) {
  const [showMotion, setShowMotion] = useState(false)
  const [cycle, setCycle] = useState(0)
  useEffect(() => {
    const timer = window.setTimeout(() => setShowMotion(true), 180)
    return () => window.clearTimeout(timer)
  }, [])
  useEffect(() => {
    if (!showMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    // Um ciclo completo, pausa curta, e recomeça somente se o fetch ainda estiver pendente.
    const timer = window.setInterval(() => setCycle(value => value + 1), 2_850)
    return () => window.clearInterval(timer)
  }, [showMotion])
  return <div className={'svx-branded-loading' + (compact ? ' svx-branded-loading--compact' : '')}
    role="status" aria-label={label} aria-live="polite">
    <span className={'svx-branded-loading__mark' + (showMotion ? ' is-visible' : '')}>
      <ShopvaxBrandMotion key={cycle} active={showMotion} />
    </span>
    <span className="svx-sr-only">{label}</span>
  </div>
}
