import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { redisReady, closeRedisForTests, cachedCatalogQuery, takeSharedRate } from './redis-runtime.mjs'

if (!process.env.REDIS_URL) throw new Error('This suite requires a test Redis URL')
test.after(() => closeRedisForTests())

test('Redis connects and enforces atomic shared limits', async () => {
  for (let i = 0; !redisReady() && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(redisReady(), true, 'redis must connect for this integration suite')
  const key = 'redis-ci:' + randomUUID()
  const values = await Promise.all(Array.from({ length: 8 }, () =>
    takeSharedRate(key, 30000, 3, () => { throw new Error('fallback unexpected') }),
  ))
  assert.equal(values.filter(value => value.ok).length, 3)
  assert.equal(values.filter(value => !value.ok).length, 5)
})

test('public catalog query returns cached results and scopes keys by parameters', async () => {
  const scope = randomUUID()
  let dbQueries = 0
  const pool = { query: async (_sql, params) => {
    dbQueries++
    return { rows: [{ store: params[0] }], rowCount: 1 }
  } }
  const sql = 'SELECT store FROM fake_catalog WHERE scope = ' + scope + ' AND store=$1'
  const first = await cachedCatalogQuery(pool, sql, ['A'], 30)
  const second = await cachedCatalogQuery(pool, sql, ['A'], 30)
  const other = await cachedCatalogQuery(pool, sql, ['B'], 30)
  assert.deepEqual(first.rows, second.rows)
  assert.equal(other.rows[0].store, 'B')
  assert.equal(dbQueries, 2)
})
