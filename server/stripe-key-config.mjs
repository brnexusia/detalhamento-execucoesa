// Interpret server-side Stripe credentials without logging their values.
export function parseStripeServerKey(raw) {
  const value = String(raw || '').trim()
  const match = /^(sk|rk)_(test|live)_([^\s]+)$/.exec(value)
  return { valid: Boolean(match), mode: match?.[2] || null, restricted: match?.[1] === 'rk' }
}
