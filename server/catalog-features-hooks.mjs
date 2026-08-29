import crypto from 'node:crypto'
import express from 'express'
import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 8, connectionTimeoutMillis: 5000 }) : null
const sessionCookie = 'atacado_session'
const visitorCookie = 'atacado_public'
const cursorKey = crypto.randomBytes(32)
const rateBuckets = new Map()

if (pool) pool.on('error', (error) => console.error('[catalog features] pool:', error.message))

const id = () => crypto.randomUUID()
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex')
const digits = (value) => String(value || '').replace(/\D/g, '')
const toMoney = (value) => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0
}
const slugify = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'catalogo'

function parseCookies(req) {
  const header = req.headers.cookie || ''
  return Object.fromEntries(header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=')
    return index < 0 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))]
  }))
}

async function currentStore(req) {
  const token = parseCookies(req)[sessionCookie]
  if (!token || !pool) return null
  const result = await pool.query(
    `SELECT s.id AS store_id,u.id AS user_id,u.name,u.email
     FROM sessions se JOIN users u ON u.id=se.user_id JOIN stores s ON s.owner_id=u.id
     WHERE se.token_hash=$1 AND se.expires_at>now() LIMIT 1`,
    [hashToken(token)],
  )
  return result.rows[0] || null
}

async function requireStore(req, res, next) {
  try {
    const store = await currentStore(req)
    if (!store) return res.status(401).json({ error: 'Sessão necessária.' })
    req.catalogStore = store
    next()
  } catch (error) { next(error) }
}

async function ensureSchema() {
  if (!pool) throw new Error('DATABASE_URL não configurada.')
  await pool.query(`
    CREATE TABLE IF NOT EXISTS catalogs (
      id text PRIMARY KEY,
      store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      slug text NOT NULL,
      name text NOT NULL,
      kind text NOT NULL DEFAULT 'geral',
      minimum_order numeric(12,2),
      is_default boolean NOT NULL DEFAULT false,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(store_id,slug)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_default_per_store ON catalogs(store_id) WHERE is_default=true;
    CREATE TABLE IF NOT EXISTS catalog_products (
      catalog_id text NOT NULL REFERENCES catalogs(id) ON DELETE CASCADE,
      product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      price_override numeric(12,2),
      visible boolean NOT NULL DEFAULT true,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(catalog_id,product_id)
    );
    CREATE INDEX IF NOT EXISTS idx_catalog_products_visible ON catalog_products(catalog_id,visible,product_id);
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS catalog_id text REFERENCES catalogs(id) ON DELETE SET NULL;
  `)
}

let schemaPromise = null
function schemaReady() {
  if (!schemaPromise) schemaPromise = ensureSchema().catch((error) => { schemaPromise = null; throw error })
  return schemaPromise
}
if (pool) {
  const timer = setTimeout(() => void schemaReady().catch((error) => console.error('[catalog features] schema:', error.message)), 800)
  timer.unref()
}

async function ensureDefaultCatalog(storeId, client = pool) {
  let result = await client.query('SELECT * FROM catalogs WHERE store_id=$1 AND is_default=true LIMIT 1', [storeId])
  if (result.rowCount) return result.rows[0]
  try {
    result = await client.query(
      `INSERT INTO catalogs (id,store_id,slug,name,kind,is_default,active)
       VALUES ($1,$2,'geral','Catálogo geral','geral',true,true)
       RETURNING *`,
      [id(), storeId],
    )
    return result.rows[0]
  } catch (error) {
    if (error?.code !== '23505') throw error
    result = await client.query('SELECT * FROM catalogs WHERE store_id=$1 AND is_default=true LIMIT 1', [storeId])
    return result.rows[0]
  }
}

async function resolveCatalog(storeId, requestedSlug, client = pool) {
  await ensureDefaultCatalog(storeId, client)
  if (requestedSlug) {
    const result = await client.query('SELECT * FROM catalogs WHERE store_id=$1 AND slug=$2 AND active=true LIMIT 1', [storeId, requestedSlug])
    if (result.rowCount) return result.rows[0]
  }
  const result = await client.query('SELECT * FROM catalogs WHERE store_id=$1 AND is_default=true AND active=true LIMIT 1', [storeId])
  return result.rows[0] || null
}

