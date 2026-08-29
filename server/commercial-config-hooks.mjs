import crypto from 'node:crypto'
import express from 'express'
import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 6, connectionTimeoutMillis: 5000 }) : null
const sessionCookie = 'atacado_session'
const paymentLabels = {
  pix: 'Pix',
  dinheiro: 'Dinheiro',
  cartao: 'Cartão',
  boleto: 'Boleto',
  transferencia: 'Transferência bancária',
}
const deliveryLabels = {
  retirada: 'Retirada',
  motoboy: 'Motoboy',
  transportadora: 'Transportadora',
  correios: 'Correios',
  entrega_propria: 'Entrega própria',
  combinar: 'Combinar com a vendedora',
}
const defaultPayments = ['pix', 'dinheiro', 'cartao', 'boleto', 'transferencia']
const defaultDeliveries = ['retirada', 'motoboy', 'transportadora', 'correios', 'entrega_propria', 'combinar']

if (pool) pool.on('error', (error) => console.error('[commercial config] pool:', error.message))
const hashToken = (token) => crypto.createHash('sha256').update(String(token || '')).digest('hex')

function parseCookies(req) {
  const header = req.headers.cookie || ''
  return Object.fromEntries(header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=')
    return index < 0 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))]
  }))
}

async function ensureSchema() {
  if (!pool) throw new Error('DATABASE_URL não configurada.')
  await pool.query(`
    ALTER TABLE stores ADD COLUMN IF NOT EXISTS payment_methods jsonb NOT NULL DEFAULT '["pix","dinheiro","cartao","boleto","transferencia"]'::jsonb;
    ALTER TABLE stores ADD COLUMN IF NOT EXISTS delivery_methods jsonb NOT NULL DEFAULT '["retirada","motoboy","transportadora","correios","entrega_propria","combinar"]'::jsonb;
    ALTER TABLE stores ADD COLUMN IF NOT EXISTS commercial_note text NOT NULL DEFAULT '';
  `)
}

let schemaPromise = null
function schemaReady() {
  if (!schemaPromise) schemaPromise = ensureSchema().catch((error) => { schemaPromise = null; throw error })
  return schemaPromise
}
if (pool) {
  const timer = setTimeout(() => void schemaReady().catch((error) => console.error('[commercial config] schema:', error.message)), 1250)
  timer.unref()
}

async function currentStore(req) {
  const token = parseCookies(req)[sessionCookie]
  if (!token || !pool) return null
  const result = await pool.query(
    `SELECT s.id AS store_id,u.id AS user_id
     FROM sessions se JOIN users u ON u.id=se.user_id JOIN stores s ON s.owner_id=u.id
     WHERE se.token_hash=$1 AND se.expires_at>now() LIMIT 1`,
    [hashToken(token)],
  )
  return result.rows[0] || null
}

async function requireStore(req, res, next) {
  try {
    await schemaReady()
    const store = await currentStore(req)
    if (!store) return res.status(401).json({ error: 'Sessão necessária.' })
    req.commercialStore = store
    next()
  } catch (error) { next(error) }
}

function normalizeList(value, dictionary, fallback) {
  if (!Array.isArray(value)) return fallback
  const seen = new Set()
  const result = []
  for (const raw of value) {
    const key = String(raw || '').trim()
    if (!dictionary[key] || seen.has(key)) continue
    seen.add(key)
    result.push(key)
  }
  return result
}

function shape(row) {
  const payments = normalizeList(row.payment_methods, paymentLabels, defaultPayments)
  const deliveries = normalizeList(row.delivery_methods, deliveryLabels, defaultDeliveries)
  return {
    paymentMethods: payments.map((key) => ({ key, label: paymentLabels[key] })),
    deliveryMethods: deliveries.map((key) => ({ key, label: deliveryLabels[key] })),
    note: String(row.commercial_note || ''),
    informationalOnly: true,
    disclaimer: 'Estas opções são apenas informativas. Pagamento, frete, prazo e entrega são combinados com o atendimento; o Atacado Shop não processa pagamento e não calcula ou rastreia frete.',
  }
}

async function adminGet(req, res) {
  const result = await pool.query('SELECT payment_methods,delivery_methods,commercial_note FROM stores WHERE id=$1 LIMIT 1', [req.commercialStore.store_id])
  if (!result.rowCount) return res.status(404).json({ error: 'Loja não encontrada.' })
  return res.json({ ...shape(result.rows[0]), options: { payments: paymentLabels, deliveries: deliveryLabels } })
}

async function adminUpdate(req, res) {
  const payments = normalizeList(req.body?.paymentMethods, paymentLabels, defaultPayments)
  const deliveries = normalizeList(req.body?.deliveryMethods, deliveryLabels, defaultDeliveries)
  const note = String(req.body?.note || '').trim().slice(0, 500)
  const result = await pool.query(
    `UPDATE stores SET payment_methods=$1,delivery_methods=$2,commercial_note=$3,updated_at=now()
     WHERE id=$4 RETURNING payment_methods,delivery_methods,commercial_note`,
    [JSON.stringify(payments), JSON.stringify(deliveries), note, req.commercialStore.store_id],
  )
  return res.json({ ...shape(result.rows[0]), options: { payments: paymentLabels, deliveries: deliveryLabels } })
}

async function publicGet(req, res) {
  await schemaReady()
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('X-Robots-Tag', 'noindex, noarchive, nosnippet')
  const result = await pool.query(
    'SELECT payment_methods,delivery_methods,commercial_note FROM stores WHERE slug=$1 AND is_active=true LIMIT 1',
    [String(req.params.storeSlug || '')],
  )
  if (!result.rowCount) return res.status(404).json({ error: 'Loja não encontrada.' })
  return res.json(shape(result.rows[0]))
}

function install(app) {
  if (app.__atacadoCommercialConfigInstalled) return
  app.__atacadoCommercialConfigInstalled = true
  app.get('/api/admin/commercial-config', requireStore, (req, res, next) => Promise.resolve(adminGet(req, res)).catch(next))
  app.put('/api/admin/commercial-config', requireStore, (req, res, next) => Promise.resolve(adminUpdate(req, res)).catch(next))
  app.get('/api/public/commercial-config/:storeSlug', (req, res, next) => Promise.resolve(publicGet(req, res)).catch(next))
}

const previousInit = express.application.init
express.application.init = function commercialConfigInit(...args) {
  const result = previousInit.apply(this, args)
  install(this)
  return result
}
