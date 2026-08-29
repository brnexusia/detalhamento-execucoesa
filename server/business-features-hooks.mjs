import crypto from 'node:crypto'
import express from 'express'
import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 6, connectionTimeoutMillis: 5000 }) : null
const sessionCookie = 'atacado_session'

if (pool) pool.on('error', (error) => console.error('[business features] pool:', error.message))
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex')

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
    ALTER TABLE products ADD COLUMN IF NOT EXISTS images jsonb NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS variant_images jsonb NOT NULL DEFAULT '[]'::jsonb;
  `)
}

let schemaPromise = null
function schemaReady() {
  if (!schemaPromise) schemaPromise = ensureSchema().catch((error) => {
    schemaPromise = null
    throw error
  })
  return schemaPromise
}
if (pool) {
  const timer = setTimeout(() => void schemaReady().catch((error) => console.error('[business features] schema:', error.message)), 750)
  timer.unref()
}

function safeInt(value, fallback, min, max) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.floor(parsed)))
}

function uniqueImages(product) {
  const values = [
    ...(Array.isArray(product.images) ? product.images : []),
    product.media_type !== 'video' ? product.media_url : '',
  ]
  const result = []
  const seen = new Set()
  for (const raw of values) {
    const value = String(raw || '').trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    result.push(value)
    if (result.length >= 40) break
  }
  return result
}

function productShape(product) {
  const images = uniqueImages(product)
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    description: product.description,
    price: Number(product.price),
    category: product.category,
    mediaUrl: product.media_url || images[0] || '',
    mediaType: product.media_type === 'video' ? 'video' : 'image',
    images,
    variantImages: Array.isArray(product.variant_images) ? product.variant_images : [],
    pack: product.pack,
    variations: Array.isArray(product.variations) ? product.variations : [],
    featured: Boolean(product.featured),
  }
}

async function publicStore(req, res, next) {
  try {
    await schemaReady()
    const storeResult = await pool.query('SELECT * FROM stores WHERE slug=$1 AND is_active=true LIMIT 1', [req.params.storeSlug])
    if (!storeResult.rowCount) return res.status(404).json({ error: 'Loja não encontrada.' })
    const store = storeResult.rows[0]
    let seller = null
    if (req.params.sellerSlug) {
      const result = await pool.query('SELECT id,slug,name,phone FROM sellers WHERE store_id=$1 AND slug=$2 AND is_active=true LIMIT 1', [store.id, req.params.sellerSlug])
      seller = result.rows[0] || null
    }
    if (!seller) seller = { id: null, slug: '', name: 'Atendimento', phone: store.whatsapp }

    const limit = safeInt(req.query.limit, 12, 1, 60)
    const q = String(req.query.q || '').trim().slice(0, 120)
    const category = String(req.query.category || '').trim().slice(0, 80)
    const cursor = String(req.query.cursor || '').trim()
    const params = [store.id]
    const filters = ['store_id=$1', 'active=true']
    if (q) {
      params.push(`%${q}%`)
      filters.push(`(name ILIKE $${params.length} OR sku ILIKE $${params.length} OR category ILIKE $${params.length})`)
    }
    if (category) {
      params.push(category)
      filters.push(`category=$${params.length}`)
    }
    if (cursor) {
      const [createdAt, id] = cursor.split('|')
      if (createdAt && id) {
        params.push(createdAt, id)
        filters.push(`(created_at,id) < ($${params.length - 1}::timestamptz,$${params.length})`)
      }
    }
    params.push(limit + 1)
    const productsResult = await pool.query(
      `SELECT * FROM products WHERE ${filters.join(' AND ')} ORDER BY featured DESC,created_at DESC,id DESC LIMIT $${params.length}`,
      params,
    )
    const raw = productsResult.rows
    const hasMore = raw.length > limit
    const rows = raw.slice(0, limit)
    const last = rows.at(-1)
    const categoriesResult = await pool.query('SELECT DISTINCT category FROM products WHERE store_id=$1 AND active=true ORDER BY category ASC', [store.id])

    return res.json({
      store: {
        slug: store.slug,
        name: store.name,
        eyebrow: store.eyebrow,
        tagline: store.tagline,
        minimumOrder: Number(store.minimum_order),
        whatsapp: store.whatsapp,
        logoUrl: store.logo_url,
        accent: store.accent,
      },
      seller,
      categories: categoriesResult.rows.map((row) => row.category).filter(Boolean),
      products: rows.map(productShape),
      page: {
        hasMore,
        nextCursor: hasMore && last ? `${new Date(last.created_at).toISOString()}|${last.id}` : null,
        limit,
      },
    })
  } catch (error) {
    next(error)
  }
}

function install(app) {
  if (app.__atacadoBusinessFeaturesInstalled) return
  app.__atacadoBusinessFeaturesInstalled = true
  app.get('/api/public/store/:storeSlug/:sellerSlug', publicStore)
  app.get('/api/public/store/:storeSlug', publicStore)
}

const previousInit = express.application.init
express.application.init = function businessFeaturesInit(...args) {
  const result = previousInit.apply(this, args)
  install(this)
  return result
}
