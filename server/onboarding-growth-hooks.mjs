// Frente 03: endpoints isolados. Nenhuma mensagem, disparo de oferta ou IA é ativada aqui.
import crypto from 'node:crypto'
import express from 'express'
import pg from 'pg'
import { ONBOARDING_CONFIRMABLE, normalizePreferences, validateSupportInput } from './onboarding-growth-policy.mjs'

const pool = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4, connectionTimeoutMillis: 5000 }) : null
if (pool) pool.on('error', error => console.error('[shopvax-growth] pool:', error.message))
const hash = value => crypto.createHash('sha256').update(String(value || '')).digest('hex')
const cookies = req => Object.fromEntries(String(req.headers.cookie || '').split(';').map(part => part.trim()).filter(Boolean).map(part => {
  const i = part.indexOf('=')
  try { return [part.slice(0, i), decodeURIComponent(part.slice(i + 1))] } catch { return ['', ''] }
}).filter(pair => pair[0]))
const wrap = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next)
const noStore = (req, res, next) => { res.set('Cache-Control', 'no-store'); next() }
let schemaReady = false
let schemaPending = null

async function ensureSchema() {
  if (!pool) { const err = new Error('Banco não configurado.'); err.status = 503; throw err }
  if (schemaReady) return
  if (!schemaPending) {
    schemaPending = (async () => {
      for (let i = 0; i < 100; i += 1) {
        const result = await pool.query("SELECT to_regclass('public.stores') AS stores, to_regclass('public.store_customers') AS customers, to_regclass('public.sessions') AS sessions")
        if (result.rows[0]?.stores && result.rows[0]?.customers && result.rows[0]?.sessions) break
        if (i === 99) throw new Error('Schema de contas não disponível.')
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      await pool.query([
        'CREATE TABLE IF NOT EXISTS shopvax_growth_consents (',
        'customer_id text PRIMARY KEY REFERENCES store_customers(id) ON DELETE CASCADE,',
        'home_store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,',
        'whatsapp boolean NOT NULL DEFAULT false, email boolean NOT NULL DEFAULT false,',
        "scope text NOT NULL DEFAULT 'selected' CHECK (scope IN ('selected','all_current')),",
        "store_ids text[] NOT NULL DEFAULT '{}'::text[], updated_at timestamptz NOT NULL DEFAULT now());",
        'CREATE TABLE IF NOT EXISTS shopvax_growth_consent_audit (',
        'id uuid PRIMARY KEY, customer_id text NOT NULL REFERENCES store_customers(id) ON DELETE CASCADE,',
        "channel text NOT NULL CHECK (channel IN ('whatsapp','email'))," ,
        'allowed boolean NOT NULL, scope text NOT NULL, store_ids text[] NOT NULL, created_at timestamptz NOT NULL DEFAULT now());',
        'CREATE INDEX IF NOT EXISTS idx_growth_consent_audit_customer ON shopvax_growth_consent_audit(customer_id,created_at DESC);',
        'CREATE TABLE IF NOT EXISTS shopvax_growth_onboarding (',
        'store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE, step text NOT NULL,',
        'confirmed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(store_id,step));',
        'CREATE TABLE IF NOT EXISTS shopvax_support_tickets (',
        'id uuid PRIMARY KEY, audience text NOT NULL, topic text NOT NULL,',
        "message text NOT NULL, reply_email text NOT NULL DEFAULT '',",
        'store_id text REFERENCES stores(id) ON DELETE SET NULL,',
        "needs_human boolean NOT NULL DEFAULT true, status text NOT NULL DEFAULT 'pending_human',",
        'created_at timestamptz NOT NULL DEFAULT now());',
        'CREATE INDEX IF NOT EXISTS idx_shopvax_support_queue ON shopvax_support_tickets(status,created_at);'
      ].join(' '))
      schemaReady = true
    })().finally(() => { schemaPending = null })
  }
  return schemaPending
}

async function owner(req) {
  await ensureSchema()
  const token = cookies(req).atacado_session
  if (!token) return null
  const result = await pool.query('SELECT s.id,s.slug,s.name,s.minimum_order,s.onboarding_palette_selected FROM sessions se JOIN stores s ON s.owner_id=se.user_id WHERE se.token_hash=$1 AND se.expires_at>now() LIMIT 1', [hash(token)])
  return result.rows[0] || null
}
async function storeForSlug(slug) {
  await ensureSchema()
  const result = await pool.query('SELECT id,slug,name FROM stores WHERE slug=$1 AND is_active=true LIMIT 1', [slug])
  return result.rows[0] || null
}
async function customer(req, storeId) {
  await ensureSchema()
  const token = cookies(req).shopvax_customer_session
  if (!token) return null
  const result = await pool.query('SELECT c.id,c.store_id FROM store_customer_sessions se JOIN store_customers c ON c.id=se.customer_id WHERE se.token_hash=$1 AND se.expires_at>now() AND c.store_id=$2 AND c.active=true LIMIT 1', [hash(token), storeId])
  return result.rows[0] || null
}
async function resolveCustomer(req, res) {
  const store = await storeForSlug(req.params.storeSlug)
  if (!store) { res.status(404).json({ error: 'Loja não encontrada.' }); return null }
  const buyer = await customer(req, store.id)
  if (!buyer) { res.status(401).json({ error: 'Entre na sua conta de comprador para configurar ofertas.' }); return null }
  return { store, buyer }
}
const activeStores = async () => (await pool.query('SELECT id,name,slug FROM stores WHERE is_active=true ORDER BY name,id LIMIT 100')).rows

async function getConsent(req, res) {
  const identity = await resolveCustomer(req, res)
  if (!identity) return
  const result = await pool.query('SELECT whatsapp,email,scope,store_ids,updated_at FROM shopvax_growth_consents WHERE customer_id=$1 AND home_store_id=$2', [identity.buyer.id, identity.store.id])
  const entry = result.rows[0] || {}
  res.json({ whatsapp: entry.whatsapp === true, email: entry.email === true, scope: entry.scope || 'selected', storeIds: entry.store_ids || [], updatedAt: entry.updated_at || null })
}
async function saveConsent(req, res) {
  const identity = await resolveCustomer(req, res)
  if (!identity) return
  const allowed = (await activeStores()).map(s => s.id)
  let next
  try { next = normalizePreferences(req.body, allowed) }
  catch (error) { return res.status(400).json({ error: error.message }) }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query([
      'INSERT INTO shopvax_growth_consents (customer_id,home_store_id,whatsapp,email,scope,store_ids)',
      'VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (customer_id) DO UPDATE SET',
      'whatsapp=excluded.whatsapp,email=excluded.email,scope=excluded.scope,',
      'store_ids=excluded.store_ids,updated_at=now() WHERE shopvax_growth_consents.home_store_id=excluded.home_store_id'
    ].join(' '), [identity.buyer.id,identity.store.id,next.whatsapp,next.email,next.scope,next.storeIds])
    for (const channel of ['whatsapp', 'email']) {
      await client.query('INSERT INTO shopvax_growth_consent_audit (id,customer_id,channel,allowed,scope,store_ids) VALUES ($1,$2,$3,$4,$5,$6)', [
        crypto.randomUUID(),identity.buyer.id,channel,next[channel],next.scope,next.storeIds
      ])
    }
    await client.query('COMMIT')
    res.json({ ok: true, ...next, status: 'preferences_saved_no_messages_sent' })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}
async function revokeConsent(req, res) {
  req.body = { whatsapp: false, email: false, scope: 'selected', storeIds: [] }
  return saveConsent(req, res)
}
async function onboarding(req, res) {
  const shop = await owner(req)
  if (!shop) return res.status(401).json({ error: 'Sessão do lojista necessária.' })
  const [rows, sellers, products] = await Promise.all([
    pool.query('SELECT step,confirmed_at FROM shopvax_growth_onboarding WHERE store_id=$1', [shop.id]),
    pool.query('SELECT count(*)::int AS total FROM sellers WHERE store_id=$1 AND is_active=true AND phone ~ '^[0-9]{10,15},
    pool.query('SELECT count(*)::int AS total FROM products WHERE store_id=$1 AND active=true', [shop.id]),
  ])
  res.json({
    identity: shop.onboarding_palette_selected === true,
    sellers: sellers.rows[0].total > 0,
    products: products.rows[0].total > 0,
    minimumOrder: Number(shop.minimum_order || 0),
    confirmed: rows.rows.map(row => row.step),
  })
}
async function confirmStep(req, res) {
  const shop = await owner(req)
  if (!shop) return res.status(401).json({ error: 'Sessão do lojista necessária.' })
  const step = String(req.body?.step || '')
  if (!ONBOARDING_CONFIRMABLE.has(step)) return res.status(400).json({ error: 'Etapa inválida.' })
  const readiness = await pool.query('SELECT (SELECT count(*) FROM sellers WHERE store_id=$1 AND is_active=true AND phone ~ '^[0-9]{10,15}, (SELECT count(*) FROM products WHERE store_id=$1 AND active=true)::int AS products', [shop.id])
  if (!readiness.rows[0].products || (step === 'whatsapp_understood' && !readiness.rows[0].sellers)) return res.status(409).json({ error: 'Cadastre um produto e, para WhatsApp, uma vendedora ativa antes de confirmar.' })
  await pool.query('INSERT INTO shopvax_growth_onboarding (store_id,step) VALUES ($1,$2) ON CONFLICT (store_id,step) DO NOTHING', [shop.id,step])
  res.json({ ok: true, step, evidence: 'explicit_merchant_action' })
}

const recentTickets = new Map()
function enforceTicketRate(req, res, next) {
  // IP usado exclusivamente em memória por 10 minutos contra abuso do formulário; não é identificador de ofertas.
  const key = String(req.ip || req.socket.remoteAddress || '')
  const now = Date.now()
  for (const [ip, value] of recentTickets) if (now - value.start > 600000) recentTickets.delete(ip)
  const current = recentTickets.get(key) || { start: now, count: 0 }
  if (current.count >= 3) return res.status(429).json({ error: 'Limite de solicitações atingido. Tente mais tarde.' })
  recentTickets.set(key, { start: current.start, count: current.count + 1 })
  next()
}
async function submitTicket(req, res) {
  if (process.env.SHOPVAX_SUPPORT_TICKETS_ENABLED !== '1') return res.status(503).json({ error: 'Central de solicitações ainda não está ativada. Consulte a ajuda na tela.' })
  await ensureSchema()
  let input
  try { input = validateSupportInput(req.body) }
  catch (error) { return res.status(400).json({ error: error.message }) }
  if (input.audience === 'merchant' && !(await owner(req))) return res.status(401).json({ error: 'Entre como lojista para solicitar suporte.' })
  const merchant = input.audience === 'merchant' ? await owner(req) : null
  const id = crypto.randomUUID()
  await pool.query('INSERT INTO shopvax_support_tickets (id,audience,topic,message,reply_email,store_id,needs_human) VALUES ($1,$2,$3,$4,$5,$6,true)', [
    id,input.audience,input.topic,input.message,input.replyEmail,merchant?.id || null,
  ])
  res.status(201).json({ id, status: 'pending_human', sentExternally: false })
}

function install(app) {
  if (app.__shopvaxGrowthInstalled) return
  app.__shopvaxGrowthInstalled = true
  app.get('/api/public/growth/stores', noStore, wrap(async (_req,res) => { await ensureSchema(); res.json({ stores: await activeStores() }) }))
  app.get('/api/public/store/:storeSlug/growth/consent', noStore, wrap(getConsent))
  app.put('/api/public/store/:storeSlug/growth/consent', express.json({ limit: '16kb' }), noStore, wrap(saveConsent))
  app.delete('/api/public/store/:storeSlug/growth/consent', noStore, wrap(revokeConsent))
  app.get('/api/admin/growth/onboarding', noStore, wrap(onboarding))
  app.post('/api/admin/growth/onboarding/confirm', express.json({ limit: '4kb' }), noStore, wrap(confirmStep))
  app.get('/api/public/support/config', noStore, (_req,res) => res.json({ ticketsEnabled: process.env.SHOPVAX_SUPPORT_TICKETS_ENABLED === '1', aiEnabled: false, messagingEnabled: false }))
  app.post('/api/public/support/tickets', express.json({ limit: '8kb' }), noStore, enforceTicketRate, wrap(submitTicket))
  // Falha da infraestrutura fica explícita: schema não habilita envios, IA nem canal de WhatsApp.
}
const previous = express.application.init
express.application.init = function shopvaxGrowthInit(...args) { const result = previous.apply(this,args); install(this); return result }
', [shop.id]),
    pool.query('SELECT count(*)::int AS total FROM products WHERE store_id=$1 AND active=true', [shop.id]),
  ])
  res.json({
    identity: shop.onboarding_palette_selected === true,
    sellers: sellers.rows[0].total > 0,
    products: products.rows[0].total > 0,
    minimumOrder: Number(shop.minimum_order || 0),
    confirmed: rows.rows.map(row => row.step),
  })
}
async function confirmStep(req, res) {
  const shop = await owner(req)
  if (!shop) return res.status(401).json({ error: 'Sessão do lojista necessária.' })
  const step = String(req.body?.step || '')
  if (!ONBOARDING_CONFIRMABLE.has(step)) return res.status(400).json({ error: 'Etapa inválida.' })
  const readiness = await pool.query('SELECT (SELECT count(*) FROM sellers WHERE store_id=$1 AND is_active=true)::int AS sellers, (SELECT count(*) FROM products WHERE store_id=$1 AND active=true)::int AS products', [shop.id])
  if (!readiness.rows[0].products || (step === 'whatsapp_understood' && !readiness.rows[0].sellers)) return res.status(409).json({ error: 'Cadastre um produto e, para WhatsApp, uma vendedora ativa antes de confirmar.' })
  await pool.query('INSERT INTO shopvax_growth_onboarding (store_id,step) VALUES ($1,$2) ON CONFLICT (store_id,step) DO NOTHING', [shop.id,step])
  res.json({ ok: true, step, evidence: 'explicit_merchant_action' })
}