function catalogShape(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    minimumOrder: row.minimum_order == null ? null : Number(row.minimum_order),
    isDefault: Boolean(row.is_default),
    active: Boolean(row.active),
  }
}

async function listCatalogs(req, res) {
  const storeId = req.catalogStore.store_id
  await ensureDefaultCatalog(storeId)
  const catalogs = await pool.query('SELECT * FROM catalogs WHERE store_id=$1 ORDER BY is_default DESC,created_at ASC', [storeId])
  const mappings = await pool.query(
    `SELECT cp.catalog_id,cp.product_id,cp.price_override,cp.visible
     FROM catalog_products cp JOIN catalogs c ON c.id=cp.catalog_id WHERE c.store_id=$1`,
    [storeId],
  )
  const byCatalog = new Map()
  for (const row of mappings.rows) {
    if (!byCatalog.has(row.catalog_id)) byCatalog.set(row.catalog_id, [])
    byCatalog.get(row.catalog_id).push({ productId: row.product_id, priceOverride: row.price_override == null ? null : Number(row.price_override), visible: Boolean(row.visible) })
  }
  return res.json({ catalogs: catalogs.rows.map((row) => ({ ...catalogShape(row), items: byCatalog.get(row.id) || [] })) })
}

async function createCatalog(req, res) {
  const storeId = req.catalogStore.store_id
  await ensureDefaultCatalog(storeId)
  const name = String(req.body?.name || '').trim().slice(0, 100)
  if (!name) return res.status(400).json({ error: 'Informe o nome do catálogo.' })
  const kind = ['atacado', 'varejo', 'geral'].includes(req.body?.kind) ? req.body.kind : 'geral'
  const minimumOrder = req.body?.minimumOrder === '' || req.body?.minimumOrder == null ? null : Math.max(0, toMoney(req.body.minimumOrder))
  const baseSlug = slugify(req.body?.slug || name)
  let slug = baseSlug
  for (let attempt = 2; attempt < 100; attempt += 1) {
    const exists = await pool.query('SELECT 1 FROM catalogs WHERE store_id=$1 AND slug=$2', [storeId, slug])
    if (!exists.rowCount) break
    slug = `${baseSlug}-${attempt}`.slice(0, 60)
  }
  const result = await pool.query(
    `INSERT INTO catalogs (id,store_id,slug,name,kind,minimum_order,is_default,active)
     VALUES ($1,$2,$3,$4,$5,$6,false,true) RETURNING *`,
    [id(), storeId, slug, name, kind, minimumOrder],
  )
  return res.status(201).json({ catalog: { ...catalogShape(result.rows[0]), items: [] } })
}

async function updateCatalog(req, res) {
  const storeId = req.catalogStore.store_id
  const existing = await pool.query('SELECT * FROM catalogs WHERE id=$1 AND store_id=$2 LIMIT 1', [req.params.catalogId, storeId])
  if (!existing.rowCount) return res.status(404).json({ error: 'Catálogo não encontrado.' })
  const current = existing.rows[0]
  const name = req.body?.name == null ? current.name : String(req.body.name).trim().slice(0, 100)
  if (!name) return res.status(400).json({ error: 'Informe o nome do catálogo.' })
  const kind = req.body?.kind == null ? current.kind : (['atacado', 'varejo', 'geral'].includes(req.body.kind) ? req.body.kind : current.kind)
  const minimumOrder = req.body?.minimumOrder === undefined ? current.minimum_order : (req.body.minimumOrder === '' || req.body.minimumOrder == null ? null : Math.max(0, toMoney(req.body.minimumOrder)))
  const active = current.is_default ? true : req.body?.active !== false
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const updated = await client.query(
      'UPDATE catalogs SET name=$1,kind=$2,minimum_order=$3,active=$4,updated_at=now() WHERE id=$5 AND store_id=$6 RETURNING *',
      [name, kind, minimumOrder, active, current.id, storeId],
    )
    if (Array.isArray(req.body?.items)) {
      for (const item of req.body.items.slice(0, 10000)) {
        const productId = String(item?.productId || '')
        if (!productId) continue
        const ownership = await client.query('SELECT 1 FROM products WHERE id=$1 AND store_id=$2', [productId, storeId])
        if (!ownership.rowCount) continue
        const priceOverride = item?.priceOverride === '' || item?.priceOverride == null ? null : Math.max(0, toMoney(item.priceOverride))
        await client.query(
          `INSERT INTO catalog_products (catalog_id,product_id,price_override,visible)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (catalog_id,product_id) DO UPDATE SET price_override=EXCLUDED.price_override,visible=EXCLUDED.visible,updated_at=now()`,
          [current.id, productId, priceOverride, item?.visible !== false],
        )
      }
    }
    await client.query('COMMIT')
    return res.json({ catalog: catalogShape(updated.rows[0]) })
  } catch (error) {
    try { await client.query('ROLLBACK') } catch {}
    throw error
  } finally { client.release() }
}

