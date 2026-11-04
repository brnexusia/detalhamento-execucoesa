import test from 'node:test'
import assert from 'node:assert/strict'
import { parseStripeServerKey } from './stripe-key-config.mjs'

const token = (prefix, mode, suffix = 'example123') => [prefix, mode, suffix].join('_')

test('supports both standard and restricted Stripe keys in each environment', () => {
  for (const [kind, environment, restricted] of [
    ['sk', 'test', false],
    ['sk', 'live', false],
    ['rk', 'test', true],
    ['rk', 'live', true],
  ]) {
    assert.deepEqual(parseStripeServerKey(token(kind, environment)), {
      valid: true, mode: environment, restricted,
    })
  }
  assert.equal(parseStripeServerKey('  ' + token('rk', 'live') + '  ').mode, 'live')
})

test('rejects publishable, signing, incomplete, and malformed keys', () => {
  for (const candidate of [
    '', 'rk_', token('rk', 'live', ''), token('sk', 'test', ''),
    token('pk', 'live'), token('whsec', 'test'), token('rk', 'live', 'has space'),
    undefined, null,
  ]) {
    assert.equal(parseStripeServerKey(candidate).valid, false)
    assert.equal(parseStripeServerKey(candidate).mode, null)
  }
})