const recentTickets = new Map()
function enforceTicketRate(req, res, next) {
  // IP usado exclusivamente em memória por 10 minutos contra abuso do formulário; não é identificador de ofertas.
  const key = String(req.ip || req.socket.remoteAddress || '')
  const now = Date.now()
  for (const [ip, value] of recentTickets) if (now - value.start > 600000) recentTickets.delete(ip)
  const current = recentTickets.get(key) || { start: now, count: 0 }
  if (current.count >= 3) return res.status(429).json({ error: 'Limite de solicitações atingido. Tente mais tarde.' })
  recentTickets.set(key, { start: current.start, count: current.count + 1 })
  next()
}
async function submitTicket(req, res) {
  if (process.env.SHOPVAX_SUPPORT_TICKETS_ENABLED !== '1') return res.status(503).json({ error: 'Central de solicitações ainda não está ativada. Consulte a ajuda na tela.' })
  await ensureSchema()
  let input
  try { input = validateSupportInput(req.body) }
  catch (error) { return res.status(400).json({ error: error.message }) }
  if (input.audience === 'merchant' && !(await owner(req))) return res.status(401).json({ error: 'Entre como lojista para solicitar suporte.' })
  const merchant = input.audience === 'merchant' ? await owner(req) : null
  const id = crypto.randomUUID()
  await pool.query('INSERT INTO shopvax_support_tickets (id,audience,topic,message,reply_email,store_id,needs_human) VALUES ($1,$2,$3,$4,$5,$6,true)', [
    id,input.audience,input.topic,input.message,input.replyEmail,merchant?.id || null,
  ])
  res.status(201).json({ id, status: 'pending_human', sentExternally: false })
}

