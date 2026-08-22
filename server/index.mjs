import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import multer from 'multer'
import pg from 'pg'

const { Pool } = pg
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const distDir = path.join(rootDir, 'dist')
const dataDir = process.env.DATA_DIR || '/data'
const uploadDir = path.join(dataDir, 'uploads')
const port = Number(process.env.PORT || 80)
const sessionCookie = 'atacado_session'
const sessionDays = 30

fs.mkdirSync(uploadDir, { recursive: true })

const databaseUrl = process.env.DATABASE_URL?.trim()
const pool = databaseUrl
  ? new Pool({ connectionString: databaseUrl, ssl: process.env.PGSSL === 'require' ? { rejectUnauthorized: false } : undefined })
  : process.env.PGHOST
    ? new Pool()
    : null

let dbReady = false
let dbError = null

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text UNIQUE NOT NULL,
  name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS stores (
  id text PRIMARY KEY,
  owner_id text UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  eyebrow text NOT NULL DEFAULT 'Atacado direto da loja',
  tagline text NOT NULL DEFAULT 'Escolha suas peças e envie o pedido para sua vendedora.',
  minimum_order numeric(12,2) NOT NULL DEFAULT 400,
  whatsapp text NOT NULL DEFAULT '',
  logo_url text NOT NULL DEFAULT '',
  accent text NOT NULL DEFAULT '#c94c2d',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sellers (
  id text PRIMARY KEY,
  store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  phone text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(store_id, slug)
);
CREATE TABLE IF NOT EXISTS products (
  id text PRIMARY KEY,
  store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  sku text NOT NULL DEFAULT '',
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  price numeric(12,2) NOT NULL,
  category text NOT NULL DEFAULT 'Geral',
  media_url text NOT NULL DEFAULT '',
  media_type text NOT NULL DEFAULT 'image',
  pack text NOT NULL DEFAULT '',
  variations jsonb NOT NULL DEFAULT '[]'::jsonb,
  featured boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS orders (
  id text PRIMARY KEY,
  code text UNIQUE NOT NULL,
  store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  seller_id text REFERENCES sellers(id) ON DELETE SET NULL,
  total numeric(12,2) NOT NULL,
  items jsonb NOT NULL,
  status text NOT NULL DEFAULT 'whatsapp',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS events (
  id text PRIMARY KEY,
  store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  seller_id text REFERENCES sellers(id) ON DELETE SET NULL,
  kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_products_store ON products(store_id);
CREATE INDEX IF NOT EXISTS idx_sellers_store ON sellers(store_id);
CREATE INDEX IF NOT EXISTS idx_orders_store_created ON orders(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_store_created ON events(store_id, created_at DESC);
`

async function initDb() {
  if (!pool) {
    dbError = 'DATABASE_URL não configurada.'
    return
  }
  try {
    await pool.query(schema)
    dbReady = true
    dbError = null
  } catch (error) {
    dbReady = false
    dbError = error instanceof Error ? error.message : String(error)
    console.error('[db] init failed:', dbError)
  }
}

await initDb()

const app = express()
app.set('trust proxy', 1)
app.use(express.json({ limit: '2mb' }))
app.use('/uploads', express.static(uploadDir, { maxAge: '7d' }))

function id() { return crypto.randomUUID() }
function slugify(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'loja'
}
function digits(value) { return String(value || '').replace(/\D/g, '') }
function toMoney(value) { const number = Number(value); return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0 }
function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex') }
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const derived = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${derived}`
}
function verifyPassword(password, stored) {
  try {
    const [salt, expectedHex] = stored.split(':')
    const actual = crypto.scryptSync(password, salt, 64)
    const expected = Buffer.from(expectedHex, 'hex')
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
  } catch { return false }
}
function parseCookies(req) {
  const header = req.headers.cookie || ''
  return Object.fromEntries(header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=')
    return index < 0 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))]
  }))
}
function setSessionCookie(req, res, token) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https'
  res.cookie(sessionCookie, token, { httpOnly: true, sameSite: 'lax', secure, maxAge: sessionDays * 24 * 60 * 60 * 1000, path: '/' })
}
function clearSessionCookie(req, res) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https'
  res.clearCookie(sessionCookie, { httpOnly: true, sameSite: 'lax', secure, path: '/' })
}
function requireDb(req, res, next) {
  if (!dbReady || !pool) return res.status(503).json({ error: 'Banco ainda não configurado.', detail: dbError })
  next()
}
async function auth(req, res, next) {
  if (!dbReady || !pool) return res.status(503).json({ error: 'Banco ainda não configurado.', detail: dbError })
  const token = parseCookies(req)[sessionCookie]
  if (!token) return res.status(401).json({ error: 'Sessão necessária.' })
  const result = await pool.query(`SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()`, [hashToken(token)])
  if (!result.rowCount) return res.status(401).json({ error: 'Sessão expirada.' })
  req.user = result.rows[0]
  next()
}
async function uniqueSlug(base, table, storeId = null, ignoreId = null) {
  let candidate = slugify(base)
  let suffix = 1
  while (true) {
    const params = [candidate]
    let sql = `SELECT id FROM ${table} WHERE slug=$1`
    if (storeId) { params.push(storeId); sql += ` AND store_id=$${params.length}` }
    if (ignoreId) { params.push(ignoreId); sql += ` AND id<>$${params.length}` }
    const found = await pool.query(sql, params)
    if (!found.rowCount) return candidate
    suffix += 1
    candidate = `${slugify(base)}-${suffix}`
  }
}
function normalizeVariations(value) {
  if (!Array.isArray(value)) return []
  return value.map((group) => ({
    name: String(group?.name || '').trim().slice(0, 40),
    options: Array.isArray(group?.options) ? group.options.map((option) => String(option).trim().slice(0, 60)).filter(Boolean).slice(0, 30) : [],
  })).filter((group) => group.name && group.options.length).slice(0, 5)
}
function publicStoreShape(store, seller, products) {
  return {
    store: { slug: store.slug, name: store.name, eyebrow: store.eyebrow, tagline: store.tagline, minimumOrder: Number(store.minimum_order), whatsapp: store.whatsapp, logoUrl: store.logo_url, accent: store.accent },
    seller,
    products: products.map((product) => ({ id: product.id, sku: product.sku, name: product.name, description: product.description, price: Number(product.price), category: product.category, mediaUrl: product.media_url, mediaType: product.media_type, pack: product.pack, variations: product.variations || [], featured: product.featured })),
  }
}

