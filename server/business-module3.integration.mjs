import assert from 'node:assert/strict'
import pg from 'pg'
import sharp from 'sharp'

const { Pool } = pg
const base = process.env.BASE_URL || 'http://127.0.0.1:3000'
const db = new Pool({ connectionString: process.env.DATABASE_URL })

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { const response = await fetch(`${base}/health`); if (response.ok) return } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Servidor não ficou pronto.')
}

async function register() {
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Teste Catálogos', email: `catalog-${Date.now()}-${Math.random()}@example.test`, password: 'scanner1234', storeName: `Loja Catálogo ${Date.now()}`, whatsapp: '5511999999999', planCode: 'bronze' }),
  })
  assert.equal(response.status, 201)
  const body = await response.json()
  return { cookie: response.headers.get('set-cookie')?.split(';')[0], storeSlug: body.storeSlug }
}

async function admin(path, cookie, options = {}) {
  return fetch(`${base}${path}`, { ...options, headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(options.headers || {}) } })
}

try {
  await waitForServer()
  const account = await register()
  const sourceImage = await sharp({
    create: { width: 1200, height: 600, channels: 3, background: '#d8d1c4' },
  }).jpeg({ quality: 90 }).toBuffer()
  const form = new FormData()
  form.append('file', new Blob([sourceImage], { type: 'image/jpeg' }), 'catalogo.jpg')
  let response = await fetch(`${base}/api/admin/upload`, {
    method: 'POST',
    headers: { Cookie: account.cookie },
    body: form,
  })
  assert.equal(response.status, 201)
  const uploaded = await response.json()
  assert.equal(uploaded.type, 'image')
  assert.equal(uploaded.variants, undefined, 'upload normal não deve gerar versões redimensionadas')

  response = await fetch(`${base}${uploaded.url}`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'image/jpeg')
  const originalMeta = await sharp(Buffer.from(await response.arrayBuffer())).metadata()
  assert.equal(originalMeta.width, 1200)
  assert.equal(originalMeta.height, 600)

  response = await admin('/api/admin/products', account.cookie, {
    method: 'POST', body: JSON.stringify({ sku: 'CAT-001', name: 'Produto Multi', description: 'Teste', price: 100, category: 'Teste', mediaUrl: uploaded.url, mediaType: 'image', pack: '', variations: [], active: true }),
  })
  assert.equal(response.status, 201)
  const product = (await response.json()).product

  response = await admin('/api/admin/catalogs', account.cookie)
  assert.equal(response.status, 200)
  let list = await response.json()
  assert.equal(list.catalogs.length, 1)
  assert.equal(list.catalogs[0].isDefault, true)

  response = await admin('/api/admin/catalogs', account.cookie, {
    method: 'POST', body: JSON.stringify({ name: 'Varejo Especial', kind: 'varejo', minimumOrder: 100 }),
  })
  assert.equal(response.status, 201)
  const catalog = (await response.json()).catalog

  response = await admin(`/api/admin/catalogs/${catalog.id}`, account.cookie, {
    method: 'PATCH', body: JSON.stringify({ items: [{ productId: product.id, priceOverride: 55, visible: true }] }),
  })
  assert.equal(response.status, 200)

  response = await fetch(`${base}/api/public/store/${account.storeSlug}?catalog=${catalog.slug}&limit=500`, { headers: { 'User-Agent': 'Mozilla/5.0 BusinessCatalogTest', 'X-Forwarded-For': '203.0.113.73' } })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.match(response.headers.get('x-robots-tag') || '', /noindex/)
  const page = await response.json()
  assert.equal(page.activeCatalog.slug, catalog.slug)
  assert.equal(page.store.minimumOrder, 100)
  assert.equal(page.products.find((item) => item.id === product.id).price, 55)
  assert.equal(page.page.limit, 24, 'proteção de paginação deve continuar ativa')

  response = await admin(`/api/admin/catalogs/${catalog.id}/pdf`, account.cookie, { method: 'GET' })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/pdf')
  assert.match(response.headers.get('content-disposition') || '', /shopvax\.pdf/i)
  const pdfBuffer = Buffer.from(await response.arrayBuffer())
  assert.equal(pdfBuffer.subarray(0, 4).toString('ascii'), '%PDF')
  assert.ok(pdfBuffer.length > 1500, 'PDF deve conter layout e produto')

  response = await fetch(`${base}/api/business/orders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ storeSlug: account.storeSlug, catalogSlug: catalog.slug, items: [{ productId: product.id, quantity: 2, selections: {} }] }),
  })
  assert.equal(response.status, 201, 'pedido deve usar mínimo do catálogo')
  const order = await response.json()
  const dbOrder = (await db.query('SELECT total,catalog_id FROM orders WHERE id=$1', [order.orderId])).rows[0]
  assert.equal(Number(dbOrder.total), 110)
  assert.equal(dbOrder.catalog_id, catalog.id)

  response = await admin(`/api/admin/catalogs/${catalog.id}`, account.cookie, {
    method: 'PATCH', body: JSON.stringify({ items: [{ productId: product.id, priceOverride: 55, visible: false }] }),
  })
  assert.equal(response.status, 200)
  response = await fetch(`${base}/api/public/store/${account.storeSlug}?catalog=${catalog.slug}`, { headers: { 'User-Agent': 'Mozilla/5.0 BusinessCatalogTest2', 'X-Forwarded-For': '203.0.113.74' } })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).products.some((item) => item.id === product.id), false, 'visibilidade deve ser independente por catálogo')

  response = await fetch(`${base}/api/public/store/${account.storeSlug}`, { headers: { 'User-Agent': 'Mozilla/5.0 BusinessCatalogDefault', 'X-Forwarded-For': '203.0.113.75' } })
  assert.equal(response.status, 200)
  const defaultPage = await response.json()
  assert.equal(defaultPage.products.find((item) => item.id === product.id).price, 100, 'catálogo principal preserva preço base')

  console.log('[business module 3] catalogs + price + visibility + minimum: ok')
} finally { await db.end() }