function install(app) {
  if (app.__shopvaxGrowthInstalled) return
  app.__shopvaxGrowthInstalled = true
  app.get('/api/public/growth/stores', noStore, wrap(async (_req,res) => { await ensureSchema(); res.json({ stores: await activeStores() }) }))
  app.get('/api/public/store/:storeSlug/growth/consent', noStore, wrap(getConsent))
  app.put('/api/public/store/:storeSlug/growth/consent', express.json({ limit: '16kb' }), noStore, wrap(saveConsent))
  app.delete('/api/public/store/:storeSlug/growth/consent', noStore, wrap(revokeConsent))
  app.get('/api/admin/growth/onboarding', noStore, wrap(onboarding))
  app.post('/api/admin/growth/onboarding/confirm', express.json({ limit: '4kb' }), noStore, wrap(confirmStep))
  app.get('/api/public/support/config', noStore, (_req,res) => res.json({ ticketsEnabled: process.env.SHOPVAX_SUPPORT_TICKETS_ENABLED === '1', aiEnabled: false, messagingEnabled: false }))
  app.post('/api/public/support/tickets', express.json({ limit: '8kb' }), noStore, enforceTicketRate, wrap(submitTicket))
  // Falha da infraestrutura fica explícita: schema não habilita envios, IA nem canal de WhatsApp.
}
const previous = express.application.init
express.application.init = function shopvaxGrowthInit(...args) { const result = previous.apply(this,args); install(this); return result }
)::int AS sellers, (SELECT count(*) FROM products WHERE store_id=$1 AND active=true)::int AS products', [shop.id])
  if (!readiness.rows[0].products || (step === 'whatsapp_understood' && !readiness.rows[0].sellers)) return res.status(409).json({ error: 'Cadastre um produto e, para WhatsApp, uma vendedora ativa antes de confirmar.' })
  await pool.query('INSERT INTO shopvax_growth_onboarding (store_id,step) VALUES ($1,$2) ON CONFLICT (store_id,step) DO NOTHING', [shop.id,step])
  res.json({ ok: true, step, evidence: 'explicit_merchant_action' })
}

