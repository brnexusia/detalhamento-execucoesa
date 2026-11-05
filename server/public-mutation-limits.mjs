// Public operations that write to PostgreSQL must be throttled independently
// of login and catalog browsing. Keep the limits generous for shared networks.
const TEN_MINUTES = 10 * 60 * 1000

export function publicMutationLimit(method, path) {
  if (method !== 'POST') return null
  if (['/api/business/orders', '/api/business/orders/phase3', '/api/public/orders'].includes(path)) {
    return { bucket: 'order', max: 30, windowMs: TEN_MINUTES }
  }
  if (path === '/api/public/events') return { bucket: 'event', max: 180, windowMs: TEN_MINUTES }
  if (path === '/api/public/phase4/shipping/quote') return { bucket: 'shipping-quote', max: 60, windowMs: TEN_MINUTES }
  if (/^\/api\/public\/phase4\/orders\/[^/]+\/shipping$/.test(path)) {
    return { bucket: 'shipping-attach', max: 40, windowMs: TEN_MINUTES }
  }
  if (path === '/api/public/phase4/payments') return { bucket: 'payment', max: 20, windowMs: TEN_MINUTES }
  if (path === '/api/public/cart-recovery') return { bucket: 'cart-recovery', max: 60, windowMs: TEN_MINUTES }
  return null
}
