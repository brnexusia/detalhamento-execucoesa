import crypto from 'node:crypto'
import express from 'express'
import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 8, connectionTimeoutMillis: 5000 }) : null
const sessionCookie = 'atacado_session'
const visitorCookie = 'atacado_public'
const allowedKinds = new Set(['access', 'product_view', 'product_click', 'cart_add', 'checkout_start', 'whatsapp_click'])

if (pool) pool.on('error', (error) => console.error('[analytics features] pool:', error.message))

const id = () => crypto.randomUUID()
const hash = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex')

function parseCookies(req) {
  const header = req.headers.cookie || ''
  return Object.fromEntries(header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=')
    return index < 0 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))]
  }))
}

function responseVisitor(res) {
  const raw = res.getHeader('set-cookie')
  const values = Array.isArray(raw) ? raw : raw ? [String(raw)] : []
  for (const value of values) {
    const match = /(?:^|;|,\s*)atacado_public=([^;,]+)/.exec(value)
    if (match?.[1]) return decodeURIComponent(match[1])
  }
  return ''
}

function visitorKey(req, res) {
  const token = parseCookies(req)[visitorCookie] || responseVisitor(res)
  if (token) return hash(`visitor:${token}`).slice(0, 40)
  return hash(`fallback:${req.ip || ''}:${req.headers['user-agent'] || ''}`).slice(0, 40)
}

async function ensureSchema() {
  if (!pool) throw new Error('DATABASE_URL não configurada.')
  await pool.query(`
    CREATE TABLE IF NOT EXISTS intent_events (
      id text PRIMARY KEY,
      store_id text NOT NULL,
      seller_id text,
      catalog_id text,
      product_id text,
      order_id text,
      kind text NOT NULL,
      visitor_key text NOT NULL DEFAULT '',
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_intent_events_store_created ON intent_events(store_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_intent_events_store_kind ON intent_events(store_id,kind,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_intent_events_product ON intent_events(store_id,product_id,created_at DESC) WHERE product_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_intent_events_seller ON intent_events(store_id,seller_id,created_at DESC) WHERE seller_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_intent_events_catalog ON intent_events(store_id,catalog_id,created_at DESC) WHERE catalog_id IS NOT NULL;
  `)
}

let schemaPromise = null
function schemaReady() {
  if (!schemaPromise) schemaPromise = ensureSchema().catch((error) => { schemaPromise = null; throw error })
  return schemaPromise
}
if (pool) {
  const timer = setTimeout(() => void schemaReady().catch((error) => console.error('[analytics features] schema:', error.message)), 900)
  timer.unref()
}

async function currentStore(req) {
  const token = parseCookies(req)[sessionCookie]
  if (!token || !pool) return null
  const result = await pool.query(
    `SELECT s.id AS store_id,u.id AS user_id,u.name,u.email
     FROM sessions se JOIN users u ON u.id=se.user_id JOIN stores s ON s.owner_id=u.id
     WHERE se.token_hash=$1 AND se.expires_at>now() LIMIT 1`,
    [hash(token)],
  )
  return result.rows[0] || null
}

async function requireStore(req, res, next) {
  try {
    const store = await currentStore(req)
    if (!store) return res.status(401).json({ error: 'Sessão necessária.' })
    req.analyticsStore = store
    next()
  } catch (error) { next(error) }
}

async function recordEvents(events) {
  const rows = events.filter((event) => event?.storeId && allowedKinds.has(event?.kind))
  if (!rows.length) return
  const values = []
  const placeholders = rows.map((event, index) => {
    const offset = index * 9
    values.push(
      id(), event.storeId, event.sellerId || null, event.catalogId || null,
      event.productId || null, event.orderId || null, event.kind,
      event.visitorKey || '', JSON.stringify(event.metadata || {}),
    )
    return `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6},$${offset + 7},$${offset + 8},$${offset + 9})`
  })
  await pool.query(
    `INSERT INTO intent_events (id,store_id,seller_id,catalog_id,product_id,order_id,kind,visitor_key,metadata)
     VALUES ${placeholders.join(',')}`,
    values,
  )
}

