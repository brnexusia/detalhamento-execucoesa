import crypto from 'node:crypto'
import express from 'express'
import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 6, connectionTimeoutMillis: 5000 }) : null
const ownerCookie = 'atacado_session'
const customerCookie = 'shopvax_customer_session'
const customerSessionDays = 30

if (pool) pool.on('error', (error) => console.error('[phase2] pool:', error.message))

const hashToken = (token) => crypto.createHash('sha256').update(String(token || '')).digest('hex')
const id = () => crypto.randomUUID()
const digits = (value) => String(value || '').replace(/\D/g, '')
const slugify = (value) => String(value || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'contato'

function parseCookies(req) {
  const header = req.headers.cookie || ''
  return Object.fromEntries(header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=')
    return index < 0 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))]
  }))
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const derived = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${derived}`
}

function verifyPassword(password, stored) {
  try {
    const [salt, expectedHex] = String(stored || '').split(':')
    const actual = crypto.scryptSync(password, salt, 64)
    const expected = Buffer.from(expectedHex, 'hex')
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
  } catch { return false }
}

function normalizeDomain(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return ''
  let host = raw
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`)
    host = url.hostname.toLowerCase()
  } catch { return '' }
  host = host.replace(/^\.+|\.+$/g, '')
  if (host.length > 253 || !host.includes('.') || /[^a-z0-9.-]/.test(host) || host.includes('..')) return ''
  if (host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return ''
  return host
}

function safeHex(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : fallback
}

function safeFont(value) {
  const allowed = ['system', 'serif', 'rounded', 'modern']
  return allowed.includes(value) ? value : 'system'
}

function customerSessionCookie(req, res, token) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https'
  res.cookie(customerCookie, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: customerSessionDays * 24 * 60 * 60 * 1000,
    path: '/',
  })
}

function clearCustomerCookie(req, res) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https'
  res.clearCookie(customerCookie, { httpOnly: true, sameSite: 'lax', secure, path: '/' })
}

async function waitForBaseSchema() {
  if (!pool) throw new Error('DATABASE_URL não configurada.')
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await pool.query(`SELECT
      to_regclass('public.stores') AS stores,
      to_regclass('public.sellers') AS sellers,
      to_regclass('public.orders') AS orders,
      to_regclass('public.platform_plans') AS plans`)
    const row = result.rows[0] || {}
    if (row.stores && row.sellers && row.orders && row.plans) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Schema base da Fase 2 não ficou pronto.')
}

let schemaPromise = null
async function ensureSchema() {
  if (!pool) throw new Error('DATABASE_URL não configurada.')
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await waitForBaseSchema()
      await pool.query(`
        ALTER TABLE stores ADD COLUMN IF NOT EXISTS seller_rotation_cursor bigint NOT NULL DEFAULT 0;
        ALTER TABLE stores ADD COLUMN IF NOT EXISTS customer_login_enabled boolean NOT NULL DEFAULT true;
        ALTER TABLE stores ADD COLUMN IF NOT EXISTS custom_domain text NOT NULL DEFAULT '';
        ALTER TABLE stores ADD COLUMN IF NOT EXISTS custom_domain_status text NOT NULL DEFAULT 'none';
        ALTER TABLE stores ADD COLUMN IF NOT EXISTS theme_background text NOT NULL DEFAULT '#ffffff';
        ALTER TABLE stores ADD COLUMN IF NOT EXISTS theme_text_color text NOT NULL DEFAULT '#17211b';
        ALTER TABLE stores ADD COLUMN IF NOT EXISTS theme_font text NOT NULL DEFAULT 'system';

        CREATE UNIQUE INDEX IF NOT EXISTS idx_stores_custom_domain_unique
          ON stores(lower(custom_domain)) WHERE custom_domain<>'';

        CREATE TABLE IF NOT EXISTS store_customers (
          id text PRIMARY KEY,
          store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
          name text NOT NULL,
          email text NOT NULL,
          phone text NOT NULL DEFAULT '',
          password_hash text NOT NULL,
          active boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE(store_id,email)
        );
        CREATE INDEX IF NOT EXISTS idx_store_customers_store_created ON store_customers(store_id,created_at DESC);

        CREATE TABLE IF NOT EXISTS store_customer_sessions (
          token_hash text PRIMARY KEY,
          customer_id text NOT NULL REFERENCES store_customers(id) ON DELETE CASCADE,
          expires_at timestamptz NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_store_customer_sessions_customer ON store_customer_sessions(customer_id,expires_at DESC);

        CREATE TABLE IF NOT EXISTS franchisees (
          id text PRIMARY KEY,
          store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
          slug text NOT NULL,
          name text NOT NULL,
          phone text NOT NULL,
          active boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE(store_id,slug)
        );
        CREATE INDEX IF NOT EXISTS idx_franchisees_store ON franchisees(store_id,created_at ASC);

        ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_id text REFERENCES store_customers(id) ON DELETE SET NULL;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS status_updated_at timestamptz NOT NULL DEFAULT now();
        CREATE INDEX IF NOT EXISTS idx_orders_customer_created ON orders(customer_id,created_at DESC) WHERE customer_id IS NOT NULL;
      `)

      // Plano 1 não deve carregar estoque legado ativado de versões anteriores.
      await pool.query(`
        UPDATE products p SET stock_enabled=false,updated_at=now()
        FROM stores s JOIN platform_plans pp ON pp.code=COALESCE(s.plan_tier,'bronze')
        WHERE p.store_id=s.id AND p.stock_enabled=true
          AND COALESCE((pp.feature_flags->>'stock')::boolean,false)=false
      `).catch(() => undefined)
    })().finally(() => { schemaPromise = null })
  }
  return schemaPromise
}

