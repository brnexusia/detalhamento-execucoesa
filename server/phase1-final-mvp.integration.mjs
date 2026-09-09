import assert from 'node:assert/strict'

const base = process.env.BASE_URL || 'http://127.0.0.1:3000'
const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${base}/health`)
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Servidor não ficou pronto.')
}

async function request(path, { method = 'GET', cookie = '', body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = response.status === 204 ? null : await response.json().catch(() => null)
  return { response, payload }
}

async function register() {
  const result = await request('/api/auth/register', {
    method: 'POST',
    body: {
      name: 'Fase 1 MVP',
      email: `phase1-${unique}@example.test`,
      password: 'phase1-mvp-1234',
      storeName: `Loja Fase 1 ${unique}`,
      whatsapp: '5511999999999',
    },
  })
  assert.equal(result.response.status, 201)
  const cookie = result.response.headers.get('set-cookie')?.split(';')[0] || ''
  assert.ok(cookie)
  return { cookie, storeSlug: result.payload.storeSlug }
}

try {
  await waitForServer()
  const account = await register()

  let result = await request('/api/admin/plan-context', { cookie: account.cookie })
  assert.equal(result.response.status, 200)
  assert.equal(result.payload.plan.code, 'bronze')
  assert.equal(result.payload.plan.name, 'Plano 1')
  assert.equal(result.payload.plan.limits.sellers, 2)
  assert.equal(result.payload.plan.limits.products, null)
  assert.equal(result.payload.plan.limits.photosPerProduct, 5)
  assert.equal(result.payload.plan.features.whatsappOrder, true)
  assert.equal(result.payload.plan.features.sellerCommission, false)

  for (let index = 0; index < 2; index += 1) {
    result = await request('/api/admin/sellers', {
      method: 'POST', cookie: account.cookie,
      body: { name: `Vendedora ${index + 1}`, phone: `55119888000${index + 10}`, isActive: true },
    })
    assert.equal(result.response.status, 201)
  }

  result = await request('/api/admin/sellers', {
    method: 'POST', cookie: account.cookie,
    body: { name: 'Vendedora 3', phone: '5511988800099', isActive: true },
  })
  assert.equal(result.response.status, 409)
  assert.equal(result.payload.code, 'PLAN_LIMIT')
  assert.equal(result.payload.max, 2)

  result = await request('/api/admin/products', {
    method: 'POST', cookie: account.cookie,
    body: {
      sku: 'F1-GALERIA', name: 'Produto Fase 1', description: 'Produto de validação', price: 49.9,
      category: 'Teste', mediaUrl: '', mediaType: 'image', pack: '',
      variations: [{ name: 'Cor', options: ['Preto', 'Branco'] }], active: true,
    },
  })
  assert.equal(result.response.status, 201)
  const productId = result.payload.product.id

  const fivePhotos = Array.from({ length: 5 }, (_, index) => `https://assets.example.test/fase1-${index + 1}.jpg`)
  result = await request(`/api/admin/products/${productId}/gallery`, {
    method: 'PATCH', cookie: account.cookie, body: { images: fivePhotos },
  })
  assert.equal(result.response.status, 200)
  assert.equal(result.payload.product.images.length, 5)
  assert.equal(result.payload.limit, 5)

  result = await request(`/api/admin/products/${productId}/gallery`, {
    method: 'PATCH', cookie: account.cookie, body: { images: [...fivePhotos, 'https://assets.example.test/fase1-6.jpg'] },
  })
  assert.equal(result.response.status, 409)
  assert.equal(result.payload.code, 'PLAN_PHOTO_LIMIT')
  assert.equal(result.payload.max, 5)

  result = await request('/api/admin/catalogs', { cookie: account.cookie })
  assert.equal(result.response.status, 200)
  assert.equal(result.payload.catalogs.length, 1, 'Plano 1 deve começar com um único catálogo padrão')
  const catalog = result.payload.catalogs[0]
  assert.equal(catalog.isDefault, true)

  result = await request(`/api/admin/catalogs/${catalog.id}`, {
    method: 'PATCH', cookie: account.cookie,
    body: {
      minimumOrder: 100,
      items: [{ productId, priceOverride: 60, visible: true }],
    },
  })
  assert.equal(result.response.status, 200)

  result = await request(`/api/public/store/${account.storeSlug}?catalog=${encodeURIComponent(catalog.slug)}`, {})
  assert.equal(result.response.status, 200)
  assert.equal(result.payload.store.minimumOrder, 100)
  const publicProduct = result.payload.products.find((product) => product.id === productId)
  assert.ok(publicProduct)
  assert.equal(publicProduct.price, 60, 'preço público deve vir do catálogo, não do preço base')
  assert.equal(publicProduct.images.length, 5)
  assert.equal(publicProduct.variations[0].name, 'Cor')

  result = await request('/api/business/orders', {
    method: 'POST',
    body: { storeSlug: account.storeSlug, catalogSlug: catalog.slug, items: [{ productId, quantity: 2, selections: {} }] },
  })
  assert.equal(result.response.status, 400)
  assert.match(result.payload.error, /Escolha Cor/)

  result = await request('/api/business/orders', {
    method: 'POST',
    body: { storeSlug: account.storeSlug, catalogSlug: catalog.slug, items: [{ productId, quantity: 1, selections: { Cor: 'Preto' } }] },
  })
  assert.equal(result.response.status, 400)
  assert.match(result.payload.error, /pedido mínimo/i)

  result = await request('/api/business/orders', {
    method: 'POST',
    body: { storeSlug: account.storeSlug, catalogSlug: catalog.slug, items: [{ productId, quantity: 2, selections: { Cor: 'Preto' } }] },
  })
  assert.equal(result.response.status, 201)
  assert.ok(result.payload.orderId)
  assert.ok(result.payload.code)
  assert.equal(result.payload.catalog.slug, catalog.slug)
  assert.match(result.payload.whatsappUrl, /^https:\/\/wa\.me\/5511999999999\?text=/)
  const whatsappMessage = new URL(result.payload.whatsappUrl).searchParams.get('text') || ''
  assert.match(whatsappMessage, /2x Produto Fase 1/)
  assert.match(whatsappMessage, /Cor: Preto/)
  assert.match(whatsappMessage, /120,00/)
  assert.match(whatsappMessage, new RegExp(result.payload.code))

  console.log('[phase1 final MVP] plans + gallery + catalog price + grid + minimum + WhatsApp: ok')
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