async function deleteCatalog(req, res) {
  const result = await pool.query('DELETE FROM catalogs WHERE id=$1 AND store_id=$2 AND is_default=false RETURNING id', [req.params.catalogId, req.catalogStore.store_id])
  if (!result.rowCount) return res.status(400).json({ error: 'O catálogo principal não pode ser excluído.' })
  return res.status(204).end()
}

function ensureVisitor(req, res) {
  let visitor = parseCookies(req)[visitorCookie]
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(visitor || '')) {
    visitor = crypto.randomBytes(24).toString('base64url')
    const secure = req.secure || req.headers['x-forwarded-proto'] === 'https'
    res.cookie(visitorCookie, visitor, { httpOnly: true, sameSite: 'lax', secure, maxAge: 24 * 60 * 60 * 1000, path: '/' })
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
  return checks.find((item) => !item.ok) || { ok: true, retryAfter: 0 }
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
    const [ivText, tagText, cipherText] = String(token || '').split('.')
    if (!ivText || !tagText || !cipherText) throw new Error('invalid')
    const iv = Buffer.from(ivText, 'base64url')
    const tag = Buffer.from(tagText, 'base64url')
    const ciphertext = Buffer.from(cipherText, 'base64url')
    const decipher = crypto.createDecipheriv('aes-256-gcm', cursorKey, iv)
    decipher.setAuthTag(tag)
    return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'))
  } catch { throw new Error('CURSOR_INVALID') }
}

function uniqueImages(row) {
  const values = [...(Array.isArray(row.images) ? row.images : []), row.media_type !== 'video' ? row.media_url : '']
  const seen = new Set()
  return values.map((value) => String(value || '').trim()).filter((value) => value && !seen.has(value) && seen.add(value)).slice(0, 40)
}

function publicProduct(product) {
  const images = uniqueImages(product)
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    description: product.description,
    price: Number(product.public_price ?? product.price),
    category: product.category,
    mediaUrl: product.media_url || images[0] || '',
    mediaType: product.media_type,
    images,
    variantImages: Array.isArray(product.variant_images) ? product.variant_images : [],
    pack: product.pack,
    variations: Array.isArray(product.variations) ? product.variations : [],
    featured: Boolean(product.featured),
    stockEnabled: Boolean(product.stock_enabled),
    stockQuantity: Math.max(0, Number(product.stock_quantity || 0)),
    variantStock: product.variant_stock && typeof product.variant_stock === 'object' ? product.variant_stock : {},
  }
}

function catalogFromReferer(req) {
  try {
    const ref = new URL(String(req.headers.referer || ''))
    return String(ref.searchParams.get('catalog') || '')
  } catch { return '' }
}