async function ownerStore(req) {
  await ensureSchema()
  const token = parseCookies(req)[ownerCookie]
  if (!token) return null
  const result = await pool.query(`
    SELECT s.*,u.id AS user_id,u.name AS owner_name,u.email AS owner_email,
           pp.name AS plan_name,pp.code AS plan_code,pp.seller_limit,pp.franchisee_limit,pp.feature_flags
    FROM sessions se
    JOIN users u ON u.id=se.user_id
    JOIN stores s ON s.owner_id=u.id
    LEFT JOIN platform_plans pp ON pp.code=COALESCE(s.plan_tier,'bronze')
    WHERE se.token_hash=$1 AND se.expires_at>now() LIMIT 1
  `, [hashToken(token)])
  return result.rows[0] || null
}

async function requireOwner(req, res, next) {
  try {
    const store = await ownerStore(req)
    if (!store) return res.status(401).json({ error: 'Sessão necessária.' })
    req.phase2Store = store
    next()
  } catch (error) { next(error) }
}

function featureEnabled(store, feature) {
  const flags = store?.feature_flags && typeof store.feature_flags === 'object' ? store.feature_flags : {}
  return flags[feature] === true
}

function featureDenied(res, label) {
  return res.status(403).json({ error: `${label} está disponível a partir do plano que inclui esse recurso.`, code: 'PLAN_FEATURE' })
}

async function currentCustomer(req, storeId = null) {
  await ensureSchema()
  const token = parseCookies(req)[customerCookie]
  if (!token) return null
  const params = [hashToken(token)]
  let storeFilter = ''
  if (storeId) { params.push(storeId); storeFilter = ` AND c.store_id=$${params.length}` }
  const result = await pool.query(`
    SELECT c.id,c.store_id,c.name,c.email,c.phone,c.created_at
    FROM store_customer_sessions se
    JOIN store_customers c ON c.id=se.customer_id
    WHERE se.token_hash=$1 AND se.expires_at>now() AND c.active=true${storeFilter}
    LIMIT 1
  `, params)
  return result.rows[0] || null
}

async function uniqueSellerSlug(storeId, base, ignoreId = null) {
  const stem = slugify(base)
  let candidate = stem
  for (let attempt = 1; attempt < 100; attempt += 1) {
    const params = [storeId, candidate]
    let sql = 'SELECT 1 FROM sellers WHERE store_id=$1 AND slug=$2'
    if (ignoreId) { params.push(ignoreId); sql += ' AND id<>$3' }
    const exists = await pool.query(sql, params)
    if (!exists.rowCount) return candidate
    candidate = `${stem}-${attempt + 1}`.slice(0, 60)
  }
  return `${stem}-${crypto.randomBytes(2).toString('hex')}`.slice(0, 60)
}

