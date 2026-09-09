import express from 'express'
import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 5000 }) : null

if (pool) pool.on('error', (error) => console.error('[phase2 public config] pool:', error.message))

async function config(req, res) {
  if (!pool) return res.status(503).json({ error: 'Banco indisponível.' })
  const result = await pool.query(`SELECT slug,name,logo_url,accent,customer_login_enabled,custom_domain,custom_domain_status,
    theme_background,theme_text_color,theme_font FROM stores WHERE slug=$1 AND is_active=true LIMIT 1`, [req.params.storeSlug])
  if (!result.rowCount) return res.status(404).json({ error: 'Loja não encontrada.' })
  const row = result.rows[0]
  return res.json({
    store: { slug: row.slug, name: row.name, logoUrl: row.logo_url, accent: row.accent },
    customerLoginEnabled: row.customer_login_enabled !== false,
    customDomain: row.custom_domain_status === 'verified' ? row.custom_domain : '',
    theme: {
      background: row.theme_background || '#ffffff',
      textColor: row.theme_text_color || '#17211b',
      font: row.theme_font || 'system',
    },
  })
}

function install(app) {
  if (app.__shopvaxPhase2PublicConfigInstalled) return
  app.__shopvaxPhase2PublicConfigInstalled = true
  app.get('/api/public/store/:storeSlug/phase2-config', (req, res, next) => Promise.resolve(config(req, res)).catch(next))
}

const previousInit = express.application.init
express.application.init = function phase2PublicConfigInit(...args) {
  const result = previousInit.apply(this, args)
  install(this)
  return result
}
