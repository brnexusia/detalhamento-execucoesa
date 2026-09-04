import crypto from 'node:crypto'
import express from 'express'
import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 5000 }) : null
const visitorCookie = 'atacado_public'
const cursorKey = crypto.randomBytes(32)
const rateBuckets = new Map()

if (pool) pool.on('error', (error) => console.error('[public protection] pool:', error.message))

function parseCookies(req) {
  const header = req.headers.cookie || ''
  return Object.fromEntries(header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=')
    return index < 0 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))]
  }))
}

function ensureVisitor(req, res) {
  let visitor = parseCookies(req)[visitorCookie]
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(visitor || '')) {
    visitor = crypto.randomBytes(24).toString('base64url')
    const secure = req.secure || req.headers['x-forwarded-proto'] === 'https'
    res.cookie(visitorCookie, visitor, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      maxAge: 24 * 60 * 60 * 1000,
      path: '/',
    })
  }
  return visitor
}

function consume(key, windowMs, limit) {
  const now = Date.now()
  const bucketKey = `${key}:${windowMs}`
  const current = rateBuckets.get(bucketKey)
  if (!current || current.resetAt <= now) {
    rateBuckets.set(bucketKey, { count: 1, resetAt: now + windowMs })
    return { ok: true, retryAfter: 0 }
  }
  current.count += 1
  if (current.count <= limit) return { ok: true, retryAfter: 0 }
  return { ok: false, retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) }
}

function checkCatalogRate(req, visitor) {
  const ip = String(req.ip || req.socket?.remoteAddress || 'unknown')
  const ua = String(req.headers['user-agent'] || '')
  const automation = /(curl|wget|python-requests|scrapy|go-http-client|httpclient|libwww|aiohttp)/i.test(ua)
  const checks = [
    consume(`visitor:${visitor}`, 20_000, automation ? 3 : 10),
    consume(`visitor:${visitor}`, 10 * 60_000, automation ? 10 : 50),
    consume(`ip:${ip}`, 20_000, 45),
    consume(`ip:${ip}`, 10 * 60_000, 240),
  ]
  const blocked = checks.find((item) => !item.ok)
  return blocked || { ok: true, retryAfter: 0 }
}

function encodeCursor(payload) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', cursorKey, iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv, tag, ciphertext].map((part) => part.toString('base64url')).join('.')
}

function decodeCursor(token) {
  try {
    const parts = String(token || '').split('.')
    if (parts.length !== 3) throw new Error('invalid')
    const [iv, tag, ciphertext] = parts.map((part) => Buffer.from(part, 'base64url'))
    if (iv.length !== 12 || tag.length !== 16 || !ciphertext.length) throw new Error('invalid')
    const decipher = crypto.createDecipheriv('aes-256-gcm', cursorKey, iv)
    decipher.setAuthTag(tag)
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    return JSON.parse(plain)
  } catch {
    throw new Error('CURSOR_INVALID')
  }
}

function publicProduct(product) {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    description: product.description,
    price: Number(product.price),
    category: product.category,
    mediaUrl: product.media_url,
    mediaType: product.media_type,
    pack: product.pack,
    variations: Array.isArray(product.variations) ? product.variations : [],
    featured: Boolean(product.featured),
  }
}