async function protectedStore(req, res) {
  if (!pool) return res.status(503).json({ error: 'Loja ainda não conectada ao banco.' })
  await schemaReady()
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

  const storeResult = await pool.query('SELECT * FROM stores WHERE slug=$1 AND is_active=true LIMIT 1', [req.params.storeSlug])
  if (!storeResult.rowCount) return res.status(404).json({ error: 'Loja não encontrada.' })
  const store = storeResult.rows[0]
  const requestedCatalog = String(req.query.catalog || catalogFromReferer(req) || '').trim().slice(0, 60)
  const catalog = await resolveCatalog(store.id, requestedCatalog)
  if (!catalog) return res.status(404).json({ error: 'Catálogo não encontrado.' })

  let seller = null
  if (req.params.sellerSlug) {
    const sellerResult = await pool.query('SELECT id,slug,name,phone FROM sellers WHERE store_id=$1 AND slug=$2 AND is_active=true LIMIT 1', [store.id, req.params.sellerSlug])
    seller = sellerResult.rows[0] || null
  }
  if (!seller) seller = { id: null, slug: '', name: 'Atendimento', phone: store.whatsapp }

  const q = String(req.query.q || '').trim().slice(0, 100)
  const category = String(req.query.category || '').trim().slice(0, 80)
  const requestedLimit = Number(req.query.limit || 24)
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(24, Math.floor(requestedLimit))) : 24
  let cursor = null
  if (req.query.cursor) {
    try { cursor = decodeCursor(req.query.cursor) } catch { return res.status(400).json({ error: 'Página inválida. Atualize a loja para continuar.' }) }
    const valid = cursor?.storeId === store.id && cursor?.visitor === visitor && cursor?.sellerSlug === String(req.params.sellerSlug || '') && cursor?.q === q && cursor?.category === category && cursor?.catalogSlug === catalog.slug && Number(cursor?.expiresAt || 0) > Date.now()
    if (!valid) return res.status(400).json({ error: 'Página inválida. Atualize a loja para continuar.' })
  }

  const params = [store.id, catalog.id]
  const conditions = ['p.store_id=$1', 'p.active=true', '(cp.visible IS NULL OR cp.visible=true)']
  if (category) { params.push(category); conditions.push(`p.category=$${params.length}`) }
  if (q) { params.push(`%${q.toLowerCase()}%`); conditions.push(`lower(p.name || ' ' || p.sku || ' ' || p.category) LIKE $${params.length}`) }
  if (cursor) {
    params.push(Number(cursor.featured || 0), cursor.createdAt, cursor.id)
    const featuredIndex = params.length - 2
    const createdIndex = params.length - 1
    const idIndex = params.length
    conditions.push(`(p.featured::int < $${featuredIndex} OR (p.featured::int=$${featuredIndex} AND p.created_at<$${createdIndex}::timestamptz) OR (p.featured::int=$${featuredIndex} AND p.created_at=$${createdIndex}::timestamptz AND p.id<$${idIndex}))`)
  }
  params.push(limit + 1)
  const productsResult = await pool.query(
    `SELECT p.*,p.created_at::text AS created_at_cursor,COALESCE(cp.price_override,p.price) AS public_price
     FROM products p LEFT JOIN catalog_products cp ON cp.product_id=p.id AND cp.catalog_id=$2
     WHERE ${conditions.join(' AND ')} ORDER BY p.featured DESC,p.created_at DESC,p.id DESC LIMIT $${params.length}`,
    params,
  )
  const hasMore = productsResult.rows.length > limit
  const pageRows = productsResult.rows.slice(0, limit)
  const last = pageRows.at(-1)
  const nextCursor = hasMore && last ? encodeCursor({ storeId: store.id, visitor, sellerSlug: String(req.params.sellerSlug || ''), q, category, catalogSlug: catalog.slug, featured: last.featured ? 1 : 0, createdAt: last.created_at_cursor, id: last.id, expiresAt: Date.now() + 30 * 60_000 }) : null
  const categoriesResult = await pool.query(
    `SELECT DISTINCT p.category FROM products p LEFT JOIN catalog_products cp ON cp.product_id=p.id AND cp.catalog_id=$2
     WHERE p.store_id=$1 AND p.active=true AND p.category<>'' AND (cp.visible IS NULL OR cp.visible=true) ORDER BY p.category ASC LIMIT 100`,
    [store.id, catalog.id],
  )
  const catalogsResult = await pool.query('SELECT * FROM catalogs WHERE store_id=$1 AND active=true ORDER BY is_default DESC,created_at ASC', [store.id])
  return res.json({
    store: { slug: store.slug, name: store.name, eyebrow: store.eyebrow, tagline: store.tagline, minimumOrder: catalog.minimum_order == null ? Number(store.minimum_order) : Number(catalog.minimum_order), whatsapp: store.whatsapp, logoUrl: store.logo_url, accent: store.accent },
    seller,
    catalogs: catalogsResult.rows.map(catalogShape),
    activeCatalog: catalogShape(catalog),
    categories: categoriesResult.rows.map((row) => row.category),
    products: pageRows.map(publicProduct),
    page: { hasMore, nextCursor, limit },
  })
}