const recentTickets = new Map()
function enforceTicketRate(req, res, next) {
  // IP usado exclusivamente em memória por 10 minutos contra abuso do formulário; não é identificador de ofertas.
  const key = String(req.ip || req.socket.remoteAddress || '')
  const now = Date.now()
  for (const [ip, value] of recentTickets) if (now - value.start > 600000) recentTickets.delete(ip)
  const current = recentTickets.get(key) || { start: now, count: 0 }
  if (current.count >= 3) return res.status(429).json({ error: 'Limite de solicitações atingido. Tente mais tarde.' })
  recentTickets.set(key, { start: current.start, count: current.count + 1 })
  next()
}
async function submitTicket(req, res) {
  if (process.env.SHOPVAX_SUPPORT_TICKETS_ENABLED !== '1') return res.status(503).json({ error: 'Central de solicitações ainda não está ativada. Consulte a ajuda na tela.' })
  await ensureSchema()
  let input
  try { input = validateSupportInput(req.body) }
  catch (error) { return res.status(400).json({ error: error.message }) }
  if (input.audience === 'merchant' && !(await owner(req))) return res.status(401).json({ error: 'Entre como lojista para solicitar suporte.' })
  const merchant = input.audience === 'merchant' ? await owner(req) : null
  const id = crypto.randomUUID()
  await pool.query('INSERT INTO shopvax_support_tickets (id,audience,topic,message,reply_email,store_id,needs_human) VALUES ($1,$2,$3,$4,$5,$6,true)', [
    id,input.audience,input.topic,input.message,input.replyEmail,merchant?.id || null,
  ])
  res.status(201).json({ id, status: 'pending_human', sentExternally: false })
}

