import { useEffect, useState } from 'react'
import ShopvaxBrandMotion from './ShopvaxBrandMotion'

/** Loading funcional: não atrasa a operação; o X só anima após 200ms.
 * Para login autenticado, immediate+exit executa uma única vinheta de 1450ms.
 */
export default function ShopvaxLoading({
  label = 'Carregando…', compact = false, immediate = false, exit = false, repeat = true, dark = false,
}: { label?: string; compact?: boolean; immediate?: boolean; exit?: boolean; repeat?: boolean; dark?: boolean }) {
  const [showMotion, setShowMotion] = useState(immediate)
  const [cycle, setCycle] = useState(0)

  useEffect(() => {
    if (immediate) { setShowMotion(true); return }
    const timer = window.setTimeout(() => setShowMotion(true), 200)
    return () => window.clearTimeout(timer)
  }, [immediate])

  useEffect(() => {
    if (!showMotion || !repeat || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    // Se a operação continuar, reinicia o X; nunca bloqueia o término do fetch.
    const timer = window.setInterval(() => setCycle(value => value + 1), 1_500)
    return () => window.clearInterval(timer)
  }, [showMotion, repeat])

  return <div className={'svx-branded-loading' + (compact ? ' svx-branded-loading--compact' : '')}
    role="status" aria-label={label} aria-live="polite">
    <span className={'svx-branded-loading__mark' + (showMotion ? ' is-visible' : '')}>
      <ShopvaxBrandMotion key={cycle} active={showMotion} exit={exit} symbolSrc={dark ? '/brand/shopvax-symbol-dark.svg' : '/brand/shopvax-symbol.svg'} />
    </span>
    {compact && <div className="svx-branded-loading__skeleton" aria-hidden="true"><span/><span/><span/></div>}
    <span className="svx-sr-only">{label}</span>
  </div>
}
