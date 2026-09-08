import pg from 'pg'

const { Pool } = pg
const base = process.env.BASE_URL || 'http://127.0.0.1:3000'
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`
const adminPassword = 'shopvax-admin-12345'

async function register(name, email) {
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, email, password: adminPassword, storeName: `${name} ${unique}`, whatsapp: '5511999999999' }),
  })
  const body = await response.json().catch(() => ({}))
  const cookie = response.headers.get('set-cookie')?.split(';')[0] || ''
  if (!response.ok || !cookie) throw new Error(`Cadastro ${name}: ${response.status} ${JSON.stringify(body)}`)
  return { ...body, cookie, email }
}

async function api(path, { method = 'GET', cookie = '', body, headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let payload = null
  try { payload = text ? JSON.parse(text) : null } catch { payload = text }
  return { response, payload }
}

async function waitForPlatformSchema() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await pool.query("SELECT to_regclass('public.platform_admins') AS table_name")
    if (result.rows[0]?.table_name) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Schema administrativo não ficou pronto.')
}

try {
  await waitForPlatformSchema()
  const admin = await register('Admin Shopvax', `admin-${unique}@example.com`)
  const adminUser = await pool.query('SELECT id FROM users WHERE email=$1 LIMIT 1', [admin.email])
  await pool.query('INSERT INTO platform_admins (user_id,created_by) VALUES ($1,$1) ON CONFLICT DO NOTHING', [adminUser.rows[0].id])

  const health = await fetch(`${base}/health`)
  if (health.headers.get('x-frame-options') !== 'DENY') throw new Error('Security headers não bloquearam framing.')
  if (!health.headers.get('content-security-policy')?.includes("frame-ancestors 'none'")) throw new Error('CSP de produção ausente.')

  const bootstrap = await api('/api/platform/bootstrap', { cookie: admin.cookie })
  if (!bootstrap.response.ok) throw new Error(`Bootstrap admin: ${bootstrap.response.status} ${JSON.stringify(bootstrap.payload)}`)
  const plans = bootstrap.payload?.plans || []
  const bronze = plans.find((plan) => plan.code === 'bronze')
  const prata = plans.find((plan) => plan.code === 'prata')
  const ouro = plans.find((plan) => plan.code === 'ouro')
  if (!bronze || bronze.monthlyPrice !== 49.9 || bronze.sellerLimit !== 5 || bronze.productLimit !== 500 || bronze.catalogLimit !== 1) throw new Error('Plano Bronze padrão divergente.')
  if (!prata || prata.monthlyPrice !== 94.9 || prata.sellerLimit !== 15 || prata.productLimit !== 2000 || prata.catalogLimit !== 3) throw new Error('Plano Prata padrão divergente.')
  if (!ouro || ouro.monthlyPrice !== 144.9 || ouro.sellerLimit !== null || ouro.productLimit !== null || ouro.catalogLimit !== null) throw new Error('Plano Ouro padrão divergente.')

  const customCode = `ops-${Date.now()}`
  const created = await api('/api/platform/plans', {
    method: 'POST', cookie: admin.cookie,
    body: { code: customCode, name: 'Operacional', monthlyPrice: 79.9, semesterDiscount: 5, annualDiscount: 15, sellerLimit: 2, productLimit: 10, catalogLimit: 2, socialWeight: 2, active: true },
  })
  if (created.response.status !== 201 || created.payload?.plan?.code !== customCode) throw new Error(`Criação de plano falhou: ${created.response.status} ${JSON.stringify(created.payload)}`)

  const store = bootstrap.payload.stores.find((item) => item.ownerEmail === admin.email)
  const assigned = await api(`/api/platform/stores/${store.id}/plan`, { method: 'PATCH', cookie: admin.cookie, body: { planCode: customCode } })
  if (!assigned.response.ok) throw new Error(`Atribuição de plano falhou: ${assigned.response.status}`)

  for (let index = 0; index < 2; index += 1) {
    const seller = await api('/api/admin/sellers', { method: 'POST', cookie: admin.cookie, body: { name: `Seller ${index}`, phone: `55119999999${index}`, isActive: true } })
    if (!seller.response.ok) throw new Error(`Seller dentro do limite falhou: ${seller.response.status} ${JSON.stringify(seller.payload)}`)
  }
  const sellerBlocked = await api('/api/admin/sellers', { method: 'POST', cookie: admin.cookie, body: { name: 'Seller 3', phone: '5511988888888', isActive: true } })
  if (sellerBlocked.response.status !== 409 || sellerBlocked.payload?.code !== 'PLAN_LIMIT') throw new Error('Limite de vendedoras não foi aplicado.')

  const firstCatalog = await api('/api/admin/catalogs', { method: 'POST', cookie: admin.cookie, body: { name: 'Varejo', kind: 'varejo' } })
  if (!firstCatalog.response.ok) throw new Error(`Primeiro catálogo adicional falhou: ${firstCatalog.response.status} ${JSON.stringify(firstCatalog.payload)}`)
  const secondCatalog = await api('/api/admin/catalogs', { method: 'POST', cookie: admin.cookie, body: { name: 'Extra', kind: 'geral' } })
  if (secondCatalog.response.status !== 409 || secondCatalog.payload?.code !== 'PLAN_LIMIT') throw new Error('Limite de catálogos não foi aplicado.')

  const evil = await api('/api/platform/plans', {
    method: 'POST', cookie: admin.cookie, body: { code: 'evil', name: 'Evil', monthlyPrice: 1 },
    headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
  })
  if (evil.response.status !== 403) throw new Error('Proteção de origem não bloqueou mutação cross-site.')

  const target = await register('Conta removível', `remove-${unique}@example.com`)
  const targetId = (await pool.query('SELECT id FROM users WHERE email=$1 LIMIT 1', [target.email])).rows[0].id
  const wrongDelete = await api(`/api/platform/accounts/${targetId}`, { method: 'DELETE', cookie: admin.cookie, body: { password: 'errada-errada-errada' } })
  if (wrongDelete.response.status !== 403) throw new Error('Exclusão de conta aceitou senha administrativa incorreta.')
  const deleted = await api(`/api/platform/accounts/${targetId}`, { method: 'DELETE', cookie: admin.cookie, body: { password: adminPassword } })
  if (!deleted.response.ok) throw new Error(`Exclusão de conta falhou: ${deleted.response.status} ${JSON.stringify(deleted.payload)}`)
  const stillThere = await pool.query('SELECT 1 FROM users WHERE id=$1', [targetId])
  if (stillThere.rowCount) throw new Error('Conta apagada permaneceu no banco.')

  const inUseDelete = await api(`/api/platform/plans/${created.payload.plan.id}`, { method: 'DELETE', cookie: admin.cookie })
  if (inUseDelete.response.status !== 409) throw new Error('Plano em uso pôde ser apagado.')
  const invalidDowngrade = await api(`/api/platform/stores/${store.id}/plan`, { method: 'PATCH', cookie: admin.cookie, body: { planCode: 'bronze' } })
  if (invalidDowngrade.response.status !== 409) throw new Error('Downgrade abaixo do uso atual não foi bloqueado.')
  const removeCatalog = await api(`/api/admin/catalogs/${firstCatalog.payload.catalog.id}`, { method: 'DELETE', cookie: admin.cookie })
  if (removeCatalog.response.status !== 204) throw new Error('Catálogo adicional não pôde ser removido para downgrade.')
  const downgrade = await api(`/api/platform/stores/${store.id}/plan`, { method: 'PATCH', cookie: admin.cookie, body: { planCode: 'bronze' } })
  if (!downgrade.response.ok) throw new Error(`Downgrade válido falhou: ${downgrade.response.status} ${JSON.stringify(downgrade.payload)}`)
  const removedPlan = await api(`/api/platform/plans/${created.payload.plan.id}`, { method: 'DELETE', cookie: admin.cookie })
  if (removedPlan.response.status !== 204) throw new Error(`Plano customizado não foi apagado: ${removedPlan.response.status}`)

  const finalBootstrap = await api('/api/platform/bootstrap', { cookie: admin.cookie })
  if (!finalBootstrap.payload?.audit?.some((entry) => entry.action === 'account.delete')) throw new Error('Auditoria não registrou exclusão de conta.')
  if (!finalBootstrap.payload?.audit?.some((entry) => entry.action === 'plan.create')) throw new Error('Auditoria não registrou criação de plano.')

  console.log('platform admin integration ok')
} finally {
  await pool.end()
}
