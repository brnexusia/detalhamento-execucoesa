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

async function request(path, { method = 'GET', cookie = '', body, headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      'user-agent': 'Mozilla/5.0 ShopVaxPhase4Test',
      'x-forwarded-for': '203.0.113.94',
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
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${base}/health`)
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Servidor não ficou pronto para a Fase 4.')
}

async function registerOwner() {
  const result = await request('/api/auth/register', {
    method: 'POST',
    body: {
      name: 'Owner Fase 4',
      email: `phase4-${unique}@example.test`,
      password: 'phase4-owner-1234',
      storeName: `Loja Fase 4 ${unique}`,
      whatsapp: '5511900000000',
    },
  })
  assert.equal(result.response.status, 201)
  const cookie = result.cookies.find((value) => value.startsWith('atacado_session=')) || ''
  assert.ok(cookie)
  return { cookie, slug: result.payload.storeSlug }
}

try {
  await waitForServer()
  const owner = await registerOwner()

  let result = await request('/api/admin/phase4', { cookie: owner.cookie })
  assert.equal(result.response.status, 200)
  assert.equal(result.payload.eligible, false)
  assert.equal(result.payload.plan.code, 'bronze')

  result = await request('/api/admin/phase4/settings', {
    method: 'PATCH', cookie: owner.cookie, body: { shippingEnabled: true },
  })
  assert.equal(result.response.status, 403)
  assert.equal(result.payload.code, 'PLAN_FEATURE')

  const storeResult = await pool.query('SELECT id FROM stores WHERE slug=$1 LIMIT 1', [owner.slug])
  assert.equal(storeResult.rowCount, 1)
  const storeId = storeResult.rows[0].id
  await pool.query("UPDATE stores SET plan_tier='ouro' WHERE id=$1", [storeId])

  result = await request('/api/admin/phase4/settings', {
    method: 'PATCH', cookie: owner.cookie,
    body: { shippingEnabled: true, metaEnabled: true, metaBrand: 'Marca Phase4', erpApiEnabled: true },
  })
  assert.equal(result.response.status, 200)
  assert.equal(result.payload.integration.shippingEnabled, true)
  assert.equal(result.payload.integration.meta.enabled, true)
  assert.equal(result.payload.integration.erpApiEnabled, true)

  result = await request('/api/admin/phase4/asaas', {
    method: 'PATCH', cookie: owner.cookie,
    body: { enabled: true, environment: 'sandbox', apiKey: 'mock_asaas_key_phase4_1234567890', paymentMethods: ['PIX', 'CREDIT_CARD'] },
  })
  assert.equal(result.response.status, 200)
  assert.equal(result.payload.integration.asaas.enabled, true)
  assert.equal(result.payload.integration.asaas.apiKeyConfigured, true)
  assert.equal(result.payload.integration.asaas.paymentMethods.length, 2)
  assert.ok(result.payload.webhookAuthToken)
  const webhookToken = result.payload.webhookAuthToken
  const webhookUrl = new URL(result.payload.integration.asaas.webhookUrl)
  assert.match(webhookUrl.pathname, /^\/api\/webhooks\/asaas\//)

  result = await request('/api/admin/phase4/asaas/provision-webhook', { method: 'POST', cookie: owner.cookie, body: {} })
  assert.equal(result.response.status, 201)
  assert.match(result.payload.webhook.id, /^wbh_mock_/)

  result = await request('/api/admin/sellers', {
    method: 'POST', cookie: owner.cookie,
    body: { name: 'Ana Fase 4', phone: '5511988800044', isActive: true },
  })
  assert.equal(result.response.status, 201)
  const seller = result.payload.seller

  result = await request('/api/admin/products', {
    method: 'POST', cookie: owner.cookie,
    body: { sku: 'F4-001', name: 'Produto Omnichannel', description: 'Produto fase 4', price: 100, category: 'Teste', mediaUrl: 'https://example.test/produto.jpg', mediaType: 'image', pack: '', variations: [], active: true },
  })
  assert.equal(result.response.status, 201)
  const product = result.payload.product

  result = await request('/api/admin/catalogs', { cookie: owner.cookie })
  assert.equal(result.response.status, 200)
  const catalog = result.payload.catalogs[0]
  assert.ok(catalog?.slug)

  result = await request('/api/admin/phase4/shipping-rules', {
    method: 'POST', cookie: owner.cookie,
    body: { name: 'Bahia Express', states: ['BA'], cepPrefixes: ['44470'], amount: 25, freeOver: 500, minSubtotal: 100, deliveryDaysMin: 2, deliveryDaysMax: 5 },
  })
  assert.equal(result.response.status, 201)
  assert.equal(result.payload.rule.amount, 25)
  const shippingRuleId = result.payload.rule.id

  result = await request('/api/public/phase4/shipping/quote', {
    method: 'POST', body: { storeSlug: owner.slug, postalCode: '44470-000', state: 'BA', subtotal: 400 },
  })
  assert.equal(result.response.status, 200)
  assert.equal(result.payload.quotes.length, 1)
  assert.equal(result.payload.quotes[0].amount, 25)
  const quoteId = result.payload.quotes[0].id

  result = await request(`/api/public/store/${owner.slug}/customers/register`, {
    method: 'POST',
    body: { name: 'Cliente Fase 4', email: `cliente-f4-${unique}@example.test`, phone: '5511977700044', password: 'cliente-12345' },
  })
  assert.equal(result.response.status, 201)
  const customerCookie = result.cookies.find((value) => value.startsWith('shopvax_customer_session=')) || ''
  assert.ok(customerCookie)

  result = await request('/api/business/orders', {
    method: 'POST', cookie: customerCookie,
    body: { storeSlug: owner.slug, sellerSlug: seller.slug, catalogSlug: catalog.slug, items: [{ productId: product.id, quantity: 4, selections: {} }] },
  })
  assert.equal(result.response.status, 201)
  assert.equal(result.payload.total, 400)
  const orderId = result.payload.orderId

  result = await request(`/api/public/phase4/orders/${orderId}/shipping`, {
    method: 'POST', cookie: customerCookie, body: { storeSlug: owner.slug, quoteId },
  })
  assert.equal(result.response.status, 200)
  assert.equal(result.payload.order.shippingAmount, 25)
  assert.equal(result.payload.order.grandTotal, 425)

  result = await request('/api/public/phase4/payments', {
    method: 'POST', cookie: customerCookie,
    body: { storeSlug: owner.slug, orderId, billingType: 'PIX', cpfCnpj: '12345678901' },
  })
  assert.equal(result.response.status, 201)
  assert.equal(result.payload.payment.value, 425)
  assert.equal(result.payload.payment.billingType, 'PIX')
  assert.match(result.payload.payment.invoiceUrl, /^https:\/\/sandbox\.asaas\.test\/invoice\//)
  const externalPaymentId = result.payload.payment.externalId

  result = await request(webhookUrl.pathname, {
    method: 'POST',
    headers: { 'asaas-access-token': 'token-incorreto-que-nao-deve-passar' },
    body: { id: `evt-wrong-${unique}`, event: 'PAYMENT_CONFIRMED', payment: { id: externalPaymentId, externalReference: orderId, status: 'CONFIRMED' } },
  })
  assert.equal(result.response.status, 401)

  const eventBody = { id: `evt-paid-${unique}`, event: 'PAYMENT_CONFIRMED', payment: { id: externalPaymentId, externalReference: orderId, status: 'CONFIRMED' } }
  result = await request(webhookUrl.pathname, {
    method: 'POST', headers: { 'asaas-access-token': webhookToken }, body: eventBody,
  })
  assert.equal(result.response.status, 200)
  assert.equal(result.payload.ok, true)

  result = await request(webhookUrl.pathname, {
    method: 'POST', headers: { 'asaas-access-token': webhookToken }, body: eventBody,
  })
  assert.equal(result.response.status, 200)
  assert.equal(result.payload.duplicate, true)

  const paidOrder = await pool.query('SELECT payment_status,payment_paid_at,sale_confirmed_at,commission_amount,shipping_amount FROM orders WHERE id=$1', [orderId])
  assert.equal(paidOrder.rows[0].payment_status, 'paid')
  assert.ok(paidOrder.rows[0].payment_paid_at)
  assert.equal(paidOrder.rows[0].sale_confirmed_at, null)
  assert.equal(Number(paidOrder.rows[0].commission_amount || 0), 0)
  assert.equal(Number(paidOrder.rows[0].shipping_amount || 0), 25)

  result = await request(`/api/public/meta-feed/${owner.slug}.csv`)
  assert.equal(result.response.status, 200)
  assert.match(result.response.headers.get('content-type') || '', /text\/csv/)
  assert.match(String(result.payload), /F4-001/)
  assert.match(String(result.payload), /Marca Phase4/)
  assert.match(String(result.payload), /400\.00 BRL|100\.00 BRL/)

  result = await request('/api/admin/phase4/api-tokens', {
    method: 'POST', cookie: owner.cookie,
    body: { name: 'ERP Teste', scopes: ['products:read', 'orders:read', 'payments:read', 'stock:write'] },
  })
  assert.equal(result.response.status, 201)
  assert.match(result.payload.token.secret, /^svx_live_/)
  const apiToken = result.payload.token.secret
  const tokenId = result.payload.token.id

  result = await request('/api/v1/products', { headers: { authorization: `Bearer ${apiToken}` } })
  assert.equal(result.response.status, 200)
  assert.ok(result.payload.data.some((item) => item.sku === 'F4-001'))

  result = await request('/api/v1/orders', { headers: { authorization: `Bearer ${apiToken}` } })
  assert.equal(result.response.status, 200)
  const apiOrder = result.payload.data.find((item) => item.id === orderId)
  assert.ok(apiOrder)
  assert.equal(apiOrder.payment_status, 'paid')
  assert.equal(apiOrder.shippingAmount, 25)

  result = await request('/api/v1/payments', { headers: { authorization: `Bearer ${apiToken}` } })
  assert.equal(result.response.status, 200)
  assert.ok(result.payload.data.some((item) => item.external_id === externalPaymentId && item.status === 'paid'))

  result = await request('/api/v1/stock/F4-001', {
    method: 'PATCH', headers: { authorization: `Bearer ${apiToken}` },
    body: { enabled: true, quantity: 12, variantStock: {} },
  })
  assert.equal(result.response.status, 200)
  assert.equal(result.payload.product.stockQuantity, 12)

  result = await request('/api/admin/phase4/erp-webhooks', {
    method: 'POST', cookie: owner.cookie,
    body: { name: 'Webhook ERP', url: 'http://127.0.0.1:9/shopvax-hook', events: ['order.created', 'payment.updated'] },
  })
  assert.equal(result.response.status, 201)
  assert.match(result.payload.webhook.secret, /^whsec_/)

  result = await request('/api/admin/phase4', { cookie: owner.cookie })
  assert.equal(result.response.status, 200)
  assert.equal(result.payload.eligible, true)
  assert.equal(result.payload.plan.code, 'ouro')
  assert.equal(result.payload.shippingRules.some((rule) => rule.id === shippingRuleId), true)
  assert.equal(result.payload.payments.some((payment) => payment.external_id === externalPaymentId && payment.status === 'paid'), true)
  assert.equal(result.payload.apiTokens.length, 1)
  assert.equal(Object.hasOwn(result.payload.apiTokens[0], 'secret'), false)
  assert.equal(result.payload.erpWebhooks.length, 1)
  assert.equal(Object.hasOwn(result.payload.erpWebhooks[0], 'secret'), false)

  result = await request(`/api/admin/phase4/api-tokens/${tokenId}`, { method: 'DELETE', cookie: owner.cookie })
  assert.equal(result.response.status, 204)

  result = await request('/api/v1/products', { headers: { authorization: `Bearer ${apiToken}` } })
  assert.equal(result.response.status, 401)

  console.log('[phase4 final MVP] Asaas + webhook idempotency + shipping + Meta feed + API/ERP: ok')
} finally {
  await pool.end()
}
