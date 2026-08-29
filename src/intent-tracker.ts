type IntentKind = 'product_click' | 'cart_add' | 'checkout_start'

function routeContext() {
  const parts = window.location.pathname.split('/').filter(Boolean)
  const storeSlug = parts[0] || ''
  const sellerSlug = parts[1] || ''
  const catalogSlug = new URLSearchParams(window.location.search).get('catalog') || ''
  return { storeSlug, sellerSlug, catalogSlug }
}

function isPublicStore() {
  const path = window.location.pathname
  if (!path || path === '/') return false
  return !path.startsWith('/painel') && !path.startsWith('/admin') && path !== '/entrar' && path !== '/criar-conta'
}

function skuFromNode(node: Element | null) {
  if (!node) return ''
  const card = node.closest('.product-card')
  if (card) return card.querySelector('.product-card__meta span')?.textContent?.trim() || ''
  const feed = node.closest('.feed-card')
  if (feed) {
    const spans = feed.querySelectorAll('.feed-card__top span')
    return spans.item(spans.length - 1)?.textContent?.trim() || ''
  }
  const picker = node.closest('.product-picker') || document.querySelector('.product-picker')
  if (picker) return picker.querySelector('.product-picker__meta span')?.textContent?.trim() || ''
  return ''
}

function send(kind: IntentKind, productSku = '') {
  if (!isPublicStore()) return
  const route = routeContext()
  if (!route.storeSlug) return
  const body = JSON.stringify({ ...route, kind, productSku: productSku || undefined })
  void fetch('/api/public/intent-events', {
    method: 'POST',
    credentials: 'include',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body,
  }).catch(() => undefined)
}

function clickHandler(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target : null
  if (!target) return

  const productTrigger = target.closest('.product-card__media, .product-card__footer button, .feed-card__actions button, .feed-card__buyline button')
  if (productTrigger) {
    const sku = skuFromNode(productTrigger)
    if (sku) send('product_click', sku)
    return
  }

  const add = target.closest('.picker-add')
  if (add) {
    const sku = skuFromNode(add)
    if (sku) send('cart_add', sku)
    return
  }

  const cartTrigger = target.closest('.cart-trigger, .mobile-cart')
  if (cartTrigger) {
    const desktopHasItems = Boolean(document.querySelector('.cart-trigger b'))
    const mobileText = document.querySelector('.mobile-cart span')?.textContent || ''
    if (desktopHasItems || /\d+\s+itens?/i.test(mobileText)) send('checkout_start')
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  document.addEventListener('click', clickHandler, { capture: true })
}