async function resolvePublicContext(body) {
  const storeSlug = String(body?.storeSlug || '').trim().slice(0, 80)
  if (!storeSlug) return null
  const storeResult = await pool.query('SELECT id,slug FROM stores WHERE slug=$1 AND is_active=true LIMIT 1', [storeSlug])
  if (!storeResult.rowCount) return null
  const store = storeResult.rows[0]
  let sellerId = null
  const sellerSlug = String(body?.sellerSlug || '').trim().slice(0, 80)
  if (sellerSlug) {
    const result = await pool.query('SELECT id FROM sellers WHERE store_id=$1 AND slug=$2 AND is_active=true LIMIT 1', [store.id, sellerSlug])
    sellerId = result.rows[0]?.id || null
  }
  let catalogId = null
  const catalogSlug = String(body?.catalogSlug || '').trim().slice(0, 80)
  try {
    if (catalogSlug) {
      const result = await pool.query('SELECT id FROM catalogs WHERE store_id=$1 AND slug=$2 AND active=true LIMIT 1', [store.id, catalogSlug])
      catalogId = result.rows[0]?.id || null
    } else {
      const result = await pool.query('SELECT id FROM catalogs WHERE store_id=$1 AND is_default=true AND active=true LIMIT 1', [store.id])
      catalogId = result.rows[0]?.id || null
    }
  } catch { catalogId = null }
  let productId = null
  const requestedProductId = String(body?.productId || '').trim().slice(0, 100)
  const productSku = String(body?.productSku || '').trim().slice(0, 120)
  if (requestedProductId || productSku) {
    const result = requestedProductId
      ? await pool.query('SELECT id FROM products WHERE store_id=$1 AND id=$2 AND active=true LIMIT 1', [store.id, requestedProductId])
      : await pool.query('SELECT id FROM products WHERE store_id=$1 AND sku=$2 AND active=true ORDER BY created_at DESC LIMIT 1', [store.id, productSku])
    productId = result.rows[0]?.id || null
  }
  return { storeId: store.id, sellerId, catalogId, productId }
}

async function publicIntentEvent(req, res) {
  await schemaReady()
  const kind = String(req.body?.kind || '')
  if (!['product_click', 'cart_add', 'checkout_start'].includes(kind)) return res.status(400).json({ error: 'Evento inválido.' })
  const context = await resolvePublicContext(req.body)
  if (!context) return res.status(404).json({ error: 'Loja não encontrada.' })
  if ((kind === 'product_click' || kind === 'cart_add') && !context.productId) return res.status(400).json({ error: 'Produto inválido.' })
  await recordEvents([{ ...context, kind, visitorKey: visitorKey(req, res) }])
  return res.status(204).end()
}

async function recordCatalogResponse(req, res, payload) {
  if (!payload?.store?.slug || !Array.isArray(payload?.products)) return
  const storeResult = await pool.query('SELECT id FROM stores WHERE slug=$1 LIMIT 1', [payload.store.slug])
  if (!storeResult.rowCount) return
  const storeId = storeResult.rows[0].id
  const sellerId = payload.seller?.id || null
  const catalogId = payload.activeCatalog?.id || null
  const key = visitorKey(req, res)
  const events = []
  const initialAccess = !req.query?.cursor && !req.query?.q && !req.query?.category
  if (initialAccess) events.push({ storeId, sellerId, catalogId, kind: 'access', visitorKey: key })
  for (const product of payload.products.slice(0, 24)) {
    if (product?.id) events.push({ storeId, sellerId, catalogId, productId: product.id, kind: 'product_view', visitorKey: key })
  }
  await recordEvents(events)
}

async function recordWhatsappOrder(req, res, payload) {
  const orderId = String(payload?.orderId || '')
  if (!orderId) return
  const result = await pool.query('SELECT store_id,seller_id,catalog_id,items FROM orders WHERE id=$1 LIMIT 1', [orderId])
  if (!result.rowCount) return
  const order = result.rows[0]
  const key = visitorKey(req, res)
  const events = [{ storeId: order.store_id, sellerId: order.seller_id, catalogId: order.catalog_id, orderId, kind: 'whatsapp_click', visitorKey: key }]
  for (const item of Array.isArray(order.items) ? order.items : []) {
    if (!item?.productId) continue
    events.push({ storeId: order.store_id, sellerId: order.seller_id, catalogId: order.catalog_id, productId: item.productId, orderId, kind: 'whatsapp_click', visitorKey: key, metadata: { quantity: Number(item.quantity || 0) } })
  }
  await recordEvents(events)
}

