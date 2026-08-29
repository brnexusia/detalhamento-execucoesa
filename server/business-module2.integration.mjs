import assert from 'node:assert/strict'
import pg from 'pg'

const { Pool } = pg
const base = process.env.BASE_URL || 'http://127.0.0.1:3000'
const db = new Pool({ connectionString: process.env.DATABASE_URL })

async function register() {
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Teste Estoque',
      email: `stock-${Date.now()}-${Math.random()}@example.test`,
      password: 'scanner1234',
      storeName: `Loja Estoque ${Date.now()}`,
      whatsapp: '5511999999999',
    }),
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

try {
  const account = await register()
  let response = await admin('/api/admin/products', account.cookie, {
    method: 'POST',
    body: JSON.stringify({
      sku: 'EST-001', name: 'Camisa Estoque', description: 'Teste', price: 500, category: 'Camisas',
      mediaUrl: '', mediaType: 'image', pack: '',
      variations: [{ name: 'Cor', options: ['Preto', 'Branco'] }, { name: 'Tamanho', options: ['P'] }], active: true,
    }),
  })
  assert.equal(response.status, 201)
  const product = (await response.json()).product
  const blackKey = 'Cor=Preto|Tamanho=P'
  const whiteKey = 'Cor=Branco|Tamanho=P'

  response = await admin(`/api/admin/features/products/${product.id}/stock`, account.cookie, {
    method: 'PATCH', body: JSON.stringify({ enabled: true, quantity: 0, variantStock: { [blackKey]: 2, [whiteKey]: 4 } }),
  })
  assert.equal(response.status, 200)

  response = await fetch(`${base}/api/public/store/${account.storeSlug}`, { headers: { 'User-Agent': 'Mozilla/5.0 BusinessStockTest', 'X-Forwarded-For': '203.0.113.72' } })
  assert.equal(response.status, 200)
  const page = await response.json()
  const publicProduct = page.products.find((item) => item.id === product.id)
  assert.equal(publicProduct.stockEnabled, true)
  assert.equal(publicProduct.variantStock[blackKey], 2)

  response = await fetch(`${base}/api/business/orders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ storeSlug: account.storeSlug, items: [{ productId: product.id, quantity: 1, selections: { Cor: 'Preto', Tamanho: 'P' } }] }),
  })
  assert.equal(response.status, 201)
  const order = await response.json()
  assert.ok(order.orderId)
  let row = (await db.query('SELECT variant_stock FROM products WHERE id=$1', [product.id])).rows[0]
  assert.equal(Number(row.variant_stock[blackKey]), 1)
  assert.equal(Number(row.variant_stock[whiteKey]), 4)

  response = await fetch(`${base}/api/business/orders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ storeSlug: account.storeSlug, items: [{ productId: product.id, quantity: 2, selections: { Cor: 'Preto', Tamanho: 'P' } }] }),
  })
  assert.equal(response.status, 409, 'não pode vender acima do saldo')

  response = await admin(`/api/admin/features/orders/${order.orderId}/cancel`, account.cookie, { method: 'POST', body: '{}' })
  assert.equal(response.status, 200)
  row = (await db.query('SELECT variant_stock FROM products WHERE id=$1', [product.id])).rows[0]
  assert.equal(Number(row.variant_stock[blackKey]), 2, 'cancelamento deve devolver estoque')

  response = await admin(`/api/admin/features/orders/${order.orderId}/cancel`, account.cookie, { method: 'POST', body: '{}' })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).idempotent, true)
  row = (await db.query('SELECT variant_stock FROM products WHERE id=$1', [product.id])).rows[0]
  assert.equal(Number(row.variant_stock[blackKey]), 2, 'cancelamento repetido não pode duplicar estoque')

  console.log('[business module 2] stock + variant + rollback: ok')
} finally {
  await db.end()
}
