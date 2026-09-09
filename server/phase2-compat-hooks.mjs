import express from 'express'
import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 5000 }) : null
const storeFallbackSeller = '__shopvax_store_whatsapp__'
const planGatesDisabled = process.env.SHOPVAX_PLAN_LIMITS_DISABLED === '1'

if (pool) pool.on('error', (error) => console.error('[phase2 compat] pool:', error.message))

let schemaPromise = null
async function ensureCompatibilitySchema() {
  if (!pool) throw new Error('DATABASE_URL não configurada.')
  if (!schemaPromise) {
    schemaPromise = (async () => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const result = await pool.query(`SELECT
          to_regclass('public.platform_plans') AS plans,
          to_regclass('public.products') AS products`)
        if (result.rows[0]?.plans && result.rows[0]?.products) break
        if (attempt === 99) throw new Error('Schema base não ficou pronto para a Fase 2.')
        await new Promise((resolve) => setTimeout(resolve, 50))
      }

      // A Fase 2 não pode depender da flag que liga/desliga os limites da Fase 1.
      // A suíte social e integrações internas executam com essa flag desligada.
      await pool.query(`
        ALTER TABLE platform_plans ADD COLUMN IF NOT EXISTS franchisee_limit integer;
        ALTER TABLE platform_plans ADD COLUMN IF NOT EXISTS feature_flags jsonb NOT NULL DEFAULT '{}'::jsonb;
        ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_enabled boolean NOT NULL DEFAULT false;
        ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_quantity integer NOT NULL DEFAULT 0;
        ALTER TABLE products ADD COLUMN IF NOT EXISTS variant_stock jsonb NOT NULL DEFAULT '{}'::jsonb;
      `)

      // Quando o próprio ambiente desliga os gates de plano, preservar o
      // comportamento legado das integrações internas: estoque continua testável.
      if (planGatesDisabled) {
        await pool.query(`UPDATE platform_plans
          SET feature_flags=COALESCE(feature_flags,'{}'::jsonb) || '{"stock":true}'::jsonb`)
      }
    })().finally(() => { schemaPromise = null })
  }
  return schemaPromise
}

function hasStickySeller(req) {
  const cookie = String(req.headers.cookie || '')
  return /(?:^|;\s*)svx_s_[a-f0-9]{12}=/.test(cookie)
}

async function prepareAdmin(_req, _res, next) {
  try {
    await ensureCompatibilitySchema()
    next()
  } catch (error) { next(error) }
}

async function preserveDirectOrderFallback(req, _res, next) {
  try {
    await ensureCompatibilitySchema()
    // A atribuição automática acontece quando o visitante abre o link geral e
    // recebe o cookie de vendedora. Chamadas diretas de API sem esse contexto
    // continuam usando o WhatsApp principal, como na fundação da Fase 1.
    if (!req.body?.sellerSlug && !hasStickySeller(req)) req.body.sellerSlug = storeFallbackSeller
    next()
  } catch (error) { next(error) }
}

function install(app) {
  if (app.__shopvaxPhase2CompatibilityInstalled) return
  app.__shopvaxPhase2CompatibilityInstalled = true
  app.use('/api/admin', prepareAdmin)
  app.post('/api/business/orders', express.json({ limit: '256kb' }), preserveDirectOrderFallback)
  if (pool) void ensureCompatibilitySchema().catch((error) => console.error('[phase2 compat] schema:', error.message))
}

const previousInit = express.application.init
express.application.init = function phase2CompatibilityInit(...args) {
  const result = previousInit.apply(this, args)
  install(this)
  return result
}
