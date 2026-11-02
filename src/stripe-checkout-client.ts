export function trustedStripeCheckoutUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'checkout.stripe.com' &&
      (url.pathname.startsWith('/c/') || url.pathname.startsWith('/pay/'))
  } catch { return false }
}