async function uniqueFranchiseeSlug(storeId, base, ignoreId = null) {
  const stem = slugify(base)
  let candidate = stem
  for (let attempt = 1; attempt < 100; attempt += 1) {
    const params = [storeId, candidate]
    let sql = 'SELECT 1 FROM franchisees WHERE store_id=$1 AND slug=$2'
    if (ignoreId) { params.push(ignoreId); sql += ' AND id<>$3' }
    const exists = await pool.query(sql, params)
    if (!exists.rowCount) return candidate
    candidate = `${stem}-${attempt + 1}`.slice(0, 60)
  }
  return `${stem}-${crypto.randomBytes(2).toString('hex')}`.slice(0, 60)
}

async function createSeller(req, res) {
  const store = req.phase2Store
  const name = String(req.body?.name || '').trim().slice(0, 120)
  const phone = digits(req.body?.phone)
  if (!name || phone.length < 10) return res.status(400).json({ error: 'Nome e WhatsApp são obrigatórios.' })
  const limit = store.seller_limit == null ? null : Number(store.seller_limit)
  if (limit != null) {
    const count = await pool.query('SELECT count(*)::int AS total FROM sellers WHERE store_id=$1', [store.id])
    if (Number(count.rows[0]?.total || 0) >= limit) return res.status(409).json({ error: `Seu plano permite até ${limit} vendedoras.`, code: 'PLAN_LIMIT', max: limit })
  }
  const slug = await uniqueSellerSlug(store.id, req.body?.slug || name)
  const result = await pool.query(
    'INSERT INTO sellers (id,store_id,slug,name,phone,is_active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [id(), store.id, slug, name, phone, req.body?.isActive !== false],
  )
  return res.status(201).json({ seller: result.rows[0] })
}

async function updateSeller(req, res) {
  const store = req.phase2Store
  const existing = await pool.query('SELECT * FROM sellers WHERE id=$1 AND store_id=$2 LIMIT 1', [req.params.id, store.id])
  if (!existing.rowCount) return res.status(404).json({ error: 'Vendedora não encontrada.' })
  const current = existing.rows[0]
  const name = String(req.body?.name ?? current.name).trim().slice(0, 120)
  const phone = digits(req.body?.phone ?? current.phone)
  if (!name || phone.length < 10) return res.status(400).json({ error: 'Nome e WhatsApp são obrigatórios.' })
  const slug = await uniqueSellerSlug(store.id, req.body?.slug || current.slug, current.id)
  const updated = await pool.query(
    'UPDATE sellers SET slug=$1,name=$2,phone=$3,is_active=$4 WHERE id=$5 AND store_id=$6 RETURNING *',
    [slug, name, phone, req.body?.isActive !== false, current.id, store.id],
  )
  return res.json({ seller: updated.rows[0] })
}

async function listFranchisees(req, res) {
  const rows = await pool.query('SELECT id,slug,name,phone,active,created_at FROM franchisees WHERE store_id=$1 ORDER BY created_at ASC', [req.phase2Store.id])
  return res.json({ franchisees: rows.rows })
}

async function createFranchisee(req, res) {
  const store = req.phase2Store
  if (!featureEnabled(store, 'franchisees')) return featureDenied(res, 'Cadastro de franqueados')
  const name = String(req.body?.name || '').trim().slice(0, 120)
  const phone = digits(req.body?.phone)
  if (!name || phone.length < 10) return res.status(400).json({ error: 'Nome e WhatsApp são obrigatórios.' })
  const limit = store.franchisee_limit == null ? null : Number(store.franchisee_limit)
  if (limit != null) {
    const count = await pool.query('SELECT count(*)::int AS total FROM franchisees WHERE store_id=$1', [store.id])
    if (Number(count.rows[0]?.total || 0) >= limit) return res.status(409).json({ error: `Seu plano permite até ${limit} franqueados.`, code: 'PLAN_LIMIT', max: limit })
  }
  const slug = await uniqueFranchiseeSlug(store.id, req.body?.slug || name)
  const result = await pool.query('INSERT INTO franchisees (id,store_id,slug,name,phone,active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,slug,name,phone,active,created_at', [id(), store.id, slug, name, phone, req.body?.active !== false])
  return res.status(201).json({ franchisee: result.rows[0] })
}