async function protectedStore(req, res) {
  if (!pool) return res.status(503).json({ error: 'Loja ainda não conectada ao banco.' })

  const visitor = ensureVisitor(req, res)
  const rate = checkCatalogRate(req, visitor)
  if (!rate.ok) {
    res.setHeader('Retry-After', String(rate.retryAfter))
    return res.status(429).json({ error: 'Navegação muito rápida. Aguarde alguns segundos e continue.' })
  }

  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('X-Robots-Tag', 'noindex, noarchive, nosnippet')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Vary', 'Cookie')

  const storeResult = await pool.query(
    'SELECT * FROM stores WHERE slug=$1 AND is_active=true LIMIT 1',
    [req.params.storeSlug],
  )
  if (!storeResult.rowCount) return res.status(404).json({ error: 'Loja não encontrada.' })
  const store = storeResult.rows[0]

  let seller = null
  if (req.params.sellerSlug) {
    const sellerResult = await pool.query(
      'SELECT id,slug,name,phone FROM sellers WHERE store_id=$1 AND slug=$2 AND is_active=true LIMIT 1',
      [store.id, req.params.sellerSlug],
    )
    if (sellerResult.rowCount) seller = sellerResult.rows[0]
  }
  if (!seller) seller = { id: null, slug: '', name: 'Atendimento', phone: store.whatsapp }

  const q = String(req.query.q || '').trim().slice(0, 100)
  const category = String(req.query.category || '').trim().slice(0, 80)
  const requestedLimit = Number(req.query.limit || 24)
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(24, Math.floor(requestedLimit))) : 24
  let cursor = null

  if (req.query.cursor) {
    try { cursor = decodeCursor(req.query.cursor) }
    catch { return res.status(400).json({ error: 'Página inválida. Atualize a loja para continuar.' }) }
    const valid = cursor?.storeId === store.id &&
      cursor?.visitor === visitor &&
      cursor?.sellerSlug === String(req.params.sellerSlug || '') &&
      cursor?.q === q && cursor?.category === category &&
      Number(cursor?.expiresAt || 0) > Date.now()
    if (!valid) return res.status(400).json({ error: 'Página inválida. Atualize a loja para continuar.' })
  }

  const params = [store.id]
  const conditions = ['store_id=$1', 'active=true']
  if (category) {
    params.push(category)
    conditions.push(`category=$${params.length}`)
  }
  if (q) {
    params.push(`%${q.toLowerCase()}%`)
    conditions.push(`lower(name || ' ' || sku || ' ' || category) LIKE $${params.length}`)
  }
  if (cursor) {
    params.push(Number(cursor.featured || 0), cursor.createdAt, cursor.id)
    const featuredIndex = params.length - 2
    const createdIndex = params.length - 1
    const idIndex = params.length
    conditions.push(`(
      featured::int < $${featuredIndex}
      OR (featured::int = $${featuredIndex} AND created_at < $${createdIndex}::timestamptz)
      OR (featured::int = $${featuredIndex} AND created_at = $${createdIndex}::timestamptz AND id < $${idIndex})
    )`)
  }
  params.push(limit + 1)
  const productsResult = await pool.query(
    `SELECT id,sku,name,description,price,category,media_url,media_type,pack,variations,featured,created_at,
            created_at::text AS created_at_cursor
     FROM products
     WHERE ${conditions.join(' AND ')}
     ORDER BY featured DESC,created_at DESC,id DESC
     LIMIT $${params.length}`,
    params,
  )

  const hasMore = productsResult.rows.length > limit
  const pageRows = productsResult.rows.slice(0, limit)
  const last = pageRows[pageRows.length - 1]
  const nextCursor = hasMore && last ? encodeCursor({
    storeId: store.id,
    visitor,
    sellerSlug: String(req.params.sellerSlug || ''),
    q,
    category,
    featured: last.featured ? 1 : 0,
    createdAt: last.created_at_cursor,
    id: last.id,
    expiresAt: Date.now() + 30 * 60_000,
  }) : null

  const categoriesResult = await pool.query(
    `SELECT DISTINCT category FROM products WHERE store_id=$1 AND active=true AND category<>'' ORDER BY category ASC LIMIT 100`,
    [store.id],
  )

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
    categories: categoriesResult.rows.map((row) => row.category),
    products: pageRows.map(publicProduct),
    page: { hasMore, nextCursor, limit },
  })
}

function installProtection(app) {
  if (app.__atacadoPublicProtectionInstalled) return
  app.__atacadoPublicProtectionInstalled = true

  app.use((req, res, next) => {
    if (req.path.startsWith('/api/public/')) {
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    }
    if (req.path.startsWith('/media/')) {
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
      res.setHeader('X-Content-Type-Options', 'nosniff')
    }
    next()
  })

  app.get('/robots.txt', (_req, res) => {
    res.type('text/plain').send('User-agent: *\nDisallow: /api/\n')
  })
  app.get('/api/public/store/:storeSlug/:sellerSlug?', (req, res, next) => {
    Promise.resolve(protectedStore(req, res)).catch(next)
  })
}

const originalInit = express.application.init
express.application.init = function publicProtectionPatchedInit(...args) {
  const result = originalInit.apply(this, args)
  installProtection(this)
  return result
}

const cleanup = setInterval(() => {
  const now = Date.now()
  for (const [key, bucket] of rateBuckets.entries()) {
    if (bucket.resetAt <= now) rateBuckets.delete(key)
  }
}, 60_000)
cleanup.unref()
