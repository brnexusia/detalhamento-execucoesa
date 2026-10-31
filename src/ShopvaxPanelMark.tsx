import { useEffect, useRef, useState } from 'react'
import ShopvaxBrandMotion from './ShopvaxBrandMotion'

const INTERVAL_MS = 180_000
const DURATION_MS = 1_500

/** Marca do painel: um ciclo a cada 3 minutos, somente com a aba visível.
 * O favicon da aba permanece estático e acessível em todos os navegadores.
 */
export default function ShopvaxPanelMark() {
  const [cycle, setCycle] = useState(0)
  const [active, setActive] = useState(false)
  const stopRef = useRef<number | null>(null)
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const animate = () => {
      if (document.visibilityState !== 'visible' || reduced.matches) return
      setCycle(value => value + 1)
      setActive(true)
      if (stopRef.current != null) window.clearTimeout(stopRef.current)
      stopRef.current = window.setTimeout(() => setActive(false), DURATION_MS)
    }
    const interval = window.setInterval(animate, INTERVAL_MS)
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') setActive(false)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(interval)
      if (stopRef.current != null) window.clearTimeout(stopRef.current)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])
  return <span className="brand__mark svx-panel-mark">
    <ShopvaxBrandMotion key={cycle} active={active} symbolSrc="/brand/shopvax-symbol-dark.svg" />
  </span>
}