app.get('/health', (_req, res) => res.json({ ok: true, database: dbReady, databaseError: dbReady ? null : dbError }))

app.post('/api/auth/register', requireDb, async (req, res) => {
  const name = String(req.body?.name || '').trim()
  const email = String(req.body?.email || '').trim().toLowerCase()
  const password = String(req.body?.password || '')
  const storeName = String(req.body?.storeName || '').trim()
  const whatsapp = digits(req.body?.whatsapp)
  if (!name || !email || !storeName || password.length < 8) return res.status(400).json({ error: 'Preencha nome, e-mail, loja e uma senha de pelo menos 8 caracteres.' })
  const exists = await pool.query('SELECT id FROM users WHERE email=$1', [email])
  if (exists.rowCount) return res.status(409).json({ error: 'Esse e-mail já está cadastrado.' })
  const userId = id()
  const storeId = id()
  const storeSlug = await uniqueSlug(storeName, 'stores')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('INSERT INTO users (id,email,name,password_hash) VALUES ($1,$2,$3,$4)', [userId, email, name, hashPassword(password)])
    await client.query('INSERT INTO stores (id,owner_id,slug,name,whatsapp) VALUES ($1,$2,$3,$4,$5)', [storeId, userId, storeSlug, storeName, whatsapp])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    console.error(error)
    return res.status(500).json({ error: 'Não foi possível criar a conta.' })
  } finally { client.release() }
  const token = crypto.randomBytes(32).toString('base64url')
  await pool.query("INSERT INTO sessions (token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '30 days')", [hashToken(token), userId])
  setSessionCookie(req, res, token)
  res.status(201).json({ ok: true, storeSlug })
})

