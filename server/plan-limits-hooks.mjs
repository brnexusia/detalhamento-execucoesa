import crypto from 'node:crypto'
import express from 'express'
import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 3, connectionTimeoutMillis: 5000 }) : null
const sessionCookies = ['shopvax_session', 'atacado_session']
const disabled = process.env.SHOPVAX_PLAN_LIMITS_DISABLED === '1'

if (pool) pool.on('error', (error) => console.error('[shopvax-plans] pool:', error.message))

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

let schemaPromise = null
async function ensureSchema() {
  if (!pool) throw new Error('DATABASE_URL não configurada.')
  if (!schemaPromise) {
    schemaPromise = pool.query(`
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
      ALTER TABLE stores ADD COLUMN IF NOT EXISTS plan_tier text NOT NULL DEFAULT 'bronze';
      INSERT INTO platform_plans (id,code,name,monthly_price,semester_discount,annual_discount,seller_limit,product_limit,catalog_limit,social_weight,active,is_system)
        VALUES
          ('plan-bronze','bronze','Bronze',49.90,5,15,5,500,1,1,true,true),
          ('plan-prata','prata','Prata',94.90,5,15,15,2000,3,2,true,true),
          ('plan-ouro','ouro','Ouro',144.90,5,15,NULL,NULL,NULL,3,true,true)
        ON CONFLICT (code) DO NOTHING;

      CREATE OR REPLACE FUNCTION shopvax_enforce_store_plan_limit()
      RETURNS trigger AS $$
      DECLARE selected_code text;
      DECLARE max_allowed integer;
      DECLARE current_total integer;
      BEGIN
        SELECT COALESCE(s.plan_tier,'bronze') INTO selected_code FROM stores s WHERE s.id=NEW.store_id;
        IF TG_TABLE_NAME='products' THEN
          SELECT product_limit INTO max_allowed FROM platform_plans WHERE code=selected_code LIMIT 1;
          SELECT count(*)::int INTO current_total FROM products WHERE store_id=NEW.store_id;
        ELSIF TG_TABLE_NAME='sellers' THEN
          SELECT seller_limit INTO max_allowed FROM platform_plans WHERE code=selected_code LIMIT 1;
          SELECT count(*)::int INTO current_total FROM sellers WHERE store_id=NEW.store_id;
        ELSIF TG_TABLE_NAME='catalogs' THEN
          SELECT catalog_limit INTO max_allowed FROM platform_plans WHERE code=selected_code LIMIT 1;
          SELECT count(*)::int INTO current_total FROM catalogs WHERE store_id=NEW.store_id;
        ELSE
          RETURN NEW;
        END IF;
        IF max_allowed IS NOT NULL AND current_total >= max_allowed THEN
          RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='SHOPVAX_PLAN_LIMIT:' || TG_TABLE_NAME;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_shopvax_plan_products ON products;
      CREATE TRIGGER trg_shopvax_plan_products BEFORE INSERT ON products FOR EACH ROW EXECUTE FUNCTION shopvax_enforce_store_plan_limit();
      DROP TRIGGER IF EXISTS trg_shopvax_plan_sellers ON sellers;
      CREATE TRIGGER trg_shopvax_plan_sellers BEFORE INSERT ON sellers FOR EACH ROW EXECUTE FUNCTION shopvax_enforce_store_plan_limit();
      DROP TRIGGER IF EXISTS trg_shopvax_plan_catalogs ON catalogs;
      CREATE TRIGGER trg_shopvax_plan_catalogs BEFORE INSERT ON catalogs FOR EACH ROW EXECUTE FUNCTION shopvax_enforce_store_plan_limit();
    `).finally(() => { schemaPromise = null })
  }
  return schemaPromise
}

async function currentStore(req) {
  await ensureSchema()
  const token = sessionToken(req)
  if (!token) return null
  const result = await pool.query(`SELECT s.id AS store_id,COALESCE(s.plan_tier,'bronze') AS plan_code
    FROM sessions se JOIN users u ON u.id=se.user_id JOIN stores s ON s.owner_id=u.id
    WHERE se.token_hash=$1 AND se.expires_at>now() LIMIT 1`, [hashToken(token)])
  return result.rows[0] || null
}

async function limitFor(storeId, planCode, tableName, columnName) {
  const plan = await pool.query(`SELECT ${columnName} AS limit FROM platform_plans WHERE code=$1 LIMIT 1`, [planCode])
  const max = plan.rows[0]?.limit == null ? null : Number(plan.rows[0].limit)
  if (max == null) return { max: null, current: 0 }
  const current = await pool.query(`SELECT count(*)::int AS total FROM ${tableName} WHERE store_id=$1`, [storeId])
  return { max, current: Number(current.rows[0]?.total || 0) }
}

function friendly(resource, max = null) {
  const labels = { products: 'produtos', sellers: 'vendedoras', catalogs: 'catálogos' }
  const label = labels[resource] || resource
  return max == null
    ? `Seu plano atingiu o limite de ${label}. Faça upgrade ou ajuste o plano antes de adicionar mais.`
    : `Seu plano permite até ${max} ${label}. Faça upgrade ou ajuste o plano antes de adicionar mais.`
}

function isDatabasePlanLimit(error) {
  return error?.code === 'P0001' && String(error?.message || '').startsWith('SHOPVAX_PLAN_LIMIT:')
}

function resourceFromDatabaseError(error) {
  return String(error?.message || '').split(':')[1] || 'recursos'
}

// Os gatilhos do PostgreSQL são a última barreira contra concorrência e inserções em massa.
// Converte a exceção deles no mesmo contrato HTTP amigável usado pelo pre-check da API.
const originalUse = express.application.use
express.application.use = function planLimitAwareUse(...args) {
  const wrapped = args.map((handler) => {
    if (typeof handler !== 'function' || handler.length !== 4) return handler
    return function shopvaxPlanLimitErrorHandler(error, req, res, next) {
      if (isDatabasePlanLimit(error)) {
        const resource = resourceFromDatabaseError(error)
        return res.status(409).json({ error: friendly(resource), code: 'PLAN_LIMIT' })
      }
      return handler(error, req, res, next)
    }
  })
  return originalUse.apply(this, wrapped)
}

async function enforce(req, res, next) {
  try {
    if (disabled) return next()
    if (req.method !== 'POST') return next()
    let resource = null
    let table = null
    let column = null
    if (req.path === '/api/admin/products') { resource = 'products'; table = 'products'; column = 'product_limit' }
    else if (req.path === '/api/admin/sellers') { resource = 'sellers'; table = 'sellers'; column = 'seller_limit' }
    else if (req.path === '/api/admin/catalogs') { resource = 'catalogs'; table = 'catalogs'; column = 'catalog_limit' }
    else return next()

    const store = await currentStore(req)
    if (!store) return next()
    const limit = await limitFor(store.store_id, store.plan_code, table, column)
    const effectiveCurrent = resource === 'catalogs' ? Math.max(1, limit.current) : limit.current
    if (limit.max != null && effectiveCurrent >= limit.max) return res.status(409).json({ error: friendly(resource, limit.max), code: 'PLAN_LIMIT' })
    next()
  } catch (error) { next(error) }
}

function install(app) {
  if (app.__shopvaxPlanLimitsInstalled) return
  app.__shopvaxPlanLimitsInstalled = true
  app.use(enforce)
  if (!disabled) void ensureSchema().catch((error) => console.error('[shopvax-plans] schema:', error.message))
}

const originalInit = express.application.init
express.application.init = function planLimitsInit(...args) {
  const result = originalInit.apply(this, args)
  install(this)
  return result
}
