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

async function request(path, { method = 'GET', cookie = '', body, headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      'user-agent': 'Mozilla/5.0 ShopVaxPhase3Test',
      'x-forwarded-for': '203.0.113.93',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/pdf')) return { response, payload: Buffer.from(await response.arrayBuffer()), cookies: cookiesFrom(response) }
  const text = await response.text()
  let payload = null
  try { payload = text ? JSON.parse(text) : null } catch { payload = text }
  return { response, payload, cookies: cookiesFrom(response) }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${base}/health`)
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Servidor não ficou pronto para a Fase 3.')
}

async function registerOwner(suffix, referralCode = '') {
  const result = await request('/api/auth/register', {
    method: 'POST',
    body: {
      name: `Owner ${suffix}`,
      email: `phase3-${suffix}-${unique}@example.test`,
      password: 'phase3-owner-1234',
      storeName: `Loja Fase 3 ${suffix} ${unique}`,
      whatsapp: '5511900000000',
      ...(referralCode ? { referralCode } : {}),
    },
  })
  assert.equal(result.response.status, 201)
  const cookie = result.cookies.find((value) => value.startsWith('atacado_session=')) || ''
  assert.ok(cookie)
  return { cookie, slug: result.payload.storeSlug, payload: result.payload }
}

try {
  await waitForServer()
  const owner = await registerOwner('principal')

  let result = await request('/api/admin/phase3', { cookie: owner.cookie })
  assert.equal(result.response.status, 200)
  assert.equal(result.payload.plan.code, 'bronze')

  // Plano 1: inteligência, avaliações e comissão permanecem bloqueadas.
  result = await request('/api/admin/intent-reports?days=30', { cookie: owner.cookie })
  assert.equal(result.response.status, 403)
  assert.equal(result.payload.code, 'PLAN_FEATURE')

  result = await request('/api/admin/phase3/commissions', { cookie: owner.cookie })
  assert.equal(result.response.status, 403)

  result = await request(`/api/public/reviews/${owner.slug}`)
  assert.equal(result.response.status, 200)
  assert.equal(result.payload.enabled, false)

  // Vendedora + produto usados em cupom, carrinho, avaliação e comissão.
  result = await request('/api/admin/sellers', {
    method: 'POST', cookie: owner.cookie,
    body: { name: 'Ana Fase 3', phone: '5511988800033', isActive: true },
  })
  assert.equal(result.response.status, 201)
  const seller = result.payload.seller

  result = await request('/api/admin/products', {
    method: 'POST', cookie: owner.cookie,
    body: { sku: 'F3-001', name: 'Produto Growth', description: 'Produto de teste da fase 3', price: 80, category: 'Teste', mediaUrl: '', mediaType: 'image', pack: '', variations: [], active: true },
  })
  assert.equal(result.response.status, 201)
  const product = result.payload.product

  result = await request('/api/admin/catalogs', { cookie: owner.cookie })
  assert.equal(result.response.status, 200)
  const catalog = result.payload.catalogs[0]
  assert.ok(catalog?.id)

  // Catálogo PDF real com assinatura ShopVax.
  result = await request(`/api/admin/phase3/catalogs/${catalog.id}/pdf`, { cookie: owner.cookie })
  assert.equal(result.response.status, 200)
  assert.match(result.response.headers.get('content-type') || '', /application\/pdf/)
  assert.equal(result.payload.subarray(0, 5).toString('latin1'), '%PDF-')
  assert.match(result.payload.toString('latin1'), /Catálogo gerado com ShopVax/)

  // Cupom: 10% com uso único.
  result = await request('/api/admin/phase3/coupons', {
    method: 'POST', cookie: owner.cookie,
    body: { code: 'BEMVINDO10', type: 'percent', value: 10, maxUses: 1 },
  })
  assert.equal(result.response.status, 201)
  assert.equal(result.payload.coupon.code, 'BEMVINDO10')

  result = await request('/api/public/coupons/validate', {
    method: 'POST', body: { storeSlug: owner.slug, code: 'BEMVINDO10', subtotal: 400 },
  })
  assert.equal(result.response.status, 200)
  assert.equal(result.payload.discount, 40)
  assert.equal(result.payload.total, 360)

  // Cliente real + visitante: carrinho fica recuperável e contatável.
  result = await request(`/api/public/store/${owner.slug}`)
  assert.equal(result.response.status, 200)
  const visitorCookie = mergeCookies(result.cookies)
  assert.ok(visitorCookie.includes('atacado_public='))

  result = await request(`/api/public/store/${owner.slug}/customers/register`, {
    method: 'POST',
    body: { name: 'Cliente Fase 3', email: `cliente-${unique}@example.test`, phone: '5511977700033', password: 'cliente-12345' },
  })
  assert.equal(result.response.status, 201)
  const customerCookie = result.cookies.find((value) => value.startsWith('shopvax_customer_session=')) || ''
  assert.ok(customerCookie)
  const publicCookies = mergeCookies(visitorCookie, customerCookie)

  result = await request('/api/public/cart-recovery', {
    method: 'POST', cookie: publicCookies,
    body: { storeSlug: owner.slug, sellerSlug: seller.slug, catalogSlug: catalog.slug, subtotal: 400, items: [{ productId: product.id, name: product.name, quantity: 5, selections: {} }] },
  })
  assert.equal(result.response.status, 202)

  result = await request('/api/admin/phase3/cart-recovery', { cookie: owner.cookie })
  assert.equal(result.response.status, 200)
  assert.equal(result.payload.recoveries.length, 1)
  assert.equal(result.payload.contactable, 1)
  assert.match(result.payload.recoveries[0].whatsappUrl, /^https:\/\/wa\.me\/5511977700033/)

  // Pedido aplica cupom após o pedido mínimo (subtotal), vincula cliente e converte o carrinho.
  result = await request('/api/business/orders', {
    method: 'POST', cookie: publicCookies,
    body: { storeSlug: owner.slug, sellerSlug: seller.slug, catalogSlug: catalog.slug, couponCode: 'BEMVINDO10', items: [{ productId: product.id, quantity: 5, selections: {} }] },
  })
  assert.equal(result.response.status, 201)
  assert.equal(result.payload.subtotal, 400)
  assert.equal(result.payload.discount, 40)
  assert.equal(result.payload.total, 360)
  assert.equal(result.payload.couponCode, 'BEMVINDO10')
  assert.match(decodeURIComponent(result.payload.whatsappUrl), /Cupom BEMVINDO10/)
  const discountedOrderId = result.payload.orderId

  result = await request('/api/admin/phase3/cart-recovery', { cookie: owner.cookie })
  assert.equal(result.response.status, 200)
  assert.equal(result.payload.recoveries.length, 0)

  result = await request('/api/business/orders', {
    method: 'POST', cookie: publicCookies,
    body: { storeSlug: owner.slug, sellerSlug: seller.slug, catalogSlug: catalog.slug, couponCode: 'BEMVINDO10', items: [{ productId: product.id, quantity: 5, selections: {} }] },
  })
  assert.equal(result.response.status, 400)
  assert.equal(result.payload.code, 'COUPON_INVALID')

  // Indicação: gera o código e credita exatamente um mês no ledger.
  result = await request('/api/admin/phase3/referral', { cookie: owner.cookie })
  assert.equal(result.response.status, 200)
  assert.match(result.payload.code, /^SVX-/)
  assert.equal(result.payload.availableCreditMonths, 0)
  const referralCode = result.payload.code

  const referred = await registerOwner('indicado', referralCode)
  assert.equal(referred.payload.referralCredited, true)
  result = await request('/api/admin/phase3/referral', { cookie: owner.cookie })
  assert.equal(result.response.status, 200)
  assert.equal(result.payload.referrals, 1)
  assert.equal(result.payload.availableCreditMonths, 1)
  assert.match(result.payload.rule, /1 indicação válida = 1 mês grátis/)

  const storeRow = await pool.query('SELECT id FROM stores WHERE slug=$1 LIMIT 1', [owner.slug])
  assert.equal(storeRow.rowCount, 1)
  const storeId = storeRow.rows[0].id

  // Plano 2: inteligência e avaliações passam a funcionar; comissão continua bloqueada.
  await pool.query("UPDATE stores SET plan_tier='prata' WHERE id=$1", [storeId])

  result = await request('/api/admin/intent-reports?days=30', { cookie: owner.cookie })
  assert.equal(result.response.status, 200)
  assert.match(result.payload.interpretation, /intenção/i)
  assert.match(result.payload.interpretation, /não representam faturamento/i)

  result = await request(`/api/public/store/${owner.slug}/customers/review`, {
    method: 'PUT', cookie: customerCookie,
    body: { rating: 5, comment: 'Atendimento ótimo e pedido fácil.' },
  })
  assert.equal(result.response.status, 200)
  assert.equal(Number(result.payload.review.rating), 5)

  result = await request(`/api/public/reviews/${owner.slug}`)
  assert.equal(result.response.status, 200)
  assert.equal(result.payload.enabled, true)
  assert.equal(result.payload.count, 1)
  assert.equal(result.payload.average, 5)
  assert.equal(result.payload.reviews[0].reviewer, 'Cliente')

  result = await request(`/api/admin/phase3/sellers/${seller.id}/commission`, {
    method: 'PATCH', cookie: owner.cookie, body: { rate: 10 },
  })
  assert.equal(result.response.status, 403)

  // Plano 3: comissão configurável, mas só após confirmação explícita da venda.
  await pool.query("UPDATE stores SET plan_tier='ouro' WHERE id=$1", [storeId])
  result = await request(`/api/admin/phase3/sellers/${seller.id}/commission`, {
    method: 'PATCH', cookie: owner.cookie, body: { rate: 10 },
  })
  assert.equal(result.response.status, 200)
  assert.equal(result.payload.seller.commissionRate, 10)

  result = await request('/api/business/orders', {
    method: 'POST', cookie: publicCookies,
    body: { storeSlug: owner.slug, sellerSlug: seller.slug, catalogSlug: catalog.slug, items: [{ productId: product.id, quantity: 5, selections: {} }] },
  })
  assert.equal(result.response.status, 201)
  const commissionOrderId = result.payload.orderId

  result = await request('/api/admin/phase3/commissions?days=30', { cookie: owner.cookie })
  assert.equal(result.response.status, 200)
  let sellerCommission = result.payload.sellers.find((item) => item.sellerId === seller.id)
  assert.equal(sellerCommission.confirmedSales, 0)
  assert.equal(sellerCommission.commissionTotal, 0)

  result = await request(`/api/admin/phase3/orders/${commissionOrderId}/confirm-sale`, { method: 'POST', cookie: owner.cookie })
  assert.equal(result.response.status, 200)
  assert.equal(result.payload.order.status, 'confirmado')
  assert.equal(result.payload.order.commissionRate, 10)
  assert.equal(result.payload.order.commissionAmount, 40)

  result = await request('/api/admin/phase3/commissions?days=30', { cookie: owner.cookie })
  assert.equal(result.response.status, 200)
  sellerCommission = result.payload.sellers.find((item) => item.sellerId === seller.id)
  assert.equal(sellerCommission.confirmedSales, 1)
  assert.equal(sellerCommission.confirmedTotal, 400)
  assert.equal(sellerCommission.commissionTotal, 40)

  // Cancelamento exclui a venda da comissão, mesmo que tenha sido confirmada antes.
  result = await request(`/api/admin/features/orders/${commissionOrderId}/cancel`, { method: 'POST', cookie: owner.cookie, body: {} })
  assert.equal(result.response.status, 200)
  result = await request('/api/admin/phase3/commissions?days=30', { cookie: owner.cookie })
  assert.equal(result.response.status, 200)
  sellerCommission = result.payload.sellers.find((item) => item.sellerId === seller.id)
  assert.equal(sellerCommission.confirmedSales, 0)
  assert.equal(sellerCommission.commissionTotal, 0)

  // O pedido com desconto permanece registrado com semântica financeira correta.
  const discounted = await pool.query('SELECT subtotal,discount,total,coupon_code,customer_id FROM orders WHERE id=$1', [discountedOrderId])
  assert.equal(Number(discounted.rows[0].subtotal), 400)
  assert.equal(Number(discounted.rows[0].discount), 40)
  assert.equal(Number(discounted.rows[0].total), 360)
  assert.equal(discounted.rows[0].coupon_code, 'BEMVINDO10')
  assert.ok(discounted.rows[0].customer_id)

  console.log('[phase3 final MVP] intelligence gate + commission + PDF + coupons + cart recovery + referral + reviews: ok')
} finally {
  await pool.end()
}
