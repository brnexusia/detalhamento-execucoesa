import assert from 'node:assert/strict'
import pg from 'pg'

const { Pool } = pg
const base = process.env.BASE_URL || 'http://127.0.0.1:3000'
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`
const adminPassword = 'phase5-admin-12345'
const targetPassword = 'phase5-target-12345'

function cookiesFrom(response) {
  const values = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [response.headers.get('set-cookie')].filter(Boolean)
  return values.map((value) => String(value).split(';')[0]).filter(Boolean)
}

function ownerCookie(cookies) {
  return cookies.find((value) => value.startsWith('atacado_session=')) || cookies.find((value) => value.startsWith('shopvax_session=')) || ''
}

async function request(path, { method = 'GET', cookie = '', body, headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      'user-agent': 'Mozilla/5.0 ShopVaxPhase5Test',
      'x-forwarded-for': '203.0.113.105',
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
  for (let attempt = 0; attempt < 160; attempt += 1) {
    try {
      const response = await fetch(`${base}/health`)
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Servidor não ficou pronto para a Fase 5.')
}

async function waitForPhase5Schema() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const result = await pool.query("SELECT to_regclass('public.platform_billing_ledger') AS ledger,to_regclass('public.platform_admins') AS admins")
    if (result.rows[0]?.ledger && result.rows[0]?.admins) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Schema da Fase 5 não ficou pronto.')
}

async function registerOwner(name, email, password) {
  const result = await request('/api/auth/register', {
    method: 'POST',
    body: { name, email, password, storeName: `${name} ${unique}`, whatsapp: '5511999999915' },
  })
  assert.equal(result.response.status, 201, `cadastro ${name}: ${JSON.stringify(result.payload)}`)
  const cookie = ownerCookie(result.cookies)
  assert.ok(cookie, `cookie de ${name}`)
  return { cookie, email, slug: result.payload.storeSlug }
}

async function login(email, password, ip = '203.0.113.106') {
  const result = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'x-forwarded-for': ip },
    body: { email, password },
  })
  assert.equal(result.response.status, 200, `login ${email}: ${JSON.stringify(result.payload)}`)
  const cookie = ownerCookie(result.cookies)
  assert.ok(cookie)
  return cookie
}

try {
  await waitForServer()
  await waitForPhase5Schema()

  const admin = await registerOwner('Admin Fase 5', `admin-f5-${unique}@example.test`, adminPassword)
  const target = await registerOwner('Lojista Fase 5', `target-f5-${unique}@example.test`, targetPassword)

  const adminUser = await pool.query('SELECT id FROM users WHERE email=$1 LIMIT 1', [admin.email])
  assert.equal(adminUser.rowCount, 1)
  await pool.query('INSERT INTO platform_admins(user_id,created_by) VALUES ($1,$1) ON CONFLICT DO NOTHING', [adminUser.rows[0].id])

  const targetStoreResult = await pool.query('SELECT id,owner_id FROM stores WHERE slug=$1 LIMIT 1', [target.slug])
  assert.equal(targetStoreResult.rowCount, 1)
  const targetStore = targetStoreResult.rows[0]

  let result = await request('/api/platform/phase5/overview', { cookie: admin.cookie })
  assert.equal(result.response.status, 200, JSON.stringify(result.payload))
  assert.equal(result.payload.launchReady, true, `checks: ${JSON.stringify(result.payload.checks)}`)
  assert.ok(result.payload.checks.filter((item) => item.critical).every((item) => item.ok))

  result = await request('/api/admin/phase5/status', { cookie: target.cookie })
  assert.equal(result.response.status, 200)
  assert.equal(result.payload.plan.code, 'bronze')
  assert.equal(result.payload.plan.limits.sellers, 2)
  assert.equal(result.payload.plan.limits.catalogs, 1)
  assert.equal(result.payload.plan.limits.photosPerProduct, 5)
  assert.equal(result.payload.billing.status, 'active')
  assert.equal(result.payload.billing.creditMonths, 0)

  result = await request(`/api/platform/phase5/stores/${targetStore.id}/billing/credits`, {
    method: 'POST', cookie: admin.cookie, body: { months: 2, note: 'Créditos de indicação homologação', password: 'senha-incorreta' },
  })
  assert.equal(result.response.status, 403)

  result = await request(`/api/platform/phase5/stores/${targetStore.id}/billing/credits`, {
    method: 'POST', cookie: admin.cookie, body: { months: 2, note: 'Créditos de indicação homologação', password: adminPassword },
  })
  assert.equal(result.response.status, 200, JSON.stringify(result.payload))
  assert.equal(result.payload.billing.creditMonths, 2)

  result = await request(`/api/platform/phase5/stores/${targetStore.id}/billing/renew`, {
    method: 'POST', cookie: admin.cookie,
    body: { cycle: 'annual', useCredits: true, note: 'Renovação anual homologada', password: adminPassword },
  })
  assert.equal(result.response.status, 200, JSON.stringify(result.payload))
  assert.equal(result.payload.pricing.months, 12)
  assert.equal(result.payload.pricing.gross, 598.8)
  assert.equal(result.payload.pricing.cycleDiscount, 89.82)
  assert.equal(result.payload.pricing.creditsUsed, 2)
  assert.equal(result.payload.pricing.chargedAmount, 424.15)
  assert.equal(result.payload.billing.creditMonths, 0)
  assert.equal(result.payload.billing.cycle, 'annual')
  assert.equal(result.payload.billing.status, 'active')
  assert.ok(new Date(result.payload.billing.periodEndsAt).getTime() > Date.now())

  result = await request(`/api/platform/phase5/stores/${targetStore.id}/billing`, { cookie: admin.cookie })
  assert.equal(result.response.status, 200)
  const renewal = result.payload.ledger.find((entry) => entry.kind === 'renewal')
  assert.ok(renewal)
  assert.equal(renewal.creditMonthsUsed, 2)
  assert.equal(renewal.chargedAmount, 424.15)
  assert.equal(renewal.grossAmount, 598.8)

  const secondTargetCookie = await login(target.email, targetPassword, '203.0.113.107')
  result = await request('/api/auth/security/sessions', { cookie: target.cookie })
  assert.equal(result.response.status, 200)
  assert.ok(result.payload.sessions.active >= 2)

  result = await request('/api/auth/security/revoke-others', { method: 'POST', cookie: target.cookie, body: {} })
  assert.equal(result.response.status, 200)
  assert.ok(result.payload.revoked >= 1)

  result = await request('/api/admin/phase5/status', { cookie: target.cookie })
  assert.equal(result.response.status, 200, 'sessão atual deveria permanecer')
  result = await request('/api/admin/phase5/status', { cookie: secondTargetCookie })
  assert.equal(result.response.status, 401, 'sessão antiga deveria ter sido revogada')

  result = await request(`/api/public/store/${target.slug}/customers/register`, {
    method: 'POST',
    body: { name: 'Cliente Fase 5', email: `cliente-f5-${unique}@example.test`, phone: '5511977700015', password: 'cliente-f5-12345' },
  })
  assert.equal(result.response.status, 201, JSON.stringify(result.payload))
  const customerCookie = result.cookies.find((value) => value.startsWith('shopvax_customer_session=')) || ''
  assert.ok(customerCookie)

  result = await request(`/api/platform/phase5/stores/${targetStore.id}/billing/status`, {
    method: 'POST', cookie: admin.cookie,
    body: { status: 'past_due', graceDays: 0, note: 'Teste de expiração', password: adminPassword },
  })
  assert.equal(result.response.status, 200)
  assert.equal(result.payload.billing.status, 'past_due')

  result = await request('/api/admin/products', {
    method: 'POST', cookie: target.cookie,
    body: { sku: 'F5-BLOCK', name: 'Produto bloqueado', price: 49.9, category: 'Teste', mediaUrl: '', mediaType: 'image', variations: [], active: true },
  })
  assert.equal(result.response.status, 402, JSON.stringify(result.payload))
  assert.equal(result.payload.code, 'BILLING_SUSPENDED')

  const suspended = await pool.query('SELECT billing_status,is_active,billing_suspended_at FROM stores WHERE id=$1', [targetStore.id])
  assert.equal(suspended.rows[0].billing_status, 'suspended')
  assert.equal(suspended.rows[0].is_active, false)
  assert.ok(suspended.rows[0].billing_suspended_at)

  result = await request(`/api/platform/phase5/stores/${targetStore.id}/billing/renew`, {
    method: 'POST', cookie: admin.cookie,
    body: { cycle: 'monthly', useCredits: false, note: 'Regularização', password: adminPassword },
  })
  assert.equal(result.response.status, 200)
  assert.equal(result.payload.billing.status, 'active')
  assert.equal(result.payload.pricing.chargedAmount, 49.9)

  const reactivated = await pool.query('SELECT billing_status,is_active,billing_suspended_at FROM stores WHERE id=$1', [targetStore.id])
  assert.equal(reactivated.rows[0].billing_status, 'active')
  assert.equal(reactivated.rows[0].is_active, true)
  assert.equal(reactivated.rows[0].billing_suspended_at, null)

  const thirdTargetCookie = await login(target.email, targetPassword, '203.0.113.108')
  assert.ok(thirdTargetCookie)

  result = await request(`/api/platform/phase5/stores/${targetStore.id}/security/revoke-sessions`, {
    method: 'POST', cookie: admin.cookie,
    body: { scope: 'all', password: adminPassword },
  })
  assert.equal(result.response.status, 200)
  assert.ok(result.payload.revoked.ownerSessions >= 1)
  assert.ok(result.payload.revoked.customerSessions >= 1)

  result = await request('/api/admin/phase5/status', { cookie: target.cookie })
  assert.equal(result.response.status, 401)
  result = await request(`/api/public/store/${target.slug}/customers/me`, { cookie: customerCookie })
  assert.equal(result.response.status, 401)

  const audit = await pool.query(`SELECT action FROM platform_audit_log WHERE target_id=$1 ORDER BY created_at`, [targetStore.id])
  const actions = audit.rows.map((row) => row.action)
  assert.ok(actions.includes('billing.credit.adjust'))
  assert.ok(actions.includes('billing.renew'))
  assert.ok(actions.includes('billing.status.change'))
  assert.ok(actions.includes('security.sessions.revoke'))

  result = await request('/api/platform/phase5/overview', { cookie: admin.cookie })
  assert.equal(result.response.status, 200)
  const targetOverview = result.payload.stores.find((store) => store.id === targetStore.id)
  assert.ok(targetOverview)
  assert.equal(targetOverview.billing.status, 'active')
  assert.equal(targetOverview.ownerSessions, 0)
  assert.equal(targetOverview.customerSessions, 0)

  console.log('phase5 final mvp integration ok')
} finally {
  await pool.end()
}
