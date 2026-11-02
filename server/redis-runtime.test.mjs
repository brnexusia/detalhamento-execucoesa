import test from 'node:test'
import assert from 'node:assert/strict'
import { redisKey, cachedCatalogQuery, takeSharedRate, closeRedisForTests } from './redis-runtime.mjs'

test.after(() => closeRedisForTests())

test('cache keys are deterministic and do not disclose visitor/store identifiers', () => {
  const input = 'store:123:buyer:456'
  assert.equal(redisKey(input), redisKey(input))
  assert.equal(redisKey(input).length, 64)
  assert.ok(!redisKey(input).includes(input))
})

test('catalog always serves database data without Redis', async () => {
  let calls = 0
  const pool = { query: async () => { calls++; return { rows: [{ sku: 'a' }], rowCount: 1 } } }
  const result = await cachedCatalogQuery(pool, 'SELECT sku FROM products', [], 10)
  assert.equal(result.rows[0].sku, 'a')
  assert.equal(calls, 1)
})

test('rate limit maintains local protection without Redis', async () => {
  const result = await takeSharedRate('buyer:abc', 20000, 2, () => ({ ok: false, retryAfter: 12 }))
  assert.deepEqual(result, { ok: false, retryAfter: 12 })
})
