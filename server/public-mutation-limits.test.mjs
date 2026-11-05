import test from 'node:test'
import assert from 'node:assert/strict'
import { publicMutationLimit } from './public-mutation-limits.mjs'

test('rate limits all publicly writable order and payment flows', () => {
  for (const path of [
    '/api/business/orders', '/api/business/orders/phase3', '/api/public/orders',
    '/api/public/events', '/api/public/phase4/shipping/quote',
    '/api/public/phase4/orders/order-uuid/shipping', '/api/public/phase4/payments',
    '/api/public/cart-recovery',
  ]) {
    const limit = publicMutationLimit('POST', path)
    assert.ok(limit?.max > 0, path)
    assert.ok(limit?.windowMs > 0, path)
  }
  assert.equal(publicMutationLimit('GET', '/api/business/orders'), null)
  assert.equal(publicMutationLimit('POST', '/api/admin/store'), null)
  assert.equal(publicMutationLimit('DELETE', '/api/public/orders'), null)
})