function install(app) {
  if (app.__shopvaxGrowthInstalled) return
  app.__shopvaxGrowthInstalled = true
  app.get('/api/public/growth/stores', noStore, wrap(async (_req,res) => { await ensureSchema(); res.json({ stores: await activeStores() }) }))
  app.get('/api/public/store/:storeSlug/growth/consent', noStore, wrap(getConsent))
  app.put('/api/public/store/:storeSlug/growth/consent', express.json({ limit: '16kb' }), noStore, wrap(saveConsent))
  app.delete('/api/public/store/:storeSlug/growth/consent', noStore, wrap(revokeConsent))
  app.get('/api/admin/growth/onboarding', noStore, wrap(onboarding))
  app.post('/api/admin/growth/onboarding/confirm', express.json({ limit: '4kb' }), noStore, wrap(confirmStep))
  app.get('/api/public/support/config', noStore, (_req,res) => res.json({ ticketsEnabled: process.env.SHOPVAX_SUPPORT_TICKETS_ENABLED === '1', aiEnabled: false, messagingEnabled: false }))
  app.post('/api/public/support/tickets', express.json({ limit: '8kb' }), noStore, enforceTicketRate, wrap(submitTicket))
  // Falha da infraestrutura fica explícita: schema não habilita envios, IA nem canal de WhatsApp.
}
const previous = express.application.init
express.application.init = function shopvaxGrowthInit(...args) { const result = previous.apply(this,args); install(this); return result }
', [shop.id]),
    pool.query('SELECT count(*)::int AS total FROM products WHERE store_id=$1 AND active=true', [shop.id]),
  ])
  res.json({
    identity: shop.onboarding_palette_selected === true,
    sellers: sellers.rows[0].total > 0,
    products: products.rows[0].total > 0,
    minimumOrder: Number(shop.minimum_order || 0),
    confirmed: rows.rows.map(row => row.step),
  })
}
async function confirmStep(req, res) {
  const shop = await owner(req)
  if (!shop) return res.status(401).json({ error: 'Sessão do lojista necessária.' })
  const step = String(req.body?.step || '')
  if (!ONBOARDING_CONFIRMABLE.has(step)) return res.status(400).json({ error: 'Etapa inválida.' })
  const readiness = await pool.query('SELECT (SELECT count(*) FROM sellers WHERE store_id=$1 AND is_active=true)::int AS sellers, (SELECT count(*) FROM products WHERE store_id=$1 AND active=true)::int AS products', [shop.id])
  if (!readiness.rows[0].products || (step === 'whatsapp_understood' && !readiness.rows[0].sellers)) return res.status(409).json({ error: 'Cadastre um produto e, para WhatsApp, uma vendedora ativa antes de confirmar.' })
  await pool.query('INSERT INTO shopvax_growth_onboarding (store_id,step) VALUES ($1,$2) ON CONFLICT (store_id,step) DO NOTHING', [shop.id,step])
  res.json({ ok: true, step, evidence: 'explicit_merchant_action' })
}

