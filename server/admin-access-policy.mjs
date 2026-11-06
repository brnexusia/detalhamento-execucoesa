// Complimentary access is an explicit, auditable exception per store.
// It does NOT change billing_required, Stripe subscriptions or paid_until.
export const complimentaryDurations = Object.freeze([7,30,90,365])

export function isComplimentaryAccessActive(row, now = Date.now()) {
  if (row?.admin_grant_active !== true) return false
  if (row.admin_grant_expires_at == null) return true
  const expiry = new Date(row.admin_grant_expires_at).getTime()
  return Number.isFinite(expiry) && expiry > now
}

export function parseComplimentaryGrant(body, now = Date.now()) {
  const planCode = String(body?.planCode || '').trim().toLowerCase()
  const duration = body?.durationDays
  const reason = String(body?.reason || '').trim()
  if (!['bronze','prata','ouro'].includes(planCode)) return { error:'Selecione Bronze, Prata ou Ouro.' }
  if (duration !== 'unlimited' && !complimentaryDurations.includes(duration)) {
    return { error:'Selecione 7, 30, 90, 365 dias ou sem prazo.' }
  }
  if (reason.length < 10 || reason.length > 300) return { error:'Informe um motivo com 10 a 300 caracteres.' }
  return {
    planCode,reason,
    expiresAt: duration === 'unlimited' ? null : new Date(now + duration * 86400_000).toISOString(),
    durationDays:duration,
  }
}
