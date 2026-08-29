import crypto from 'node:crypto'
import express from 'express'
import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 6, connectionTimeoutMillis: 5000 }) : null
const sessionCookie = 'atacado_session'

if (pool) pool.on('error', (error) => console.error('[team features] pool:', error.message))

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
    ALTER TABLE sellers ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'vendedora';
    ALTER TABLE sellers ADD COLUMN IF NOT EXISTS commission_type text NOT NULL DEFAULT 'none';
    ALTER TABLE sellers ADD COLUMN IF NOT EXISTS commission_value numeric(12,2) NOT NULL DEFAULT 0;
    CREATE INDEX IF NOT EXISTS idx_sellers_team_role ON sellers(store_id,role) WHERE is_active=true;
  `)
}

let schemaPromise = null
function schemaReady() {
  if (!schemaPromise) schemaPromise = ensureSchema().catch((error) => { schemaPromise = null; throw error })
  return schemaPromise
}
if (pool) {
  const timer = setTimeout(() => void schemaReady().catch((error) => console.error('[team features] schema:', error.message)), 1100)
  timer.unref()
}

async function currentStore(req) {
  const token = parseCookies(req)[sessionCookie]
  if (!token || !pool) return null
  const result = await pool.query(
    `SELECT s.id AS store_id,s.slug AS store_slug,u.id AS user_id,u.name,u.email
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
    req.teamStore = store
    next()
  } catch (error) { next(error) }
}

function commissionEstimate(type, value, attributedOrders, attributedValue) {
  const ruleValue = Math.max(0, Number(value || 0))
  if (type === 'percent') return Math.round((attributedValue * ruleValue / 100) * 100) / 100
  if (type === 'fixed') return Math.round((attributedOrders * ruleValue) * 100) / 100
  return 0
}

async function teamPayload(store) {
  await schemaReady()
  const sellersResult = await pool.query(
    `SELECT id,slug,name,phone,is_active,role,commission_type,commission_value,created_at
     FROM sellers WHERE store_id=$1 ORDER BY created_at ASC`,
    [store.store_id],
  )
  const orderMetrics = await pool.query(
    `SELECT seller_id,
       COUNT(*) FILTER (WHERE status<>'cancelled')::int AS attributed_orders,
       COALESCE(SUM(total) FILTER (WHERE status<>'cancelled'),0)::numeric AS attributed_value
     FROM orders WHERE store_id=$1 AND seller_id IS NOT NULL GROUP BY seller_id`,
    [store.store_id],
  )
  const ordersBySeller = new Map(orderMetrics.rows.map((row) => [row.seller_id, row]))

  let intentBySeller = new Map()
  try {
    const intentMetrics = await pool.query(
      `SELECT seller_id,
         COUNT(*) FILTER (WHERE kind='access')::int AS accesses,
         COUNT(*) FILTER (WHERE kind='cart_add')::int AS cart_adds,
         COUNT(*) FILTER (WHERE kind='whatsapp_click' AND product_id IS NULL)::int AS whatsapp_orders
       FROM intent_events WHERE store_id=$1 AND seller_id IS NOT NULL GROUP BY seller_id`,
      [store.store_id],
    )
    intentBySeller = new Map(intentMetrics.rows.map((row) => [row.seller_id, row]))
  } catch {}

  const sellers = sellersResult.rows.map((seller) => {
    const order = ordersBySeller.get(seller.id) || {}
    const intent = intentBySeller.get(seller.id) || {}
    const attributedOrders = Number(order.attributed_orders || 0)
    const attributedValue = Number(order.attributed_value || 0)
    const commissionType = ['percent', 'fixed'].includes(seller.commission_type) ? seller.commission_type : 'none'
    const commissionValue = Number(seller.commission_value || 0)
    return {
      id: seller.id,
      slug: seller.slug,
      name: seller.name,
      phone: seller.phone,
      active: Boolean(seller.is_active),
      role: seller.role === 'gerente' ? 'gerente' : 'vendedora',
      commissionType,
      commissionValue,
      metrics: {
        accesses: Number(intent.accesses || 0),
        cartAdds: Number(intent.cart_adds || 0),
        whatsappOrders: Number(intent.whatsapp_orders || attributedOrders),
        attributedOrders,
        attributedValue,
        estimatedCommission: commissionEstimate(commissionType, commissionValue, attributedOrders, attributedValue),
      },
    }
  })

  return {
    administrator: { id: store.user_id, name: store.name, email: store.email, role: 'administrador' },
    storeSlug: store.store_slug,
    interpretation: 'Comissão é apenas uma estimativa baseada em pedidos/intenção atribuíveis enviados ao WhatsApp. Não representa faturamento confirmado, folha de pagamento nem repasse financeiro.',
    sellers,
  }
}

async function getTeam(req, res) {
  return res.json(await teamPayload(req.teamStore))
}

async function updateSellerTeam(req, res) {
  await schemaReady()
  const role = req.body?.role === 'gerente' ? 'gerente' : req.body?.role === 'vendedora' ? 'vendedora' : null
  const commissionType = ['none', 'percent', 'fixed'].includes(req.body?.commissionType) ? req.body.commissionType : null
  if (!role || !commissionType) return res.status(400).json({ error: 'Papel ou tipo de comissão inválido.' })
  let commissionValue = Math.max(0, Number(req.body?.commissionValue || 0))
  if (commissionType === 'percent') commissionValue = Math.min(100, commissionValue)
  commissionValue = Math.round(commissionValue * 100) / 100
  if (commissionType === 'none') commissionValue = 0

  const result = await pool.query(
    `UPDATE sellers SET role=$1,commission_type=$2,commission_value=$3
     WHERE id=$4 AND store_id=$5 RETURNING id`,
    [role, commissionType, commissionValue, req.params.sellerId, req.teamStore.store_id],
  )
  if (!result.rowCount) return res.status(404).json({ error: 'Vendedora não encontrada.' })
  return res.json(await teamPayload(req.teamStore))
}

function install(app) {
  if (app.__atacadoTeamFeaturesInstalled) return
  app.__atacadoTeamFeaturesInstalled = true
  app.get('/api/admin/team', requireStore, (req, res, next) => Promise.resolve(getTeam(req, res)).catch(next))
  app.patch('/api/admin/team/sellers/:sellerId', express.json({ limit: '64kb' }), requireStore, (req, res, next) => Promise.resolve(updateSellerTeam(req, res)).catch(next))
}

const previousInit = express.application.init
express.application.init = function teamFeaturesInit(...args) {
  const result = previousInit.apply(this, args)
  install(this)
  return result
}
