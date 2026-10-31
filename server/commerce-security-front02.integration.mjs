import assert from 'node:assert/strict'
import pg from 'pg'

const { Pool } = pg
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const base = process.env.BASE_URL || 'http://127.0.0.1:3000'
const unique = String(Date.now()) + '-' + Math.random().toString(16).slice(2)
const jsonHeaders = { 'content-type': 'application/json' }

function cookieFrom(response, name) {
  const values = response.headers.getSetCookie?.() || [response.headers.get('set-cookie')].filter(Boolean)
  return values.map(value => String(value).split(';')[0]).find(value => value.startsWith(name + '=')) || ''
}
async function call(path, { method = 'GET', cookie = '', body } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(body === undefined ? {} : jsonHeaders), ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let payload
  try { payload = JSON.parse(text) } catch { payload = text }
  return { response, payload, cookie: cookieFrom(response, 'atacado_session') || cookieFrom(response, 'shopvax_customer_session') }
}
async function owner(letter) {
  const result = await call('/api/auth/register', {
    method: 'POST',
    body: {
      name: 'Dono ' + letter, email: 'owner-' + letter + '-' + unique + '@example.test',
      password: 'strong-test-owner-123', storeName: 'Loja Comercial ' + letter + ' ' + unique,
      whatsapp: '5511991111111', planCode: 'bronze',
    },
  })
  assert.equal(result.response.status, 201, JSON.stringify(result.payload))
  assert.ok(result.cookie.startsWith('atacado_session='))
  return { cookie: result.cookie, slug: result.payload.storeSlug }
}
async function buyer(store, letter) {
  const result = await call('/api/public/store/' + store.slug + '/customers/register', {
    method: 'POST', body: {
      name: 'Comprador ' + letter, email: 'buyer-' + letter + '-' + unique + '@example.test',
      password: 'strong-test-buyer-123', phone: '5511981111111',
    },
  })
  assert.equal(result.response.status, 201, JSON.stringify(result.payload))
  assert.ok(result.cookie.startsWith('shopvax_customer_session='))
  return { cookie: result.cookie, id: result.payload.customer.id }
}
async function product(store, suffix, price = 500) {
  const result = await call('/api/admin/products', {
    method: 'POST', cookie: store.cookie,
    body: { sku: 'SEC-' + suffix + '-' + unique, name: 'Peça ' + suffix, description: '',
      price, category: 'Testes', mediaUrl: '', mediaType: 'image', pack: '', variations: [], active: true },
  })
  assert.equal(result.response.status, 201, JSON.stringify(result.payload))
  return result.payload.product.id
}
async function prepare(store, buyerCookie, productId, extra = {}) {
  return call('/api/business/orders', {
    method: 'POST', cookie: buyerCookie,
    body: {
      storeSlug: store.slug,
      items: [{ productId, quantity: 1, selections: {}, unitPrice: 0.01, price: 0.01 }],
      total: 0.01,
      ...extra,
    },
  })
}
async function setStock(store, productId, quantity) {
  const result = await call('/api/admin/features/products/' + productId + '/stock', {
    method: 'PATCH', cookie: store.cookie,
    body: { enabled: true, quantity, variantStock: {} },
  })
  assert.equal(result.response.status, 200, JSON.stringify(result.payload))
}
async function countOrders(storeId) {
  const r = await pool.query('SELECT count(*)::int AS total FROM orders WHERE store_id=$1', [storeId])
  return Number(r.rows[0].total)
}

