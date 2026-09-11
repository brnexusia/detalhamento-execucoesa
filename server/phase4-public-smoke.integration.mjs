import assert from 'node:assert/strict'
import pg from 'pg'

const { Pool } = pg
const base = process.env.BASE_URL || 'http://127.0.0.1:3000'
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

try {
  const storeResult = await pool.query("SELECT slug FROM stores WHERE plan_tier='ouro' ORDER BY created_at DESC LIMIT 1")
  assert.equal(storeResult.rowCount, 1)
  const slug = storeResult.rows[0].slug

  let response = await fetch(`${base}/api/public/phase4/config/${encodeURIComponent(slug)}`)
  assert.equal(response.status, 200)
  let payload = await response.json()
  assert.equal(payload.eligible, true)
  assert.equal(payload.shipping.enabled, true)
  assert.equal(payload.payment.enabled, true)
  assert.ok(payload.payment.methods.includes('PIX'))
  assert.equal(payload.customerAccountPath, `/cliente/${encodeURIComponent(slug)}`)

  response = await fetch(`${base}/api/public/meta-feed/${encodeURIComponent(slug)}.csv`)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') || '', /text\/csv/)
  const csv = await response.text()
  assert.match(csv, /F4-001/)

  response = await fetch(`${base}/painel/integracoes`, { redirect: 'manual' })
  assert.ok([200, 304].includes(response.status))

  console.log('[phase4 public smoke] config + Meta feed + integrations route: ok')
} finally {
  await pool.end()
}
