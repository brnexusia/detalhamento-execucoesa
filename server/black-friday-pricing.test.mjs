import test from 'node:test'
import assert from 'node:assert/strict'
import { blackFridayPrices, blackFridayPromotion } from './black-friday-pricing.mjs'
import { planPrice } from './stripe-billing-policy.mjs'

test('Black Friday: promo values are the single source for system defaults', () => {
  assert.deepEqual(['bronze','prata','ouro'].map(code => blackFridayPrices[code].monthlyPrice), [29.99,49.99,69.99])
  assert.deepEqual(['bronze','prata','ouro'].map(code => planPrice(code, 'monthly').amountCents), [2999,4999,6999])
})

test('campaign label appears only while admin price equals the offer', () => {
  assert.deepEqual(blackFridayPromotion('bronze', '29.99'), { label: 'Black Friday', originalMonthlyPrice: 49.90 })
  assert.deepEqual(blackFridayPromotion('prata', 49.99), { label: 'Black Friday', originalMonthlyPrice: 94.90 })
  assert.deepEqual(blackFridayPromotion('ouro', 69.99), { label: 'Black Friday', originalMonthlyPrice: 144.90 })
  assert.equal(blackFridayPromotion('bronze', 32.5), null)
  assert.equal(blackFridayPromotion('outro', 29.99), null)
})

test('edited admin price and cycle discounts drive the Stripe amount', () => {
  const row = { code: 'prata', name: 'Prata', monthly_price: '49.99', semester_discount: '5', annual_discount: '15' }
  assert.equal(planPrice('prata', 'monthly', row).amountCents, 4999)
  assert.equal(planPrice('prata', 'semiannual', row).amountCents, 28494)
  assert.equal(planPrice('prata', 'annual', row).amountCents, 50990)
  assert.equal(planPrice('prata', 'monthly', { ...row, monthly_price: '57.33' }).amountCents, 5733)
})
