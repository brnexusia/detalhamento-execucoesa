// Only an authenticated Stripe Checkout Session fetched from the Stripe API
// can supply the redirect destination. Never accept a URL from the browser.
export function trustedStripeCheckoutDestination(raw, customHostname = '') {
  if (typeof raw !== 'string' || !raw || raw.length > 8192) return false
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname === '/') return false
    const officialHosts = new Set(['checkout.stripe.com', 'pay.stripe.com', 'buy.stripe.com'])
    const custom = String(customHostname || '').trim().toLowerCase()
    // Custom domains must be explicitly configured; arbitrary external sites are never permitted.
    return officialHosts.has(url.hostname) ||
      (Boolean(custom) && url.hostname === custom && !officialHosts.has(custom))
  } catch { return false }
}
