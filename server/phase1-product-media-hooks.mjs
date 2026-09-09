import crypto from 'node:crypto'
import express from 'express'
import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 3, connectionTimeoutMillis: 5000 }) : null
const sessionCookies = ['shopvax_session', 'atacado_session']

if (pool) pool.on('error', (error) => console.error('[phase1-media] pool:', error.message))

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex')

function parseCookies(req) {
  const header = req.headers.cookie || ''
  return Object.fromEntries(header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=')
    return index < 0 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))]
  }))
}

function sessionToken(req) {
  const cookies = parseCookies(req)
  for (const name of sessionCookies) if (cookies[name]) return cookies[name]
  return ''
}

let schemaPromise = null
async function ensureSchema() {
  if (!pool) throw new Error('DATABASE_URL não configurada.')
  if (!schemaPromise) {
    schemaPromise = pool.query(`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS images jsonb NOT NULL DEFAULT '[]'::jsonb;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS variant_images jsonb NOT NULL DEFAULT '[]'::jsonb;
    `).finally(() => { schemaPromise = null })
  }
  return schemaPromise
}

async function currentStore(req) {
  await ensureSchema()
  const token = sessionToken(req)
  if (!token) return null
  const result = await pool.query(
    `SELECT s.id AS store_id,COALESCE(s.plan_tier,'bronze') AS plan_code
     FROM sessions se
     JOIN users u ON u.id=se.user_id
     JOIN stores s ON s.owner_id=u.id
     WHERE se.token_hash=$1 AND se.expires_at>now()
     LIMIT 1`,
    [hashToken(token)],
  )
  return result.rows[0] || null
}

async function requireStore(req, res, next) {
  try {
    const store = await currentStore(req)
    if (!store) return res.status(401).json({ error: 'Sessão necessária.' })
    req.phase1Store = store
    next()
  } catch (error) { next(error) }
}

function normalizeImages(value) {
  const source = Array.isArray(value) ? value : []
  const seen = new Set()
  const result = []
  for (const raw of source) {
    const image = String(raw || '').trim().slice(0, 1000)
    if (!image || seen.has(image)) continue
    if (!(image.startsWith('/media/') || /^https?:\/\//i.test(image))) continue
    seen.add(image)
    result.push(image)
    if (result.length >= 40) break
  }
  return result
}

async function photoLimit(planCode) {
  const result = await pool.query('SELECT photo_limit FROM platform_plans WHERE code=$1 AND active=true LIMIT 1', [planCode])
  const value = result.rows[0]?.photo_limit
  return value == null ? null : Math.max(1, Number(value))
}

async function updateGallery(req, res) {
  const store = req.phase1Store
  const existing = await pool.query(
    'SELECT id,media_url,media_type,images FROM products WHERE id=$1 AND store_id=$2 LIMIT 1',
    [req.params.productId, store.store_id],
  )
  if (!existing.rowCount) return res.status(404).json({ error: 'Produto não encontrado.' })

  const images = normalizeImages(req.body?.images)
  const max = await photoLimit(store.plan_code)
  if (max != null && images.length > max) {
    return res.status(409).json({ error: `Seu plano permite até ${max} fotos por produto.`, code: 'PLAN_PHOTO_LIMIT', max, current: images.length })
  }

  const current = existing.rows[0]
  const keepVideo = current.media_type === 'video' && String(current.media_url || '').trim()
  const mediaUrl = keepVideo ? current.media_url : (images[0] || '')
  const mediaType = keepVideo ? 'video' : 'image'

  const updated = await pool.query(
    `UPDATE products
     SET images=$1,media_url=$2,media_type=$3,updated_at=now()
     WHERE id=$4 AND store_id=$5
     RETURNING id,images,media_url,media_type`,
    [JSON.stringify(images), mediaUrl, mediaType, req.params.productId, store.store_id],
  )
  return res.json({ product: updated.rows[0], limit: max })
}

async function galleryInfo(req, res) {
  const store = req.phase1Store
  const result = await pool.query(
    'SELECT id,name,media_url,media_type,images FROM products WHERE id=$1 AND store_id=$2 LIMIT 1',
    [req.params.productId, store.store_id],
  )
  if (!result.rowCount) return res.status(404).json({ error: 'Produto não encontrado.' })
  const max = await photoLimit(store.plan_code)
  const product = result.rows[0]
  return res.json({
    product: {
      id: product.id,
      name: product.name,
      mediaUrl: product.media_url,
      mediaType: product.media_type,
      images: normalizeImages(product.images),
    },
    limit: max,
  })
}

function install(app) {
  if (app.__shopvaxPhase1MediaInstalled) return
  app.__shopvaxPhase1MediaInstalled = true
  app.get('/api/admin/products/:productId/gallery', requireStore, (req, res, next) => Promise.resolve(galleryInfo(req, res)).catch(next))
  app.patch('/api/admin/products/:productId/gallery', express.json({ limit: '128kb' }), requireStore, (req, res, next) => Promise.resolve(updateGallery(req, res)).catch(next))
  if (pool) void ensureSchema().catch((error) => console.error('[phase1-media] schema:', error.message))
}

const previousInit = express.application.init
express.application.init = function phase1ProductMediaInit(...args) {
  const result = previousInit.apply(this, args)
  install(this)
  return result
}
