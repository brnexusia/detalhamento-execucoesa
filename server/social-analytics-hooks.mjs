import crypto from 'node:crypto'
import express from 'express'
import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 5000 }) : null
const sessionCookie = 'atacado_session'

if (pool) pool.on('error', (error) => console.error('[social analytics] pool:', error.message))

const hash = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex')

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
    ALTER TABLE products ADD COLUMN IF NOT EXISTS social_published boolean NOT NULL DEFAULT true;
    CREATE TABLE IF NOT EXISTS social_post_views (
      product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      visitor_key text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(product_id,visitor_key)
    );
    CREATE TABLE IF NOT EXISTS social_post_likes (
      product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      visitor_key text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(product_id,visitor_key)
    );
    CREATE TABLE IF NOT EXISTS social_store_follows (
      store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      visitor_key text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(store_id,visitor_key)
    );
    CREATE TABLE IF NOT EXISTS social_actions (
      id text PRIMARY KEY,
      product_id text REFERENCES products(id) ON DELETE CASCADE,
      store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      visitor_key text NOT NULL,
      kind text NOT NULL,
      seller_id text REFERENCES sellers(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE social_actions ADD COLUMN IF NOT EXISTS seller_id text REFERENCES sellers(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_social_analytics_views ON social_post_views(store_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_social_analytics_likes ON social_post_likes(store_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_social_analytics_follows ON social_store_follows(store_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_social_analytics_actions ON social_actions(store_id,kind,created_at DESC);
  `)
}

let schemaPromise = null
function schemaReady() {
  if (!schemaPromise) schemaPromise = ensureSchema().catch((error) => { schemaPromise = null; throw error })
  return schemaPromise
}

if (pool) {
  const timer = setTimeout(() => void schemaReady().catch((error) => console.error('[social analytics] schema:', error.message)), 1700)
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
    req.socialAnalyticsStore = store
    next()
  } catch (error) { next(error) }
}

function number(row, key) { return Number(row?.[key] || 0) }
function percent(part, total) { return total > 0 ? Math.round((part / total) * 10000) / 100 : 0 }

async function socialReports(req, res) {
  await schemaReady()
  const storeId = req.socialAnalyticsStore.store_id
  const days = Math.max(1, Math.min(365, Math.floor(Number(req.query.days) || 30)))
  const params = [storeId, days]

  const summaryResult = await pool.query(`
    WITH engaged AS (
      SELECT visitor_key FROM social_post_likes WHERE store_id=$1 AND created_at>=now()-($2::int*interval '1 day')
      UNION
      SELECT visitor_key FROM social_actions WHERE store_id=$1 AND kind IN ('share','ask') AND created_at>=now()-($2::int*interval '1 day')
    ), asked AS (
      SELECT DISTINCT visitor_key FROM social_actions WHERE store_id=$1 AND kind='ask' AND created_at>=now()-($2::int*interval '1 day')
    )
    SELECT
      (SELECT COUNT(*)::int FROM products WHERE store_id=$1 AND active=true AND social_published=true) AS active_posts,
      (SELECT COUNT(DISTINCT visitor_key)::int FROM social_post_views WHERE store_id=$1 AND created_at>=now()-($2::int*interval '1 day')) AS reach,
      (SELECT COUNT(*)::int FROM social_post_views WHERE store_id=$1 AND created_at>=now()-($2::int*interval '1 day')) AS product_views,
      (SELECT COUNT(*)::int FROM social_post_likes WHERE store_id=$1 AND created_at>=now()-($2::int*interval '1 day')) AS likes,
      (SELECT COUNT(*)::int FROM social_actions WHERE store_id=$1 AND kind='share' AND created_at>=now()-($2::int*interval '1 day')) AS shares,
      (SELECT COUNT(*)::int FROM social_store_follows WHERE store_id=$1) AS followers,
      (SELECT COUNT(*)::int FROM social_store_follows WHERE store_id=$1 AND created_at>=now()-($2::int*interval '1 day')) AS new_followers,
      (SELECT COUNT(*)::int FROM social_actions WHERE store_id=$1 AND kind='ask' AND created_at>=now()-($2::int*interval '1 day')) AS asks,
      (SELECT COUNT(*)::int FROM engaged) AS engaged_visitors,
      (SELECT COUNT(*)::int FROM asked) AS ask_visitors
  `, params)
  const s = summaryResult.rows[0] || {}
  const reach = number(s, 'reach')
  const summary = {
    activePosts: number(s, 'active_posts'),
    reach,
    productViews: number(s, 'product_views'),
    likes: number(s, 'likes'),
    shares: number(s, 'shares'),
    followers: number(s, 'followers'),
    newFollowers: number(s, 'new_followers'),
    asks: number(s, 'asks'),
    engagedVisitors: number(s, 'engaged_visitors'),
    interactionRate: percent(number(s, 'engaged_visitors'), reach),
    askRate: percent(number(s, 'ask_visitors'), reach),
  }

  const productsResult = await pool.query(`
    WITH views AS (
      SELECT product_id,COUNT(*)::int AS views
      FROM social_post_views
      WHERE store_id=$1 AND created_at>=now()-($2::int*interval '1 day')
      GROUP BY product_id
    ), likes AS (
      SELECT product_id,COUNT(*)::int AS likes
      FROM social_post_likes
      WHERE store_id=$1 AND created_at>=now()-($2::int*interval '1 day')
      GROUP BY product_id
    ), actions AS (
      SELECT product_id,
        COUNT(*) FILTER (WHERE kind='share')::int AS shares,
        COUNT(*) FILTER (WHERE kind='ask')::int AS asks
      FROM social_actions
      WHERE store_id=$1 AND product_id IS NOT NULL AND kind IN ('share','ask') AND created_at>=now()-($2::int*interval '1 day')
      GROUP BY product_id
    )
    SELECT p.id,p.sku,p.name,
      COALESCE(v.views,0)::int AS views,
      COALESCE(l.likes,0)::int AS likes,
      COALESCE(a.shares,0)::int AS shares,
      COALESCE(a.asks,0)::int AS asks
    FROM products p
    LEFT JOIN views v ON v.product_id=p.id
    LEFT JOIN likes l ON l.product_id=p.id
    LEFT JOIN actions a ON a.product_id=p.id
    WHERE p.store_id=$1 AND (COALESCE(v.views,0)+COALESCE(l.likes,0)+COALESCE(a.shares,0)+COALESCE(a.asks,0))>0
    ORDER BY COALESCE(a.asks,0) DESC,(COALESCE(l.likes,0)+COALESCE(a.shares,0)) DESC,COALESCE(v.views,0) DESC,p.name ASC
    LIMIT 100
  `, params)
  const products = productsResult.rows.map((row) => ({
    id: row.id,
    sku: row.sku,
    name: row.name,
    views: number(row, 'views'),
    likes: number(row, 'likes'),
    shares: number(row, 'shares'),
    asks: number(row, 'asks'),
    askRate: percent(number(row, 'asks'), number(row, 'views')),
  }))

  const sellersResult = await pool.query(`
    SELECT a.seller_id,COALESCE(s.name,'WhatsApp principal') AS name,COALESCE(s.slug,'') AS slug,COUNT(*)::int AS asks
    FROM social_actions a
    LEFT JOIN sellers s ON s.id=a.seller_id
    WHERE a.store_id=$1 AND a.kind='ask' AND a.created_at>=now()-($2::int*interval '1 day')
    GROUP BY a.seller_id,s.name,s.slug
    ORDER BY asks DESC,name ASC
  `, params)
  const sellers = sellersResult.rows.map((row) => ({ sellerId: row.seller_id, name: row.name, slug: row.slug, asks: number(row, 'asks') }))

  return res.json({
    periodDays: days,
    interpretation: 'Visualizações, curtidas, compartilhamentos, seguidores e perguntas representam alcance e intenção dentro da rede Shopvax. Perguntas encaminhadas ao WhatsApp não representam venda ou faturamento confirmado.',
    summary,
    products,
    sellers,
  })
}

function install(app) {
  if (app.__shopvaxSocialAnalyticsInstalled) return
  app.__shopvaxSocialAnalyticsInstalled = true
  app.get('/api/admin/social-metrics', requireStore, (req, res, next) => Promise.resolve(socialReports(req, res)).catch(next))
}

const previousInit = express.application.init
express.application.init = function socialAnalyticsInit(...args) {
  const result = previousInit.apply(this, args)
  install(this)
  return result
}
