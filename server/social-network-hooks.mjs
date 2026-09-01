import crypto from 'node:crypto'
import express from 'express'
import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 6, connectionTimeoutMillis: 5000 }) : null
const visitorCookie = 'shopvax_visitor'

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

    CREATE TABLE IF NOT EXISTS social_post_views (
      product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      visitor_key text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(product_id,visitor_key)
    );
    CREATE INDEX IF NOT EXISTS idx_social_post_views_store ON social_post_views(store_id,created_at DESC);

    CREATE TABLE IF NOT EXISTS social_post_likes (
      product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      visitor_key text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(product_id,visitor_key)
    );
    CREATE INDEX IF NOT EXISTS idx_social_post_likes_store ON social_post_likes(store_id,created_at DESC);

    CREATE TABLE IF NOT EXISTS social_store_follows (
      store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      visitor_key text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(store_id,visitor_key)
    );
    CREATE INDEX IF NOT EXISTS idx_social_store_follows_created ON social_store_follows(store_id,created_at DESC);

    CREATE TABLE IF NOT EXISTS social_actions (
      id text PRIMARY KEY,
      product_id text REFERENCES products(id) ON DELETE CASCADE,
      store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      visitor_key text NOT NULL,
      kind text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_social_actions_product_kind ON social_actions(product_id,kind,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_social_actions_store_kind ON social_actions(store_id,kind,created_at DESC);

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

function parseCookies(req) {
  const header = req.headers.cookie || ''
  return Object.fromEntries(header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=')
    return index < 0 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))]
  }))
}

function visitorKey(req, res) {
  let token = parseCookies(req)[visitorCookie]
  if (!/^[A-Za-z0-9_-]{24,100}$/.test(token || '')) {
    token = crypto.randomBytes(24).toString('base64url')
    const secure = req.secure || req.headers['x-forwarded-proto'] === 'https'
    res.cookie(visitorCookie, token, { httpOnly: true, sameSite: 'lax', secure, maxAge: 365 * 24 * 60 * 60 * 1000, path: '/' })
  }
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 40)
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

async function publicStoreProfile(slug, viewerKey) {
  await schemaReady()
  const result = await pool.query(`
    SELECT s.id,s.slug,s.name,s.tagline,s.eyebrow,s.logo_url,s.accent,s.plan_tier,
      COUNT(p.id) FILTER (WHERE p.active=true AND p.social_published=true)::int AS product_count,
      (SELECT COUNT(*)::int FROM social_store_follows f WHERE f.store_id=s.id) AS follower_count,
      (SELECT COUNT(*)::int FROM social_post_views v WHERE v.store_id=s.id) AS view_count,
      EXISTS(SELECT 1 FROM social_store_follows f WHERE f.store_id=s.id AND f.visitor_key=$2) AS following
    FROM stores s
    LEFT JOIN products p ON p.store_id=s.id
    WHERE s.slug=$1 AND s.is_active=true AND s.social_enabled=true
    GROUP BY s.id
    LIMIT 1
  `, [slug, viewerKey])
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
    stats: { followers: Number(row.follower_count || 0), views: Number(row.view_count || 0), following: Boolean(row.following) },
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

async function publicFeed(cursorValue, requestedLimit, viewerKey) {
  await schemaReady()
  const cursor = decodeFeedCursor(cursorValue)
  const limit = Math.max(1, Math.min(30, Math.floor(Number(requestedLimit) || 12)))
  const result = await pool.query(`
    SELECT p.id,p.sku,p.name,p.description,p.price,p.category,p.media_url,p.media_type,p.pack,p.variations,p.featured,p.social_published_at,
      s.id AS store_id,s.slug AS store_slug,s.name AS store_name,s.logo_url AS store_logo_url,s.accent AS store_accent,s.plan_tier,
      (SELECT COUNT(*)::int FROM social_post_views v WHERE v.product_id=p.id) AS social_views,
      (SELECT COUNT(*)::int FROM social_post_likes l WHERE l.product_id=p.id) AS social_likes,
      (SELECT COUNT(*)::int FROM social_actions a WHERE a.product_id=p.id AND a.kind='share') AS social_shares,
      (SELECT COUNT(*)::int FROM social_store_follows f WHERE f.store_id=s.id) AS social_followers,
      EXISTS(SELECT 1 FROM social_post_likes l WHERE l.product_id=p.id AND l.visitor_key=$4) AS social_liked,
      EXISTS(SELECT 1 FROM social_store_follows f WHERE f.store_id=s.id AND f.visitor_key=$4) AS social_following
    FROM products p
    JOIN stores s ON s.id=p.store_id
    WHERE p.active=true AND p.social_published=true AND s.is_active=true AND s.social_enabled=true
      AND ($1::timestamptz IS NULL OR p.social_published_at < $1::timestamptz OR (p.social_published_at = $1::timestamptz AND p.id < $2))
    ORDER BY p.social_published_at DESC,p.id DESC
    LIMIT $3
  `, [cursor?.at || null, cursor?.id || '', limit + 1, viewerKey])
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
      interactions: {
        views: Number(row.social_views || 0),
        likes: Number(row.social_likes || 0),
        shares: Number(row.social_shares || 0),
        followers: Number(row.social_followers || 0),
        liked: Boolean(row.social_liked),
        following: Boolean(row.social_following),
      },
    })),
    page: { hasMore, nextCursor: hasMore && rows.length ? encodeFeedCursor(rows[rows.length - 1]) : null },
  }
}