function normalizeSelections(value) {
  return Object.fromEntries(Object.entries(value && typeof value === 'object' ? value : {}).map(([key, option]) => [String(key).trim().slice(0, 40), String(option).trim().slice(0, 60)]).filter(([key, option]) => key && option).sort(([a], [b]) => a.localeCompare(b, 'pt-BR')))
}
function variantKey(value) { return Object.entries(normalizeSelections(value)).map(([key, option]) => `${key}=${option}`).join('|') }
function clampStock(value) { return Math.max(0, Math.min(999999999, Math.floor(Number(value) || 0))) }
function normalizeVariantStock(value) {
  const result = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result
  for (const [key, qty] of Object.entries(value)) result[String(key).slice(0, 500)] = clampStock(qty)
  return result
}
function validateProductSelections(product, requested) {
  const selections = {}
  for (const group of Array.isArray(product.variations) ? product.variations : []) {
    const name = String(group?.name || '')
    const options = Array.isArray(group?.options) ? group.options.map(String) : []
    const selected = String(requested?.[name] || '')
    if (!selected || !options.includes(selected)) throw new Error(`Escolha ${name} para ${product.name}.`)
    selections[name] = selected
  }
  return normalizeSelections(selections)
}
function availableStock(product, selections) {
  if (!product.stock_enabled) return Number.POSITIVE_INFINITY
  const map = normalizeVariantStock(product.variant_stock)
  const key = variantKey(selections)
  return key && Object.prototype.hasOwnProperty.call(map, key) ? clampStock(map[key]) : clampStock(product.stock_quantity)
}

