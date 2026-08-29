import crypto from 'node:crypto'
import express from 'express'
import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 8, connectionTimeoutMillis: 5000 }) : null
const sessionCookie = 'atacado_session'

if (pool) pool.on('error', (error) => console.error('[business features] pool:', error.message))

const id = () => crypto.randomUUID()
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex')
const digits = (value) => String(value || '').replace(/\D/g, '')
const toMoney = (value) => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0
}

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
    req.businessStore = store
    next()
  } catch (error) { next(error) }
}

function normalizeSelections(value) {
  const entries = Object.entries(value && typeof value === 'object' ? value : {})
    .map(([key, option]) => [String(key).trim().slice(0, 40), String(option).trim().slice(0, 60)])
    .filter(([key, option]) => key && option)
    .sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))
  return Object.fromEntries(entries)
}

function variantKey(value) {
  return Object.entries(normalizeSelections(value)).map(([key, option]) => `${key}=${option}`).join('|')
}

function clampStock(value) {
  const number = Math.floor(Number(value) || 0)
  return Math.max(0, Math.min(999999999, number))
}

function normalizeVariantStock(value) {
  const result = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result
  for (const [rawKey, rawQty] of Object.entries(value)) {
    const key = String(rawKey || '').trim().slice(0, 500)
    if (!key) continue
    result[key] = clampStock(rawQty)
    if (Object.keys(result).length >= 1000) break
  }
  return result
}

async function ensureSchema() {
  if (!pool) throw new Error('DATABASE_URL não configurada.')
  await pool.query(`
    ALTER TABLE products ADD COLUMN IF NOT EXISTS images jsonb NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS variant_images jsonb NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_enabled boolean NOT NULL DEFAULT false;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_quantity integer NOT NULL DEFAULT 0;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS variant_stock jsonb NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS stock_reverted boolean NOT NULL DEFAULT false;
    CREATE INDEX IF NOT EXISTS idx_products_stock_enabled ON products(store_id,stock_enabled) WHERE active=true;
  `)
}

let schemaPromise = null
function schemaReady() {
  if (!schemaPromise) schemaPromise = ensureSchema().catch((error) => { schemaPromise = null; throw error })
  return schemaPromise
}
if (pool) {
  const timer = setTimeout(() => void schemaReady().catch((error) => console.error('[business features] schema:', error.message)), 750)
  timer.unref()
}

function uniqueImages(row, fallback) {
  const values = [...(Array.isArray(row?.images) ? row.images : []), fallback || '']
  const seen = new Set()
  return values.map((value) => String(value || '').trim()).filter((value) => value && !seen.has(value) && seen.add(value)).slice(0, 40)
}

function availableStock(product, selections) {
  if (!product.stock_enabled) return Number.POSITIVE_INFINITY
  const map = product.variant_stock && typeof product.variant_stock === 'object' && !Array.isArray(product.variant_stock) ? product.variant_stock : {}
  const key = variantKey(selections)
  if (key && Object.prototype.hasOwnProperty.call(map, key)) return clampStock(map[key])
  return clampStock(product.stock_quantity)
}

function validateProductSelections(product, requested) {
  const groups = Array.isArray(product.variations) ? product.variations : []
  const selections = {}
  for (const group of groups) {
    const name = String(group?.name || '')
    const options = Array.isArray(group?.options) ? group.options.map(String) : []
    const selected = String(requested?.[name] || '')
    if (!selected || !options.includes(selected)) throw new Error(`Escolha ${name} para ${product.name}.`)
    selections[name] = selected
  }
  return normalizeSelections(selections)
}

async function updateStock(req, res) {
  const enabled = req.body?.enabled === true
  const quantity = clampStock(req.body?.quantity)
  const variantStock = normalizeVariantStock(req.body?.variantStock)
  const result = await pool.query(
    `UPDATE products SET stock_enabled=$1,stock_quantity=$2,variant_stock=$3,updated_at=now()
     WHERE id=$4 AND store_id=$5 RETURNING id,stock_enabled,stock_quantity,variant_stock`,
    [enabled, quantity, JSON.stringify(variantStock), req.params.productId, req.businessStore.store_id],
  )
  if (!result.rowCount) return res.status(404).json({ error: 'Produto não encontrado.' })
  return res.json({ product: result.rows[0] })
}

