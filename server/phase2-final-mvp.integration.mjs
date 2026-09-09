import assert from 'node:assert/strict'
import pg from 'pg'

const { Pool } = pg
const base = process.env.BASE_URL || 'http://127.0.0.1:3000'
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`

function cookiesFrom(response) {
  const values = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [response.headers.get('set-cookie')].filter(Boolean)
  return values.map((value) => String(value).split(';')[0]).filter(Boolean)
}

function mergeCookies(...groups) {
  const map = new Map()
  for (const raw of groups.flat()) {
    const [name] = String(raw).split('=')
    if (name) map.set(name, raw)
  }
  return [...map.values()].join('; ')
}

async function request(path, { method = 'GET', cookie = '', body, headers = {}, redirect = 'follow' } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    redirect,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let payload = null
  try { payload = text ? JSON.parse(text) : null } catch { payload = text }
  return { response, payload, cookies: cookiesFrom(response) }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const result = await fetch(`${base}/health`)
      if (result.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Servidor não ficou pronto.')
}

async function registerOwner() {
  const result = await request('/api/auth/register', {
    method: 'POST',
    body: {
      name: 'Operação Fase 2',
      email: `phase2-${unique}@example.test`,
      password: 'phase2-owner-1234',
      storeName: `Loja Fase 2 ${unique}`,
      whatsapp: '5511900000000',
    },
  })
  assert.equal(result.response.status, 201)
  const ownerCookie = result.cookies.find((value) => value.startsWith('atacado_session=')) || ''
  assert.ok(ownerCookie)
  return { cookie: ownerCookie, slug: result.payload.storeSlug }
}

try {
  await waitForServer()
  const owner = await registerOwner()

  let result = await request('/api/admin/phase2', { cookie: owner.cookie })
  assert.equal(result.response.status, 200)
  assert.equal(result.payload.plan.code, 'bronze')
  assert.equal(result.payload.plan.limits.sellers, 2)
  assert.equal(result.payload.store.customerLoginEnabled, true)

  for (const [index, name] of ['Ana', 'Bia'].entries()) {
    result = await request('/api/admin/sellers', {
      method: 'POST', cookie: owner.cookie,
      body: { name, phone: `55119888000${index + 11}`, isActive: true },
    })
    assert.equal(result.response.status, 201)
  }
  result = await request('/api/admin/sellers', {
    method: 'POST', cookie: owner.cookie,
    body: { name: 'Carla', phone: '5511988800099', isActive: true },
  })
  assert.equal(result.response.status, 409)
  assert.equal(result.payload.code, 'PLAN_LIMIT')

  // Visitante A recebe a primeira vendedora e permanece nela enquanto o cookie existir.
  result = await request(`/api/public/store/${owner.slug}`)
  assert.equal(result.response.status, 200)
  assert.equal(result.payload.seller.name, 'Ana')
  const visitorA = mergeCookies(result.cookies)
  assert.ok(visitorA.includes('svx_s_'))

  let repeat = await request(`/api/public/store/${owner.slug}`, { cookie: visitorA })
  assert.equal(repeat.response.status, 200)
  assert.equal(repeat.payload.seller.name, 'Ana')

  // Visitante B recebe a próxima vendedora.
  const visitorBResult = await request(`/api/public/store/${owner.slug}`)
  assert.equal(visitorBResult.response.status, 200)
  assert.equal(visitorBResult.payload.seller.name, 'Bia')

  // Plano 1 não pode ativar estoque nem domínio próprio/personalização avançada.
  result = await request('/api/admin/products', {
    method: 'POST', cookie: owner.cookie,
    body: { sku: 'F2-1', name: 'Produto Fase 2', description: '', price: 80, category: 'Teste', mediaUrl: '', mediaType: 'image', pack: '', variations: [], active: true },
  })
  assert.equal(result.response.status, 201)
  const productId = result.payload.product.id

  result = await request(`/api/admin/features/products/${productId}/stock`, {
    method: 'PATCH', cookie: owner.cookie,
    body: { enabled: true, quantity: 10, variantStock: {} },
  })
  assert.equal(result.response.status, 403)
  assert.equal(result.payload.code, 'PLAN_FEATURE')

  result = await request('/api/admin/phase2/store', {
    method: 'PATCH', cookie: owner.cookie,
    body: { customDomain: `loja-${unique}.example.test` },
  })
  assert.equal(result.response.status, 403)

  // Cliente cria conta, entra na sessão e o pedido fica vinculado ao histórico dele.
  result = await request(`/api/public/store/${owner.slug}/customers/register`, {
    method: 'POST',
    body: { name: 'Cliente Teste', email: `cliente-${unique}@example.test`, phone: '5511977700000', password: 'cliente-12345' },
  })
  assert.equal(result.response.status, 201)
  const customerCookie = result.cookies.find((value) => value.startsWith('shopvax_customer_session=')) || ''
  assert.ok(customerCookie)

  const customerVisitorCookie = mergeCookies(visitorA, customerCookie)
  result = await request('/api/business/orders', {
    method: 'POST', cookie: customerVisitorCookie,
    body: { storeSlug: owner.slug, items: [{ productId, quantity: 5, selections: {} }] },
  })
  assert.equal(result.response.status, 201)
  assert.ok(result.payload.orderId)
  assert.equal(result.payload.customer.name, 'Cliente Teste')
  const orderId = result.payload.orderId
  const wa = new URL(result.payload.whatsappUrl)
  assert.match(wa.pathname, /5511988800011$/)

  result = await request(`/api/public/store/${owner.slug}/customers/me`, { cookie: customerCookie })
  assert.equal(result.response.status, 200)
  assert.equal(result.payload.customer.name, 'Cliente Teste')
  assert.equal(result.payload.orders.length, 1)
  assert.equal(result.payload.orders[0].id, orderId)

  result = await request('/api/admin/phase2', { cookie: owner.cookie })
  assert.equal(result.response.status, 200)
  assert.equal(result.payload.customers.length, 1)
  assert.equal(result.payload.customers[0].orders_count, 1)

  result = await request(`/api/admin/phase2/orders/${orderId}/status`, {
    method: 'PATCH', cookie: owner.cookie, body: { status: 'em_atendimento' },
  })
  assert.equal(result.response.status, 200)
  assert.equal(result.payload.order.status, 'em_atendimento')

  // Faz upgrade técnico para o Plano 2 e valida os recursos que passam a ser permitidos.
  const storeRow = await pool.query('SELECT id FROM stores WHERE slug=$1 LIMIT 1', [owner.slug])
  assert.equal(storeRow.rowCount, 1)
  await pool.query("UPDATE stores SET plan_tier='prata' WHERE id=$1", [storeRow.rows[0].id])

  result = await request(`/api/admin/features/products/${productId}/stock`, {
    method: 'PATCH', cookie: owner.cookie,
    body: { enabled: true, quantity: 12, variantStock: {} },
  })
  assert.equal(result.response.status, 200)
  assert.equal(result.payload.product.stock_enabled, true)

  const customDomain = `loja-${unique}.example.test`
  result = await request('/api/admin/phase2/store', {
    method: 'PATCH', cookie: owner.cookie,
    body: {
      customDomain,
      theme: { background: '#f4f1ea', textColor: '#1d241f', font: 'rounded' },
    },
  })
  assert.equal(result.response.status, 200)
  assert.equal(result.payload.store.custom_domain, customDomain)
  assert.equal(result.payload.store.custom_domain_status, 'pending')
  assert.equal(result.payload.store.theme_font, 'rounded')

  for (const [index, name] of ['Franquia Norte', 'Franquia Sul'].entries()) {
    result = await request('/api/admin/phase2/franchisees', {
      method: 'POST', cookie: owner.cookie,
      body: { name, phone: `55119666000${index + 11}`, active: true },
    })
    assert.equal(result.response.status, 201)
  }
  result = await request('/api/admin/phase2/franchisees', {
    method: 'POST', cookie: owner.cookie,
    body: { name: 'Franquia Extra', phone: '5511966600099', active: true },
  })
  assert.equal(result.response.status, 409)
  assert.equal(result.payload.max, 2)

  // Em produção o proxy entrega o domínio original em X-Forwarded-Host.
  result = await request('/', {
    headers: { 'x-forwarded-host': customDomain },
    redirect: 'manual',
  })
  assert.equal(result.response.status, 302)
  assert.equal(result.response.headers.get('location'), `/${owner.slug}`)

  result = await request('/api/admin/phase2', { cookie: owner.cookie })
  assert.equal(result.response.status, 200)
  assert.equal(result.payload.store.customDomainStatus, 'verified')
  assert.equal(result.payload.franchisees.length, 2)

  const themed = await request(`/api/public/store/${owner.slug}`, { cookie: visitorA })
  assert.equal(themed.response.status, 200)
  assert.equal(themed.payload.store.theme.background, '#f4f1ea')
  assert.equal(themed.payload.store.theme.font, 'rounded')

  console.log('[phase2 final MVP] round-robin + customers + stock gating + domain + franchisees + orders: ok')
} finally {
  await pool.end()
}
