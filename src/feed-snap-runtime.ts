type FeedList = HTMLElement & { __shopvaxSnapBound?: boolean }

const SNAP_IDLE_MS = 140
const SNAP_TOLERANCE_PX = 2

function viewportHeight() {
  const visual = window.visualViewport?.height
  return Math.max(1, Math.round(Number.isFinite(visual) && Number(visual) > 0 ? Number(visual) : window.innerHeight))
}

function nearestCard(list: HTMLElement) {
  const cards = Array.from(list.querySelectorAll<HTMLElement>('.social-feed-card'))
  if (!cards.length) return null
  const current = list.scrollTop
  let nearest = cards[0]
  let distance = Math.abs(nearest.offsetTop - current)
  for (const card of cards.slice(1)) {
    const nextDistance = Math.abs(card.offsetTop - current)
    if (nextDistance < distance) {
      nearest = card
      distance = nextDistance
    }
  }
  return { card: nearest, distance }
}

function snapToNearest(list: HTMLElement, behavior: ScrollBehavior = 'smooth') {
  const target = nearestCard(list)
  if (!target || target.distance <= SNAP_TOLERANCE_PX) return
  list.scrollTo({ top: target.card.offsetTop, behavior })
}

function syncViewport(list: HTMLElement, preserveCard = true) {
  const page = list.closest<HTMLElement>('.social-feed-page')
  if (!page) return
  const targetBeforeResize = preserveCard ? nearestCard(list)?.card || null : null
  page.style.setProperty('--shopvax-feed-height', `${viewportHeight()}px`)
  if (targetBeforeResize) requestAnimationFrame(() => list.scrollTo({ top: targetBeforeResize.offsetTop, behavior: 'auto' }))
}

function bindList(list: FeedList) {
  if (list.__shopvaxSnapBound) return
  list.__shopvaxSnapBound = true

  let idleTimer = 0
  let touching = false
  let resizing = false

  const scheduleSnap = (delay = SNAP_IDLE_MS) => {
    window.clearTimeout(idleTimer)
    if (touching || resizing) return
    idleTimer = window.setTimeout(() => snapToNearest(list), delay)
  }

  const onScroll = () => scheduleSnap()
  const onTouchStart = () => {
    touching = true
    window.clearTimeout(idleTimer)
  }
  const onTouchEnd = () => {
    touching = false
    scheduleSnap(90)
  }
  const onScrollEnd = () => snapToNearest(list)
  const onResize = () => {
    resizing = true
    window.clearTimeout(idleTimer)
    syncViewport(list, true)
    window.setTimeout(() => {
      resizing = false
      snapToNearest(list, 'auto')
    }, 60)
  }

  syncViewport(list, false)
  list.addEventListener('scroll', onScroll, { passive: true })
  list.addEventListener('touchstart', onTouchStart, { passive: true })
  list.addEventListener('touchend', onTouchEnd, { passive: true })
  if ('onscrollend' in window) list.addEventListener('scrollend', onScrollEnd, { passive: true })
  window.addEventListener('resize', onResize, { passive: true })
  window.visualViewport?.addEventListener('resize', onResize, { passive: true })
}

function reconcile() {
  const page = document.querySelector<HTMLElement>('.social-feed-page')
  document.documentElement.classList.toggle('shopvax-feed-active', Boolean(page))
  if (!page) return
  const list = page.querySelector<FeedList>('.social-feed-list')
  if (list) bindList(list)
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const boot = () => {
    reconcile()
    const observer = new MutationObserver(reconcile)
    observer.observe(document.documentElement, { childList: true, subtree: true })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true })
  else boot()
}