async function updateFranchisee(req, res) {
  const store = req.phase2Store
  if (!featureEnabled(store, 'franchisees')) return featureDenied(res, 'Cadastro de franqueados')
  const currentResult = await pool.query('SELECT * FROM franchisees WHERE id=$1 AND store_id=$2 LIMIT 1', [req.params.id, store.id])
  if (!currentResult.rowCount) return res.status(404).json({ error: 'Franqueado não encontrado.' })
  const current = currentResult.rows[0]
  const name = String(req.body?.name ?? current.name).trim().slice(0, 120)
  const phone = digits(req.body?.phone ?? current.phone)
  if (!name || phone.length < 10) return res.status(400).json({ error: 'Nome e WhatsApp são obrigatórios.' })
  const slug = await uniqueFranchiseeSlug(store.id, req.body?.slug || current.slug, current.id)
  const result = await pool.query('UPDATE franchisees SET slug=$1,name=$2,phone=$3,active=$4,updated_at=now() WHERE id=$5 AND store_id=$6 RETURNING id,slug,name,phone,active,created_at', [slug, name, phone, req.body?.active !== false, current.id, store.id])
  return res.json({ franchisee: result.rows[0] })
}

async function deleteFranchisee(req, res) {
  const result = await pool.query('DELETE FROM franchisees WHERE id=$1 AND store_id=$2 RETURNING id', [req.params.id, req.phase2Store.id])
  if (!result.rowCount) return res.status(404).json({ error: 'Franqueado não encontrado.' })
  return res.status(204).end()
}

function assignmentCookieName(storeId) {
  return `svx_s_${crypto.createHash('sha256').update(storeId).digest('hex').slice(0, 12)}`
}

async function activeSellerBySlug(storeId, slug, client = pool) {
  if (!slug) return null
  const result = await client.query('SELECT id,slug,name,phone FROM sellers WHERE store_id=$1 AND slug=$2 AND is_active=true LIMIT 1', [storeId, slug])
  return result.rows[0] || null
}

async function assignedSeller(store, req, res, { advance = true } = {}) {
  const cookieName = assignmentCookieName(store.id)
  const sticky = parseCookies(req)[cookieName]
  const existing = await activeSellerBySlug(store.id, sticky)
  if (existing) return existing

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const locked = await client.query('SELECT seller_rotation_cursor FROM stores WHERE id=$1 FOR UPDATE', [store.id])
    const sellers = await client.query('SELECT id,slug,name,phone FROM sellers WHERE store_id=$1 AND is_active=true ORDER BY created_at ASC,id ASC', [store.id])
    if (!sellers.rowCount) { await client.query('COMMIT'); return null }
    const cursor = Math.max(0, Number(locked.rows[0]?.seller_rotation_cursor || 0))
    const seller = sellers.rows[cursor % sellers.rows.length]
    if (advance) await client.query('UPDATE stores SET seller_rotation_cursor=$1,updated_at=now() WHERE id=$2', [cursor + 1, store.id])
    await client.query('COMMIT')
    const secure = req.secure || req.headers['x-forwarded-proto'] === 'https'
    res.cookie(cookieName, seller.slug, { httpOnly: true, sameSite: 'lax', secure, maxAge: 24 * 60 * 60 * 1000, path: '/' })
    return seller
  } catch (error) {
    try { await client.query('ROLLBACK') } catch {}
    throw error
  } finally { client.release() }
}

async function storeBySlug(slug) {
  const result = await pool.query('SELECT * FROM stores WHERE slug=$1 AND is_active=true LIMIT 1', [String(slug || '')])
  return result.rows[0] || null
}

