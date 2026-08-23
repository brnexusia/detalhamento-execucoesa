import crypto from 'node:crypto'
import express from 'express'
import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 4, connectionTimeoutMillis: 5000 }) : null
const sessionCookie = 'atacado_session'

if (pool) pool.on('error', (error) => console.error('[platform-admin] pool:', error.message))

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex')
const id = () => crypto.randomUUID()

function parseCookies(req) {
  const header = req.headers.cookie || ''
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=')
        return index < 0 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))]
      }),
  )
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const derived = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${derived}`
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
      CREATE INDEX IF NOT EXISTS idx_platform_admins_created ON platform_admins(created_at DESC);
    `)
    await pool.query(`
      INSERT INTO platform_admins (user_id, created_by)
      SELECT u.id, NULL
      FROM users u
      WHERE NOT EXISTS (SELECT 1 FROM platform_admins)
      ORDER BY u.created_at ASC
      LIMIT 1
      ON CONFLICT DO NOTHING
    `)
  })()
  try {
    await schemaPromise
  } finally {
    schemaPromise = null
  }
}

async function currentPlatformAdmin(req) {
  await ensurePlatformSchema()
  const token = parseCookies(req)[sessionCookie]
  if (!token) return null
  const result = await pool.query(
    `SELECT u.id, u.email, u.name
     FROM sessions s
     JOIN users u ON u.id=s.user_id
     JOIN platform_admins pa ON pa.user_id=u.id
     WHERE s.token_hash=$1 AND s.expires_at>now()
     LIMIT 1`,
    [hashToken(token)],
  )
  return result.rows[0] || null
}

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)

function installPlatformRoutes(app) {
  if (app.__atacadoPlatformRoutesInstalled) return
  app.__atacadoPlatformRoutesInstalled = true

  const router = express.Router()
  router.use(express.json({ limit: '256kb' }))

  const requirePlatformAdmin = asyncRoute(async (req, res, next) => {
    const user = await currentPlatformAdmin(req)
    if (!user) return res.status(403).json({ error: 'Acesso restrito aos administradores do Atacado Shop.' })
    req.platformUser = user
    next()
  })

  router.get('/bootstrap', requirePlatformAdmin, asyncRoute(async (req, res) => {
    const [stats, stores, admins, latestUsers] = await Promise.all([
      pool.query(`
        SELECT
          (SELECT count(*)::int FROM users) AS users,
          (SELECT count(*)::int FROM stores) AS stores,
          (SELECT count(*)::int FROM stores WHERE is_active=true) AS active_stores,
          (SELECT count(*)::int FROM products) AS products,
          (SELECT count(*)::int FROM orders) AS orders,
          (SELECT coalesce(sum(total),0)::numeric FROM orders) AS order_value
      `),
      pool.query(`
        SELECT
          s.id,s.slug,s.name,s.is_active,s.created_at,s.updated_at,s.minimum_order,s.whatsapp,
          u.id AS owner_id,u.name AS owner_name,u.email AS owner_email,
          (SELECT count(*)::int FROM products p WHERE p.store_id=s.id) AS products,
          (SELECT count(*)::int FROM sellers se WHERE se.store_id=s.id) AS sellers,
          (SELECT count(*)::int FROM orders o WHERE o.store_id=s.id) AS orders,
          (SELECT coalesce(sum(o.total),0)::numeric FROM orders o WHERE o.store_id=s.id) AS order_value
        FROM stores s
        JOIN users u ON u.id=s.owner_id
        ORDER BY s.created_at DESC
      `),
      pool.query(`
        SELECT u.id,u.name,u.email,pa.created_at,
          EXISTS(SELECT 1 FROM stores s WHERE s.owner_id=u.id) AS has_store
        FROM platform_admins pa
        JOIN users u ON u.id=pa.user_id
        ORDER BY pa.created_at ASC
      `),
      pool.query(`
        SELECT u.id,u.name,u.email,u.created_at,
          s.id AS store_id,s.name AS store_name,s.slug AS store_slug
        FROM users u
        LEFT JOIN stores s ON s.owner_id=u.id
        ORDER BY u.created_at DESC
        LIMIT 12
      `),
    ])

    res.json({
      user: req.platformUser,
      stats: { ...stats.rows[0], order_value: Number(stats.rows[0]?.order_value || 0) },
      stores: stores.rows.map((store) => ({ ...store, minimum_order: Number(store.minimum_order), order_value: Number(store.order_value || 0) })),
      admins: admins.rows,
      latestUsers: latestUsers.rows,
    })
  }))

  router.patch('/stores/:storeId/status', requirePlatformAdmin, asyncRoute(async (req, res) => {
    const active = Boolean(req.body?.active)
    const result = await pool.query(
      'UPDATE stores SET is_active=$1,updated_at=now() WHERE id=$2 RETURNING id,slug,name,is_active',
      [active, req.params.storeId],
    )
    if (!result.rowCount) return res.status(404).json({ error: 'Loja não encontrada.' })
    res.json({ store: result.rows[0] })
  }))

  router.post('/admins', requirePlatformAdmin, asyncRoute(async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase()
    const name = String(req.body?.name || '').trim()
    const password = String(req.body?.password || '')
    if (!email) return res.status(400).json({ error: 'Informe o e-mail do administrador.' })

    const user = await pool.query('SELECT id,name,email FROM users WHERE email=$1 LIMIT 1', [email])
    let userRow = user.rows[0] || null

    if (!userRow) {
      if (!name || password.length < 8) {
        return res.status(400).json({ error: 'Para um novo usuário, informe nome e senha temporária de pelo menos 8 caracteres.' })
      }
      const created = await pool.query(
        'INSERT INTO users (id,email,name,password_hash) VALUES ($1,$2,$3,$4) RETURNING id,name,email',
        [id(), email, name, hashPassword(password)],
      )
      userRow = created.rows[0]
    }

    await pool.query(
      'INSERT INTO platform_admins (user_id,created_by) VALUES ($1,$2) ON CONFLICT (user_id) DO NOTHING',
      [userRow.id, req.platformUser.id],
    )
    res.status(201).json({ admin: userRow })
  }))

  router.delete('/admins/:userId', requirePlatformAdmin, asyncRoute(async (req, res) => {
    if (req.params.userId === req.platformUser.id) {
      return res.status(400).json({ error: 'Você não pode remover o próprio acesso administrativo.' })
    }
    const count = await pool.query('SELECT count(*)::int AS total FROM platform_admins')
    if (Number(count.rows[0]?.total || 0) <= 1) {
      return res.status(400).json({ error: 'O sistema precisa manter pelo menos um administrador.' })
    }
    await pool.query('DELETE FROM platform_admins WHERE user_id=$1', [req.params.userId])
    res.json({ ok: true })
  }))

  router.get('/health', requirePlatformAdmin, asyncRoute(async (_req, res) => {
    const db = await pool.query('SELECT now() AS now')
    res.json({ ok: true, database: true, now: db.rows[0].now })
  }))

  app.use('/api/platform', router)
  void ensurePlatformSchema().catch((error) => console.error('[platform-admin] schema:', error.message))
}

const originalInit = express.application.init
express.application.init = function patchedInit(...args) {
  const result = originalInit.apply(this, args)
  installPlatformRoutes(this)
  return result
}
