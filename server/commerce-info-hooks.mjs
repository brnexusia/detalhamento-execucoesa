import crypto from 'node:crypto'
import express from 'express'
import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 5000 }) : null
const sessionCookie = 'atacado_session'

if (pool) pool.on('error', (error) => console.error('[commerce info] pool:', error.message))

const deliveryOptions = {
  retirada: 'Retirada',
  motoboy: 'Motoboy',
  transportadora: 'Transportadora',
  correios: 'Correios',
  entrega_propria: 'Entrega própria',
  combinar_vendedora: 'Combinar com a vendedora',
}
const paymentOptions = {
  pix: 'Pix',
  dinheiro: 'Dinheiro',
  cartao: 'Cartão',
  boleto: 'Boleto',
  transferencia: 'Transferência',
}

const hashToken = (token) => crypto.createHash('sha256').update(String(token || '')).digest('hex')

function parseCookies(req) {
  const header = req.headers.cookie || ''
  return Object.fromEntries(header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=')
    return index < 0 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))]
  }))
}

function normalizeKeys(value, options) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => String(item || '').trim()).filter((item) => Object.prototype.hasOwnProperty.call(options, item)))].slice(0, 20)
}

function labeled(keys, options) {
  return normalizeKeys(keys, options).map((key) => ({ key, label: options[key] }))
}

async function ensureSchema() {
  if (!pool) throw new Error('DATABASE_URL não configurada.')
  await pool.query(`
    ALTER TABLE stores ADD COLUMN IF NOT EXISTS delivery_methods jsonb NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE stores ADD COLUMN IF NOT EXISTS payment_methods jsonb NOT NULL DEFAULT '[]'::jsonb;
  `)
}

let schemaPromise = null
function schemaReady() {
  if (!schemaPromise) schemaPromise = ensureSchema().catch((error) => { schemaPromise = null; throw error })
  return schemaPromise
}
if (pool) {
  const timer = setTimeout(() => void schemaReady().catch((error) => console.error('[commerce info] schema:', error.message)), 1200)
  timer.unref()
}

async function currentStore(req) {
  const token = parseCookies(req)[sessionCookie]
  if (!token || !pool) return null
  const result = await pool.query(
    `SELECT s.id AS store_id,s.slug AS store_slug
     FROM sessions se JOIN users u ON u.id=se.user_id JOIN stores s ON s.owner_id=u.id
     WHERE se.token_hash=$1 AND se.expires_at>now() LIMIT 1`,
    [hashToken(token)],
  )
  return result.rows[0] || null
}

async function requireStore(req, res, next) {
  try {
    const store = await currentStore(req)
    if (!store) return res.status(401).json({ error: 'Sessão necessária.' })
    req.commerceStore = store
    next()
  } catch (error) { next(error) }
}

function payload(row) {
  const deliveryMethods = labeled(row?.delivery_methods, deliveryOptions)
  const paymentMethods = labeled(row?.payment_methods, paymentOptions)
  return {
    deliveryMethods,
    paymentMethods,
    paymentProcessing: false,
    freightCalculation: false,
    notice: 'As formas exibidas são informativas. Pagamento, valor do frete, prazo e detalhes da entrega são combinados diretamente com a loja/vendedora; o Atacado Shop não processa pagamento nem calcula frete automático.',
  }
}

async function getAdmin(req, res) {
  await schemaReady()
  const result = await pool.query('SELECT delivery_methods,payment_methods FROM stores WHERE id=$1 LIMIT 1', [req.commerceStore.store_id])
  if (!result.rowCount) return res.status(404).json({ error: 'Loja não encontrada.' })
  return res.json({
    ...payload(result.rows[0]),
    availableDeliveryMethods: Object.entries(deliveryOptions).map(([key, label]) => ({ key, label })),
    availablePaymentMethods: Object.entries(paymentOptions).map(([key, label]) => ({ key, label })),
  })
}

async function updateAdmin(req, res) {
  await schemaReady()
  const deliveryMethods = normalizeKeys(req.body?.deliveryMethods, deliveryOptions)
  const paymentMethods = normalizeKeys(req.body?.paymentMethods, paymentOptions)
  const result = await pool.query(
    'UPDATE stores SET delivery_methods=$1,payment_methods=$2 WHERE id=$3 RETURNING delivery_methods,payment_methods',
    [JSON.stringify(deliveryMethods), JSON.stringify(paymentMethods), req.commerceStore.store_id],
  )
  return res.json({
    ...payload(result.rows[0]),
    availableDeliveryMethods: Object.entries(deliveryOptions).map(([key, label]) => ({ key, label })),
    availablePaymentMethods: Object.entries(paymentOptions).map(([key, label]) => ({ key, label })),
  })
}

async function getPublic(req, res) {
  await schemaReady()
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('X-Robots-Tag', 'noindex, noarchive, nosnippet')
  const result = await pool.query('SELECT delivery_methods,payment_methods FROM stores WHERE slug=$1 AND is_active=true LIMIT 1', [req.params.storeSlug])
  if (!result.rowCount) return res.status(404).json({ error: 'Loja não encontrada.' })
  return res.json(payload(result.rows[0]))
}

function install(app) {
  if (app.__atacadoCommerceInfoInstalled) return
  app.__atacadoCommerceInfoInstalled = true
  app.get('/api/admin/commerce-info', requireStore, (req, res, next) => Promise.resolve(getAdmin(req, res)).catch(next))
  app.put('/api/admin/commerce-info', express.json({ limit: '64kb' }), requireStore, (req, res, next) => Promise.resolve(updateAdmin(req, res)).catch(next))
  app.get('/api/public/commerce-info/:storeSlug', (req, res, next) => Promise.resolve(getPublic(req, res)).catch(next))
}

const previousInit = express.application.init
express.application.init = function commerceInfoInit(...args) {
  const result = previousInit.apply(this, args)
  install(this)
  return result
}