async function socialProduct(productId) {
  const result = await pool.query(`
    SELECT p.id,p.store_id FROM products p JOIN stores s ON s.id=p.store_id
    WHERE p.id=$1 AND p.active=true AND p.social_published=true AND s.is_active=true AND s.social_enabled=true LIMIT 1
  `, [productId])
  return result.rows[0] || null
}

async function viewPost(productId, key) {
  const product = await socialProduct(productId)
  if (!product) return null
  await pool.query(`INSERT INTO social_post_views (product_id,store_id,visitor_key) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [product.id, product.store_id, key])
  const count = await pool.query('SELECT COUNT(*)::int AS total FROM social_post_views WHERE product_id=$1', [product.id])
  return { views: Number(count.rows[0]?.total || 0) }
}

async function toggleLike(productId, key) {
  const product = await socialProduct(productId)
  if (!product) return null
  const removed = await pool.query('DELETE FROM social_post_likes WHERE product_id=$1 AND visitor_key=$2 RETURNING product_id', [product.id, key])
  let liked = false
  if (!removed.rowCount) {
    await pool.query(`INSERT INTO social_post_likes (product_id,store_id,visitor_key) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [product.id, product.store_id, key])
    liked = true
  }
  const count = await pool.query('SELECT COUNT(*)::int AS total FROM social_post_likes WHERE product_id=$1', [product.id])
  return { liked, likes: Number(count.rows[0]?.total || 0) }
}

async function sharePost(productId, key) {
  const product = await socialProduct(productId)
  if (!product) return null
  await pool.query(`INSERT INTO social_actions (id,product_id,store_id,visitor_key,kind) VALUES ($1,$2,$3,$4,'share')`, [crypto.randomUUID(), product.id, product.store_id, key])
  const count = await pool.query(`SELECT COUNT(*)::int AS total FROM social_actions WHERE product_id=$1 AND kind='share'`, [product.id])
  return { shares: Number(count.rows[0]?.total || 0) }
}

async function toggleFollow(storeId, key) {
  const store = await pool.query('SELECT id FROM stores WHERE id=$1 AND is_active=true AND social_enabled=true LIMIT 1', [storeId])
  if (!store.rowCount) return null
  const removed = await pool.query('DELETE FROM social_store_follows WHERE store_id=$1 AND visitor_key=$2 RETURNING store_id', [storeId, key])
  let following = false
  if (!removed.rowCount) {
    await pool.query('INSERT INTO social_store_follows (store_id,visitor_key) VALUES ($1,$2) ON CONFLICT DO NOTHING', [storeId, key])
    following = true
  }
  const count = await pool.query('SELECT COUNT(*)::int AS total FROM social_store_follows WHERE store_id=$1', [storeId])
  return { following, followers: Number(count.rows[0]?.total || 0) }
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
      return res.json(await publicFeed(req.query.cursor, req.query.limit, visitorKey(req, res)))
    } catch (error) {
      if (error?.message === 'CURSOR_INVALID') return res.status(400).json({ error: 'Cursor inválido.' })
      next(error)
    }
  })

  app.get('/api/social/stores/:slug', async (req, res, next) => {
    try {
      const profile = await publicStoreProfile(String(req.params.slug || '').trim().slice(0, 80), visitorKey(req, res))
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

  app.post('/api/social/posts/:productId/view', async (req, res, next) => {
    try {
      const result = await viewPost(String(req.params.productId || ''), visitorKey(req, res))
      if (!result) return res.status(404).json({ error: 'Publicação não encontrada.' })
      return res.json(result)
    } catch (error) { next(error) }
  })

  app.post('/api/social/posts/:productId/like', async (req, res, next) => {
    try {
      const result = await toggleLike(String(req.params.productId || ''), visitorKey(req, res))
      if (!result) return res.status(404).json({ error: 'Publicação não encontrada.' })
      return res.json(result)
    } catch (error) { next(error) }
  })

  app.post('/api/social/posts/:productId/share', async (req, res, next) => {
    try {
      const result = await sharePost(String(req.params.productId || ''), visitorKey(req, res))
      if (!result) return res.status(404).json({ error: 'Publicação não encontrada.' })
      return res.json(result)
    } catch (error) { next(error) }
  })

  app.post('/api/social/stores/:storeId/follow', async (req, res, next) => {
    try {
      const result = await toggleFollow(String(req.params.storeId || ''), visitorKey(req, res))
      if (!result) return res.status(404).json({ error: 'Loja não encontrada.' })
      return res.json(result)
    } catch (error) { next(error) }
  })
}

const previousInit = express.application.init
express.application.init = function socialNetworkInit(...args) {
  const result = previousInit.apply(this, args)
  install(this)
  return result
}