async function createCatalogOrder(req, res) {
  await schemaReady()
  const storeResult = await pool.query('SELECT * FROM stores WHERE slug=$1 AND is_active=true LIMIT 1', [String(req.body?.storeSlug || '')])
  if (!storeResult.rowCount) return res.status(404).json({ error: 'Loja não encontrada.' })
  const store = storeResult.rows[0]
  const catalog = await resolveCatalog(store.id, String(req.body?.catalogSlug || '').trim())
  if (!catalog) return res.status(404).json({ error: 'Catálogo não encontrado.' })
  const requestedItems = Array.isArray(req.body?.items) ? req.body.items : []
  if (!requestedItems.length) return res.status(400).json({ error: 'Carrinho vazio.' })
  const productIds = [...new Set(requestedItems.map((item) => String(item?.productId || '')).filter(Boolean))]
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const productsResult = await client.query(
      `SELECT p.*,COALESCE(cp.price_override,p.price) AS public_price,COALESCE(cp.visible,true) AS catalog_visible
       FROM products p LEFT JOIN catalog_products cp ON cp.product_id=p.id AND cp.catalog_id=$3
       WHERE p.store_id=$1 AND p.active=true AND p.id=ANY($2::text[]) ORDER BY p.id FOR UPDATE`,
      [store.id, productIds, catalog.id],
    )
    const byId = new Map(productsResult.rows.map((product) => [product.id, product]))
    const items = []
    let total = 0
    for (const requested of requestedItems) {
      const product = byId.get(String(requested?.productId || ''))
      if (!product || !product.catalog_visible) continue
      let selections
      try { selections = validateProductSelections(product, requested?.selections) }
      catch (error) { await client.query('ROLLBACK'); return res.status(400).json({ error: error.message }) }
      const quantity = Math.max(1, Math.min(999, Math.floor(Number(requested?.quantity) || 1)))
      const stock = availableStock(product, selections)
      if (stock < quantity) { await client.query('ROLLBACK'); return res.status(409).json({ error: stock <= 0 ? `${product.name} está sem estoque.` : `Restam apenas ${stock} unidade(s) de ${product.name} nessa variação.` }) }
      const unitPrice = Number(product.public_price)
      const lineTotal = toMoney(unitPrice * quantity)
      total += lineTotal
      items.push({ productId: product.id, sku: product.sku, name: product.name, quantity, unitPrice, lineTotal, selections, stockKey: variantKey(selections), catalogId: catalog.id })
      if (product.stock_enabled) {
        const map = normalizeVariantStock(product.variant_stock)
        const key = variantKey(selections)
        if (key && Object.prototype.hasOwnProperty.call(map, key)) {
          map[key] = clampStock(map[key] - quantity)
          await client.query('UPDATE products SET variant_stock=$1,updated_at=now() WHERE id=$2', [JSON.stringify(map), product.id])
          product.variant_stock = map
        } else {
          product.stock_quantity = clampStock(product.stock_quantity - quantity)
          await client.query('UPDATE products SET stock_quantity=$1,updated_at=now() WHERE id=$2', [product.stock_quantity, product.id])
        }
      }
    }
    total = toMoney(total)
    if (!items.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Nenhum produto válido no carrinho.' }) }
    const minimum = catalog.minimum_order == null ? Number(store.minimum_order) : Number(catalog.minimum_order)
    if (total < minimum) { await client.query('ROLLBACK'); return res.status(400).json({ error: `O pedido mínimo deste catálogo é R$ ${minimum.toFixed(2).replace('.', ',')}.` }) }
    let seller = null
    if (req.body?.sellerSlug) {
      const sellerResult = await client.query('SELECT * FROM sellers WHERE store_id=$1 AND slug=$2 AND is_active=true LIMIT 1', [store.id, req.body.sellerSlug])
      seller = sellerResult.rows[0] || null
    }
    const phone = digits(seller?.phone || store.whatsapp)
    if (phone.length < 10) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'A loja ainda não configurou um WhatsApp de atendimento.' }) }
    const code = `AS-${Date.now().toString().slice(-6)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`
    const orderId = id()
    await client.query('INSERT INTO orders (id,code,store_id,seller_id,catalog_id,total,items,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [orderId, code, store.id, seller?.id || null, catalog.id, total, JSON.stringify(items), 'whatsapp'])
    await client.query('INSERT INTO events (id,store_id,seller_id,kind) VALUES ($1,$2,$3,$4)', [id(), store.id, seller?.id || null, 'whatsapp'])
    await client.query('COMMIT')
    const formatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
    const lines = items.map((item) => `${item.quantity}x ${item.name}${Object.keys(item.selections).length ? ` (${Object.entries(item.selections).map(([key,value]) => `${key}: ${value}`).join(' · ')})` : ''} — ${formatter.format(item.lineTotal)}`)
    const message = [`Olá! Montei este pedido na ${store.name}:`, `Catálogo: ${catalog.name}`, '', ...lines, '', `Total dos produtos: ${formatter.format(total)}`, `Pedido: ${code}`, '', `Quero finalizar com ${seller?.name || 'atendimento'}.`].join('\n')
    return res.status(201).json({ code, orderId, catalog: catalogShape(catalog), whatsappUrl: `https://wa.me/${phone}?text=${encodeURIComponent(message)}` })
  } catch (error) {
    try { await client.query('ROLLBACK') } catch {}
    throw error
  } finally { client.release() }
}

function install(app) {
  if (app.__atacadoCatalogFeaturesInstalled) return
  app.__atacadoCatalogFeaturesInstalled = true
  app.get('/api/admin/catalogs', requireStore, (req, res, next) => Promise.resolve(listCatalogs(req, res)).catch(next))
  app.post('/api/admin/catalogs', express.json({ limit: '64kb' }), requireStore, (req, res, next) => Promise.resolve(createCatalog(req, res)).catch(next))
  app.patch('/api/admin/catalogs/:catalogId', express.json({ limit: '2mb' }), requireStore, (req, res, next) => Promise.resolve(updateCatalog(req, res)).catch(next))
  app.delete('/api/admin/catalogs/:catalogId', requireStore, (req, res, next) => Promise.resolve(deleteCatalog(req, res)).catch(next))
  app.get('/api/public/store/:storeSlug/:sellerSlug?', (req, res, next) => Promise.resolve(protectedStore(req, res)).catch(next))
  app.post('/api/business/orders', express.json({ limit: '256kb' }), (req, res, next) => Promise.resolve(createCatalogOrder(req, res)).catch(next))
}

const previousInit = express.application.init
express.application.init = function catalogFeaturesInit(...args) {
  const result = previousInit.apply(this, args)
  install(this)
  return result
}

const cleanup = setInterval(() => {
  const now = Date.now()
  for (const [key, bucket] of rateBuckets.entries()) if (bucket.resetAt <= now) rateBuckets.delete(key)
}, 60_000)
cleanup.unref()
