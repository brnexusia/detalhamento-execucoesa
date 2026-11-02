import assert from 'node:assert/strict'
import { test } from 'node:test'
import crypto from 'node:crypto'
import { revokeAllBrowserSessions, clearAllBrowserSessionCookies } from './global-logout.mjs'

const sha = (token) => crypto.createHash('sha256').update(token).digest('hex')
function fakePool({ relations = true, failOn = '' } = {}) {
  const calls = []
  let released = false
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params })
      if (failOn && sql.includes(failOn)) throw new Error('database failure')
      if (sql.startsWith('SELECT to_regclass')) {
        return { rows: [{ buyer_sessions: relations ? 'buyer_sessions' : null, store_customer_sessions: relations ? 'store_customer_sessions' : null }] }
      }
      return { rows: [] }
    },
    release() { released = true },
  }
  return { calls, client, pool: { connect: async () => client }, get released() { return released } }
}

test('logout atomically revokes owner, WhatsApp buyer and legacy store customer cookies', async () => {
  const db = fakePool()
  await revokeAllBrowserSessions(db.pool, {
    atacado_session: 'owner-secret',
    shopvax_buyer_session: 'buyer-secret',
    shopvax_customer_session: 'legacy-secret',
  })
  assert.deepEqual(db.calls.map((call) => call.sql), [
    'BEGIN',
    'DELETE FROM sessions WHERE token_hash=$1',
    "SELECT to_regclass('public.buyer_sessions') AS buyer_sessions, to_regclass('public.store_customer_sessions') AS store_customer_sessions",
    'DELETE FROM buyer_sessions WHERE token_hash=$1',
    'DELETE FROM store_customer_sessions WHERE token_hash=$1',
    'COMMIT',
  ])
  assert.deepEqual(db.calls.filter((c) => c.sql.startsWith('DELETE')).map((c) => c.params), [
    [sha('owner-secret')], [sha('buyer-secret')], [sha('legacy-secret')],
  ])
  assert.equal(db.released, true)
})

test('logout supports an older installation without optional buyer tables', async () => {
  const db = fakePool({ relations: false })
  await revokeAllBrowserSessions(db.pool, { atacado_session: 'owner', shopvax_buyer_session: 'buyer' })
  assert.equal(db.calls.filter((call) => call.sql.startsWith('DELETE')).length, 1)
  assert.equal(db.calls.at(-1).sql, 'COMMIT')
})

test('logout fails and rolls back on revocation failure rather than claiming success', async () => {
  const db = fakePool({ failOn: 'DELETE FROM buyer_sessions' })
  await assert.rejects(revokeAllBrowserSessions(db.pool, {
    atacado_session: 'owner', shopvax_buyer_session: 'buyer',
  }), /database failure/)
  assert.ok(db.calls.some((call) => call.sql === 'ROLLBACK'))
  assert.ok(!db.calls.some((call) => call.sql === 'COMMIT'))
  assert.equal(db.released, true)
})

test('anonymous logout never opens a database connection', async () => {
  await revokeAllBrowserSessions(null, {})
  await assert.rejects(revokeAllBrowserSessions(null, { atacado_session: 'active' }), /Banco indisponível/)
})

test('logout expires all three cookies with consistent security attributes', () => {
  const cleared = []
  clearAllBrowserSessionCookies({ secure: false, headers: { 'x-forwarded-proto': 'https' } }, {
    clearCookie(name, options) { cleared.push({ name, options }) },
  })
  assert.deepEqual(cleared.map((entry) => entry.name), [
    'atacado_session', 'shopvax_buyer_session', 'shopvax_customer_session',
  ])
  for (const { options } of cleared) {
    assert.deepEqual(options, { httpOnly: true, sameSite: 'lax', secure: true, path: '/' })
  }
})
