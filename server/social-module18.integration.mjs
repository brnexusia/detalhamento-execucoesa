import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import pg from 'pg'

const { Pool } = pg
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3000'
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL ausente.')

const pkg = await fs.readFile('package.json', 'utf8')
const dockerfile = await fs.readFile('Dockerfile', 'utf8')
if (!pkg.includes('node --import ./server/brand-compat-hooks.mjs --import ./server/performance-hooks.mjs')) throw new Error('Bridge de compatibilidade não é o primeiro hook no npm start.')
if (!dockerfile.includes('"./server/brand-compat-hooks.mjs", "--import", "./server/performance-hooks.mjs"')) throw new Error('Bridge de compatibilidade não é o primeiro hook no Docker.')

function setCookies(response) {
  if (typeof response.headers.getSetCookie === 'function') return response.headers.getSetCookie()
  const value = response.headers.get('set-cookie')
  return value ? [value] : []
}

function cookieValue(cookies, name) {
  for (const cookie of cookies) {
    const match = new RegExp(`(?:^|[,\\s])${name}=([^;,%\\s]+)`).exec(cookie)
    if (match) return match[1]
  }
  return ''
}

const suffix = crypto.randomBytes(5).toString('hex')
const email = `m18-${suffix}@example.test`
const password = `Senha-${suffix}-A1`
const storeName = `Compat ${suffix}`
const pool = new Pool({ connectionString: databaseUrl, max: 2 })

try {
  const register = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Compat Teste', email, password, storeName, whatsapp: '5511999999999' }),
  })
  const registerBody = await register.json().catch(() => ({}))
  if (register.status !== 201) throw new Error(`Cadastro de teste falhou: ${register.status} ${JSON.stringify(registerBody)}`)

  const cookies = setCookies(register)
  const modernSession = cookieValue(cookies, 'shopvax_session')
  const legacySession = cookieValue(cookies, 'atacado_session')
  if (!modernSession || !legacySession) throw new Error('Cadastro não entrega simultaneamente sessão Shopvax e sessão legada.')
  if (modernSession !== legacySession) throw new Error('Alias de sessão Shopvax não preserva o mesmo token legado.')

  const modernBootstrap = await fetch(`${baseUrl}/api/admin/bootstrap`, { headers: { Cookie: `shopvax_session=${modernSession}` } })
  if (!modernBootstrap.ok) throw new Error(`Sessão moderna não autentica o painel: ${modernBootstrap.status}`)

  const modernCatalogs = await fetch(`${baseUrl}/api/admin/catalogs`, { headers: { Cookie: `shopvax_session=${modernSession}` } })
  if (!modernCatalogs.ok) throw new Error(`Sessão moderna não atravessa hooks legados: ${modernCatalogs.status}`)

  const legacyBootstrap = await fetch(`${baseUrl}/api/admin/bootstrap`, { headers: { Cookie: `atacado_session=${legacySession}` } })
  if (!legacyBootstrap.ok) throw new Error(`Sessão legada deixou de funcionar: ${legacyBootstrap.status}`)

  const publicStore = await fetch(`${baseUrl}/api/public/store/${encodeURIComponent(registerBody.storeSlug)}`)
  if (!publicStore.ok) throw new Error(`Loja pública de teste falhou: ${publicStore.status}`)
  const visitorCookies = setCookies(publicStore)
  if (!cookieValue(visitorCookies, 'shopvax_public') || !cookieValue(visitorCookies, 'atacado_public')) throw new Error('Visitante público não recebe alias Shopvax + legado.')

  const storeResult = await pool.query('SELECT id FROM stores WHERE slug=$1 LIMIT 1', [registerBody.storeSlug])
  if (!storeResult.rowCount) throw new Error('Loja de teste não encontrada no banco.')
  const storeId = storeResult.rows[0].id

  let triggerReady = false
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const trigger = await pool.query("SELECT 1 FROM pg_trigger WHERE tgname='trg_shopvax_order_code_prefix' AND NOT tgisinternal")
    if (trigger.rowCount) { triggerReady = true; break }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  if (!triggerReady) throw new Error('Migração de prefixo de pedido não ficou pronta.')

  const orderId = `m18-order-${suffix}`
  const legacyCode = `AS-M18-${suffix}`
  await pool.query(
    'INSERT INTO orders (id,code,store_id,total,items,status) VALUES ($1,$2,$3,$4,$5,$6)',
    [orderId, legacyCode, storeId, 10, JSON.stringify([]), 'test'],
  )
  const order = await pool.query('SELECT code FROM orders WHERE id=$1', [orderId])
  if (order.rows[0]?.code !== `SV-M18-${suffix}`) throw new Error(`Novo pedido não migrou para prefixo SV: ${order.rows[0]?.code}`)

  const logout = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { Cookie: `shopvax_session=${modernSession}` },
  })
  if (!logout.ok) throw new Error(`Logout com sessão moderna falhou: ${logout.status}`)
  const clearCookies = setCookies(logout).join('\n')
  if (!clearCookies.includes('shopvax_session=') || !clearCookies.includes('atacado_session=')) throw new Error('Logout não limpa sessão Shopvax e sessão legada.')

  console.log('social module 18 ok')
} finally {
  await pool.query('DELETE FROM users WHERE email=$1', [email]).catch(() => undefined)
  await pool.end()
}