async function createStockOrder(req, res) {
  const storeResult = await pool.query('SELECT * FROM stores WHERE slug=$1 AND is_active=true LIMIT 1', [String(req.body?.storeSlug || '')])
  if (!storeResult.rowCount) return res.status(404).json({ error: 'Loja não encontrada.' })
  const store = storeResult.rows[0]
  const requestedItems = Array.isArray(req.body?.items) ? req.body.items : []
  if (!requestedItems.length) return res.status(400).json({ error: 'Carrinho vazio.' })
  const productIds = [...new Set(requestedItems.map((item) => String(item?.productId || '')).filter(Boolean))]
  if (!productIds.length) return res.status(400).json({ error: 'Carrinho vazio.' })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const productsResult = await client.query(
      'SELECT * FROM products WHERE store_id=$1 AND active=true AND id=ANY($2::text[]) ORDER BY id FOR UPDATE',
      [store.id, productIds],
    )
    const byId = new Map(productsResult.rows.map((product) => [product.id, product]))
    const items = []
    let total = 0

    for (const requested of requestedItems) {
      const product = byId.get(String(requested?.productId || ''))
      if (!product) continue
      let selections
      try { selections = validateProductSelections(product, requested?.selections) }
      catch (error) {
        await client.query('ROLLBACK')
        return res.status(400).json({ error: error.message })
      }
      const quantity = Math.max(1, Math.min(999, Math.floor(Number(requested?.quantity) || 1)))
      const stock = availableStock(product, selections)
      if (stock < quantity) {
        await client.query('ROLLBACK')
        return res.status(409).json({ error: stock <= 0 ? `${product.name} está sem estoque.` : `Restam apenas ${stock} unidade(s) de ${product.name} nessa variação.` })
      }
      const unitPrice = Number(product.price)
      const lineTotal = toMoney(unitPrice * quantity)
      total += lineTotal
      items.push({ productId: product.id, sku: product.sku, name: product.name, quantity, unitPrice, lineTotal, selections, stockKey: variantKey(selections) })

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
    if (!items.length) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'Nenhum produto válido no carrinho.' })
    }
    if (total < Number(store.minimum_order)) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: `O pedido mínimo é R$ ${Number(store.minimum_order).toFixed(2).replace('.', ',')}.` })
    }

    let seller = null
    if (req.body?.sellerSlug) {
      const sellerResult = await client.query('SELECT * FROM sellers WHERE store_id=$1 AND slug=$2 AND is_active=true LIMIT 1', [store.id, req.body.sellerSlug])
      seller = sellerResult.rows[0] || null
    }
    const phone = digits(seller?.phone || store.whatsapp)
    if (phone.length < 10) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'A loja ainda não configurou um WhatsApp de atendimento.' })
    }

    const code = `AS-${Date.now().toString().slice(-6)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`
    const orderId = id()
    await client.query('INSERT INTO orders (id,code,store_id,seller_id,total,items,status) VALUES ($1,$2,$3,$4,$5,$6,$7)', [orderId, code, store.id, seller?.id || null, total, JSON.stringify(items), 'whatsapp'])
    await client.query('INSERT INTO events (id,store_id,seller_id,kind) VALUES ($1,$2,$3,$4)', [id(), store.id, seller?.id || null, 'whatsapp'])
    await client.query('COMMIT')

    const formatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
    const lines = items.map((item) => {
      const variations = Object.entries(item.selections).map(([key, value]) => `${key}: ${value}`).join(' · ')
      return `${item.quantity}x ${item.name}${variations ? ` (${variations})` : ''} — ${formatter.format(item.lineTotal)}`
    })
    const attendant = seller?.name || 'atendimento'
    const message = [`Olá! Montei este pedido na ${store.name}:`, '', ...lines, '', `Total dos produtos: ${formatter.format(total)}`, `Pedido: ${code}`, '', `Quero finalizar com ${attendant}.`].join('\n')
    return res.status(201).json({ code, orderId, whatsappUrl: `https://wa.me/${phone}?text=${encodeURIComponent(message)}` })
  } catch (error) {
    try { await client.query('ROLLBACK') } catch {}
    throw error
  } finally { client.release() }
}