async function phase2Context(req, res) {
  const store = req.phase2Store
  const [sellers, franchisees, customers, orders] = await Promise.all([
    pool.query('SELECT id,slug,name,phone,is_active,created_at FROM sellers WHERE store_id=$1 ORDER BY created_at ASC', [store.id]),
    pool.query('SELECT id,slug,name,phone,active,created_at FROM franchisees WHERE store_id=$1 ORDER BY created_at ASC', [store.id]),
    pool.query(`SELECT c.id,c.name,c.email,c.phone,c.active,c.created_at,
      count(o.id)::int AS orders_count,COALESCE(sum(o.total),0)::numeric AS orders_value
      FROM store_customers c LEFT JOIN orders o ON o.customer_id=c.id
      WHERE c.store_id=$1 GROUP BY c.id ORDER BY c.created_at DESC LIMIT 500`, [store.id]),
    pool.query(`SELECT o.id,o.code,o.total,o.status,o.created_at,o.status_updated_at,o.customer_id,o.seller_id,o.items,
      c.name AS customer_name,c.email AS customer_email,s.name AS seller_name
      FROM orders o LEFT JOIN store_customers c ON c.id=o.customer_id LEFT JOIN sellers s ON s.id=o.seller_id
      WHERE o.store_id=$1 ORDER BY o.created_at DESC LIMIT 200`, [store.id]),
  ])
  return res.json({
    plan: {
      code: store.plan_code || store.plan_tier || 'bronze',
      name: store.plan_name || 'Plano 1',
      limits: { sellers: store.seller_limit == null ? null : Number(store.seller_limit), franchisees: store.franchisee_limit == null ? null : Number(store.franchisee_limit) },
      features: store.feature_flags && typeof store.feature_flags === 'object' ? store.feature_flags : {},
    },
    store: {
      id: store.id,
      slug: store.slug,
      sellerRotationCursor: Number(store.seller_rotation_cursor || 0),
      customerLoginEnabled: store.customer_login_enabled !== false,
      customDomain: store.custom_domain || '',
      customDomainStatus: store.custom_domain_status || 'none',
      theme: { background: store.theme_background || '#ffffff', textColor: store.theme_text_color || '#17211b', font: store.theme_font || 'system', accent: store.accent },
      cnameTarget: process.env.SHOPVAX_DOMAIN_CNAME_TARGET || '',
    },
    sellers: sellers.rows,
    franchisees: franchisees.rows,
    customers: customers.rows.map((row) => ({ ...row, orders_value: Number(row.orders_value || 0) })),
    orders: orders.rows.map((row) => ({ ...row, total: Number(row.total || 0) })),
    semantics: 'Pedidos enviados ao WhatsApp representam intenção/pedido registrado no Shopvax. Os valores não significam faturamento confirmado.',
  })
}

async function updatePhase2Store(req, res) {
  const store = req.phase2Store
  let customDomain = store.custom_domain || ''
  let customDomainStatus = store.custom_domain_status || 'none'
  let background = store.theme_background || '#ffffff'
  let textColor = store.theme_text_color || '#17211b'
  let font = store.theme_font || 'system'

  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'customDomain')) {
    if (!featureEnabled(store, 'customDomain')) return featureDenied(res, 'Domínio próprio')
    const raw = String(req.body.customDomain || '').trim()
    const normalized = raw ? normalizeDomain(raw) : ''
    if (raw && !normalized) return res.status(400).json({ error: 'Informe apenas um domínio válido, como loja.com.br.' })
    customDomain = normalized
    customDomainStatus = normalized ? (normalized === store.custom_domain ? store.custom_domain_status || 'pending' : 'pending') : 'none'
  }

  const changingTheme = ['background', 'textColor', 'font'].some((key) => Object.prototype.hasOwnProperty.call(req.body?.theme || {}, key))
  if (changingTheme) {
    if (!featureEnabled(store, 'storePersonalization')) return featureDenied(res, 'Personalização avançada')
    background = safeHex(req.body.theme?.background, background)
    textColor = safeHex(req.body.theme?.textColor, textColor)
    font = safeFont(req.body.theme?.font)
  }

  const customerLoginEnabled = req.body?.customerLoginEnabled == null ? store.customer_login_enabled !== false : req.body.customerLoginEnabled !== false
  try {
    const result = await pool.query(`UPDATE stores SET customer_login_enabled=$1,custom_domain=$2,custom_domain_status=$3,
      theme_background=$4,theme_text_color=$5,theme_font=$6,updated_at=now() WHERE id=$7
      RETURNING customer_login_enabled,custom_domain,custom_domain_status,theme_background,theme_text_color,theme_font`,
    [customerLoginEnabled, customDomain, customDomainStatus, background, textColor, font, store.id])
    return res.json({ store: result.rows[0] })
  } catch (error) {
    if (error?.code === '23505') return res.status(409).json({ error: 'Esse domínio já está ligado a outra loja.' })
    throw error
  }
}

