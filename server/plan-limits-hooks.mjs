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

const finalSystemPlans = [
  {
    id: 'plan-bronze',
    code: 'bronze',
    name: 'Plano 1',
    monthlyPrice: 49.90,
    sellerLimit: 2,
    productLimit: null,
    catalogLimit: 1,
    photoLimit: 5,
    franchiseeLimit: 0,
    socialWeight: 1,
    trafficPriority: 'baixa',
    features: {
      catalog: true,
      products: true,
      cart: true,
      minimumOrder: true,
      productVideo: true,
      customerLogin: true,
      whatsappOrder: true,
      temporaryStoreDisable: true,
      wholesaleRetail: true,
      productGrid: true,
      meetingPoints: true,
      stock: false,
      customDomain: false,
      reviews: false,
      commercialIntelligence: false,
      storePersonalization: false,
      franchisees: false,
      sellerCommission: false,
      vaxLar: false,
    },
  },
  {
    id: 'plan-prata',
    code: 'prata',
    name: 'Plano 2',
    monthlyPrice: 94.90,
    sellerLimit: 4,
    productLimit: null,
    catalogLimit: 3,
    photoLimit: 10,
    franchiseeLimit: 2,
    socialWeight: 2,
    trafficPriority: 'media',
    features: {
      catalog: true,
      products: true,
      cart: true,
      minimumOrder: true,
      productVideo: true,
      customerLogin: true,
      whatsappOrder: true,
      temporaryStoreDisable: true,
      wholesaleRetail: true,
      productGrid: true,
      meetingPoints: true,
      stock: true,
      customDomain: true,
      reviews: true,
      commercialIntelligence: true,
      storePersonalization: true,
      franchisees: true,
      sellerCommission: false,
      vaxLar: false,
    },
  },
  {
    id: 'plan-ouro',
    code: 'ouro',
    name: 'Plano 3',
    monthlyPrice: 144.90,
    sellerLimit: null,
    productLimit: null,
    catalogLimit: null,
    photoLimit: 10,
    franchiseeLimit: null,
    socialWeight: 3,
    trafficPriority: 'alta',
    features: {
      catalog: true,
      products: true,
      cart: true,
      minimumOrder: true,
      productVideo: true,
      customerLogin: true,
      whatsappOrder: true,
      temporaryStoreDisable: true,
      wholesaleRetail: true,
      productGrid: true,
      meetingPoints: true,
      stock: true,
      customDomain: true,
      reviews: true,
      commercialIntelligence: true,
      storePersonalization: true,
      franchisees: true,
      sellerCommission: true,
      vaxLar: false,
    },
  },
]

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

async function waitForPlatformPlans() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = await pool.query("SELECT to_regclass('public.platform_plans') AS plans")
    if (result.rows[0]?.plans) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Schema de planos da plataforma não ficou pronto.')
}

