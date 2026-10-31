import assert from 'node:assert/strict'
import pg from 'pg'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const base = process.env.BASE_URL || 'http://127.0.0.1:3000'
const json = async (path, { method = 'GET', cookie, body } = {}) => {
  const headers = { 'Content-Type': 'application/json' }
  if (cookie) headers.Cookie = cookie
  const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  let payload
  try { payload = await response.json() } catch { payload = {} }
  return { response, payload, cookie: response.headers.get('set-cookie')?.split(';')[0] }
}
const unique = Date.now() + '-' + Math.random().toString(36).slice(2, 7)
try {
  let result
  for (let i = 0; i < 50; i += 1) {
    try { result = await json('/api/public/support/config'); if (result.response.ok) break } catch {}
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  assert.equal(result?.response.status, 200)
  assert.equal(result.payload.ticketsEnabled, false)
  assert.equal(result.payload.aiEnabled, false)
  assert.equal(result.payload.messagingEnabled, false)
  assert.equal(result.payload.supportWhatsapp, null)
  const aiDisabled = await json('/api/public/support/assist', {
    method:'POST',body:{audience:'buyer',topic:'order',question:'Como faço um talão de pedido?',privacyAcknowledged:true},
  })
  assert.equal(aiDisabled.response.status,503,'A assistência não pode iniciar sem chave e ativação explícita')
  const merchant = await json('/api/auth/register', { method: 'POST', body: {
    name: 'Lojista Teste', email: 'growth-' + unique + '@example.test', password: 'growth-secret-2026',
    storeName: 'Loja Growth ' + unique, whatsapp: '5511987700123', planCode: 'bronze',
  } })
  assert.equal(merchant.response.status, 201, JSON.stringify(merchant.payload))
  assert.ok(merchant.cookie)
  const slug = merchant.payload.storeSlug
  const onboardPath = '/api/admin/growth/onboarding'
  const first = await json(onboardPath, { cookie: merchant.cookie })
  assert.equal(first.response.status, 200, JSON.stringify(first.payload))
  assert.equal(first.payload.products, false)
  assert.equal(first.payload.sellers, false)
  assert.equal(first.payload.identity, false)
  const early = await json(onboardPath + '/confirm', { method: 'POST', cookie: merchant.cookie, body: { step: 'whatsapp_understood' } })
  assert.equal(early.response.status, 409)
  const bogus = await json(onboardPath + '/confirm', { method: 'POST', cookie: merchant.cookie, body: { step: 'identity' } })
  assert.equal(bogus.response.status, 400)

  const customer = await json('/api/public/store/' + slug + '/customers/register', { method: 'POST', body: {
    name: 'Cliente Teste', email: 'customer-' + unique + '@example.test', phone: '71999999999', password: 'customer-safe-2026',
  } })
  assert.equal(customer.response.status, 201, JSON.stringify(customer.payload))
  assert.ok(customer.cookie)
  const consent = '/api/public/store/' + slug + '/growth/consent'
  const guest = await json(consent)
  assert.equal(guest.response.status, 401)
  const empty = await json(consent, { cookie: customer.cookie })
  assert.equal(empty.response.status, 200, JSON.stringify(empty.payload))
  assert.equal(empty.payload.whatsapp, false)
  assert.equal(empty.payload.email, false)
  const { payload: list } = await json('/api/public/growth/stores')
  const shop = list.stores.find(s => s.slug === slug)
  assert.ok(shop, 'Loja registrada deve constar no consentimento')
  const optin = await json(consent, { method:'PUT', cookie:customer.cookie, body: {
    whatsapp:true, email:false, scope:'selected', storeIds:[shop.id],
  } })
  assert.equal(optin.response.status, 200, JSON.stringify(optin.payload))
  assert.equal(optin.payload.status, 'preferences_saved_no_messages_sent')
  const selected = await json(consent, { cookie: customer.cookie })
  assert.equal(selected.payload.whatsapp, true)
  assert.equal(selected.payload.email, false)
  assert.deepEqual(selected.payload.storeIds, [shop.id])
  const invalid = await json(consent, { method: 'PUT', cookie:customer.cookie, body: {
    whatsapp:true, email:true, scope:'selected', storeIds:['made-up-store'],
  } })
  assert.equal(invalid.response.status, 400)
  const revoke = await json(consent, { method:'DELETE', cookie:customer.cookie })
  assert.equal(revoke.response.status, 200, JSON.stringify(revoke.payload))
  const disabled = await json(consent, { cookie:customer.cookie })
  assert.equal(disabled.payload.whatsapp, false)
  assert.equal(disabled.payload.email, false)
  assert.deepEqual(disabled.payload.storeIds, [])
  const audit = await pool.query('SELECT channel,allowed FROM shopvax_growth_consent_audit WHERE customer_id=$1 ORDER BY created_at,id', [customer.payload.customer.id])
  assert.equal(audit.rowCount, 4)
  assert.equal(audit.rows.filter(row => row.allowed).length, 1)

  const seller = await json('/api/admin/sellers', { method:'POST', cookie:merchant.cookie, body: { name:'Carla',phone:'5511999991234',isActive:true } })
  assert.equal(seller.response.status, 201, JSON.stringify(seller.payload))
  const product = await json('/api/admin/products', { method:'POST', cookie:merchant.cookie, body: {
    sku:'G-001',name:'Camisa teste',description:'Produto teste',price:49.9,category:'Camisa',
    mediaUrl:'',mediaType:'image',pack:'',variations:[],active:true,
  } })
  assert.equal(product.response.status, 201, JSON.stringify(product.payload))
  const ready = await json(onboardPath, { cookie:merchant.cookie })
  assert.equal(ready.payload.products, true)
  assert.equal(ready.payload.sellers, true)
  const mark = await json(onboardPath + '/confirm', { method:'POST', cookie:merchant.cookie, body: { step:'minimum_reviewed' } })
  assert.equal(mark.response.status, 200, JSON.stringify(mark.payload))
  const repeat = await json(onboardPath + '/confirm', { method:'POST', cookie:merchant.cookie, body: { step:'minimum_reviewed' } })
  assert.equal(repeat.response.status, 200, 'Registro idempotente')
  const marked = await json(onboardPath, { cookie:merchant.cookie })
  assert.deepEqual(marked.payload.confirmed, ['minimum_reviewed'])
  const support = await json('/api/public/support/tickets', { method:'POST', body: {
    audience:'buyer',topic:'order',message:'Não consigo acessar meu pedido.',privacyAcknowledged:true,
  } })
  assert.equal(support.response.status, 503)
  const tickets = await pool.query('SELECT count(*)::int AS count FROM shopvax_support_tickets')
  assert.equal(tickets.rows[0].count, 0, 'Sem canal ativado não acumular pedidos de ajuda invisíveis')
  console.log('SHOPVAX_GROWTH_INTEGRATION_OK')
} finally { await pool.end() }
