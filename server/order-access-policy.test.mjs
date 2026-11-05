import test from 'node:test'
import assert from 'node:assert/strict'
import { customerOwnsOrder, quoteMatchesOrder } from './order-access-policy.mjs'

test('only the authenticated order owner may attach shipping or pay', () => {
  assert.equal(customerOwnsOrder({ customer_id: 'buyer-a' }, { id: 'buyer-a' }), true)
  assert.equal(customerOwnsOrder({ customer_id: 'buyer-a' }, { id: 'buyer-b' }), false)
  assert.equal(customerOwnsOrder({ customer_id: null }, { id: 'buyer-a' }), false)
  assert.equal(customerOwnsOrder({ customer_id: null }, null), false)
  assert.equal(customerOwnsOrder({ customer_id: 'buyer-a' }, null), false)
})

test('shipping quotes must match the persisted order total in cents', () => {
  assert.equal(quoteMatchesOrder({ subtotal: '400.00' }, { total: '400.00' }), true)
  assert.equal(quoteMatchesOrder({ subtotal: '500.00' }, { total: '400.00' }), false)
  assert.equal(quoteMatchesOrder({ subtotal: 999999 }, { total: 400 }), false)
  assert.equal(quoteMatchesOrder({ subtotal: 'NaN' }, { total: 400 }), false)
})
