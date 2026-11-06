// Interpret server-side Stripe credentials without logging their values.
export function parseStripeServerKey(raw) {
  const value = String(raw || '').trim()
  const match = /^(sk|rk)_(test|live)_([^\s]+)$/.exec(value)
  return { valid: Boolean(match), mode: match?.[2] || null, restricted: match?.[1] === 'rk' }
}

/**
 * Backward compatibility for EasyPanel installations that saved a Stripe
 * secret under the old _URL variable name (which actually contains a key).
 * Prefer the canonical key and never silently override an explicit value.
 */
export function resolveStripeServerKey(env = {}) {
  const primary = String(env.SHOPVAX_STRIPE_SECRET_KEY || '').trim()
  const legacy = String(env.SHOPVAX_STRIPE_SECRET_KEY_URL || '').trim()
  return {
    value: primary || legacy,
    source: primary ? 'SHOPVAX_STRIPE_SECRET_KEY' : legacy ? 'SHOPVAX_STRIPE_SECRET_KEY_URL' : null,
  }
}