function number(row, key) { return Number(row?.[key] || 0) }
function percent(part, total) { return total > 0 ? Math.round((part / total) * 10000) / 100 : 0 }

async function reports(req, res) {
  await schemaReady()
  const storeId = req.analyticsStore.store_id
  const days = Math.max(1, Math.min(365, Math.floor(Number(req.query.days) || 30)))
  const intervalParams = [storeId, days]

  const itemsResult = await pool.query(
    `SELECT p.id,p.sku,p.name,
       COUNT(e.id) FILTER (WHERE e.kind='product_view')::int AS views,
       COUNT(e.id) FILTER (WHERE e.kind='product_click')::int AS clicks,
       COUNT(e.id) FILTER (WHERE e.kind='cart_add')::int AS cart_adds,
       COUNT(e.id) FILTER (WHERE e.kind='whatsapp_click' AND e.product_id IS NOT NULL)::int AS whatsapp,
       COALESCE(SUM((e.metadata->>'quantity')::int) FILTER (WHERE e.kind='whatsapp_click' AND e.product_id IS NOT NULL),0)::int AS whatsapp_units
     FROM products p LEFT JOIN intent_events e ON e.product_id=p.id AND e.store_id=$1 AND e.created_at>=now()-($2::int*interval '1 day')
     WHERE p.store_id=$1 GROUP BY p.id,p.sku,p.name
     HAVING COUNT(e.id)>0
     ORDER BY whatsapp DESC,cart_adds DESC,clicks DESC,views DESC,p.name ASC LIMIT 100`,
    intervalParams,
  )
  const items = itemsResult.rows.map((row) => ({
    id: row.id, sku: row.sku, name: row.name, views: number(row, 'views'), clicks: number(row, 'clicks'),
    cartAdds: number(row, 'cart_adds'), whatsapp: number(row, 'whatsapp'), whatsappUnits: number(row, 'whatsapp_units'),
    interestRate: percent(number(row, 'cart_adds') + number(row, 'whatsapp'), number(row, 'views')),
  }))

  const linksResult = await pool.query(
    `SELECT e.seller_id,COALESCE(s.name,'Link geral') AS name,COALESCE(s.slug,'') AS slug,
       COUNT(*) FILTER (WHERE e.kind='access')::int AS accesses,
       COUNT(*) FILTER (WHERE e.kind='cart_add')::int AS carts,
       COUNT(*) FILTER (WHERE e.kind='checkout_start')::int AS checkouts,
       COUNT(*) FILTER (WHERE e.kind='whatsapp_click' AND e.product_id IS NULL)::int AS whatsapp
     FROM intent_events e LEFT JOIN sellers s ON s.id=e.seller_id
     WHERE e.store_id=$1 AND e.created_at>=now()-($2::int*interval '1 day')
     GROUP BY e.seller_id,s.name,s.slug ORDER BY whatsapp DESC,accesses DESC`,
    intervalParams,
  )
  const links = linksResult.rows.map((row) => ({ sellerId: row.seller_id, name: row.name, slug: row.slug, accesses: number(row, 'accesses'), carts: number(row, 'carts'), checkouts: number(row, 'checkouts'), whatsapp: number(row, 'whatsapp') }))
  const sellers = links.filter((row) => row.sellerId).map((row) => ({ ...row, conversion: percent(row.whatsapp, row.accesses) }))

  let catalogs = []
  try {
    const catalogsResult = await pool.query(
      `SELECT e.catalog_id,COALESCE(c.name,'Catálogo geral') AS name,COALESCE(c.kind,'geral') AS kind,COALESCE(c.slug,'geral') AS slug,
         COUNT(*) FILTER (WHERE e.kind='product_view')::int AS views,
         COUNT(*) FILTER (WHERE e.kind='product_click')::int AS clicks,
         COUNT(*) FILTER (WHERE e.kind='cart_add')::int AS carts,
         COUNT(*) FILTER (WHERE e.kind='whatsapp_click' AND e.product_id IS NULL)::int AS whatsapp
       FROM intent_events e LEFT JOIN catalogs c ON c.id=e.catalog_id
       WHERE e.store_id=$1 AND e.created_at>=now()-($2::int*interval '1 day')
       GROUP BY e.catalog_id,c.name,c.kind,c.slug ORDER BY whatsapp DESC,views DESC`,
      intervalParams,
    )
    catalogs = catalogsResult.rows.map((row) => ({ catalogId: row.catalog_id, name: row.name, kind: row.kind, slug: row.slug, views: number(row, 'views'), clicks: number(row, 'clicks'), carts: number(row, 'carts'), whatsapp: number(row, 'whatsapp'), engagement: percent(number(row, 'clicks') + number(row, 'carts'), number(row, 'views')) }))
  } catch { catalogs = [] }

  const funnelResult = await pool.query(
    `SELECT
       COUNT(DISTINCT visitor_key) FILTER (WHERE kind='access')::int AS access,
       COUNT(DISTINCT visitor_key) FILTER (WHERE kind='product_click')::int AS product,
       COUNT(DISTINCT visitor_key) FILTER (WHERE kind='cart_add')::int AS cart,
       COUNT(DISTINCT visitor_key) FILTER (WHERE kind='checkout_start')::int AS checkout,
       COUNT(DISTINCT visitor_key) FILTER (WHERE kind='whatsapp_click' AND product_id IS NULL)::int AS whatsapp
     FROM intent_events WHERE store_id=$1 AND created_at>=now()-($2::int*interval '1 day')`,
    intervalParams,
  )
  const f = funnelResult.rows[0] || {}
  const stages = [
    { key: 'access', label: 'Acesso', value: number(f, 'access') },
    { key: 'product', label: 'Produto', value: number(f, 'product') },
    { key: 'cart', label: 'Carrinho', value: number(f, 'cart') },
    { key: 'checkout', label: 'Checkout iniciado', value: number(f, 'checkout') },
    { key: 'whatsapp', label: 'Clique no WhatsApp', value: number(f, 'whatsapp') },
  ]
  const funnel = stages.map((stage, index) => ({ ...stage, fromPrevious: index === 0 ? 100 : percent(stage.value, stages[index - 1].value), fromAccess: index === 0 ? 100 : percent(stage.value, stages[0].value) }))

  return res.json({
    periodDays: days,
    interpretation: 'Cliques para o WhatsApp representam intenção / lead / pedido enviado ao WhatsApp. Não representam faturamento, ticket médio ou venda concluída.',
    items, links, sellers, catalogs, funnel,
  })
}

