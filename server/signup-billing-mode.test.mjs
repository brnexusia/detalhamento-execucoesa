import test from 'node:test'
import assert from 'node:assert/strict'
import { requiresPaymentForSignup } from './signup-billing-mode.mjs'

test('produção exige pagamento por padrão, mesmo se a variável antiga indicar grátis', () => {
  assert.equal(requiresPaymentForSignup({}), true)
  assert.equal(requiresPaymentForSignup({ NODE_ENV: 'production' }), true)
  assert.equal(requiresPaymentForSignup({ NODE_ENV: 'production', SHOPVAX_REQUIRE_PAYMENT_ON_SIGNUP: '0' }), true)
  assert.equal(requiresPaymentForSignup({ NODE_ENV: 'production', SHOPVAX_REQUIRE_PAYMENT_ON_SIGNUP: 'false' }), true)
  assert.equal(requiresPaymentForSignup({ NODE_ENV: 'production', SHOPVAX_REQUIRE_PAYMENT_ON_SIGNUP: '1' }), true)
})

test('somente testes locais podem simular cadastro sem cobrança', () => {
  assert.equal(requiresPaymentForSignup({ NODE_ENV: 'test' }), false)
  assert.equal(requiresPaymentForSignup({ NODE_ENV: 'test', SHOPVAX_REQUIRE_PAYMENT_ON_SIGNUP: '0' }), false)
  assert.equal(requiresPaymentForSignup({ NODE_ENV: 'test', SHOPVAX_REQUIRE_PAYMENT_ON_SIGNUP: '1' }), true)
  assert.equal(requiresPaymentForSignup({ NODE_ENV: 'development', SHOPVAX_REQUIRE_PAYMENT_ON_SIGNUP: '0' }), true)
})
