import assert from 'node:assert/strict'

// Integration test: run ONLY against a local disposable test server/database.
// CI already starts the application with its own isolated PostgreSQL service.
const base = process.env.BASE_URL || 'http://127.0.0.1:3000'
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) {
  throw new Error('admin-pagination integration refuses non-local targets')
}
const unique = `admin-perf-${Date.now()}-${Math.random().toString(16).slice(2)}`

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    method: options.method || 'GET',
    headers: {
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const json = await response.json().catch(() => null)
  return { status: response.status, json, cookie: response.headers.get('set-cookie')?.split(';')[0] || '' }
}
async function register(name) {
  const r = await request('/api/auth/register', {
    method: 'POST',
    body: {
      name, email: `${name}-${unique}@example.test`,
      password: 'performance-regression-1234',
      storeName: `${name} ${unique}`, whatsapp: '5511999999999', planCode: 'bronze',
    },
  })
  assert.equal(r.status, 201, JSON.stringify(r.json))
  assert.ok(r.cookie, 'registered owner must receive session')
  return r.cookie
}
async function add(cookie, sku, name, category) {
  const r = await request('/api/admin/products', {
    method: 'POST', cookie,
    body: { sku, name, category, description: '', pack: '', price: 59.9, mediaUrl: '', variations: [] },
  })
  assert.equal(r.status, 201, JSON.stringify(r.json))
  return r.json.product.id
}
const a = await register('owner-a')
const b = await register('owner-b')
assert.equal((await request('/api/admin/products?page=1')).status, 401)
const ids = []
for (const [sku,name,category] of [
  ['A-01','Blusa Azul','Blusas'], ['A-02','Blusa Verde','Blusas'],
  ['A-03','Calça Azul','Calças'], ['A-04','Blusa Branca','Blusas'],
]) ids.push(await add(a,sku,name,category))
const otherId = await add(b,'B-01','Blusa Secreta','Blusas')

const compact = await request('/api/admin/bootstrap?compact=1', { cookie: a })
assert.equal(compact.status, 200)
assert.deepEqual(compact.json.products, [], 'compact bootstrap must not materialize product rows')
assert.equal(compact.json.productCount, 4)
assert.equal(compact.json.productCategories.find(c => c.category === 'Blusas')?.count, 3)
const legacy = await request('/api/admin/bootstrap', { cookie: a })
assert.equal(legacy.json.products.length, 4, 'legacy client contract remains compatible')

const first = await request('/api/admin/products?page=1&limit=2', { cookie: a })
const second = await request('/api/admin/products?page=2&limit=2', { cookie: a })
assert.equal(first.status, 200)
assert.equal(first.json.pagination.total, 4)
assert.equal(first.json.products.length, 2)
assert.equal(second.json.products.length, 2)
assert.equal(new Set([...first.json.products, ...second.json.products].map(p => p.id)).size, 4)
assert.ok(first.json.products.every(p => p.price === 59.9))
assert.ok(![...first.json.products, ...second.json.products].some(p => p.id === otherId))

const filtered = await request('/api/admin/products?limit=2&page=1&q=blusa&category=Blusas', { cookie: a })
assert.equal(filtered.json.pagination.total, 3)
assert.equal(filtered.json.products.length, 2)
assert.ok(filtered.json.products.every(p => p.category === 'Blusas'))
const sku = await request('/api/admin/products?q=A-03', { cookie: a })
assert.deepEqual(sku.json.products.map(p => p.id), [ids[2]])
const noMatch = await request('/api/admin/products?q=secreta&store_id=IGNORED', { cookie: a })
assert.equal(noMatch.json.pagination.total, 0, 'client-supplied tenant identifier must never bypass ownership')
const other = await request('/api/admin/products?page=1', { cookie: b })
assert.deepEqual(other.json.products.map(p => p.id), [otherId])
const bounded = await request('/api/admin/products?limit=999999&page=-7', { cookie: a })
assert.equal(bounded.json.pagination.limit, 100)
assert.equal(bounded.json.pagination.page, 1)
console.log('ADMIN_PAGINATION_ISOLATION_PASS')