async function updateOrderStatus(req, res) {
  const allowed = ['whatsapp', 'em_atendimento', 'arquivado']
  const status = String(req.body?.status || '')
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Status inválido. Para cancelar e devolver estoque, use a ação de cancelamento.' })
  const result = await pool.query('UPDATE orders SET status=$1,status_updated_at=now() WHERE id=$2 AND store_id=$3 AND status<>\'cancelled\' RETURNING id,code,status,status_updated_at', [status, req.params.orderId, req.phase2Store.id])
  if (!result.rowCount) return res.status(404).json({ error: 'Pedido não encontrado ou já cancelado.' })
  return res.json({ order: result.rows[0] })
}

async function registerCustomer(req, res) {
  await ensureSchema()
  const store = await storeBySlug(req.params.storeSlug)
  if (!store || store.customer_login_enabled === false) return res.status(404).json({ error: 'Cadastro de clientes indisponível nesta loja.' })
  const name = String(req.body?.name || '').trim().slice(0, 120)
  const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 240)
  const phone = digits(req.body?.phone).slice(0, 20)
  const password = String(req.body?.password || '')
  if (!name || !email.includes('@') || password.length < 8) return res.status(400).json({ error: 'Informe nome, e-mail e uma senha de pelo menos 8 caracteres.' })
  const customerId = id()
  try {
    await pool.query('INSERT INTO store_customers (id,store_id,name,email,phone,password_hash) VALUES ($1,$2,$3,$4,$5,$6)', [customerId, store.id, name, email, phone, hashPassword(password)])
  } catch (error) {
    if (error?.code === '23505') return res.status(409).json({ error: 'Esse e-mail já possui cadastro nesta loja.' })
    throw error
  }
  const token = crypto.randomBytes(32).toString('base64url')
  await pool.query("INSERT INTO store_customer_sessions (token_hash,customer_id,expires_at) VALUES ($1,$2,now()+interval '30 days')", [hashToken(token), customerId])
  customerSessionCookie(req, res, token)
  return res.status(201).json({ customer: { id: customerId, name, email, phone }, store: { slug: store.slug, name: store.name } })
}

async function loginCustomer(req, res) {
  await ensureSchema()
  const store = await storeBySlug(req.params.storeSlug)
  if (!store || store.customer_login_enabled === false) return res.status(404).json({ error: 'Login de clientes indisponível nesta loja.' })
  const email = String(req.body?.email || '').trim().toLowerCase()
  const password = String(req.body?.password || '')
  const result = await pool.query('SELECT * FROM store_customers WHERE store_id=$1 AND email=$2 AND active=true LIMIT 1', [store.id, email])
  if (!result.rowCount || !verifyPassword(password, result.rows[0].password_hash)) return res.status(401).json({ error: 'E-mail ou senha inválidos.' })
  const customer = result.rows[0]
  const token = crypto.randomBytes(32).toString('base64url')
  await pool.query('DELETE FROM store_customer_sessions WHERE expires_at<=now()')
  await pool.query("INSERT INTO store_customer_sessions (token_hash,customer_id,expires_at) VALUES ($1,$2,now()+interval '30 days')", [hashToken(token), customer.id])
  customerSessionCookie(req, res, token)
  return res.json({ customer: { id: customer.id, name: customer.name, email: customer.email, phone: customer.phone }, store: { slug: store.slug, name: store.name } })
}