const recentTickets = new Map()
function enforceTicketRate(req, res, next) {
  // IP usado exclusivamente em memória por 10 minutos contra abuso do formulário; não é identificador de ofertas.
  const key = String(req.ip || req.socket.remoteAddress || '')
  const now = Date.now()
  for (const [ip, value] of recentTickets) if (now - value.start > 600000) recentTickets.delete(ip)
  const current = recentTickets.get(key) || { start: now, count: 0 }
  if (current.count >= 3) return res.status(429).json({ error: 'Limite de solicitações atingido. Tente mais tarde.' })
  recentTickets.set(key, { start: current.start, count: current.count + 1 })
  next()
}
async function submitTicket(req, res) {
  if (process.env.SHOPVAX_SUPPORT_TICKETS_ENABLED !== '1') return res.status(503).json({ error: 'Central de solicitações ainda não está ativada. Consulte a ajuda na tela.' })
  await ensureSchema()
  let input
  try { input = validateSupportInput(req.body) }
  catch (error) { return res.status(400).json({ error: error.message }) }
  if (input.audience === 'merchant' && !(await owner(req))) return res.status(401).json({ error: 'Entre como lojista para solicitar suporte.' })
  const merchant = input.audience === 'merchant' ? await owner(req) : null
  const id = crypto.randomUUID()
  await pool.query('INSERT INTO shopvax_support_tickets (id,audience,topic,message,reply_email,store_id,needs_human) VALUES ($1,$2,$3,$4,$5,$6,true)', [
    id,input.audience,input.topic,input.message,input.replyEmail,merchant?.id || null,
  ])
  res.status(201).json({ id, status: 'pending_human', sentExternally: false })
}

function install(app) {
  if (app.__shopvaxGrowthInstalled) return
  app.__shopvaxGrowthInstalled = true
  app.get('/api/public/growth/stores', noStore, wrap(async (_req,res) => { await ensureSchema(); res.json({ stores: await activeStores() }) }))
  app.get('/api/public/store/:storeSlug/growth/consent', noStore, wrap(getConsent))
  app.put('/api/public/store/:storeSlug/growth/consent', express.json({ limit: '16kb' }), noStore, wrap(saveConsent))
  app.delete('/api/public/store/:storeSlug/growth/consent', noStore, wrap(revokeConsent))
  app.get('/api/admin/growth/onboarding', noStore, wrap(onboarding))
  app.post('/api/admin/growth/onboarding/confirm', express.json({ limit: '4kb' }), noStore, wrap(confirmStep))
  app.get('/api/public/support/config', noStore, (_req,res) => res.json({ ticketsEnabled: process.env.SHOPVAX_SUPPORT_TICKETS_ENABLED === '1', aiEnabled: false, messagingEnabled: false }))
  app.post('/api/public/support/tickets', express.json({ limit: '8kb' }), noStore, enforceTicketRate, wrap(submitTicket))
  // Falha da infraestrutura fica explícita: schema não habilita envios, IA nem canal de WhatsApp.
}
const previous = express.application.init
express.application.init = function shopvaxGrowthInit(...args) { const result = previous.apply(this,args); install(this); return result }
