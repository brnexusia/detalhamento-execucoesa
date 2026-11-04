import test from 'node:test'
import assert from 'node:assert/strict'
import { requiresPaymentForSignup } from './signup-billing-mode.mjs'

test('cadastros novos são liberados sem pagamento por padrão', () => {
  assert.equal(requiresPaymentForSignup({}), false)
  assert.equal(requiresPaymentForSignup({ SHOPVAX_REQUIRE_PAYMENT_ON_SIGNUP: '0' }), false)
  assert.equal(requiresPaymentForSignup({ SHOPVAX_REQUIRE_PAYMENT_ON_SIGNUP: 'false' }), false)
})
test('cobrança pode ser reativada explicitamente', () => {
  assert.equal(requiresPaymentForSignup({ SHOPVAX_REQUIRE_PAYMENT_ON_SIGNUP: '1' }), true)
  assert.equal(requiresPaymentForSignup({ SHOPVAX_REQUIRE_PAYMENT_ON_SIGNUP: ' 1 ' }), true)
})
