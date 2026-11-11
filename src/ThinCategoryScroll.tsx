import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'

type ScrollMetrics = { width: number; left: number }

export default function ThinCategoryScroll({ children, refreshKey }: { children: ReactNode; refreshKey: string }) {
  const navRef = useRef<HTMLElement>(null)
  const [metrics, setMetrics] = useState<ScrollMetrics>({ width: 100, left: 0 })

  const measure = () => {
    const nav = navRef.current
    if (!nav) return

    const available = Math.max(0, nav.scrollWidth - nav.clientWidth)
    const width = available > 1 ? Math.max(5, (nav.clientWidth / nav.scrollWidth) * 100) : 100
    const left = available > 1 ? (nav.scrollLeft / available) * (100 - width) : 0

    setMetrics((prev) => prev.width === width && prev.left === left ? prev : { width, left })
  }

  useEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const observer = new ResizeObserver(measure)
    observer.observe(nav)
    Array.from(nav.children).forEach((child) => observer.observe(child))
    measure()
    return () => observer.disconnect()
  }, [refreshKey])

  const moveToPointer = (event: PointerEvent<HTMLButtonElement>) => {
    const nav = navRef.current
    if (!nav || nav.scrollWidth <= nav.clientWidth) return
    const rail = event.currentTarget.getBoundingClientRect()
    if (rail.width <= 0) return
    const progress = Math.max(0, Math.min(1, (event.clientX - rail.left) / rail.width))
    nav.scrollLeft = progress * (nav.scrollWidth - nav.clientWidth)
    measure()
  }

  return (
    <div className="svx-products__category-scroll">
      <nav ref={navRef} className="svx-products__categories" aria-label="Filtrar produtos por categoria" onScroll={measure}>
        {children}
      </nav>
      {metrics.width < 99.9 && (
        <button
          type="button"
          className="svx-products__category-scrollbar"
          aria-label="Rolar categorias horizontalmente"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            moveToPointer(event)
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) moveToPointer(event)
          }}
          onKeyDown={(event) => {
            const nav = navRef.current
            if (!nav) return
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault()
              nav.scrollBy({ left: event.key === 'ArrowLeft' ? -120 : 120, behavior: 'smooth' })
            }
          }}
        >
          <span className="svx-products__category-scrollbar-thumb" style={{ width: `${metrics.width}%`, left: `${metrics.left}%` }} />
        </button>
      )}
    </div>
  )
}
