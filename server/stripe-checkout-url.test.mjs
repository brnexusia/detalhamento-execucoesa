import test from 'node:test'
import assert from 'node:assert/strict'
import { trustedStripeCheckoutDestination } from './stripe-checkout-url.mjs'

test('allows Stripe-hosted Checkout URLs with multiple official paths', () => {
  for (const url of [
    'https://checkout.stripe.com/c/pay/cs_test_example#fragment',
    'https://checkout.stripe.com/pay/cs_live_example',
    'https://checkout.stripe.com/session/cs_test_example',
    'https://pay.stripe.com/c/pay/cs_live_example',
    'https://buy.stripe.com/test_example',
  ]) assert.equal(trustedStripeCheckoutDestination(url), true, url)
})

test('rejects non-Stripe, unsafe and malformed redirect URLs', () => {
  for (const url of [
    '', null, 'javascript:alert(1)', '/api/billing/checkout/redirect',
    'http://checkout.stripe.com/c/pay/test',
    'https://checkout.stripe.com', 'https://checkout.stripe.com/',
    'https://checkout.stripe.com.evil.test/c/pay',
    'https://checkout-stripe.com/c/pay',
    'https://checkout.stripe.com@evil.test/c/pay',
    'https://user:pw@checkout.stripe.com/c/pay',
    'https://checkout.stripe.com:8080/c/pay',
    'https://evil.test/c/pay',
  ]) assert.equal(trustedStripeCheckoutDestination(url), false, String(url))
})

test('custom domains are never implicitly permitted', () => {
  const url = 'https://pay.shopvax.com.br/session/cs_live_example'
  assert.equal(trustedStripeCheckoutDestination(url), false)
  assert.equal(trustedStripeCheckoutDestination(url, 'pay.shopvax.com.br'), true)
  assert.equal(trustedStripeCheckoutDestination('https://evil.test/path','pay.shopvax.com.br'),false)
})