try {
  const first = await owner('A')
  const second = await owner('B')
  const rowA = (await pool.query('SELECT id FROM stores WHERE slug=$1', [first.slug])).rows[0]
  const rowB = (await pool.query('SELECT id FROM stores WHERE slug=$1', [second.slug])).rows[0]
  assert.notEqual(rowA.id, rowB.id)
  const a1 = await buyer(first, 'A1')
  const a2 = await buyer(first, 'A2')
  const b1 = await buyer(second, 'B1')

  let res = await call('/api/public/store/' + first.slug + '/customers/me', { cookie: a1.cookie })
  assert.equal(res.response.status, 200)
  assert.match(res.response.headers.get('cache-control') || '', /no-store/)
  assert.equal(res.payload.orders.length, 0)
  assert.equal((await call('/api/public/store/' + second.slug + '/customers/me', { cookie: a1.cookie })).response.status, 401)
  assert.equal((await call('/api/public/store/' + first.slug + '/customers/me', { cookie: b1.cookie })).response.status, 401)
  assert.equal((await call('/api/public/store/' + first.slug + '/customers/me', { cookie: first.cookie })).response.status, 401)

  const firstProduct = await product(first, 'first')
  await pool.query("UPDATE stores SET plan_tier='prata' WHERE id=ANY($1::text[])", [[rowA.id, rowB.id]])
  await setStock(first, firstProduct, 1)

  const noSeller = await prepare(first, a1.cookie, firstProduct)
  assert.equal(noSeller.response.status, 409)
  assert.equal(noSeller.payload.code, 'NO_AVAILABLE_SELLER')
  assert.equal(await countOrders(rowA.id), 0)
  assert.equal(Number((await pool.query('SELECT stock_quantity FROM products WHERE id=$1', [firstProduct])).rows[0].stock_quantity), 1)

  const active = await call('/api/admin/sellers', {
    method: 'POST', cookie: first.cookie,
    body: { name: 'Vendedora disponível', phone: '5511982222233', isActive: true },
  })
  assert.equal(active.response.status, 201)
  const inactive = await call('/api/admin/sellers', {
    method: 'POST', cookie: first.cookie,
    body: { name: 'Vendedora inativa', phone: '5511989999988', isActive: false },
  })
  assert.equal(inactive.response.status, 201)
  const badPhone = await call('/api/admin/sellers', {
    method: 'POST', cookie: first.cookie,
    body: { name: 'Vendedora com telefone legado', phone: '5511989999977', isActive: true },
  })
  assert.equal(badPhone.response.status, 201)
  await pool.query("UPDATE sellers SET phone='not-a-phone' WHERE id=$1", [badPhone.payload.seller.id])

  const publicPage = await call('/api/public/store/' + first.slug, { cookie: a1.cookie })
  assert.equal(publicPage.response.status, 200)
  assert.match(publicPage.response.headers.get('cache-control') || '', /no-store/)
  assert.equal(publicPage.payload.customer.id, a1.id)
  assert.notEqual(publicPage.payload.seller.phone, publicPage.payload.store.whatsapp)

  res = await prepare(first, a1.cookie, firstProduct, { sellerSlug: inactive.payload.seller.slug })
  assert.equal(res.response.status, 201, JSON.stringify(res.payload))
  assert.equal(new URL(res.payload.whatsappUrl).pathname, '/5511982222233')
  const firstOrder = res.payload.orderId
  const stored = (await pool.query('SELECT total,customer_id,seller_id,store_id,status FROM orders WHERE id=$1', [firstOrder])).rows[0]
  assert.equal(Number(stored.total), 500, 'Preço de cliente manipulado não pode alterar valor do banco')
  assert.equal(stored.customer_id, a1.id)
  assert.equal(stored.seller_id, active.payload.seller.id)
  assert.equal(stored.store_id, rowA.id)
  assert.equal(stored.status, 'whatsapp', 'Talão não é venda confirmada')
  assert.equal((await prepare(first, a1.cookie, firstProduct)).response.status, 409, 'Estoque não pode ficar negativo')
  assert.equal(await countOrders(rowA.id), 1)

  // A01: a vendedora atribuída continua ativa, porém perdeu o telefone válido.
  // O backend deve reatribuir antes de baixar estoque, sem usar o número da loja.
  const invalidPhoneProduct = await product(first, 'invalid-phone-fallback')
  await setStock(first, invalidPhoneProduct, 1)
  const fallbackOrder = await prepare(first, a2.cookie, invalidPhoneProduct, { sellerSlug: badPhone.payload.seller.slug })
  assert.equal(fallbackOrder.response.status, 201, JSON.stringify(fallbackOrder.payload))
  assert.equal(new URL(fallbackOrder.payload.whatsappUrl).pathname, '/5511982222233')
  const fallbackSeller = (await pool.query('SELECT seller_id FROM orders WHERE id=$1', [fallbackOrder.payload.orderId])).rows[0]
  assert.equal(fallbackSeller.seller_id, active.payload.seller.id)
  assert.equal(Number((await pool.query('SELECT stock_quantity FROM products WHERE id=$1', [invalidPhoneProduct])).rows[0].stock_quantity), 0)
  assert.equal(await countOrders(rowA.id), 2)

  const secondProduct = await product(first, 'concurrent')
  await setStock(first, secondProduct, 1)
  const attempts = await Promise.all([
    prepare(first, a1.cookie, secondProduct, { sellerSlug: badPhone.payload.seller.slug }),
    prepare(first, a2.cookie, secondProduct),
  ])
  assert.deepEqual(attempts.map(result => result.response.status).sort(), [201, 409])
  assert.equal(new URL(attempts.find(result => result.response.status === 201).payload.whatsappUrl).pathname, '/5511982222233')
  assert.equal(Number((await pool.query('SELECT stock_quantity FROM products WHERE id=$1', [secondProduct])).rows[0].stock_quantity), 0)
  assert.equal(await countOrders(rowA.id), 3)

  // Loja B precisa ter vendedora para o teste alcançar a validação cross-tenant do produto.
  const secondSeller = await call('/api/admin/sellers', {
    method: 'POST', cookie: second.cookie,
    body: { name: 'Atendimento B', phone: '5511977777700', isActive: true },
  })
  assert.equal(secondSeller.response.status, 201)
  const foreignProduct = await prepare(second, b1.cookie, firstProduct)
  assert.equal(foreignProduct.response.status, 400, 'Outro tenant não pode comprar produto de loja alheia')
  assert.equal(await countOrders(rowB.id), 0)
  assert.equal((await call('/api/admin/features/orders/' + firstOrder + '/cancel', { method: 'POST', cookie: second.cookie, body: {} })).response.status, 404)

  // Defensa em profundidade: nem mesmo FK inconsistente pode trazer nome/dados da loja A ao painel da B.
  const productB = await product(second, 'tenant-b')
  const createdB = await prepare(second, b1.cookie, productB)
  assert.equal(createdB.response.status, 201)
  const ownOrderB = createdB.payload.orderId
  await pool.query('UPDATE orders SET customer_id=$1 WHERE id=$2', [a1.id, ownOrderB])
  const panelB = await call('/api/admin/phase2', { cookie: second.cookie })
  assert.equal(panelB.response.status, 200)
  assert.equal(panelB.payload.orders.find(order => order.id === ownOrderB).customer_name, null, 'Join do painel deve exigir loja do comprador')
  const panelA = await call('/api/admin/phase2', { cookie: first.cookie })
  assert.equal(panelA.response.status, 200)
  const validOrdersA1 = (await pool.query('SELECT count(*)::int AS total FROM orders WHERE store_id=$1 AND customer_id=$2', [rowA.id, a1.id])).rows[0].total
  assert.equal(panelA.payload.customers.find(customer => customer.id === a1.id).orders_count, validOrdersA1, 'Pedidos de outra loja não contam mesmo se customer_id estiver adulterado')
  await pool.query('UPDATE orders SET customer_id=$1 WHERE id=$2', [b1.id, ownOrderB])

  await call('/api/admin/phase2/orders/' + firstOrder + '/status', {
    method: 'PATCH', cookie: first.cookie, body: { status: 'confirmado' },
  }).then(result => assert.equal(result.response.status, 200, JSON.stringify(result.payload)))
  const meA1 = await call('/api/public/store/' + first.slug + '/customers/me', { cookie: a1.cookie })
  const meA2 = await call('/api/public/store/' + first.slug + '/customers/me', { cookie: a2.cookie })
  const meB1 = await call('/api/public/store/' + second.slug + '/customers/me', { cookie: b1.cookie })
  assert.equal(meA1.response.status, 200)
  assert.equal(meA2.response.status, 200)
  assert.equal(meB1.response.status, 200)
  assert.equal(meB1.payload.orders.length, 1)
  assert.equal(meB1.payload.orders[0].id, ownOrderB)
  assert.equal(meA1.payload.orders.find(order => order.id === firstOrder)?.status, 'confirmado')
  assert.equal(meA2.payload.orders.some(order => order.id === firstOrder), false)
  assert.equal(meA1.payload.orders.length + meA2.payload.orders.length, 3)
  assert.match(meA1.payload.semantics, /não comprova/i)

  res = await call('/api/admin/features/orders/' + firstOrder + '/cancel', { method: 'POST', cookie: first.cookie, body: {} })
  assert.equal(res.response.status, 200)
  res = await call('/api/admin/features/orders/' + firstOrder + '/cancel', { method: 'POST', cookie: first.cookie, body: {} })
  assert.equal(res.response.status, 200)
  assert.equal(res.payload.idempotent, true)
  assert.equal(Number((await pool.query('SELECT stock_quantity FROM products WHERE id=$1', [firstProduct])).rows[0].stock_quantity), 1)

  res = await call('/api/public/customers/logout', { method: 'POST', cookie: a1.cookie })
  assert.equal(res.response.status, 200)
  assert.equal((await call('/api/public/store/' + first.slug + '/customers/me', { cookie: a1.cookie })).response.status, 401)
  assert.equal((await call('/api/public/store/' + first.slug + '/customers/me', { cookie: a2.cookie })).response.status, 200)
  assert.equal((await call('/api/admin/phase2', { cookie: first.cookie })).response.status, 200)
  console.log('COMMERCE_SECURITY_FRONT02_PASS: two stores, three buyers, prices, stock races, seller validity, status and logout')
} finally {
  await pool.end()
}