let schemaPromise = null
async function ensureSchema() {
  if (!pool) throw new Error('DATABASE_URL não configurada.')
  if (!schemaPromise) {
    schemaPromise = (async () => {
      // platform-hooks é o dono da criação de platform_plans. Esperar por ele evita
      // duas sessões PostgreSQL tentando criar o mesmo tipo/tabela em instalações novas.
      await waitForPlatformPlans()
      await pool.query(`
        ALTER TABLE platform_plans ADD COLUMN IF NOT EXISTS photo_limit integer;
        ALTER TABLE platform_plans ADD COLUMN IF NOT EXISTS franchisee_limit integer;
        ALTER TABLE platform_plans ADD COLUMN IF NOT EXISTS traffic_priority text NOT NULL DEFAULT 'baixa';
        ALTER TABLE platform_plans ADD COLUMN IF NOT EXISTS feature_flags jsonb NOT NULL DEFAULT '{}'::jsonb;
        ALTER TABLE platform_plans ADD COLUMN IF NOT EXISTS mvp_schema_version integer NOT NULL DEFAULT 0;
        ALTER TABLE stores ADD COLUMN IF NOT EXISTS plan_tier text NOT NULL DEFAULT 'bronze';
        ALTER TABLE products ADD COLUMN IF NOT EXISTS images jsonb NOT NULL DEFAULT '[]'::jsonb;

        CREATE TABLE IF NOT EXISTS catalogs (
          id text PRIMARY KEY,
          store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
          slug text NOT NULL,
          name text NOT NULL,
          kind text NOT NULL DEFAULT 'geral',
          minimum_order numeric(12,2),
          is_default boolean NOT NULL DEFAULT false,
          active boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE(store_id,slug)
        );
      `)

      for (const plan of finalSystemPlans) {
        await pool.query(
          `INSERT INTO platform_plans
             (id,code,name,monthly_price,semester_discount,annual_discount,seller_limit,product_limit,catalog_limit,photo_limit,franchisee_limit,social_weight,traffic_priority,feature_flags,active,is_system,mvp_schema_version)
           VALUES ($1,$2,$3,$4,5,15,$5,$6,$7,$8,$9,$10,$11,$12,true,true,1)
           ON CONFLICT (code) DO UPDATE SET
             name=EXCLUDED.name,
             monthly_price=EXCLUDED.monthly_price,
             semester_discount=EXCLUDED.semester_discount,
             annual_discount=EXCLUDED.annual_discount,
             seller_limit=EXCLUDED.seller_limit,
             product_limit=EXCLUDED.product_limit,
             catalog_limit=EXCLUDED.catalog_limit,
             photo_limit=EXCLUDED.photo_limit,
             franchisee_limit=EXCLUDED.franchisee_limit,
             social_weight=EXCLUDED.social_weight,
             traffic_priority=EXCLUDED.traffic_priority,
             feature_flags=EXCLUDED.feature_flags,
             active=true,
             mvp_schema_version=1,
             updated_at=now()
           WHERE platform_plans.is_system=true AND platform_plans.mvp_schema_version<1`,
          [
            plan.id,
            plan.code,
            plan.name,
            plan.monthlyPrice,
            plan.sellerLimit,
            plan.productLimit,
            plan.catalogLimit,
            plan.photoLimit,
            plan.franchiseeLimit,
            plan.socialWeight,
            plan.trafficPriority,
            JSON.stringify(plan.features),
          ],
        )
      }

      await pool.query(`
        CREATE OR REPLACE FUNCTION shopvax_enforce_store_plan_limit()
        RETURNS trigger AS $$
        DECLARE selected_code text;
        DECLARE max_allowed integer;
        DECLARE current_total integer;
        BEGIN
          SELECT COALESCE(s.plan_tier,'bronze') INTO selected_code FROM stores s WHERE s.id=NEW.store_id;
          IF TG_TABLE_NAME='products' THEN
            SELECT product_limit INTO max_allowed FROM platform_plans WHERE code=selected_code AND active=true LIMIT 1;
            SELECT count(*)::int INTO current_total FROM products WHERE store_id=NEW.store_id;
          ELSIF TG_TABLE_NAME='sellers' THEN
            SELECT seller_limit INTO max_allowed FROM platform_plans WHERE code=selected_code AND active=true LIMIT 1;
            SELECT count(*)::int INTO current_total FROM sellers WHERE store_id=NEW.store_id;
          ELSIF TG_TABLE_NAME='catalogs' THEN
            SELECT catalog_limit INTO max_allowed FROM platform_plans WHERE code=selected_code AND active=true LIMIT 1;
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

        CREATE OR REPLACE FUNCTION shopvax_enforce_product_photo_limit()
        RETURNS trigger AS $$
        DECLARE selected_code text;
        DECLARE max_allowed integer;
        DECLARE current_total integer;
        BEGIN
          SELECT COALESCE(s.plan_tier,'bronze') INTO selected_code FROM stores s WHERE s.id=NEW.store_id;
          SELECT photo_limit INTO max_allowed FROM platform_plans WHERE code=selected_code AND active=true LIMIT 1;
          IF max_allowed IS NULL THEN RETURN NEW; END IF;

          SELECT count(DISTINCT image_value)::int INTO current_total
          FROM (
            SELECT trim(value) AS image_value
              FROM jsonb_array_elements_text(COALESCE(NEW.images,'[]'::jsonb))
            UNION ALL
            SELECT trim(COALESCE(NEW.media_url,'')) AS image_value
              WHERE COALESCE(NEW.media_type,'image') <> 'video'
          ) AS source
          WHERE image_value <> '';

          IF current_total > max_allowed THEN
            RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='SHOPVAX_PLAN_PHOTO_LIMIT:' || max_allowed::text;
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
        DROP TRIGGER IF EXISTS trg_shopvax_plan_product_photos ON products;
        CREATE TRIGGER trg_shopvax_plan_product_photos BEFORE INSERT OR UPDATE OF images,media_url,media_type,store_id ON products FOR EACH ROW EXECUTE FUNCTION shopvax_enforce_product_photo_limit();
      `)
    })().finally(() => { schemaPromise = null })
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

async function planFor(code) {
  const result = await pool.query(
    `SELECT id,code,name,monthly_price,semester_discount,annual_discount,seller_limit,product_limit,catalog_limit,photo_limit,franchisee_limit,social_weight,traffic_priority,feature_flags
     FROM platform_plans WHERE code=$1 AND active=true LIMIT 1`,
    [code],
  )
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

function isDatabasePhotoLimit(error) {
  return error?.code === 'P0001' && String(error?.message || '').startsWith('SHOPVAX_PLAN_PHOTO_LIMIT:')
}

function resourceFromDatabaseError(error) {
  return String(error?.message || '').split(':')[1] || 'recursos'
}

function photoLimitFromDatabaseError(error) {
  const value = Number(String(error?.message || '').split(':')[1])
  return Number.isFinite(value) && value > 0 ? value : null
}

const originalUse = express.application.use
express.application.use = function planLimitAwareUse(...args) {
  const wrapped = args.map((handler) => {
    if (typeof handler !== 'function' || handler.length !== 4) return handler
    return function shopvaxPlanLimitErrorHandler(error, req, res, next) {
      if (isDatabasePlanLimit(error)) {
        const resource = resourceFromDatabaseError(error)
        return res.status(409).json({ error: friendly(resource), code: 'PLAN_LIMIT' })
      }
      if (isDatabasePhotoLimit(error)) {
        const max = photoLimitFromDatabaseError(error)
        return res.status(409).json({ error: max ? `Seu plano permite até ${max} fotos por produto.` : 'Seu plano atingiu o limite de fotos por produto.', code: 'PLAN_PHOTO_LIMIT', max })
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
    if (limit.max != null && effectiveCurrent >= limit.max) return res.status(409).json({ error: friendly(resource, limit.max), code: 'PLAN_LIMIT', max: limit.max, current: effectiveCurrent })
    next()
  } catch (error) { next(error) }
}

async function planContext(req, res, next) {
  try {
    const store = await currentStore(req)
    if (!store) return res.status(401).json({ error: 'Sessão necessária.' })
    const plan = await planFor(store.plan_code)
    if (!plan) return res.status(404).json({ error: 'Plano da loja não encontrado.' })
    const usage = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM products WHERE store_id=$1) AS products,
         (SELECT count(*)::int FROM sellers WHERE store_id=$1) AS sellers,
         (SELECT count(*)::int FROM catalogs WHERE store_id=$1) AS catalogs`,
      [store.store_id],
    )
    return res.json({
      plan: {
        code: plan.code,
        name: plan.name,
        monthlyPrice: Number(plan.monthly_price),
        semesterDiscount: Number(plan.semester_discount),
        annualDiscount: Number(plan.annual_discount),
        limits: {
          sellers: plan.seller_limit == null ? null : Number(plan.seller_limit),
          products: plan.product_limit == null ? null : Number(plan.product_limit),
          catalogs: plan.catalog_limit == null ? null : Number(plan.catalog_limit),
          photosPerProduct: plan.photo_limit == null ? null : Number(plan.photo_limit),
          franchisees: plan.franchisee_limit == null ? null : Number(plan.franchisee_limit),
        },
        trafficPriority: plan.traffic_priority,
        socialWeight: Number(plan.social_weight || 1),
        features: plan.feature_flags && typeof plan.feature_flags === 'object' ? plan.feature_flags : {},
      },
      usage: usage.rows[0] || { products: 0, sellers: 0, catalogs: 0 },
      roadmap: { vaxLar: 'plano-3-futuro' },
    })
  } catch (error) { next(error) }
}

function install(app) {
  if (app.__shopvaxPlanLimitsInstalled) return
  app.__shopvaxPlanLimitsInstalled = true
  app.use(enforce)
  app.get('/api/admin/plan-context', planContext)
  if (!disabled) void ensureSchema().catch((error) => console.error('[shopvax-plans] schema:', error.message))
}

const originalInit = express.application.init
express.application.init = function planLimitsInit(...args) {
  const result = originalInit.apply(this, args)
  install(this)
  return result
}
