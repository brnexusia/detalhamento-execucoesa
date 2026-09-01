import express from 'express'
import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 6, connectionTimeoutMillis: 5000 }) : null

if (pool) pool.on('error', (error) => console.error('[social network] pool:', error.message))

async function ensureSchema() {
  if (!pool) throw new Error('DATABASE_URL não configurada.')
  await pool.query(`
    ALTER TABLE stores ADD COLUMN IF NOT EXISTS social_enabled boolean NOT NULL DEFAULT true;
    ALTER TABLE stores ADD COLUMN IF NOT EXISTS plan_tier text NOT NULL DEFAULT 'bronze';
    ALTER TABLE products ADD COLUMN IF NOT EXISTS social_published boolean NOT NULL DEFAULT true;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS social_published_at timestamptz NOT NULL DEFAULT now();
    CREATE INDEX IF NOT EXISTS idx_stores_social_enabled ON stores(social_enabled,is_active,plan_tier);
    CREATE INDEX IF NOT EXISTS idx_products_social_feed ON products(social_published_at DESC,id) WHERE active=true AND social_published=true;
  `)
}

let schemaPromise = null
function schemaReady() {
  if (!schemaPromise) schemaPromise = ensureSchema().catch((error) => { schemaPromise = null; throw error })
  return schemaPromise
}

if (pool) {
  const timer = setTimeout(() => void schemaReady().catch((error) => console.error('[social network] schema:', error.message)), 1200)
  timer.unref()
}

async function publicStoreProfile(slug) {
  await schemaReady()
  const result = await pool.query(`
    SELECT s.id,s.slug,s.name,s.tagline,s.eyebrow,s.logo_url,s.accent,s.plan_tier,
      COUNT(p.id) FILTER (WHERE p.active=true AND p.social_published=true)::int AS product_count
    FROM stores s
    LEFT JOIN products p ON p.store_id=s.id
    WHERE s.slug=$1 AND s.is_active=true AND s.social_enabled=true
    GROUP BY s.id
    LIMIT 1
  `, [slug])
  if (!result.rowCount) return null
  const row = result.rows[0]
  return {
    store: {
      id: row.id,
      slug: row.slug,
      name: row.name,
      tagline: row.tagline,
      eyebrow: row.eyebrow,
      logoUrl: row.logo_url,
      accent: row.accent,
      planTier: ['ouro', 'prata'].includes(row.plan_tier) ? row.plan_tier : 'bronze',
      productCount: Number(row.product_count || 0),
    },
    stats: { followers: 0, views: 0 },
  }
}

function install(app) {
  if (app.__shopvaxSocialNetworkInstalled) return
  app.__shopvaxSocialNetworkInstalled = true

  app.get('/api/social/health', async (_req, res, next) => {
    try {
      await schemaReady()
      const result = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE social_enabled=true AND is_active=true)::int AS stores,
          (SELECT COUNT(*)::int FROM products WHERE active=true AND social_published=true) AS products
        FROM stores
      `)
      res.json({ ok: true, network: true, stores: Number(result.rows[0]?.stores || 0), products: Number(result.rows[0]?.products || 0) })
    } catch (error) { next(error) }
  })

  app.get('/api/social/stores/:slug', async (req, res, next) => {
    try {
      const profile = await publicStoreProfile(String(req.params.slug || '').trim().slice(0, 80))
      if (!profile) return res.status(404).json({ error: 'Loja não encontrada.' })
      return res.json(profile)
    } catch (error) { next(error) }
  })
}

const previousInit = express.application.init
express.application.init = function socialNetworkInit(...args) {
  const result = previousInit.apply(this, args)
  install(this)
  return result
}
