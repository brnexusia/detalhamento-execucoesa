import assert from 'node:assert/strict'

const base = process.env.BASE_URL || 'http://127.0.0.1:3000'
const browserHeaders = { 'User-Agent': 'Mozilla/5.0 ScannerModule6Test', 'X-Forwarded-For': '203.0.113.61' }

async function register() {
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Proteção Pública',
      email: `public-protection-${Date.now()}-${Math.random()}@example.test`,
      password: 'scanner1234',
      storeName: `Loja Protegida ${Date.now()}`,
      whatsapp: '5511999999999',
    }),
  })
  assert.equal(response.status, 201)
  const body = await response.json()
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie)
  assert.ok(body.storeSlug)
  return { cookie, storeSlug: body.storeSlug }
}

async function admin(path, cookie, options = {}) {
  return fetch(`${base}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(options.headers || {}) },
  })
}

function publicCookie(response) {
  const raw = response.headers.get('set-cookie') || ''
  const match = /(?:^|,\s*)(atacado_public=[^;]+)/.exec(raw)
  return match?.[1] || ''
}

const account = await register()
const productIds = []
for (let index = 1; index <= 55; index += 1) {
  const response = await admin('/api/admin/products', account.cookie, {
    method: 'POST',
    body: JSON.stringify({
      sku: `MOD6-${String(index).padStart(3, '0')}`,
      name: `Produto Protegido ${String(index).padStart(3, '0')}`,
      description: `Descrição ${index}`,
      price: 10 + index / 100,
      category: index % 2 === 0 ? 'Camisas' : 'Calças',
      mediaUrl: '',
      mediaType: 'image',
      pack: '',
      variations: index % 3 === 0 ? [{ name: 'Tamanho', options: ['P', 'M', 'G'] }] : [],
      active: true,
    }),
  })
  assert.equal(response.status, 201)
  const body = await response.json()
  productIds.push(body.product.id)
}

let response = await fetch(`${base}/api/public/store/${account.storeSlug}?limit=500`, { headers: browserHeaders })
assert.equal(response.status, 200)
assert.equal(response.headers.get('cache-control'), 'private, no-store')
assert.match(response.headers.get('x-robots-tag') || '', /noindex/)
const visitor = publicCookie(response)
assert.ok(visitor, 'primeira página deve emitir cookie público opaco')
let page = await response.json()
assert.equal(page.products.length, 24, 'endpoint público nunca pode despejar o catálogo inteiro')
assert.equal(page.page.limit, 24)
assert.equal(page.page.hasMore, true)
assert.ok(page.page.nextCursor)
assert.ok(page.categories.includes('Camisas'))
assert.ok(page.categories.includes('Calças'))
const firstIds = new Set(page.products.map((item) => item.id))

response = await fetch(`${base}/api/public/store/${account.storeSlug}?cursor=${encodeURIComponent(page.page.nextCursor)}`, {
  headers: { ...browserHeaders, Cookie: visitor },
})
assert.equal(response.status, 200)
let page2 = await response.json()
assert.equal(page2.products.length, 24)
assert.equal(page2.products.some((item) => firstIds.has(item.id)), false, 'cursor não pode repetir a página anterior')
assert.equal(page2.page.hasMore, true)

response = await fetch(`${base}/api/public/store/${account.storeSlug}?cursor=${encodeURIComponent(`${page.page.nextCursor}x`)}`, {
  headers: { ...browserHeaders, Cookie: visitor },
})
assert.equal(response.status, 400, 'cursor adulterado deve falhar')

response = await fetch(`${base}/api/public/store/${account.storeSlug}?cursor=${encodeURIComponent(page.page.nextCursor)}`, {
  headers: { ...browserHeaders, 'X-Forwarded-For': '203.0.113.62' },
})
assert.equal(response.status, 400, 'cursor deve ficar vinculado ao visitante que iniciou a navegação')

response = await fetch(`${base}/api/public/store/${account.storeSlug}?q=${encodeURIComponent('MOD6-055')}`, {
  headers: { ...browserHeaders, Cookie: visitor },
})
assert.equal(response.status, 200)
let search = await response.json()
assert.equal(search.products.length, 1)
assert.equal(search.products[0].sku, 'MOD6-055')

response = await fetch(`${base}/api/public/store/${account.storeSlug}?category=${encodeURIComponent('Camisas')}`, {
  headers: { ...browserHeaders, Cookie: visitor },
})
assert.equal(response.status, 200)
let categoryPage = await response.json()
assert.ok(categoryPage.products.length > 0)
assert.equal(categoryPage.products.every((item) => item.category === 'Camisas'), true)

const allIds = new Set(firstIds)
for (const item of page2.products) allIds.add(item.id)
response = await fetch(`${base}/api/public/store/${account.storeSlug}?cursor=${encodeURIComponent(page2.page.nextCursor)}`, {
  headers: { ...browserHeaders, Cookie: visitor },
})
assert.equal(response.status, 200)
const page3 = await response.json()
for (const item of page3.products) allIds.add(item.id)
assert.equal(allIds.size, 55, 'navegação humana sequencial deve conseguir chegar ao catálogo completo')
assert.equal(page3.page.hasMore, false)

const lateProduct = page3.products[0]
response = await fetch(`${base}/api/public/orders`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...browserHeaders, Cookie: visitor },
  body: JSON.stringify({
    storeSlug: account.storeSlug,
    items: [{ productId: lateProduct.id, quantity: 50, selections: Object.fromEntries((lateProduct.variations || []).map((group) => [group.name, group.options[0]])) }],
  }),
})
assert.equal(response.status, 201, 'proteção do catálogo não pode quebrar fechamento do carrinho')
const order = await response.json()
assert.match(order.code, /^AS-/)
assert.match(order.whatsappUrl, /^https:\/\/wa\.me\//)

response = await fetch(`${base}/robots.txt`)
assert.equal(response.status, 200)
assert.match(await response.text(), /Disallow: \/api\//)

const botHeaders = { 'User-Agent': 'python-requests/2.32', 'X-Forwarded-For': '203.0.113.90' }
response = await fetch(`${base}/api/public/store/${account.storeSlug}`, { headers: botHeaders })
assert.equal(response.status, 200)
const botCookie = publicCookie(response)
assert.ok(botCookie)
let blocked = false
for (let attempt = 0; attempt < 5; attempt += 1) {
  response = await fetch(`${base}/api/public/store/${account.storeSlug}`, { headers: { ...botHeaders, Cookie: botCookie } })
  if (response.status === 429) {
    blocked = true
    assert.ok(Number(response.headers.get('retry-after') || 0) >= 1)
    break
  }
}
assert.equal(blocked, true, 'cliente automatizado em rajada deve ser limitado')

console.log('[scanner module 6] public anti-scraping protection: ok')
