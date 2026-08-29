import assert from 'node:assert/strict'

const base = process.env.BASE_URL || 'http://127.0.0.1:3000'

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${base}/health`)
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Servidor não iniciou a tempo.')
}

async function register() {
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Admin Equipe', email: `team-${Date.now()}-${Math.random()}@example.test`, password: 'scanner1234', storeName: `Loja Equipe ${Date.now()}`, whatsapp: '5511999999999' }),
  })
  assert.equal(response.status, 201)
  const body = await response.json()
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie)
  return { cookie, storeSlug: body.storeSlug }
}

async function admin(path, cookie, options = {}) {
  return fetch(`${base}${path}`, { ...options, headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(options.headers || {}) } })
}

await waitForServer()
const account = await register()

let response = await admin('/api/admin/sellers', account.cookie, {
  method: 'POST', body: JSON.stringify({ name: 'Beatriz Equipe', phone: '5511988887777' }),
})
assert.equal(response.status, 201)
const seller = (await response.json()).seller

response = await admin('/api/admin/products', account.cookie, {
  method: 'POST', body: JSON.stringify({ sku: 'TEAM-001', name: 'Produto Equipe', description: 'Teste de comissão', price: 500, category: 'Equipe', mediaUrl: '', mediaType: 'image', pack: '', variations: [], active: true }),
})
assert.equal(response.status, 201)
const product = (await response.json()).product

response = await admin(`/api/admin/team/sellers/${seller.id}`, account.cookie, {
  method: 'PATCH', body: JSON.stringify({ role: 'gerente', commissionType: 'percent', commissionValue: 10 }),
})
assert.equal(response.status, 200)
let team = await response.json()
assert.equal(team.administrator.role, 'administrador')
assert.match(team.interpretation, /estimativa/i)
assert.match(team.interpretation, /não representa faturamento confirmado/i)
let member = team.sellers.find((item) => item.id === seller.id)
assert.equal(member.role, 'gerente')
assert.equal(member.commissionType, 'percent')
assert.equal(member.commissionValue, 10)

response = await fetch(`${base}/api/business/orders`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ storeSlug: account.storeSlug, sellerSlug: seller.slug, items: [{ productId: product.id, quantity: 1, selections: {} }] }),
})
assert.equal(response.status, 201)
const order = await response.json()
assert.ok(order.orderId)

response = await admin('/api/admin/team', account.cookie)
assert.equal(response.status, 200)
team = await response.json()
member = team.sellers.find((item) => item.id === seller.id)
assert.equal(member.metrics.attributedOrders, 1)
assert.equal(member.metrics.attributedValue, 500)
assert.equal(member.metrics.estimatedCommission, 50)

response = await admin(`/api/admin/team/sellers/${seller.id}`, account.cookie, {
  method: 'PATCH', body: JSON.stringify({ role: 'vendedora', commissionType: 'fixed', commissionValue: 25 }),
})
assert.equal(response.status, 200)
team = await response.json()
member = team.sellers.find((item) => item.id === seller.id)
assert.equal(member.role, 'vendedora')
assert.equal(member.metrics.estimatedCommission, 25)

response = await admin(`/api/admin/features/orders/${order.orderId}/cancel`, account.cookie, { method: 'POST', body: '{}' })
assert.equal(response.status, 200)
response = await admin('/api/admin/team', account.cookie)
team = await response.json()
member = team.sellers.find((item) => item.id === seller.id)
assert.equal(member.metrics.attributedOrders, 0, 'pedido cancelado não deve compor a estimativa')
assert.equal(member.metrics.attributedValue, 0)
assert.equal(member.metrics.estimatedCommission, 0)

response = await admin(`/api/admin/team/sellers/${seller.id}`, account.cookie, {
  method: 'PATCH', body: JSON.stringify({ role: 'supervisor-total', commissionType: 'percent', commissionValue: 10 }),
})
assert.equal(response.status, 400, 'papéis fora do modelo mínimo devem ser recusados')

console.log('[business module 5] roles + optional commission estimate: ok')
