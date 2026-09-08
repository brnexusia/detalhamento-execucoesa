import crypto from 'node:crypto'
import express from 'express'
import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 5000 }) : null
const sessionCookies = ['shopvax_session', 'atacado_session']
const bootstrapToken = String(process.env.SHOPVAX_ADMIN_BOOTSTRAP_TOKEN || '').trim()

if (pool) pool.on('error', (error) => console.error('[shopvax-admin] pool:', error.message))

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex')
const id = () => crypto.randomUUID()
const clampInt = (value, min, max) => Math.max(min, Math.min(max, Math.floor(Number(value) || 0)))
const nullableLimit = (value) => value === '' || value == null ? null : clampInt(value, 1, 1_000_000)
const money = (value) => Math.max(0, Math.round((Number(value) || 0) * 100) / 100)
const percentage = (value) => Math.max(0, Math.min(95, Math.round((Number(value) || 0) * 100) / 100))
const slugify = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

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

function timingSafeTextEqual(left, right) {
  const a = Buffer.from(String(left || ''))
  const b = Buffer.from(String(right || ''))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function planShape(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    monthlyPrice: Number(row.monthly_price || 0),
    semesterDiscount: Number(row.semester_discount || 0),
    annualDiscount: Number(row.annual_discount || 0),
    sellerLimit: row.seller_limit == null ? null : Number(row.seller_limit),
    productLimit: row.product_limit == null ? null : Number(row.product_limit),
    catalogLimit: row.catalog_limit == null ? null : Number(row.catalog_limit),
    socialWeight: Number(row.social_weight || 1),
    active: Boolean(row.active),
    isSystem: Boolean(row.is_system),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

let schemaPromise = null
async function ensurePlatformSchema() {
  if (!pool) throw new Error('DATABASE_URL não configurada.')
  if (schemaPromise) return schemaPromise
  schemaPromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS platform_admins (
        user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        created_by text REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS platform_plans (
        id text PRIMARY KEY,
        code text UNIQUE NOT NULL,
        name text NOT NULL,
        monthly_price numeric(12,2) NOT NULL,
        semester_discount numeric(5,2) NOT NULL DEFAULT 5,
        annual_discount numeric(5,2) NOT NULL DEFAULT 15,
        seller_limit integer,
        product_limit integer,
        catalog_limit integer,
        social_weight integer NOT NULL DEFAULT 1,
        active boolean NOT NULL DEFAULT true,
        is_system boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS platform_audit_log (
        id text PRIMARY KEY,
        actor_user_id text REFERENCES users(id) ON DELETE SET NULL,
        action text NOT NULL,
        target_type text NOT NULL,
        target_id text,
        meta jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_platform_admins_created ON platform_admins(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_platform_audit_created ON platform_audit_log(created_at DESC);
      ALTER TABLE stores ADD COLUMN IF NOT EXISTS plan_tier text NOT NULL DEFAULT 'bronze';
    `)
    const defaults = [
      ['bronze', 'Bronze', 49.90, 5, 15, 5, 500, 1, 1],
      ['prata', 'Prata', 94.90, 5, 15, 15, 2000, 3, 2],
      ['ouro', 'Ouro', 144.90, 5, 15, null, null, null, 3],
    ]
    for (const [code, name, price, semester, annual, sellers, products, catalogs, weight] of defaults) {
      await pool.query(
        `INSERT INTO platform_plans (id,code,name,monthly_price,semester_discount,annual_discount,seller_limit,product_limit,catalog_limit,social_weight,active,is_system)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,true)
         ON CONFLICT (code) DO NOTHING`,
        [`plan-${code}`, code, name, price, semester, annual, sellers, products, catalogs, weight],
      )
    }
  })()
  try { await schemaPromise } finally { schemaPromise = null }
}

async function currentSessionUser(req) {
  await ensurePlatformSchema()
  const token = sessionToken(req)
  if (!token) return null
  const result = await pool.query(
    `SELECT u.id,u.email,u.name,u.password_hash,s.created_at AS session_created_at
     FROM sessions s JOIN users u ON u.id=s.user_id
     WHERE s.token_hash=$1 AND s.expires_at>now() LIMIT 1`,
    [hashToken(token)],
  )
  return result.rows[0] || null
}

async function currentPlatformAdmin(req) {
  const token = sessionToken(req)
  if (!token) return null
  await ensurePlatformSchema()
  const result = await pool.query(
    `SELECT u.id,u.email,u.name,u.password_hash,s.created_at AS session_created_at
     FROM sessions s
     JOIN users u ON u.id=s.user_id
     JOIN platform_admins pa ON pa.user_id=u.id
     WHERE s.token_hash=$1 AND s.expires_at>now() AND s.created_at>now()-interval '7 days'
     LIMIT 1`,
    [hashToken(token)],
  )
  return result.rows[0] || null
}

async function storeUsage(storeId) {
  const result = await pool.query(`SELECT
    (SELECT count(*)::int FROM products WHERE store_id=$1) AS products,
    (SELECT count(*)::int FROM sellers WHERE store_id=$1) AS sellers,
    (SELECT count(*)::int FROM catalogs WHERE store_id=$1) AS catalogs`, [storeId])
  return result.rows[0] || { products: 0, sellers: 0, catalogs: 0 }
}

function capacityError(plan, usage) {
  const checks = [
    ['seller_limit', 'sellers', 'vendedoras'],
    ['product_limit', 'products', 'produtos'],
    ['catalog_limit', 'catalogs', 'catálogos'],
  ]
  for (const [limitKey, usageKey, label] of checks) {
    const max = plan[limitKey] == null ? null : Number(plan[limitKey])
    const current = Number(usage[usageKey] || 0)
    if (max != null && current > max) return `A loja usa ${current} ${label}, acima do limite de ${max} do plano ${plan.name}.`
  }
  return ''
}

async function assignedPlanViolation(code, proposed) {
  const stores = await pool.query('SELECT id,name FROM stores WHERE plan_tier=$1', [code])
  for (const store of stores.rows) {
    const usage = await storeUsage(store.id)
    const error = capacityError(proposed, usage)
    if (error) return `${store.name}: ${error}`
  }
  return ''
}

async function audit(actorId, action, targetType, targetId = null, meta = {}) {
  await pool.query(
    'INSERT INTO platform_audit_log (id,actor_user_id,action,target_type,target_id,meta) VALUES ($1,$2,$3,$4,$5,$6)',
    [id(), actorId || null, action, targetType, targetId, JSON.stringify(meta || {})],
  )
}

async function requireReauth(req, res) {
  const password = String(req.body?.password || '')
  if (!password) { res.status(400).json({ error: 'Confirme sua senha para esta ação.' }); return false }
  const user = req.platformUser
  if (!verifyPassword(password, user.password_hash)) { res.status(403).json({ error: 'Senha administrativa incorreta.' }); return false }
  return true
}

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)

function installPlatformRoutes(app) {
  if (app.__shopvaxPlatformRoutesInstalled) return
  app.__shopvaxPlatformRoutesInstalled = true

  const router = express.Router()
  router.use(express.json({ limit: '256kb' }))

  const requirePlatformAdmin = asyncRoute(async (req, res, next) => {
    const user = await currentPlatformAdmin(req)
    if (!user) return res.status(403).json({ error: 'Acesso restrito aos administradores do Shopvax.' })
    req.platformUser = user
    next()
  })

  router.post('/claim-admin', asyncRoute(async (req, res) => {
    const user = await currentSessionUser(req)
    if (!user) return res.status(401).json({ error: 'Entre na sua conta antes de ativar a administração.' })
    const count = await pool.query('SELECT count(*)::int AS total FROM platform_admins')
    if (Number(count.rows[0]?.total || 0) > 0) return res.status(409).json({ error: 'A administração inicial já foi configurada.' })
    if (bootstrapToken.length < 24) return res.status(503).json({ error: 'Configure SHOPVAX_ADMIN_BOOTSTRAP_TOKEN no ambiente antes de ativar o primeiro administrador.' })
    const supplied = String(req.body?.token || '')
    if (!timingSafeTextEqual(supplied, bootstrapToken)) return res.status(403).json({ error: 'Token de ativação inválido.' })
    await pool.query('INSERT INTO platform_admins (user_id,created_by) VALUES ($1,$1) ON CONFLICT DO NOTHING', [user.id])
    await audit(user.id, 'admin.claim', 'user', user.id)
    res.status(201).json({ ok: true })
  }))

  router.get('/bootstrap', requirePlatformAdmin, asyncRoute(async (req, res) => {
    const [stats, stores, admins, latestUsers, plans, auditRows] = await Promise.all([
      pool.query(`SELECT
        (SELECT count(*)::int FROM users) AS users,
        (SELECT count(*)::int FROM stores) AS stores,
        (SELECT count(*)::int FROM stores WHERE is_active=true) AS active_stores,
        (SELECT count(*)::int FROM products) AS products,
        (SELECT count(*)::int FROM orders) AS orders,
        (SELECT coalesce(sum(total),0)::numeric FROM orders) AS order_value`),
      pool.query(`SELECT s.id,s.slug,s.name,s.is_active,s.created_at,s.updated_at,s.plan_tier,
        u.id AS owner_id,u.name AS owner_name,u.email AS owner_email,
        (SELECT count(*)::int FROM products p WHERE p.store_id=s.id) AS products,
        (SELECT count(*)::int FROM sellers se WHERE se.store_id=s.id) AS sellers,
        (SELECT count(*)::int FROM orders o WHERE o.store_id=s.id) AS orders,
        (SELECT coalesce(sum(o.total),0)::numeric FROM orders o WHERE o.store_id=s.id) AS order_value
        FROM stores s JOIN users u ON u.id=s.owner_id ORDER BY s.created_at DESC`),
      pool.query(`SELECT u.id,u.name,u.email,pa.created_at,
        EXISTS(SELECT 1 FROM stores s WHERE s.owner_id=u.id) AS has_store
        FROM platform_admins pa JOIN users u ON u.id=pa.user_id ORDER BY pa.created_at ASC`),
      pool.query(`SELECT u.id,u.name,u.email,u.created_at,s.name AS store_name,s.slug AS store_slug
        FROM users u LEFT JOIN stores s ON s.owner_id=u.id ORDER BY u.created_at DESC LIMIT 12`),
      pool.query('SELECT * FROM platform_plans ORDER BY social_weight ASC,monthly_price ASC,created_at ASC'),
      pool.query(`SELECT l.id,l.action,l.target_type,l.target_id,l.meta,l.created_at,u.name AS actor_name,u.email AS actor_email
        FROM platform_audit_log l LEFT JOIN users u ON u.id=l.actor_user_id ORDER BY l.created_at DESC LIMIT 40`),
    ])

    res.json({
      user: { id: req.platformUser.id, name: req.platformUser.name, email: req.platformUser.email },
      stats: { ...stats.rows[0], order_value: Number(stats.rows[0]?.order_value || 0) },
      stores: stores.rows.map((store) => ({
        id: store.id, slug: store.slug, name: store.name, isActive: Boolean(store.is_active), createdAt: store.created_at,
        ownerId: store.owner_id, ownerName: store.owner_name, ownerEmail: store.owner_email, planCode: store.plan_tier || 'bronze',
        products: Number(store.products || 0), sellers: Number(store.sellers || 0), orders: Number(store.orders || 0), orderValue: Number(store.order_value || 0),
      })),
      admins: admins.rows.map((row) => ({ id: row.id, name: row.name, email: row.email, createdAt: row.created_at, hasStore: Boolean(row.has_store) })),
      latestUsers: latestUsers.rows.map((row) => ({ id: row.id, name: row.name, email: row.email, createdAt: row.created_at, storeName: row.store_name, storeSlug: row.store_slug })),
      plans: plans.rows.map(planShape),
      audit: auditRows.rows.map((row) => ({ id: row.id, action: row.action, targetType: row.target_type, targetId: row.target_id, meta: row.meta || {}, createdAt: row.created_at, actorName: row.actor_name, actorEmail: row.actor_email })),
    })
  }))

  router.get('/accounts', requirePlatformAdmin, asyncRoute(async (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase().slice(0, 120)
    const limit = clampInt(req.query.limit || 50, 1, 100)
    const offset = clampInt(req.query.offset || 0, 0, 100000)
    const params = []
    let where = ''
    if (q) { params.push(`%${q}%`); where = `WHERE lower(u.name || ' ' || u.email || ' ' || coalesce(s.name,'')) LIKE $1` }
    params.push(limit, offset)
    const li = params.length - 1
    const oi = params.length
    const result = await pool.query(`SELECT u.id,u.name,u.email,u.created_at,
      EXISTS(SELECT 1 FROM platform_admins pa WHERE pa.user_id=u.id) AS is_admin,
      s.id AS store_id,s.name AS store_name,s.slug AS store_slug,s.is_active,s.plan_tier
      FROM users u LEFT JOIN stores s ON s.owner_id=u.id ${where}
      ORDER BY u.created_at DESC LIMIT $${li} OFFSET $${oi}`, params)
    res.json({ accounts: result.rows.map((row) => ({
      id: row.id, name: row.name, email: row.email, createdAt: row.created_at, isAdmin: Boolean(row.is_admin),
      store: row.store_id ? { id: row.store_id, name: row.store_name, slug: row.store_slug, isActive: Boolean(row.is_active), planCode: row.plan_tier || 'bronze' } : null,
    })) })
  }))

  router.patch('/stores/:storeId/status', requirePlatformAdmin, asyncRoute(async (req, res) => {
    const active = Boolean(req.body?.active)
    const result = await pool.query('UPDATE stores SET is_active=$1,updated_at=now() WHERE id=$2 RETURNING id,slug,name,is_active', [active, req.params.storeId])
    if (!result.rowCount) return res.status(404).json({ error: 'Loja não encontrada.' })
    await audit(req.platformUser.id, active ? 'store.activate' : 'store.suspend', 'store', req.params.storeId)
    res.json({ store: result.rows[0] })
  }))

  router.patch('/stores/:storeId/plan', requirePlatformAdmin, asyncRoute(async (req, res) => {
    const code = slugify(req.body?.planCode)
    const plan = await pool.query('SELECT * FROM platform_plans WHERE code=$1 AND active=true LIMIT 1', [code])
    if (!plan.rowCount) return res.status(400).json({ error: 'Plano inválido ou inativo.' })
    const usage = await storeUsage(req.params.storeId)
    const violation = capacityError(plan.rows[0], usage)
    if (violation) return res.status(409).json({ error: violation })
    const result = await pool.query('UPDATE stores SET plan_tier=$1,updated_at=now() WHERE id=$2 RETURNING id,slug,name,plan_tier', [code, req.params.storeId])
    if (!result.rowCount) return res.status(404).json({ error: 'Loja não encontrada.' })
    await audit(req.platformUser.id, 'store.plan.change', 'store', req.params.storeId, { planCode: code })
    res.json({ store: result.rows[0] })
  }))

  router.post('/plans', requirePlatformAdmin, asyncRoute(async (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 80)
    const code = slugify(req.body?.code || name)
    if (!name || !code) return res.status(400).json({ error: 'Informe nome e código do plano.' })
    const row = await pool.query(`INSERT INTO platform_plans
      (id,code,name,monthly_price,semester_discount,annual_discount,seller_limit,product_limit,catalog_limit,social_weight,active,is_system)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false) RETURNING *`, [
      id(), code, name, money(req.body?.monthlyPrice), percentage(req.body?.semesterDiscount ?? 5), percentage(req.body?.annualDiscount ?? 15),
      nullableLimit(req.body?.sellerLimit), nullableLimit(req.body?.productLimit), nullableLimit(req.body?.catalogLimit), clampInt(req.body?.socialWeight || 1, 1, 3), req.body?.active !== false,
    ])
    await audit(req.platformUser.id, 'plan.create', 'plan', row.rows[0].id, { code })
    res.status(201).json({ plan: planShape(row.rows[0]) })
  }))

  router.patch('/plans/:planId', requirePlatformAdmin, asyncRoute(async (req, res) => {
    const current = await pool.query('SELECT * FROM platform_plans WHERE id=$1 LIMIT 1', [req.params.planId])
    if (!current.rowCount) return res.status(404).json({ error: 'Plano não encontrado.' })
    const old = current.rows[0]
    const name = String(req.body?.name ?? old.name).trim().slice(0, 80)
    if (!name) return res.status(400).json({ error: 'Informe o nome do plano.' })
    const proposed = {
      ...old,
      name,
      seller_limit: req.body?.sellerLimit === undefined ? old.seller_limit : nullableLimit(req.body.sellerLimit),
      product_limit: req.body?.productLimit === undefined ? old.product_limit : nullableLimit(req.body.productLimit),
      catalog_limit: req.body?.catalogLimit === undefined ? old.catalog_limit : nullableLimit(req.body.catalogLimit),
    }
    const violation = await assignedPlanViolation(old.code, proposed)
    if (violation) return res.status(409).json({ error: `Não é possível reduzir esse plano agora. ${violation}` })
    const updated = await pool.query(`UPDATE platform_plans SET name=$1,monthly_price=$2,semester_discount=$3,annual_discount=$4,
      seller_limit=$5,product_limit=$6,catalog_limit=$7,social_weight=$8,active=$9,updated_at=now() WHERE id=$10 RETURNING *`, [
      name, money(req.body?.monthlyPrice ?? old.monthly_price), percentage(req.body?.semesterDiscount ?? old.semester_discount), percentage(req.body?.annualDiscount ?? old.annual_discount),
      proposed.seller_limit, proposed.product_limit, proposed.catalog_limit,
      clampInt(req.body?.socialWeight ?? old.social_weight, 1, 3), req.body?.active === undefined ? old.active : Boolean(req.body.active), req.params.planId,
    ])
    await audit(req.platformUser.id, 'plan.update', 'plan', req.params.planId, { code: old.code })
    res.json({ plan: planShape(updated.rows[0]) })
  }))

  router.delete('/plans/:planId', requirePlatformAdmin, asyncRoute(async (req, res) => {
    const current = await pool.query('SELECT * FROM platform_plans WHERE id=$1 LIMIT 1', [req.params.planId])
    if (!current.rowCount) return res.status(404).json({ error: 'Plano não encontrado.' })
    if (current.rows[0].is_system) return res.status(400).json({ error: 'Bronze, Prata e Ouro não podem ser apagados; edite ou desative se necessário.' })
    const assigned = await pool.query('SELECT count(*)::int AS total FROM stores WHERE plan_tier=$1', [current.rows[0].code])
    if (Number(assigned.rows[0]?.total || 0) > 0) return res.status(409).json({ error: 'Esse plano ainda está vinculado a lojas.' })
    await pool.query('DELETE FROM platform_plans WHERE id=$1', [req.params.planId])
    await audit(req.platformUser.id, 'plan.delete', 'plan', req.params.planId, { code: current.rows[0].code })
    res.status(204).end()
  }))

  router.post('/admins', requirePlatformAdmin, asyncRoute(async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase()
    const name = String(req.body?.name || '').trim()
    const password = String(req.body?.password || '')
    if (!email) return res.status(400).json({ error: 'Informe o e-mail do administrador.' })
    const user = await pool.query('SELECT id,name,email FROM users WHERE email=$1 LIMIT 1', [email])
    let userRow = user.rows[0] || null
    if (!userRow) {
      if (!name || password.length < 12) return res.status(400).json({ error: 'Para um novo administrador, informe nome e senha temporária de pelo menos 12 caracteres.' })
      const created = await pool.query('INSERT INTO users (id,email,name,password_hash) VALUES ($1,$2,$3,$4) RETURNING id,name,email', [id(), email, name, hashPassword(password)])
      userRow = created.rows[0]
    }
    await pool.query('INSERT INTO platform_admins (user_id,created_by) VALUES ($1,$2) ON CONFLICT (user_id) DO NOTHING', [userRow.id, req.platformUser.id])
    await audit(req.platformUser.id, 'admin.add', 'user', userRow.id, { email: userRow.email })
    res.status(201).json({ admin: userRow })
  }))

  router.delete('/admins/:userId', requirePlatformAdmin, asyncRoute(async (req, res) => {
    if (!(await requireReauth(req, res))) return
    if (req.params.userId === req.platformUser.id) return res.status(400).json({ error: 'Você não pode remover o próprio acesso administrativo.' })
    const count = await pool.query('SELECT count(*)::int AS total FROM platform_admins')
    if (Number(count.rows[0]?.total || 0) <= 1) return res.status(400).json({ error: 'O sistema precisa manter pelo menos um administrador.' })
    await pool.query('DELETE FROM platform_admins WHERE user_id=$1', [req.params.userId])
    await audit(req.platformUser.id, 'admin.remove', 'user', req.params.userId)
    res.json({ ok: true })
  }))

  router.delete('/accounts/:userId', requirePlatformAdmin, asyncRoute(async (req, res) => {
    if (!(await requireReauth(req, res))) return
    if (req.params.userId === req.platformUser.id) return res.status(400).json({ error: 'Você não pode apagar a própria conta administrativa.' })
    const admin = await pool.query('SELECT 1 FROM platform_admins WHERE user_id=$1', [req.params.userId])
    if (admin.rowCount) return res.status(409).json({ error: 'Remova primeiro o acesso administrativo dessa conta.' })
    const target = await pool.query('SELECT id,name,email FROM users WHERE id=$1 LIMIT 1', [req.params.userId])
    if (!target.rowCount) return res.status(404).json({ error: 'Conta não encontrada.' })
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM users WHERE id=$1', [req.params.userId])
      await client.query('COMMIT')
    } catch (error) {
      try { await client.query('ROLLBACK') } catch {}
      throw error
    } finally { client.release() }
    await audit(req.platformUser.id, 'account.delete', 'user', req.params.userId, { email: target.rows[0].email, name: target.rows[0].name })
    res.json({ ok: true })
  }))

  router.get('/health', requirePlatformAdmin, asyncRoute(async (_req, res) => {
    const db = await pool.query('SELECT now() AS now')
    res.json({ ok: true, database: true, now: db.rows[0].now })
  }))

  app.use('/api/platform', router)
  void ensurePlatformSchema().catch((error) => console.error('[shopvax-admin] schema:', error.message))
}

const originalInit = express.application.init
express.application.init = function patchedInit(...args) {
  const result = originalInit.apply(this, args)
  installPlatformRoutes(this)
  return result
}