app.post('/api/auth/login', requireDb, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  const password = String(req.body?.password || '')
  const result = await pool.query('SELECT id,password_hash FROM users WHERE email=$1', [email])
  if (!result.rowCount || !verifyPassword(password, result.rows[0].password_hash)) return res.status(401).json({ error: 'E-mail ou senha inválidos.' })
  const token = crypto.randomBytes(32).toString('base64url')
  await pool.query('DELETE FROM sessions WHERE expires_at<=now()')
  await pool.query("INSERT INTO sessions (token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '30 days')", [hashToken(token), result.rows[0].id])
  setSessionCookie(req, res, token)
  res.json({ ok: true })
})

app.post('/api/auth/logout', async (req, res) => {
  const token = parseCookies(req)[sessionCookie]
  if (token && pool && dbReady) await pool.query('DELETE FROM sessions WHERE token_hash=$1', [hashToken(token)])
  clearSessionCookie(req, res)
  res.json({ ok: true })
})

app.get('/api/auth/me', auth, async (req, res) => {
  const store = await pool.query('SELECT * FROM stores WHERE owner_id=$1 LIMIT 1', [req.user.id])
  res.json({ user: req.user, store: store.rows[0] || null })
})

app.get('/api/admin/bootstrap', auth, async (req, res) => {
  const storeResult = await pool.query('SELECT * FROM stores WHERE owner_id=$1 LIMIT 1', [req.user.id])
  const store = storeResult.rows[0]
  if (!store) return res.status(404).json({ error: 'Loja não encontrada.' })
  const [products, sellers, orders, stats] = await Promise.all([
    pool.query('SELECT * FROM products WHERE store_id=$1 ORDER BY created_at DESC', [store.id]),
    pool.query('SELECT * FROM sellers WHERE store_id=$1 ORDER BY created_at ASC', [store.id]),
    pool.query('SELECT * FROM orders WHERE store_id=$1 ORDER BY created_at DESC LIMIT 100', [store.id]),
    pool.query(`SELECT (SELECT count(*)::int FROM events WHERE store_id=$1 AND kind='view') AS views,(SELECT count(*)::int FROM events WHERE store_id=$1 AND kind='cart') AS carts,(SELECT count(*)::int FROM orders WHERE store_id=$1) AS orders,(SELECT coalesce(sum(total),0)::numeric FROM orders WHERE store_id=$1) AS value`, [store.id]),
  ])
  res.json({ user: req.user, store: { ...store, minimum_order: Number(store.minimum_order) }, products: products.rows.map((item) => ({ ...item, price: Number(item.price) })), sellers: sellers.rows, orders: orders.rows.map((item) => ({ ...item, total: Number(item.total) })), stats: { ...stats.rows[0], value: Number(stats.rows[0]?.value || 0) } })
})

