import crypto from 'node:crypto'
import express from 'express'
import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 5000 }) : null
const visitorCookie = 'shopvax_visitor'

if (pool) pool.on('error', (error) => console.error('[social ranking] pool:', error.message))

let schemaPromise = null
function ensureSchema() {
  if (!schemaPromise) schemaPromise = (async () => {
    if (!pool) throw new Error('DATABASE_URL não configurada.')
    await pool.query(`
      ALTER TABLE stores ADD COLUMN IF NOT EXISTS social_enabled boolean NOT NULL DEFAULT true;
      ALTER TABLE stores ADD COLUMN IF NOT EXISTS plan_tier text NOT NULL DEFAULT 'bronze';
      ALTER TABLE products ADD COLUMN IF NOT EXISTS social_published boolean NOT NULL DEFAULT true;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS social_published_at timestamptz NOT NULL DEFAULT now();
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
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `)
  })().catch((error) => { schemaPromise = null; throw error })
  return schemaPromise
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

function encodeCursor(snapshot, slot) {
  return Buffer.from(JSON.stringify({ snapshot, slot }), 'utf8').toString('base64url')
}

function decodeCursor(value) {
  if (!value) return { snapshot: new Date().toISOString(), slot: 0 }
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'))
    if (!parsed?.snapshot || Number.isNaN(Date.parse(parsed.snapshot)) || !Number.isInteger(parsed.slot) || parsed.slot < 0) throw new Error('invalid')
    return { snapshot: new Date(parsed.snapshot).toISOString(), slot: parsed.slot }
  } catch { throw new Error('CURSOR_INVALID') }
}

function publication(row) {
  return {
    id: row.id,
    product: {
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
    },
    store: {
      id: row.store_id,
      slug: row.store_slug,
      name: row.store_name,
      logoUrl: row.store_logo_url,
      accent: row.store_accent,
      planTier: row.tier,
    },
    interactions: {
      views: Number(row.social_views || 0),
      likes: Number(row.social_likes || 0),
      shares: Number(row.social_shares || 0),
      followers: Number(row.social_followers || 0),
      liked: Boolean(row.social_liked),
      following: Boolean(row.social_following),
    },
  }
}

async function rankedFeed(req, res) {
  await ensureSchema()
  const cursor = decodeCursor(req.query.cursor)
  const limit = Math.max(1, Math.min(30, Math.floor(Number(req.query.limit) || 12)))
  const key = visitorKey(req, res)
  const result = await pool.query(`
    WITH base AS (
      SELECT p.id,p.sku,p.name,p.description,p.price,p.category,p.media_url,p.media_type,p.pack,p.variations,p.featured,p.social_published_at,
        s.id AS store_id,s.slug AS store_slug,s.name AS store_name,s.logo_url AS store_logo_url,s.accent AS store_accent,
        CASE WHEN s.plan_tier='ouro' THEN 'ouro' WHEN s.plan_tier='prata' THEN 'prata' ELSE 'bronze' END AS tier,
        ROW_NUMBER() OVER (
          PARTITION BY CASE WHEN s.plan_tier='ouro' THEN 'ouro' WHEN s.plan_tier='prata' THEN 'prata' ELSE 'bronze' END
          ORDER BY p.social_published_at DESC,p.id DESC
        )::bigint AS tier_pos,
        (SELECT COUNT(*)::int FROM social_post_views v WHERE v.product_id=p.id) AS social_views,
        (SELECT COUNT(*)::int FROM social_post_likes l WHERE l.product_id=p.id) AS social_likes,
        (SELECT COUNT(*)::int FROM social_actions a WHERE a.product_id=p.id AND a.kind='share') AS social_shares,
        (SELECT COUNT(*)::int FROM social_store_follows f WHERE f.store_id=s.id) AS social_followers,
        EXISTS(SELECT 1 FROM social_post_likes l WHERE l.product_id=p.id AND l.visitor_key=$4) AS social_liked,
        EXISTS(SELECT 1 FROM social_store_follows f WHERE f.store_id=s.id AND f.visitor_key=$4) AS social_following
      FROM products p
      JOIN stores s ON s.id=p.store_id
      WHERE p.active=true AND p.social_published=true AND s.is_active=true AND s.social_enabled=true
        AND p.social_published_at <= $1::timestamptz
    ), slotted AS (
      SELECT *, CASE tier
        WHEN 'ouro' THEN (((tier_pos-1)/3)*6 + CASE ((tier_pos-1)%3) WHEN 0 THEN 1 WHEN 1 THEN 3 ELSE 5 END)
        WHEN 'prata' THEN (((tier_pos-1)/2)*6 + CASE ((tier_pos-1)%2) WHEN 0 THEN 2 ELSE 6 END)
        ELSE ((tier_pos-1)*6 + 4)
      END::bigint AS feed_slot
      FROM base
    )
    SELECT * FROM slotted
    WHERE feed_slot > $2::bigint
    ORDER BY feed_slot ASC
    LIMIT $3
  `, [cursor.snapshot, cursor.slot, limit + 1, key])
  const hasMore = result.rows.length > limit
  const rows = result.rows.slice(0, limit)
  const lastSlot = rows.length ? Number(rows[rows.length - 1].feed_slot) : cursor.slot
  return {
    posts: rows.map(publication),
    page: { hasMore, nextCursor: hasMore ? encodeCursor(cursor.snapshot, lastSlot) : null },
    ranking: { version: 'plan-priority-v1', weights: { ouro: 3, prata: 2, bronze: 1 } },
  }
}

const previousGet = express.application.get
express.application.get = function socialRankingGet(path, ...handlers) {
  if (path === '/api/social/feed' && handlers.length) {
    return previousGet.call(this, path, async (req, res, next) => {
      try { return res.json(await rankedFeed(req, res)) }
      catch (error) {
        if (error?.message === 'CURSOR_INVALID') return res.status(400).json({ error: 'Cursor inválido.' })
        next(error)
      }
    })
  }
  return previousGet.call(this, path, ...handlers)
}
