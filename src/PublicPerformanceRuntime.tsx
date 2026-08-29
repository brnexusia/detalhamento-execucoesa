import { useLayoutEffect } from 'react'

function preconnect(origin: string) {
  if (!origin || origin === window.location.origin) return
  const selector = `link[rel="preconnect"][href="${CSS.escape(origin)}"]`
  if (document.head.querySelector(selector)) return
  const link = document.createElement('link')
  link.rel = 'preconnect'
  link.href = origin
  link.crossOrigin = 'anonymous'
  document.head.appendChild(link)
}

function tuneMedia() {
  const logo = document.querySelector<HTMLImageElement>('.brand__logo')
  if (logo) {
    logo.loading = 'eager'
    logo.decoding = 'async'
    logo.fetchPriority = 'high'
  }

  const gridImages = Array.from(document.querySelectorAll<HTMLImageElement>('.product-card__media img'))
  gridImages.forEach((image, index) => {
    image.decoding = 'async'
    image.loading = index < 4 ? 'eager' : 'lazy'
    image.fetchPriority = index < 4 ? 'high' : 'auto'
  })

  const feedImages = Array.from(document.querySelectorAll<HTMLImageElement>('.feed-card > img'))
  feedImages.forEach((image, index) => {
    image.decoding = 'async'
    image.loading = index === 0 ? 'eager' : 'lazy'
    image.fetchPriority = index === 0 ? 'high' : 'auto'
  })

  document.querySelectorAll<HTMLImageElement>('.cart-item img').forEach((image) => {
    image.decoding = 'async'
    image.loading = 'lazy'
  })

  document.querySelectorAll<HTMLImageElement>('.product-picker__media img').forEach((image) => {
    image.decoding = 'async'
    image.loading = 'eager'
    image.fetchPriority = 'high'
  })

  const origins = new Set<string>()
  for (const image of [...gridImages.slice(0, 8), ...feedImages.slice(0, 2), ...(logo ? [logo] : [])]) {
    try { origins.add(new URL(image.currentSrc || image.src, window.location.href).origin) } catch {}
  }
  Array.from(origins).slice(0, 4).forEach(preconnect)
}

export default function PublicPerformanceRuntime() {
  useLayoutEffect(() => {
    tuneMedia()
    let scheduled = 0
    const observer = new MutationObserver(() => {
      if (scheduled) return
      scheduled = window.requestAnimationFrame(() => {
        scheduled = 0
        tuneMedia()
      })
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      if (scheduled) window.cancelAnimationFrame(scheduled)
    }
  }, [])

  return null
}