app.put('/api/admin/store', auth, async (req, res) => {
  const current = await pool.query('SELECT * FROM stores WHERE owner_id=$1 LIMIT 1', [req.user.id])
  if (!current.rowCount) return res.status(404).json({ error: 'Loja não encontrada.' })
  const store = current.rows[0]
  const desiredSlug = slugify(req.body?.slug || store.slug)
  const slug = desiredSlug === store.slug ? store.slug : await uniqueSlug(desiredSlug, 'stores', null, store.id)
  const name = String(req.body?.name || store.name).trim()
  const eyebrow = String(req.body?.eyebrow ?? store.eyebrow).trim().slice(0, 120)
  const tagline = String(req.body?.tagline ?? store.tagline).trim().slice(0, 240)
  const minimumOrder = Math.max(0, toMoney(req.body?.minimumOrder ?? store.minimum_order))
  const whatsapp = digits(req.body?.whatsapp ?? store.whatsapp)
  const logoUrl = String(req.body?.logoUrl ?? store.logo_url).trim().slice(0, 1000)
  const accent = /^#[0-9a-fA-F]{6}$/.test(req.body?.accent || '') ? req.body.accent : store.accent
  const updated = await pool.query('UPDATE stores SET slug=$1,name=$2,eyebrow=$3,tagline=$4,minimum_order=$5,whatsapp=$6,logo_url=$7,accent=$8,updated_at=now() WHERE id=$9 RETURNING *', [slug, name, eyebrow, tagline, minimumOrder, whatsapp, logoUrl, accent, store.id])
  res.json({ store: { ...updated.rows[0], minimum_order: Number(updated.rows[0].minimum_order) } })
})

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 8)
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`)
  },
})
const upload = multer({ storage, limits: { fileSize: 30 * 1024 * 1024 }, fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype) || /^video\//.test(file.mimetype)) })
app.post('/api/admin/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Envie uma imagem ou vídeo.' })
  res.status(201).json({ url: `/uploads/${req.file.filename}`, type: req.file.mimetype.startsWith('video/') ? 'video' : 'image' })
})

app.post('/api/admin/products', auth, async (req, res) => {
  const store = await pool.query('SELECT id FROM stores WHERE owner_id=$1 LIMIT 1', [req.user.id])
  const price = toMoney(req.body?.price)
  const name = String(req.body?.name || '').trim()
  if (!store.rowCount || !name || price <= 0) return res.status(400).json({ error: 'Nome e preço são obrigatórios.' })
  const result = await pool.query(`INSERT INTO products (id,store_id,sku,name,description,price,category,media_url,media_type,pack,variations,featured,active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`, [id(), store.rows[0].id, String(req.body?.sku || '').trim().slice(0, 80), name.slice(0, 180), String(req.body?.description || '').trim().slice(0, 2000), price, String(req.body?.category || 'Geral').trim().slice(0, 80) || 'Geral', String(req.body?.mediaUrl || '').trim().slice(0, 1000), req.body?.mediaType === 'video' ? 'video' : 'image', String(req.body?.pack || '').trim().slice(0, 160), JSON.stringify(normalizeVariations(req.body?.variations)), Boolean(req.body?.featured), req.body?.active !== false])
  res.status(201).json({ product: { ...result.rows[0], price: Number(result.rows[0].price) } })
})

app.put('/api/admin/products/:id', auth, async (req, res) => {
  const store = await pool.query('SELECT id FROM stores WHERE owner_id=$1 LIMIT 1', [req.user.id])
  if (!store.rowCount) return res.status(404).json({ error: 'Loja não encontrada.' })
  const price = toMoney(req.body?.price)
  const name = String(req.body?.name || '').trim()
  if (!name || price <= 0) return res.status(400).json({ error: 'Nome e preço são obrigatórios.' })
  const result = await pool.query(`UPDATE products SET sku=$1,name=$2,description=$3,price=$4,category=$5,media_url=$6,media_type=$7,pack=$8,variations=$9,featured=$10,active=$11,updated_at=now() WHERE id=$12 AND store_id=$13 RETURNING *`, [String(req.body?.sku || '').trim().slice(0, 80), name.slice(0, 180), String(req.body?.description || '').trim().slice(0, 2000), price, String(req.body?.category || 'Geral').trim().slice(0, 80) || 'Geral', String(req.body?.mediaUrl || '').trim().slice(0, 1000), req.body?.mediaType === 'video' ? 'video' : 'image', String(req.body?.pack || '').trim().slice(0, 160), JSON.stringify(normalizeVariations(req.body?.variations)), Boolean(req.body?.featured), req.body?.active !== false, req.params.id, store.rows[0].id])
  if (!result.rowCount) return res.status(404).json({ error: 'Produto não encontrado.' })
  res.json({ product: { ...result.rows[0], price: Number(result.rows[0].price) } })
})

app.delete('/api/admin/products/:id', auth, async (req, res) => {
  const store = await pool.query('SELECT id FROM stores WHERE owner_id=$1 LIMIT 1', [req.user.id])
  if (!store.rowCount) return res.status(404).json({ error: 'Loja não encontrada.' })
  await pool.query('DELETE FROM products WHERE id=$1 AND store_id=$2', [req.params.id, store.rows[0].id])
  res.json({ ok: true })
})

app.post('/api/admin/sellers', auth, async (req, res) => {
  const store = await pool.query('SELECT id FROM stores WHERE owner_id=$1 LIMIT 1', [req.user.id])
  const name = String(req.body?.name || '').trim()
  const phone = digits(req.body?.phone)
  if (!store.rowCount || !name || phone.length < 10) return res.status(400).json({ error: 'Nome e WhatsApp são obrigatórios.' })
  const slug = await uniqueSlug(req.body?.slug || name, 'sellers', store.rows[0].id)
  const result = await pool.query('INSERT INTO sellers (id,store_id,slug,name,phone,is_active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [id(), store.rows[0].id, slug, name.slice(0, 120), phone, req.body?.isActive !== false])
  res.status(201).json({ seller: result.rows[0] })
})

app.put('/api/admin/sellers/:id', auth, async (req, res) => {
  const store = await pool.query('SELECT id FROM stores WHERE owner_id=$1 LIMIT 1', [req.user.id])
  if (!store.rowCount) return res.status(404).json({ error: 'Loja não encontrada.' })
  const current = await pool.query('SELECT * FROM sellers WHERE id=$1 AND store_id=$2', [req.params.id, store.rows[0].id])
  if (!current.rowCount) return res.status(404).json({ error: 'Vendedora não encontrada.' })
  const name = String(req.body?.name || current.rows[0].name).trim()
  const phone = digits(req.body?.phone || current.rows[0].phone)
  const desired = slugify(req.body?.slug || current.rows[0].slug)
  const slug = desired === current.rows[0].slug ? desired : await uniqueSlug(desired, 'sellers', store.rows[0].id, req.params.id)
  const result = await pool.query('UPDATE sellers SET slug=$1,name=$2,phone=$3,is_active=$4 WHERE id=$5 AND store_id=$6 RETURNING *', [slug, name, phone, req.body?.isActive !== false, req.params.id, store.rows[0].id])
  res.json({ seller: result.rows[0] })
})

app.delete('/api/admin/sellers/:id', auth, async (req, res) => {
  const store = await pool.query('SELECT id FROM stores WHERE owner_id=$1 LIMIT 1', [req.user.id])
  if (!store.rowCount) return res.status(404).json({ error: 'Loja não encontrada.' })
  await pool.query('DELETE FROM sellers WHERE id=$1 AND store_id=$2', [req.params.id, store.rows[0].id])
  res.json({ ok: true })
})

async function getPublicStore(req, res) {
  if (!dbReady || !pool) return res.status(503).json({ error: 'Loja ainda não conectada ao banco.' })
  const storeResult = await pool.query('SELECT * FROM stores WHERE slug=$1 AND is_active=true LIMIT 1', [req.params.storeSlug])
  if (!storeResult.rowCount) return res.status(404).json({ error: 'Loja não encontrada.' })
  const store = storeResult.rows[0]
  let seller = null
  if (req.params.sellerSlug) {
    const sellerResult = await pool.query('SELECT id,slug,name,phone FROM sellers WHERE store_id=$1 AND slug=$2 AND is_active=true LIMIT 1', [store.id, req.params.sellerSlug])
    if (sellerResult.rowCount) seller = sellerResult.rows[0]
  }
  if (!seller) seller = { id: null, slug: '', name: 'Atendimento', phone: store.whatsapp }
  const products = await pool.query('SELECT * FROM products WHERE store_id=$1 AND active=true ORDER BY featured DESC,created_at DESC', [store.id])
  res.json(publicStoreShape(store, seller, products.rows))
}
app.get('/api/public/store/:storeSlug/:sellerSlug', getPublicStore)
app.get('/api/public/store/:storeSlug', getPublicStore)

app.post('/api/public/events', requireDb, async (req, res) => {
  const storeResult = await pool.query('SELECT id FROM stores WHERE slug=$1 AND is_active=true LIMIT 1', [String(req.body?.storeSlug || '')])
  if (!storeResult.rowCount) return res.status(204).end()
  let sellerId = null
  if (req.body?.sellerSlug) {
    const seller = await pool.query('SELECT id FROM sellers WHERE store_id=$1 AND slug=$2 LIMIT 1', [storeResult.rows[0].id, req.body.sellerSlug])
    sellerId = seller.rows[0]?.id || null
  }
  const kind = ['view', 'cart', 'whatsapp'].includes(req.body?.kind) ? req.body.kind : 'view'
  await pool.query('INSERT INTO events (id,store_id,seller_id,kind) VALUES ($1,$2,$3,$4)', [id(), storeResult.rows[0].id, sellerId, kind])
  res.status(204).end()
})

app.post('/api/public/orders', requireDb, async (req, res) => {
  const storeResult = await pool.query('SELECT * FROM stores WHERE slug=$1 AND is_active=true LIMIT 1', [String(req.body?.storeSlug || '')])
  if (!storeResult.rowCount) return res.status(404).json({ error: 'Loja não encontrada.' })
  const store = storeResult.rows[0]
  const requestedItems = Array.isArray(req.body?.items) ? req.body.items : []
  if (!requestedItems.length) return res.status(400).json({ error: 'Carrinho vazio.' })
  const productIds = [...new Set(requestedItems.map((item) => String(item.productId || '')).filter(Boolean))]
  const productsResult = await pool.query('SELECT * FROM products WHERE store_id=$1 AND active=true AND id=ANY($2::text[])', [store.id, productIds])
  const byId = new Map(productsResult.rows.map((product) => [product.id, product]))
  const items = []
  let total = 0
  for (const requested of requestedItems) {
    const product = byId.get(String(requested.productId || ''))
    if (!product) continue
    const quantity = Math.max(1, Math.min(999, Math.floor(Number(requested.quantity) || 1)))
    const allowedGroups = Array.isArray(product.variations) ? product.variations : []
    const selections = {}
    for (const group of allowedGroups) {
      const selected = String(requested.selections?.[group.name] || '')
      if (!group.options.includes(selected)) return res.status(400).json({ error: `Escolha ${group.name} para ${product.name}.` })
      selections[group.name] = selected
    }
    const unitPrice = Number(product.price)
    const lineTotal = unitPrice * quantity
    total += lineTotal
    items.push({ productId: product.id, sku: product.sku, name: product.name, quantity, unitPrice, lineTotal, selections })
  }
  total = toMoney(total)
  if (!items.length) return res.status(400).json({ error: 'Nenhum produto válido no carrinho.' })
  if (total < Number(store.minimum_order)) return res.status(400).json({ error: `O pedido mínimo é R$ ${Number(store.minimum_order).toFixed(2).replace('.', ',')}.` })
  let seller = null
  if (req.body?.sellerSlug) {
    const sellerResult = await pool.query('SELECT * FROM sellers WHERE store_id=$1 AND slug=$2 AND is_active=true LIMIT 1', [store.id, req.body.sellerSlug])
    seller = sellerResult.rows[0] || null
  }
  const phone = digits(seller?.phone || store.whatsapp)
  if (phone.length < 10) return res.status(400).json({ error: 'A loja ainda não configurou um WhatsApp de atendimento.' })
  const code = `AS-${Date.now().toString().slice(-6)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`
  await pool.query('INSERT INTO orders (id,code,store_id,seller_id,total,items) VALUES ($1,$2,$3,$4,$5,$6)', [id(), code, store.id, seller?.id || null, total, JSON.stringify(items)])
  await pool.query('INSERT INTO events (id,store_id,seller_id,kind) VALUES ($1,$2,$3,$4)', [id(), store.id, seller?.id || null, 'whatsapp'])
  const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
  const lines = items.map((item) => {
    const variations = Object.entries(item.selections).map(([key, value]) => `${key}: ${value}`).join(' · ')
    return `${item.quantity}x ${item.name}${variations ? ` (${variations})` : ''} — ${money.format(item.lineTotal)}`
  })
  const attendant = seller?.name || 'atendimento'
  const message = [`Olá! Montei este pedido na ${store.name}:`, '', ...lines, '', `Total dos produtos: ${money.format(total)}`, `Pedido: ${code}`, '', `Quero finalizar com ${attendant}.`].join('\n')
  res.status(201).json({ code, whatsappUrl: `https://wa.me/${phone}?text=${encodeURIComponent(message)}` })
})

app.use(express.static(distDir, { index: false, maxAge: '1h' }))
app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')))
app.use((error, _req, res, _next) => {
  console.error(error)
  if (error?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Arquivo maior que 30 MB.' })
  res.status(500).json({ error: 'Erro interno.' })
})
app.listen(port, '0.0.0.0', () => console.log(`[atacado-shop] listening on :${port} | db=${dbReady ? 'ready' : 'not-configured'}`))
