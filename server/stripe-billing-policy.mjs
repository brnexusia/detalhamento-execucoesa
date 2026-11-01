import crypto from 'node:crypto'
import { systemPlans } from './system-plans.mjs'

export const cycles = {
  monthly: { months: 1, interval: 'month', count: 1, discount: 0, label: 'Mensal' },
  semiannual: { months: 6, interval: 'month', count: 6, discount: 5, label: 'Semestral' },
  annual: { months: 12, interval: 'year', count: 1, discount: 15, label: 'Anual' },
}

export function planPrice(code, cycle) {
  const plan = systemPlans.find((entry) => entry.code === code)
  const term = cycles[cycle]
  if (!plan || !term) return null
  return {
    code: plan.code,
    name: plan.name,
    cycle,
    interval: term.interval,
    intervalCount: term.count,
    amountCents: Math.round(plan.monthlyPrice * 100 * term.months * (100 - term.discount) / 100),
  }
}

export function verifyStripeSignature(payload, header, secret, now = Date.now()) {
  if (!Buffer.isBuffer(payload) || !secret || typeof header !== 'string') return false
  const parts = header.split(',').map((part) => part.trim().split('='))
  const timestamp = parts.find((part) => part[0] === 't')?.[1]
  const signatures = parts.filter((part) => part[0] === 'v1').map((part) => part[1])
  if (!timestamp || !/^\d+$/.test(timestamp) || !signatures.length) return false
  const seconds = Number(timestamp)
  if (!Number.isSafeInteger(seconds) || Math.abs(now / 1000 - seconds) > 300) return false
  const signed = Buffer.concat([Buffer.from(timestamp + '.'), payload])
  const expected = crypto.createHmac('sha256', secret).update(signed).digest()
  return signatures.some((signature) => {
    if (!/^[\da-f]{64}$/i.test(signature || '')) return false
    return crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex'))
  })
}

export function subscriptionAccess(row, now = Date.now()) {
  if (!row?.billing_required) return true // Lojas legadas preservadas até migração expressa.
  return row.subscription_status === 'active' &&
    Boolean(row.active_plan_code) &&
    Boolean(row.paid_until) &&
    new Date(row.paid_until).getTime() > now
}
