import assert from 'node:assert/strict'

const base = process.env.BASE_URL || 'http://127.0.0.1:3001'
const headers = {
  'content-type': 'application/json',
  'x-forwarded-for': '198.51.100.211',
}

const request = () => fetch(base + '/api/business/orders', {
  method: 'POST', headers, body: JSON.stringify({
    storeSlug: 'pentest-nonexistent-store', items: [{ productId: 'missing', quantity: 1 }],
  }),
})

// No real orders, accounts or financial operations: all requests use an
// impossible store slug and verify middleware behavior on the local CI server.
for (let i = 0; i < 30; i += 1) {
  const response = await request()
  assert.notEqual(response.status, 429, 'unexpected limit on request ' + (i + 1))
  await response.arrayBuffer()
}
const blocked = await request()
assert.equal(blocked.status, 429)
assert.ok(Number(blocked.headers.get('retry-after')) >= 1)
await blocked.arrayBuffer()

const malformedOrigin = await fetch(base + '/api/public/events', {
  method: 'POST',
  headers: { ...headers, origin: 'null', 'sec-fetch-site': 'same-site' },
  body: '{}',
})
assert.equal(malformedOrigin.status, 403)
console.log('[security] public mutation rate limit and Origin validation: ok')
