import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { cycles, planPrice, subscriptionAccess, verifyStripeSignature } from './stripe-billing-policy.mjs'

test('preços oficiais em BRL, incluindo desconto semestral/anual com arredondamento', () => {
  assert.deepEqual(['bronze','prata','ouro'].map((p) => planPrice(p, 'monthly').amountCents), [4990,9490,14490])
  assert.deepEqual(['bronze','prata','ouro'].map((p) => planPrice(p, 'semiannual').amountCents), [28443,54093,82593])
  assert.deepEqual(['bronze','prata','ouro'].map((p) => planPrice(p, 'annual').amountCents), [50898,96798,147798])
  assert.equal(planPrice('platinum','monthly'), null)
  assert.equal(planPrice('bronze','weekly'), null)
  assert.equal(cycles.semiannual.count, 6)
})
test('rejeita webhooks sem assinatura, adulterados, com timestamp expirado', () => {
  const body = Buffer.from(JSON.stringify({ id: 'evt_123' }))
  const now = Date.now()
  const timestamp = Math.floor(now / 1000)
  const secret = 'whsec_fake_for_tests'
  const signature = crypto.createHmac('sha256', secret).update(timestamp + '.' + body).digest('hex')
  const header = 't=' + timestamp + ',v1=' + signature
  assert.equal(verifyStripeSignature(body, header, secret, now), true)
  assert.equal(verifyStripeSignature(body, header, 'whsec_outro', now), false)
  assert.equal(verifyStripeSignature(Buffer.from('adulterado'), header, secret, now), false)
  assert.equal(verifyStripeSignature(body, header, secret, now + 301_000), false)
  assert.equal(verifyStripeSignature(body, 't=x,v1=abc', secret, now), false)
  assert.equal(verifyStripeSignature(null, header, secret, now), false)
})
test('acesso pago exige evento de cobrança, plano ativo e prazo válido', () => {
  const now = Date.UTC(2026, 10, 1)
  const valid = { billing_required: true, subscription_status: 'active', active_plan_code: 'prata', paid_until: new Date(now + 86400_000) }
  assert.equal(subscriptionAccess(valid, now), true)
  assert.equal(subscriptionAccess({ ...valid, subscription_status: 'past_due' }, now), false)
  assert.equal(subscriptionAccess({ ...valid, subscription_status: 'canceled' }, now), false)
  assert.equal(subscriptionAccess({ ...valid, active_plan_code: null }, now), false)
  assert.equal(subscriptionAccess({ ...valid, paid_until: new Date(now) }, now), false)
  assert.equal(subscriptionAccess({ ...valid, paid_until: null }, now), false)
  assert.equal(subscriptionAccess({ ...valid, billing_required: false }, now), true)
})