function install(app) {
  if (app.__atacadoAnalyticsFeaturesInstalled) return
  app.__atacadoAnalyticsFeaturesInstalled = true

  app.use((req, res, next) => {
    if (!req.path.startsWith('/api/')) return next()
    Promise.resolve(schemaReady()).then(() => {
      if (req.method === 'GET' && req.path.startsWith('/api/public/store/')) {
        const originalJson = res.json.bind(res)
        res.json = async (payload) => {
          try { if (res.statusCode === 200) await recordCatalogResponse(req, res, payload) }
          catch (error) { console.error('[analytics features] catalog event:', error.message) }
          return originalJson(payload)
        }
      }
      if (req.method === 'POST' && req.path === '/api/business/orders') {
        const originalJson = res.json.bind(res)
        res.json = async (payload) => {
          try { if (res.statusCode === 201) await recordWhatsappOrder(req, res, payload) }
          catch (error) { console.error('[analytics features] whatsapp event:', error.message) }
          return originalJson(payload)
        }
      }
      next()
    }).catch(next)
  })

  app.post('/api/public/intent-events', express.json({ limit: '64kb' }), (req, res, next) => Promise.resolve(publicIntentEvent(req, res)).catch(next))
  app.get('/api/admin/intent-reports', requireStore, (req, res, next) => Promise.resolve(reports(req, res)).catch(next))
}

const previousInit = express.application.init
express.application.init = function analyticsFeaturesInit(...args) {
  const result = previousInit.apply(this, args)
  install(this)
  return result
}
