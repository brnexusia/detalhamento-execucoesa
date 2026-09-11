import express from 'express'
import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 3, connectionTimeoutMillis: 5000 }) : null

if (pool) pool.on('error', (error) => console.error('[phase4 public config] pool:', error.message))

async function tableReady() {
  if (!pool) return false
  const result = await pool.query("SELECT to_regclass('public.store_phase4_integrations') AS integrations")
  return Boolean(result.rows[0]?.integrations)
}

async function publicConfig(req, res) {
  if (!pool) return res.status(503).json({ error: 'Banco indisponível.' })
  if (!(await tableReady())) return res.json({ eligible: false, payment: { enabled: false, methods: [] }, shipping: { enabled: false } })
  const result = await pool.query(`
    SELECT s.id,s.slug,s.plan_tier,pp.code AS plan_code,i.asaas_enabled,i.payment_methods,i.shipping_enabled
    FROM stores s
    LEFT JOIN platform_plans pp ON pp.code=COALESCE(s.plan_tier,'bronze')
    LEFT JOIN store_phase4_integrations i ON i.store_id=s.id
    WHERE s.slug=$1 AND s.is_active=true LIMIT 1
  `, [String(req.params.storeSlug || '')])
  if (!result.rowCount) return res.status(404).json({ error: 'Loja não encontrada.' })
  const row = result.rows[0]
  const eligible = String(row.plan_code || row.plan_tier || '') === 'ouro'
  const methods = eligible && row.asaas_enabled && Array.isArray(row.payment_methods) ? row.payment_methods : []
  return res.json({
    eligible,
    payment: { enabled: eligible && Boolean(row.asaas_enabled), methods },
    shipping: { enabled: eligible && Boolean(row.shipping_enabled) },
    customerAccountPath: `/cliente/${encodeURIComponent(row.slug)}`,
  })
}

function install(app) {
  if (app.__shopvaxPhase4PublicConfigInstalled) return
  app.__shopvaxPhase4PublicConfigInstalled = true
  app.get('/api/public/phase4/config/:storeSlug', (req, res, next) => Promise.resolve(publicConfig(req, res)).catch(next))
}

const previousInit = express.application.init
express.application.init = function phase4PublicConfigInit(...args) {
  const result = previousInit.apply(this, args)
  install(this)
  return result
}
