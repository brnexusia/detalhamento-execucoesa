import crypto from 'node:crypto'
import express from 'express'
import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 4, connectionTimeoutMillis: 5000 }) : null
const visitorCookie = 'shopvax_visitor'

if (pool) pool.on('error', (error) => console.error('[social commerce] pool:', error.message))

async function ensureSchema() {
  if (!pool) throw new Error('DATABASE_URL não configurada.')
  await pool.query(`
    CREATE TABLE IF NOT EXISTS social_seller_affinity (
      store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      visitor_key text NOT NULL,
      seller_id text NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(store_id,visitor_key)
    );
    CREATE INDEX IF NOT EXISTS idx_social_seller_affinity_seller ON social_seller_affinity(seller_id,updated_at DESC);
    ALTER TABLE social_actions ADD COLUMN IF NOT EXISTS seller_id text REFERENCES sellers(id) ON DELETE SET NULL;
  `)
}

let schemaPromise = null
function schemaReady() {
  if (!schemaPromise) schemaPromise = ensureSchema().catch((error) => { schemaPromise = null; throw error })
  return schemaPromise
}

if (pool) {
  const timer = setTimeout(() => void schemaReady().catch((error) => console.error('[social commerce] schema:', error.message)), 1500)
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

function digits(value) { return String(value || '').replace(/\D/g, '') }

async function sellerFor(storeId, key) {
  const existing = await pool.query(`
    SELECT s.id,s.slug,s.name,s.phone
    FROM social_seller_affinity a
    JOIN sellers s ON s.id=a.seller_id
    WHERE a.store_id=$1 AND a.visitor_key=$2 AND s.is_active=true
      AND length(regexp_replace(s.phone,'\\D','','g')) >= 10
    LIMIT 1
  `, [storeId, key])
  if (existing.rowCount) {
    await pool.query('UPDATE social_seller_affinity SET updated_at=now() WHERE store_id=$1 AND visitor_key=$2', [storeId, key])
    return existing.rows[0]
  }

  const selected = await pool.query(`
    SELECT s.id,s.slug,s.name,s.phone,COUNT(a.visitor_key)::int AS assignments
    FROM sellers s
    LEFT JOIN social_seller_affinity a ON a.seller_id=s.id
    WHERE s.store_id=$1 AND s.is_active=true
      AND length(regexp_replace(s.phone,'\\D','','g')) >= 10
    GROUP BY s.id
    ORDER BY COUNT(a.visitor_key) ASC,s.created_at ASC,s.id ASC
    LIMIT 1
  `, [storeId])
  if (!selected.rowCount) return null
  const seller = selected.rows[0]
  await pool.query(`
    INSERT INTO social_seller_affinity (store_id,visitor_key,seller_id)
    VALUES ($1,$2,$3)
    ON CONFLICT (store_id,visitor_key)
    DO UPDATE SET seller_id=EXCLUDED.seller_id,updated_at=now()
  `, [storeId, key, seller.id])
  return seller
}

async function askAboutProduct(productId, key) {
  await schemaReady()
  const result = await pool.query(`
    SELECT p.id,p.name,p.sku,p.price,
      s.id AS store_id,s.slug AS store_slug,s.name AS store_name,s.whatsapp
    FROM products p
    JOIN stores s ON s.id=p.store_id
    WHERE p.id=$1 AND p.active=true AND p.social_published=true
      AND s.is_active=true AND s.social_enabled=true
    LIMIT 1
  `, [productId])
  if (!result.rowCount) return null
  const row = result.rows[0]
  const seller = await sellerFor(row.store_id, key)
  const phone = digits(seller?.phone || row.whatsapp)
  if (phone.length < 10) {
    const error = new Error('NO_WHATSAPP')
    error.code = 'NO_WHATSAPP'
    throw error
  }

  const message = [
    `Olá! Vi o produto *${row.name}* no Shopvax e gostaria de saber mais.`,
    '',
    `Loja: ${row.store_name}`,
    row.sku ? `Referência: ${row.sku}` : '',
  ].filter(Boolean).join('\n')

  await pool.query(`
    INSERT INTO social_actions (id,product_id,store_id,visitor_key,kind,seller_id)
    VALUES ($1,$2,$3,$4,'ask',$5)
  `, [crypto.randomUUID(), row.id, row.store_id, key, seller?.id || null])

  return {
    whatsappUrl: `https://wa.me/${phone}?text=${encodeURIComponent(message)}`,
    product: { id: row.id, name: row.name, sku: row.sku, price: Number(row.price) },
    store: { id: row.store_id, slug: row.store_slug, name: row.store_name },
    seller: seller ? { id: seller.id, slug: seller.slug, name: seller.name } : { id: null, slug: '', name: 'Atendimento' },
  }
}

function install(app) {
  if (app.__shopvaxSocialCommerceInstalled) return
  app.__shopvaxSocialCommerceInstalled = true

  app.post('/api/social/posts/:productId/ask', async (req, res, next) => {
    try {
      const result = await askAboutProduct(String(req.params.productId || ''), visitorKey(req, res))
      if (!result) return res.status(404).json({ error: 'Publicação não encontrada.' })
      return res.json(result)
    } catch (error) {
      if (error?.code === 'NO_WHATSAPP') return res.status(409).json({ error: 'A loja ainda não configurou um WhatsApp de atendimento.' })
      next(error)
    }
  })
}

const previousInit = express.application.init
express.application.init = function socialCommerceInit(...args) {
  const result = previousInit.apply(this, args)
  install(this)
  return result
}
