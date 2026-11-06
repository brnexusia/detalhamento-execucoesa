// Checkout uses an authenticated, same-origin redirect: the backend fetches
// and validates the Stripe session before redirecting the browser.
// Direct Stripe-hosted URLs remain accepted for compatibility with old builds.
export function trustedStripeCheckoutUrl(value: string): boolean {
  if (value === '/api/billing/checkout/redirect') return true
  if (typeof value !== 'string' || value.length > 8192) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' &&
      !url.username && !url.password && !url.port && url.pathname !== '/' &&
      ['checkout.stripe.com', 'pay.stripe.com', 'buy.stripe.com'].includes(url.hostname)
  } catch { return false }
}
