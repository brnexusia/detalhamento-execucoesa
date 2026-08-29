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
    body: JSON.stringify({ name: 'Teste Métricas', email: `metrics-${Date.now()}-${Math.random()}@example.test`, password: 'scanner1234', storeName: `Loja Métricas ${Date.now()}`, whatsapp: '5511999999999' }),
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

function publicCookie(response) {
  const raw = response.headers.get('set-cookie') || ''
  const match = /(?:^|,\s*)(atacado_public=[^;]+)/.exec(raw)
  return match?.[1] || ''
}

await waitForServer()
const account = await register()

let response = await admin('/api/admin/sellers', account.cookie, {
  method: 'POST', body: JSON.stringify({ name: 'Ana Métricas', phone: '5511988887777' }),
})
assert.equal(response.status, 201)
const seller = (await response.json()).seller

response = await admin('/api/admin/products', account.cookie, {
  method: 'POST', body: JSON.stringify({ sku: 'MET-001', name: 'Produto Métricas', description: 'Produto para medir intenção', price: 500, category: 'Teste', mediaUrl: '', mediaType: 'image', pack: '', variations: [], active: true }),
})
assert.equal(response.status, 201)
const product = (await response.json()).product

response = await fetch(`${base}/api/public/store/${account.storeSlug}/${seller.slug}`, {
  headers: { 'User-Agent': 'Mozilla/5.0 MetricsTest', 'X-Forwarded-For': '203.0.113.84' },
})
assert.equal(response.status, 200)
const visitor = publicCookie(response)
assert.ok(visitor)
const catalogPage = await response.json()
assert.equal(catalogPage.products.some((item) => item.id === product.id), true)
assert.ok(catalogPage.activeCatalog?.slug)
const publicHeaders = { 'Content-Type': 'application/json', Cookie: visitor, 'User-Agent': 'Mozilla/5.0 MetricsTest', 'X-Forwarded-For': '203.0.113.84' }
const eventBase = { storeSlug: account.storeSlug, sellerSlug: seller.slug, catalogSlug: catalogPage.activeCatalog.slug, productId: product.id }

for (const kind of ['product_click', 'cart_add']) {
  response = await fetch(`${base}/api/public/intent-events`, { method: 'POST', headers: publicHeaders, body: JSON.stringify({ ...eventBase, kind }) })
  assert.equal(response.status, 204)
}
response = await fetch(`${base}/api/public/intent-events`, { method: 'POST', headers: publicHeaders, body: JSON.stringify({ storeSlug: account.storeSlug, sellerSlug: seller.slug, catalogSlug: catalogPage.activeCatalog.slug, kind: 'checkout_start' }) })
assert.equal(response.status, 204)

response = await fetch(`${base}/api/business/orders`, {
  method: 'POST', headers: publicHeaders,
  body: JSON.stringify({ storeSlug: account.storeSlug, sellerSlug: seller.slug, catalogSlug: catalogPage.activeCatalog.slug, items: [{ productId: product.id, quantity: 1, selections: {} }] }),
})
assert.equal(response.status, 201)
const order = await response.json()
assert.ok(order.orderId)

response = await admin('/api/admin/intent-reports?days=30', account.cookie)
assert.equal(response.status, 200)
const reports = await response.json()
assert.equal(reports.periodDays, 30)
assert.match(reports.interpretation, /intenção/i)
assert.match(reports.interpretation, /não representam faturamento/i)

const item = reports.items.find((entry) => entry.id === product.id)
assert.ok(item)
assert.ok(item.views >= 1)
assert.ok(item.clicks >= 1)
assert.ok(item.cartAdds >= 1)
assert.ok(item.whatsapp >= 1)

const sellerReport = reports.sellers.find((entry) => entry.sellerId === seller.id)
assert.ok(sellerReport)
assert.ok(sellerReport.accesses >= 1)
assert.ok(sellerReport.carts >= 1)
assert.ok(sellerReport.whatsapp >= 1)

const catalogReport = reports.catalogs.find((entry) => entry.catalogId === catalogPage.activeCatalog.id)
assert.ok(catalogReport)
assert.ok(catalogReport.views >= 1)
assert.ok(catalogReport.carts >= 1)
assert.ok(catalogReport.whatsapp >= 1)

const funnel = Object.fromEntries(reports.funnel.map((stage) => [stage.key, stage.value]))
assert.ok(funnel.access >= 1)
assert.ok(funnel.product >= 1)
assert.ok(funnel.cart >= 1)
assert.ok(funnel.checkout >= 1)
assert.ok(funnel.whatsapp >= 1)

console.log('[business module 4] five intent reports + WhatsApp semantics: ok')