async function customerMe(req, res) {
  await ensureSchema()
  const store = await storeBySlug(req.params.storeSlug)
  if (!store) return res.status(404).json({ error: 'Loja não encontrada.' })
  const customer = await currentCustomer(req, store.id)
  if (!customer) return res.status(401).json({ error: 'Entre para acessar sua conta.' })
  const orders = await pool.query(`SELECT o.id,o.code,o.total,o.items,o.status,o.created_at,o.status_updated_at,s.name AS seller_name
    FROM orders o LEFT JOIN sellers s ON s.id=o.seller_id WHERE o.customer_id=$1 AND o.store_id=$2 ORDER BY o.created_at DESC LIMIT 100`, [customer.id, store.id])
  return res.json({
    customer,
    store: { slug: store.slug, name: store.name, logoUrl: store.logo_url, accent: store.accent },
    orders: orders.rows.map((row) => ({ ...row, total: Number(row.total || 0) })),
    semantics: 'O histórico mostra pedidos registrados/enviados ao atendimento. Não confirma pagamento ou faturamento.',
  })
}

async function logoutCustomer(req, res) {
  const token = parseCookies(req)[customerCookie]
  if (token && pool) await pool.query('DELETE FROM store_customer_sessions WHERE token_hash=$1', [hashToken(token)]).catch(() => undefined)
  clearCustomerCookie(req, res)
  return res.json({ ok: true })
}

async function decoratePublicPayload(req, res, next) {
  const match = req.path.match(/^\/api\/public\/store\/([^/]+)(?:\/([^/]+))?$/)
  if (!match || req.method !== 'GET') return next()
  const storeSlug = decodeURIComponent(match[1])
  const originalJson = res.json.bind(res)
  res.json = (payload) => {
    Promise.resolve((async () => {
      try {
        const store = await storeBySlug(storeSlug)
        if (store && payload?.store) {
          const customer = await currentCustomer(req, store.id)
          payload.store = {
            ...payload.store,
            customerLoginEnabled: store.customer_login_enabled !== false,
            customDomain: store.custom_domain_status === 'verified' ? store.custom_domain : '',
            theme: { background: store.theme_background, textColor: store.theme_text_color, font: store.theme_font },
          }
          payload.customer = customer ? { id: customer.id, name: customer.name, email: customer.email } : null
        }
      } catch (error) { console.error('[phase2] public decoration:', error.message) }
      originalJson(payload)
    })())
    return res
  }
  next()
}