async function cancelOrder(req, res) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const orderResult = await client.query('SELECT * FROM orders WHERE id=$1 AND store_id=$2 FOR UPDATE', [req.params.orderId, req.businessStore.store_id])
    if (!orderResult.rowCount) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Pedido não encontrado.' })
    }
    const order = orderResult.rows[0]
    if (order.stock_reverted) {
      await client.query('COMMIT')
      return res.json({ order: { id: order.id, status: order.status, stock_reverted: true }, idempotent: true })
    }
    const items = Array.isArray(order.items) ? order.items : []
    const ids = [...new Set(items.map((item) => String(item.productId || '')).filter(Boolean))]
    if (ids.length) {
      const products = await client.query('SELECT * FROM products WHERE store_id=$1 AND id=ANY($2::text[]) ORDER BY id FOR UPDATE', [req.businessStore.store_id, ids])
      const byId = new Map(products.rows.map((product) => [product.id, product]))
      for (const item of items) {
        const product = byId.get(String(item.productId || ''))
        if (!product?.stock_enabled) continue
        const quantity = Math.max(0, Math.floor(Number(item.quantity) || 0))
        if (!quantity) continue
        const map = normalizeVariantStock(product.variant_stock)
        const key = String(item.stockKey || variantKey(item.selections))
        if (key && Object.prototype.hasOwnProperty.call(map, key)) {
          map[key] = clampStock(map[key] + quantity)
          await client.query('UPDATE products SET variant_stock=$1,updated_at=now() WHERE id=$2', [JSON.stringify(map), product.id])
          product.variant_stock = map
        } else {
          product.stock_quantity = clampStock(product.stock_quantity + quantity)
          await client.query('UPDATE products SET stock_quantity=$1,updated_at=now() WHERE id=$2', [product.stock_quantity, product.id])
        }
      }
    }
    const updated = await client.query("UPDATE orders SET status='cancelled',stock_reverted=true WHERE id=$1 RETURNING id,status,stock_reverted", [order.id])
    await client.query('COMMIT')
    return res.json({ order: updated.rows[0], idempotent: false })
  } catch (error) {
    try { await client.query('ROLLBACK') } catch {}
    throw error
  } finally { client.release() }
}

function install(app) {
  if (app.__atacadoBusinessFeaturesInstalled) return
  app.__atacadoBusinessFeaturesInstalled = true

  app.use((req, res, next) => {
    if (!req.path.startsWith('/api/')) return next()
    Promise.resolve(schemaReady()).then(() => {
      if (req.method === 'GET' && req.path.startsWith('/api/public/store/')) {
        const originalJson = res.json.bind(res)
        res.json = async (payload) => {
          try {
            if (Array.isArray(payload?.products) && payload.products.length) {
              const ids = payload.products.map((product) => String(product.id || '')).filter(Boolean)
              const result = await pool.query('SELECT id,images,variant_images,media_url,media_type,stock_enabled,stock_quantity,variant_stock FROM products WHERE id=ANY($1::text[])', [ids])
              const byId = new Map(result.rows.map((row) => [row.id, row]))
              payload.products = payload.products.map((product) => {
                const row = byId.get(product.id)
                if (!row) return product
                const images = uniqueImages(row, row.media_type !== 'video' ? row.media_url : '')
                return {
                  ...product,
                  images,
                  variantImages: Array.isArray(row.variant_images) ? row.variant_images : [],
                  mediaUrl: product.mediaUrl || images[0] || '',
                  stockEnabled: Boolean(row.stock_enabled),
                  stockQuantity: clampStock(row.stock_quantity),
                  variantStock: normalizeVariantStock(row.variant_stock),
                }
              })
            }
          } catch (error) { console.error('[business features] public payload:', error.message) }
          return originalJson(payload)
        }
      }
      next()
    }).catch(next)
  })

  app.patch('/api/admin/features/products/:productId/stock', express.json({ limit: '64kb' }), requireStore, (req, res, next) => Promise.resolve(updateStock(req, res)).catch(next))
  app.post('/api/business/orders', express.json({ limit: '256kb' }), (req, res, next) => Promise.resolve(createStockOrder(req, res)).catch(next))
  app.post('/api/admin/features/orders/:orderId/cancel', express.json({ limit: '16kb' }), requireStore, (req, res, next) => Promise.resolve(cancelOrder(req, res)).catch(next))
}

const previousInit = express.application.init
express.application.init = function businessFeaturesInit(...args) {
  const result = previousInit.apply(this, args)
  install(this)
  return result
}
