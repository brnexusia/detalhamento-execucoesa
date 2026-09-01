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

    CREATE OR REPLACE FUNCTION shopvax_touch_social_publication()
    RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        IF NEW.active = true THEN
          NEW.social_published := true;
          NEW.social_published_at := now();
        END IF;
      ELSIF NEW.active = true AND (
        OLD.active IS DISTINCT FROM NEW.active OR
        OLD.name IS DISTINCT FROM NEW.name OR
        OLD.description IS DISTINCT FROM NEW.description OR
        OLD.price IS DISTINCT FROM NEW.price OR
        OLD.category IS DISTINCT FROM NEW.category OR
        OLD.media_url IS DISTINCT FROM NEW.media_url OR
        OLD.media_type IS DISTINCT FROM NEW.media_type OR
        OLD.variations IS DISTINCT FROM NEW.variations
      ) THEN
        NEW.social_published := true;
        NEW.social_published_at := now();
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_shopvax_social_publication ON products;
    CREATE TRIGGER trg_shopvax_social_publication
      BEFORE INSERT OR UPDATE ON products
      FOR EACH ROW EXECUTE FUNCTION shopvax_touch_social_publication();
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

function planTier(value) {
  return ['ouro', 'prata'].includes(value) ? value : 'bronze'
}

function publicationShape(row) {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    category: row.category,
    mediaUrl: row.media_url,
    mediaType: row.media_type === 'video' ? 'video' : 'image',
    pack: row.pack,
    variations: Array.isArray(row.variations) ? row.variations : [],
    featured: Boolean(row.featured),
    publishedAt: row.social_published_at,
  }
}

function encodeFeedCursor(row) {
  return Buffer.from(JSON.stringify({ at: row.social_published_at, id: row.id }), 'utf8').toString('base64url')
}

function decodeFeedCursor(value) {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'))
    if (!parsed?.at || !parsed?.id || Number.isNaN(Date.parse(parsed.at))) throw new Error('invalid')
    return { at: new Date(parsed.at).toISOString(), id: String(parsed.id) }
  } catch { throw new Error('CURSOR_INVALID') }
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
      planTier: planTier(row.plan_tier),
      productCount: Number(row.product_count || 0),
    },
    stats: { followers: 0, views: 0 },
  }
}

async function publicStorePublications(slug) {
  await schemaReady()
  const store = await pool.query('SELECT id FROM stores WHERE slug=$1 AND is_active=true AND social_enabled=true LIMIT 1', [slug])
  if (!store.rowCount) return null
  const products = await pool.query(`
    SELECT id,sku,name,description,price,category,media_url,media_type,pack,variations,featured,social_published_at
    FROM products
    WHERE store_id=$1 AND active=true AND social_published=true
    ORDER BY social_published_at DESC,id DESC
    LIMIT 500
  `, [store.rows[0].id])
  return products.rows.map(publicationShape)
}

async function publicFeed(cursorValue, requestedLimit) {
  await schemaReady()
  const cursor = decodeFeedCursor(cursorValue)
  const limit = Math.max(1, Math.min(30, Math.floor(Number(requestedLimit) || 12)))
  const result = await pool.query(`
    SELECT p.id,p.sku,p.name,p.description,p.price,p.category,p.media_url,p.media_type,p.pack,p.variations,p.featured,p.social_published_at,
      s.id AS store_id,s.slug AS store_slug,s.name AS store_name,s.logo_url AS store_logo_url,s.accent AS store_accent,s.plan_tier
    FROM products p
    JOIN stores s ON s.id=p.store_id
    WHERE p.active=true AND p.social_published=true AND s.is_active=true AND s.social_enabled=true
      AND ($1::timestamptz IS NULL OR p.social_published_at < $1::timestamptz OR (p.social_published_at = $1::timestamptz AND p.id < $2))
    ORDER BY p.social_published_at DESC,p.id DESC
    LIMIT $3
  `, [cursor?.at || null, cursor?.id || '', limit + 1])
  const hasMore = result.rows.length > limit
  const rows = result.rows.slice(0, limit)
  return {
    posts: rows.map((row) => ({
      id: row.id,
      product: publicationShape(row),
      store: {
        id: row.store_id,
        slug: row.store_slug,
        name: row.store_name,
        logoUrl: row.store_logo_url,
        accent: row.store_accent,
        planTier: planTier(row.plan_tier),
      },
    })),
    page: { hasMore, nextCursor: hasMore && rows.length ? encodeFeedCursor(rows[rows.length - 1]) : null },
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

  app.get('/api/social/feed', async (req, res, next) => {
    try {
      return res.json(await publicFeed(req.query.cursor, req.query.limit))
    } catch (error) {
      if (error?.message === 'CURSOR_INVALID') return res.status(400).json({ error: 'Cursor inválido.' })
      next(error)
    }
  })

  app.get('/api/social/stores/:slug', async (req, res, next) => {
    try {
      const profile = await publicStoreProfile(String(req.params.slug || '').trim().slice(0, 80))
      if (!profile) return res.status(404).json({ error: 'Loja não encontrada.' })
      return res.json(profile)
    } catch (error) { next(error) }
  })

  app.get('/api/social/stores/:slug/publications', async (req, res, next) => {
    try {
      const publications = await publicStorePublications(String(req.params.slug || '').trim().slice(0, 80))
      if (!publications) return res.status(404).json({ error: 'Loja não encontrada.' })
      return res.json({ publications })
    } catch (error) { next(error) }
  })
}

const previousInit = express.application.init
express.application.init = function socialNetworkInit(...args) {
  const result = previousInit.apply(this, args)
  install(this)
  return result
}