async function stickySellerRewrite(req, res, next) {
  if (req.method !== 'GET') return next()
  const match = req.url.match(/^\/api\/public\/store\/([^/?]+)(\?[^#]*)?$/)
  if (!match) return next()
  try {
    await ensureSchema()
    const store = await storeBySlug(decodeURIComponent(match[1]))
    if (!store) return next()
    const seller = await assignedSeller(store, req, res)
    if (!seller) return next()
    const query = match[2] || ''
    req.url = `/api/public/store/${encodeURIComponent(store.slug)}/${encodeURIComponent(seller.slug)}${query}`
    next()
  } catch (error) { next(error) }
}

async function enrichPublicEvent(req, res, next) {
  try {
    if (req.body?.sellerSlug) return next()
    const store = await storeBySlug(req.body?.storeSlug)
    if (!store) return next()
    const seller = await assignedSeller(store, req, res, { advance: false })
    if (seller) req.body.sellerSlug = seller.slug
    next()
  } catch (error) { next(error) }
}

async function enrichOrder(req, res, next) {
  try {
    await ensureSchema()
    const store = await storeBySlug(req.body?.storeSlug)
    if (!store) return next()
    if (!req.body?.sellerSlug) {
      const seller = await assignedSeller(store, req, res)
      if (seller) req.body.sellerSlug = seller.slug
    }
    const customer = await currentCustomer(req, store.id)
    if (customer) {
      const originalJson = res.json.bind(res)
      res.json = (payload) => {
        if (res.statusCode === 201 && payload?.orderId) {
          pool.query('UPDATE orders SET customer_id=$1 WHERE id=$2 AND store_id=$3', [customer.id, payload.orderId, store.id])
            .then(() => originalJson({ ...payload, customer: { id: customer.id, name: customer.name } }))
            .catch((error) => { console.error('[phase2] attach customer:', error.message); originalJson(payload) })
          return res
        }
        return originalJson(payload)
      }
    }
    next()
  } catch (error) { next(error) }
}

async function stockGate(req, res, next) {
  try {
    const store = await ownerStore(req)
    if (!store) return res.status(401).json({ error: 'Sessão necessária.' })
    if (!featureEnabled(store, 'stock')) return featureDenied(res, 'Controle de estoque')
    next()
  } catch (error) { next(error) }
}

async function customDomainRoot(req, res, next) {
  if (req.method !== 'GET' || req.path !== '/' || req.path.startsWith('/api/')) return next()
  try {
    await ensureSchema()
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase().replace(/:\d+$/, '')
    if (!host) return next()
    const result = await pool.query("SELECT id,slug,custom_domain_status FROM stores WHERE lower(custom_domain)=lower($1) AND custom_domain<>'' AND is_active=true LIMIT 1", [host])
    if (!result.rowCount) return next()
    const store = result.rows[0]
    if (store.custom_domain_status !== 'verified') await pool.query("UPDATE stores SET custom_domain_status='verified',updated_at=now() WHERE id=$1", [store.id])
    const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : ''
    return res.redirect(302, `/${encodeURIComponent(store.slug)}${query}`)
  } catch (error) { next(error) }
}

function install(app) {
  if (app.__shopvaxPhase2Installed) return
  app.__shopvaxPhase2Installed = true

  // Executa antes das rotas de catálogo/estoque e preserva seus handlers atuais.
  app.use(customDomainRoot)
  app.use(decoratePublicPayload)
  app.use(stickySellerRewrite)

  app.post('/api/public/events', express.json({ limit: '32kb' }), enrichPublicEvent, (_req, _res, next) => next())
  app.post('/api/business/orders', express.json({ limit: '256kb' }), enrichOrder, (_req, _res, next) => next())
  app.patch('/api/admin/features/products/:productId/stock', stockGate, (_req, _res, next) => next())

  // Sobrescreve apenas criação/edição de vendedoras para garantir limites antes da rota legada.
  app.post('/api/admin/sellers', express.json({ limit: '64kb' }), requireOwner, (req, res, next) => Promise.resolve(createSeller(req, res)).catch(next))
  app.put('/api/admin/sellers/:id', express.json({ limit: '64kb' }), requireOwner, (req, res, next) => Promise.resolve(updateSeller(req, res)).catch(next))

  app.get('/api/admin/phase2', requireOwner, (req, res, next) => Promise.resolve(phase2Context(req, res)).catch(next))
  app.patch('/api/admin/phase2/store', express.json({ limit: '64kb' }), requireOwner, (req, res, next) => Promise.resolve(updatePhase2Store(req, res)).catch(next))
  app.patch('/api/admin/phase2/orders/:orderId/status', express.json({ limit: '32kb' }), requireOwner, (req, res, next) => Promise.resolve(updateOrderStatus(req, res)).catch(next))

  app.get('/api/admin/phase2/franchisees', requireOwner, (req, res, next) => Promise.resolve(listFranchisees(req, res)).catch(next))
  app.post('/api/admin/phase2/franchisees', express.json({ limit: '64kb' }), requireOwner, (req, res, next) => Promise.resolve(createFranchisee(req, res)).catch(next))
  app.put('/api/admin/phase2/franchisees/:id', express.json({ limit: '64kb' }), requireOwner, (req, res, next) => Promise.resolve(updateFranchisee(req, res)).catch(next))
  app.delete('/api/admin/phase2/franchisees/:id', requireOwner, (req, res, next) => Promise.resolve(deleteFranchisee(req, res)).catch(next))

  app.post('/api/public/store/:storeSlug/customers/register', express.json({ limit: '64kb' }), (req, res, next) => Promise.resolve(registerCustomer(req, res)).catch(next))
  app.post('/api/public/store/:storeSlug/customers/login', express.json({ limit: '32kb' }), (req, res, next) => Promise.resolve(loginCustomer(req, res)).catch(next))
  app.get('/api/public/store/:storeSlug/customers/me', (req, res, next) => Promise.resolve(customerMe(req, res)).catch(next))
  app.post('/api/public/customers/logout', (req, res, next) => Promise.resolve(logoutCustomer(req, res)).catch(next))

  if (pool) void ensureSchema().catch((error) => console.error('[phase2] schema:', error.message))
}

const previousInit = express.application.init
express.application.init = function phase2Init(...args) {
  const result = previousInit.apply(this, args)
  install(this)
  return result
}
