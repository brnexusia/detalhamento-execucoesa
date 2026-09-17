import crypto from 'node:crypto'
import express from 'express'
import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 3, connectionTimeoutMillis: 5000 }) : null
const sessionCookies = ['shopvax_session', 'atacado_session']

if (pool) pool.on('error', (error) => console.error('[shopvax-signup-plan] pool:', error.message))

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

let schemaReady = false
async function ensureSchema() {
  if (!pool) throw new Error('DATABASE_URL não configurada.')
  if (schemaReady) return

  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = await pool.query("SELECT to_regclass('public.platform_plans') AS plans")
    if (result.rows[0]?.plans) {
      await pool.query(`
        ALTER TABLE stores ADD COLUMN IF NOT EXISTS plan_tier text NOT NULL DEFAULT 'bronze';
        ALTER TABLE stores ADD COLUMN IF NOT EXISTS signup_plan_selected_at timestamptz;
      `)
      schemaReady = true
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  throw new Error('Planos da plataforma ainda não estão disponíveis.')
}

function shapePlan(row) {
  return {
    code: row.code,
    name: row.name,
    monthlyPrice: Number(row.monthly_price),
    sellerLimit: row.seller_limit == null ? null : Number(row.seller_limit),
    productLimit: row.product_limit == null ? null : Number(row.product_limit),
    catalogLimit: row.catalog_limit == null ? null : Number(row.catalog_limit),
    photoLimit: row.photo_limit == null ? null : Number(row.photo_limit),
    franchiseeLimit: row.franchisee_limit == null ? null : Number(row.franchisee_limit),
  }
}

async function listPlans(_req, res) {
  try {
    await ensureSchema()
    const result = await pool.query(`
      SELECT code,name,monthly_price,seller_limit,product_limit,catalog_limit,photo_limit,franchisee_limit
      FROM platform_plans
      WHERE active=true AND is_system=true
      ORDER BY monthly_price ASC, name ASC
    `)
    res.json({ plans: result.rows.map(shapePlan) })
  } catch (error) {
    console.error('[shopvax-signup-plan] list:', error)
    res.status(503).json({ error: 'Planos temporariamente indisponíveis.' })
  }
}

async function selectInitialPlan(req, res) {
  try {
    await ensureSchema()
    const token = sessionToken(req)
    if (!token) return res.status(401).json({ error: 'Sessão necessária.' })

    const planCode = String(req.body?.planCode || '').trim().toLowerCase()
    if (!planCode) return res.status(400).json({ error: 'Selecione um plano.' })

    const plan = await pool.query(
      `SELECT code,name,monthly_price
       FROM platform_plans
       WHERE code=$1 AND active=true AND is_system=true
       LIMIT 1`,
      [planCode],
    )
    if (!plan.rowCount) return res.status(400).json({ error: 'Plano selecionado inválido.' })

    const session = await pool.query(
      `SELECT u.id AS user_id
       FROM sessions s
       JOIN users u ON u.id=s.user_id
       WHERE s.token_hash=$1 AND s.expires_at>now()
       LIMIT 1`,
      [hashToken(token)],
    )
    if (!session.rowCount) return res.status(401).json({ error: 'Sessão expirada.' })

    const updated = await pool.query(
      `UPDATE stores
       SET plan_tier=$1,signup_plan_selected_at=now(),updated_at=now()
       WHERE owner_id=$2
         AND signup_plan_selected_at IS NULL
         AND created_at > now() - interval '15 minutes'
       RETURNING id,slug,plan_tier`,
      [planCode, session.rows[0].user_id],
    )

    if (!updated.rowCount) {
      return res.status(409).json({ error: 'A seleção inicial do plano já foi concluída ou expirou.' })
    }

    res.json({
      ok: true,
      plan: {
        code: plan.rows[0].code,
        name: plan.rows[0].name,
        monthlyPrice: Number(plan.rows[0].monthly_price),
      },
    })
  } catch (error) {
    console.error('[shopvax-signup-plan] select:', error)
    res.status(500).json({ error: 'Não foi possível aplicar o plano selecionado.' })
  }
}

function install(app) {
  if (app.__shopvaxSignupPlanInstalled) return
  app.__shopvaxSignupPlanInstalled = true
  app.get('/api/public/plans', listPlans)
  app.post('/api/account/plan', express.json({ limit: '10kb' }), selectInitialPlan)
}

const originalInit = express.application.init
express.application.init = function signupPlanInit(...args) {
  const result = originalInit.apply(this, args)
  install(this)
  return result
}
