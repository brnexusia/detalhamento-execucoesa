import { buildOrderWhatsappMessage, assertKnownOrderSelections, orderProductDetails } from './order-whatsapp-message.mjs'
import { resolvedVariantPrices, variantUnitPrice } from './variant-pricing.mjs'
import { withCatalogMedia, catalogMediaProjection } from './catalog-media.mjs'
import { subscriptionAccess } from './stripe-billing-policy.mjs'
import crypto from 'node:crypto'
import express from 'express'
import pg from 'pg'
import { loadCatalogMedia, streamCatalogPdf } from './catalog-pdf.mjs'
import { currentSocialBuyer, currentBuyerCustomer } from './buyer-whatsapp-auth-hooks.mjs'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 8, connectionTimeoutMillis: 5000 }) : null
const sessionCookie = 'atacado_session'
const visitorCookie = 'atacado_public'
const cursorKey = crypto.randomBytes(32)
const rateBuckets = new Map()

if (pool) pool.on('error', (error) => console.error('[catalog features] pool:', error.message))

const id = () => crypto.randomUUID()
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex')
const digits = (value) => String(value || '').replace(/\D/g, '')
const toMoney = (value) => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0
}
// Cada tipo comercial usa seu preço próprio, com fallback para o preço base.
// Uma exceção manual explícita do catálogo continua tendo prioridade.
// Caixa fechada preserva seu preço e multiplicador de estoque próprios.
// Catálogos personalizados escolhem explicitamente qual tabela utilizar.
const effectiveCatalogPrice = "COALESCE(cp.price_override,CASE WHEN c.kind='varejo' OR (c.kind='personalizado' AND c.price_mode='varejo') THEN p.retail_price WHEN c.kind='caixa_fechada' OR (c.kind='personalizado' AND c.price_mode='caixa_fechada') THEN p.box_price WHEN c.kind='atacado' OR (c.kind='personalizado' AND c.price_mode='atacado') THEN p.wholesale_price WHEN c.kind='alto_atacado' THEN p.high_wholesale_price ELSE p.price END,p.price)"
const isBoxCatalog = (catalog) => catalog.kind === 'caixa_fechada' || (catalog.kind === 'personalizado' && catalog.price_mode === 'caixa_fechada')
const catalogKinds = new Set(['varejo','atacado','alto_atacado','caixa_fechada','personalizado'])
const pricingModes = new Set(['base','varejo','atacado','caixa_fechada'])
function catalogConfiguration(body, previous = null) {
  const kind = body?.kind === undefined ? previous?.kind || 'varejo' : String(body.kind || '')
  if (!catalogKinds.has(kind) && !(kind === 'geral' && previous?.kind === 'geral')) {
    return { error: 'Escolha Varejo, Atacado, Alto Atacado ou Personalizado.' }
  }
  const customLabel = kind === 'personalizado'
    ? String(body?.customLabel === undefined ? previous?.custom_label || '' : body.customLabel || '').trim().slice(0,60)
    : ''
  if (kind === 'personalizado' && !customLabel) return { error: 'Defina o nome do tipo personalizado.' }
  const priceMode = kind === 'personalizado'
    ? String(body?.priceMode === undefined ? previous?.price_mode || 'base' : body.priceMode || '')
    : 'base'
  if (!pricingModes.has(priceMode)) return { error: 'Regra de preço personalizado inválida.' }
  return { kind, customLabel, priceMode }
}
const slugify = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'catalogo'

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
    `SELECT s.id AS store_id,s.plan_tier,u.id AS user_id,u.name,u.email
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
    await schemaReady()
    req.catalogStore = store
    next()
  } catch (error) { next(error) }
}

async function ensureSchema() {
  if (!pool) throw new Error('DATABASE_URL não configurada.')
  await pool.query(`
    CREATE TABLE IF NOT EXISTS catalogs (
      id text PRIMARY KEY,
      store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      slug text NOT NULL,
      name text NOT NULL,
      kind text NOT NULL DEFAULT 'geral',
      minimum_order numeric(12,2),
      is_default boolean NOT NULL DEFAULT false,
      active boolean NOT NULL DEFAULT true,
      explicit_membership boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(store_id,slug)
    );
    ALTER TABLE catalogs ADD COLUMN IF NOT EXISTS explicit_membership boolean NOT NULL DEFAULT false;
    ALTER TABLE catalogs ADD COLUMN IF NOT EXISTS custom_label text NOT NULL DEFAULT '';
    ALTER TABLE catalogs ADD COLUMN IF NOT EXISTS price_mode text NOT NULL DEFAULT 'base';
    -- Migração única: o código antigo chamava de atacado aquilo que o usuário
    -- via como "Caixa fechada". Preservar preço, estoque e pedidos antigos.
    ALTER TABLE catalogs ADD COLUMN IF NOT EXISTS kind_schema_version integer;
    UPDATE catalogs
       SET kind=CASE WHEN kind='atacado' THEN 'caixa_fechada' ELSE kind END,
           kind_schema_version=2
     WHERE kind_schema_version IS NULL;
    ALTER TABLE catalogs ALTER COLUMN kind_schema_version SET DEFAULT 2;
    ALTER TABLE catalogs ALTER COLUMN kind_schema_version SET NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_default_per_store ON catalogs(store_id) WHERE is_default=true;
    CREATE TABLE IF NOT EXISTS catalog_products (
      catalog_id text NOT NULL REFERENCES catalogs(id) ON DELETE CASCADE,
      product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      price_override numeric(12,2),
      visible boolean NOT NULL DEFAULT true,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(catalog_id,product_id)
    );
    ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS media_override jsonb;
    ALTER TABLE catalogs ADD COLUMN IF NOT EXISTS feed_enabled boolean;
    UPDATE catalogs SET feed_enabled=is_default WHERE feed_enabled IS NULL;
    ALTER TABLE catalogs ALTER COLUMN feed_enabled SET DEFAULT false;
    ALTER TABLE catalogs ALTER COLUMN feed_enabled SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_catalog_products_visible ON catalog_products(catalog_id,visible,product_id);
    ALTER TABLE products ADD COLUMN IF NOT EXISTS images jsonb NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS variant_prices jsonb;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS retail_price numeric(12,2);
    ALTER TABLE products ADD COLUMN IF NOT EXISTS wholesale_price numeric(12,2);
    ALTER TABLE products ADD COLUMN IF NOT EXISTS high_wholesale_price numeric(12,2);
    ALTER TABLE products ADD COLUMN IF NOT EXISTS box_price numeric(12,2);
    ALTER TABLE products ADD COLUMN IF NOT EXISTS units_per_box integer;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS catalog_id text REFERENCES catalogs(id) ON DELETE SET NULL;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS buyer jsonb NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS edit_revision integer NOT NULL DEFAULT 0;
    CREATE TABLE IF NOT EXISTS seller_order_access (
      seller_id text PRIMARY KEY REFERENCES sellers(id) ON DELETE CASCADE,
      invite_hash text UNIQUE, invite_expires_at timestamptz,
      session_hash text UNIQUE, session_expires_at timestamptz
    );
    CREATE TABLE IF NOT EXISTS order_edit_history (id bigserial PRIMARY KEY,order_id text NOT NULL REFERENCES orders(id) ON DELETE CASCADE,store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,user_id text NOT NULL,old_items jsonb NOT NULL,new_items jsonb NOT NULL,old_total numeric(12,2) NOT NULL,new_total numeric(12,2) NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
  `)
}

let schemaPromise = null
function schemaReady() {
  if (!schemaPromise) schemaPromise = ensureSchema().catch((error) => { schemaPromise = null; throw error })
  return schemaPromise
}
export async function ensureCatalogSchema() { return schemaReady() }

if (pool) {
  const timer = setTimeout(() => void schemaReady().catch((error) => console.error('[catalog features] schema:', error.message)), 800)
  timer.unref()
}

async function ensureDefaultCatalog(storeId, client = pool) {
  await schemaReady()
  let result = await client.query('SELECT * FROM catalogs WHERE store_id=$1 AND is_default=true LIMIT 1', [storeId])
  if (result.rowCount) return result.rows[0]
  try {
    result = await client.query(
      `INSERT INTO catalogs (id,store_id,slug,name,kind,is_default,active,feed_enabled)
       VALUES ($1,$2,'geral','Catálogo geral','geral',true,true,true)
       RETURNING *`,
      [id(), storeId],
    )
    return result.rows[0]
  } catch (error) {
    if (error?.code !== '23505') throw error
    result = await client.query('SELECT * FROM catalogs WHERE store_id=$1 AND is_default=true LIMIT 1', [storeId])
    return result.rows[0]
  }
}

async function resolveCatalog(storeId, requestedSlug, planCode, client = pool) {
  await ensureDefaultCatalog(storeId, client)
  if (requestedSlug) {
    const result = await client.query('SELECT * FROM catalogs WHERE store_id=$1 AND slug=$2 AND active=true LIMIT 1', [storeId, requestedSlug])
    const selected = result.rows[0] || null
    // Nunca trocar silenciosamente um link do varejo por outro catálogo: os valores divergem.
    return selected && (planCode === 'ouro' || selected.is_default) ? selected : null
  }
  const result = await client.query('SELECT * FROM catalogs WHERE store_id=$1 AND is_default=true AND active=true LIMIT 1', [storeId])
  return result.rows[0] || null
}

function catalogShape(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    customLabel: row.custom_label || '',
    priceMode: row.price_mode || 'base',
    minimumOrder: row.minimum_order == null ? null : Number(row.minimum_order),
    isDefault: Boolean(row.is_default),
    active: Boolean(row.active),
    explicitMembership: Boolean(row.explicit_membership),
    feedEnabled: Boolean(row.feed_enabled),
  }
}

async function listCatalogs(req, res) {
  const storeId = req.catalogStore.store_id
  await ensureDefaultCatalog(storeId)
  const catalogs = await pool.query('SELECT * FROM catalogs WHERE store_id=$1 ORDER BY is_default DESC,created_at ASC', [storeId])
  const mappings = req.query?.includeItems==='1'
    ? await pool.query(
      `SELECT cp.catalog_id,cp.product_id,cp.price_override,cp.visible
       FROM catalog_products cp JOIN catalogs c ON c.id=cp.catalog_id WHERE c.store_id=$1`,
      [storeId],
    )
    : { rows: [] }
  const byCatalog = new Map()
  for (const row of mappings.rows) {
    if (!byCatalog.has(row.catalog_id)) byCatalog.set(row.catalog_id, [])
    byCatalog.get(row.catalog_id).push({ productId: row.product_id, priceOverride: row.price_override == null ? null : Number(row.price_override), visible: Boolean(row.visible) })
  }
  return res.json({ canCreateMultiple: req.catalogStore.plan_tier === 'ouro',
    catalogs: catalogs.rows.map((row) => ({ ...catalogShape(row),
      lockedByPlan: req.catalogStore.plan_tier !== 'ouro' && !row.is_default,
      items: byCatalog.get(row.id) || [] })) })
}

async function productCatalogMemberships(req,res){
  const storeId=req.catalogStore.store_id
  await ensureDefaultCatalog(storeId)
  const productId=String(req.params.productId||'')
  if(productId!=='new'&&!(await pool.query('SELECT 1 FROM products WHERE id=$1 AND store_id=$2',[productId,storeId])).rowCount)
    return res.status(404).json({error:'Produto não encontrado.'})
  const result=await pool.query(`SELECT c.*,cp.price_override,cp.media_override,
    CASE WHEN c.explicit_membership THEN COALESCE(cp.visible,false) ELSE COALESCE(cp.visible,true) END AS included
    FROM catalogs c LEFT JOIN catalog_products cp ON cp.catalog_id=c.id AND cp.product_id=$2
    WHERE c.store_id=$1 ORDER BY c.is_default DESC,c.name,c.id`,[storeId,productId==='new'?null:productId])
  return res.json({catalogs:result.rows.map(row=>({...catalogShape(row),lockedByPlan:req.catalogStore.plan_tier!=='ouro'&&!row.is_default,
    included:Boolean(row.included),priceOverride:row.price_override==null?null:Number(row.price_override),mediaOverride:row.media_override||null}))})
}

async function createCatalog(req, res) {
  const storeId = req.catalogStore.store_id
  await ensureDefaultCatalog(storeId)
  if (req.catalogStore.plan_tier !== 'ouro') return res.status(403).json({
    error: 'Catálogos adicionais são exclusivos do plano Gold.', code: 'GOLD_REQUIRED',
  })
  const name = String(req.body?.name || '').trim().slice(0, 100)
  if (!name) return res.status(400).json({ error: 'Informe o nome do catálogo.' })
  const configuration = catalogConfiguration(req.body)
  if (configuration.error) return res.status(400).json({ error: configuration.error })
  const {kind, customLabel, priceMode} = configuration
  const minimumOrder = req.body?.minimumOrder === '' || req.body?.minimumOrder == null ? null : Math.max(0, toMoney(req.body.minimumOrder))
  const baseSlug = slugify(req.body?.slug || name)
  let slug = baseSlug
  for (let attempt = 2; attempt < 100; attempt += 1) {
    const exists = await pool.query('SELECT 1 FROM catalogs WHERE store_id=$1 AND slug=$2', [storeId, slug])
    if (!exists.rowCount) break
    slug = `${baseSlug}-${attempt}`.slice(0, 60)
  }
  const sourceId=String(req.body?.sourceCatalogId||'').trim()
  const client=await pool.connect()
  try{
    await client.query('BEGIN')
    if(sourceId&&sourceId!=='all'&&!(await client.query('SELECT 1 FROM catalogs WHERE id=$1 AND store_id=$2 FOR SHARE',[sourceId,storeId])).rowCount){
      await client.query('ROLLBACK')
      return res.status(404).json({error:'Catálogo de origem não encontrado nesta loja.'})
    }
    const result=await client.query(
      `INSERT INTO catalogs (id,store_id,slug,name,kind,custom_label,price_mode,minimum_order,is_default,active,explicit_membership,feed_enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false,true,true,$9) RETURNING *`,
      [id(),storeId,slug,name,kind,customLabel,priceMode,minimumOrder,req.body?.feedEnabled===true])
    const catalog=result.rows[0]
    let copied=0
    if(sourceId){
      const copy=await client.query(`INSERT INTO catalog_products(catalog_id,product_id,price_override,visible)
        SELECT $1,p.id,NULL,true FROM products p
        LEFT JOIN catalogs src ON src.id=$3 AND src.store_id=p.store_id
        LEFT JOIN catalog_products cp ON cp.catalog_id=src.id AND cp.product_id=p.id
        WHERE p.store_id=$2 AND ($3='all' OR (src.id IS NOT NULL AND
          CASE WHEN src.explicit_membership THEN cp.visible=true ELSE COALESCE(cp.visible,true) END))
        ON CONFLICT(catalog_id,product_id) DO NOTHING`,[catalog.id,storeId,sourceId])
      copied=copy.rowCount
    }
    await client.query('COMMIT')
    return res.status(201).json({catalog:{...catalogShape(catalog),items:[]},copied})
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}
  finally{client.release()}
}

async function updateCatalog(req, res) {
  const storeId = req.catalogStore.store_id
  const existing = await pool.query('SELECT * FROM catalogs WHERE id=$1 AND store_id=$2 LIMIT 1', [req.params.catalogId, storeId])
  if (!existing.rowCount) return res.status(404).json({ error: 'Catálogo não encontrado.' })
  const current = existing.rows[0]
  if (!current.is_default && req.catalogStore.plan_tier !== 'ouro') return res.status(403).json({
    error: 'Este catálogo adicional requer plano Gold. Faça upgrade para editar.', code: 'GOLD_REQUIRED',
  })
  const name = req.body?.name == null ? current.name : String(req.body.name).trim().slice(0, 100)
  if (!name) return res.status(400).json({ error: 'Informe o nome do catálogo.' })
  const configuration = catalogConfiguration(req.body, current)
  if (configuration.error) return res.status(400).json({ error: configuration.error })
  const {kind, customLabel, priceMode} = configuration
  const minimumOrder = req.body?.minimumOrder === undefined ? current.minimum_order : (req.body.minimumOrder === '' || req.body.minimumOrder == null ? null : Math.max(0, toMoney(req.body.minimumOrder)))
  const active = current.is_default ? true : req.body?.active !== false
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const updated = await client.query(
      'UPDATE catalogs SET name=$1,kind=$2,custom_label=$3,price_mode=$4,minimum_order=$5,active=$6,feed_enabled=COALESCE($9::boolean,feed_enabled),updated_at=now() WHERE id=$7 AND store_id=$8 RETURNING *',
      [name, kind, customLabel, priceMode, minimumOrder, active, current.id, storeId,typeof req.body?.feedEnabled==='boolean'?req.body.feedEnabled:null],
    )
    if (Array.isArray(req.body?.items)) {
      for (const item of req.body.items.slice(0, 10000)) {
        const productId = String(item?.productId || '')
        if (!productId) continue
        const ownership = await client.query('SELECT 1 FROM products WHERE id=$1 AND store_id=$2', [productId, storeId])
        if (!ownership.rowCount) continue
        const priceOverride = item?.priceOverride === '' || item?.priceOverride == null ? null : Math.max(0, toMoney(item.priceOverride))
        await client.query(
          `INSERT INTO catalog_products (catalog_id,product_id,price_override,visible)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (catalog_id,product_id) DO UPDATE SET price_override=EXCLUDED.price_override,visible=EXCLUDED.visible,updated_at=now()`,
          [current.id, productId, priceOverride, item?.visible !== false],
        )
      }
    }
    await client.query('COMMIT')
    return res.json({ catalog: catalogShape(updated.rows[0]) })
  } catch (error) {
    try { await client.query('ROLLBACK') } catch {}
    throw error
  } finally { client.release() }
}


/* Edição leve da participação no catálogo: não duplica registros de produto.
   Catálogos legados seguem em modo inclusivo até o dono organizá-los; os
   novos começam vazios (associação explícita). */
async function setCatalogMembers(req,res) {
 const storeId=req.catalogStore.store_id
 await ensureSchema()
 const found=await pool.query('SELECT * FROM catalogs WHERE id=$1 AND store_id=$2',[req.params.catalogId,storeId])
 if(!found.rowCount)return res.status(404).json({error:'Catálogo não encontrado.'})
 const catalog=found.rows[0]
 if(catalog.is_default)return res.status(400).json({error:'O catálogo geral reúne a base da loja.'})
 if(req.catalogStore.plan_tier!=='ouro')return res.status(403).json({error:'Catálogos adicionais requerem Gold.',code:'GOLD_REQUIRED'})
 const ids=[...new Set((Array.isArray(req.body?.ids)?req.body.ids:[]).map(x=>String(x||'').trim()).filter(Boolean))]
 if(!ids.length||ids.length>500)return res.status(400).json({error:'Escolha entre 1 e 500 produtos por operação.'})
 const action=req.body?.action
 if(!['add','remove'].includes(action))return res.status(400).json({error:'Operação inválida.'})
 if(action==='add'){
   const result=await pool.query(`
     INSERT INTO catalog_products (catalog_id,product_id,visible)
     SELECT $1,p.id,true FROM products p WHERE p.store_id=$2 AND p.id=ANY($3::text[])
     ON CONFLICT(catalog_id,product_id) DO UPDATE SET visible=true,
       price_override=CASE WHEN catalog_products.visible THEN catalog_products.price_override ELSE NULL END,
       updated_at=CASE WHEN catalog_products.visible THEN catalog_products.updated_at ELSE now() END
     RETURNING product_id`,[catalog.id,storeId,ids])
   return res.json({ok:true,changed:result.rowCount})
 }
 if(catalog.explicit_membership){
   const result=await pool.query(`
     DELETE FROM catalog_products cp USING products p
     WHERE cp.catalog_id=$1 AND cp.product_id=p.id AND p.store_id=$2 AND p.id=ANY($3::text[])
     RETURNING cp.product_id`,[catalog.id,storeId,ids])
   return res.json({ok:true,changed:result.rowCount})
 }
 const result=await pool.query(`
   INSERT INTO catalog_products(catalog_id,product_id,visible)
   SELECT $1,p.id,false FROM products p WHERE p.store_id=$2 AND p.id=ANY($3::text[])
   ON CONFLICT(catalog_id,product_id) DO UPDATE SET visible=false,updated_at=now()
   RETURNING product_id`,[catalog.id,storeId,ids])
 return res.json({ok:true,changed:result.rowCount})
}
async function downloadCatalogPdf(req, res) {
  const storeId = req.catalogStore.store_id
  const category = String(req.query?.category || '').trim().slice(0,80)
  await schemaReady()
  const catalogResult = await pool.query('SELECT * FROM catalogs WHERE id=$1 AND store_id=$2 LIMIT 1', [req.params.catalogId, storeId])
  if (!catalogResult.rowCount) return res.status(404).json({ error: 'Catálogo não encontrado.' })
  const storeResult = await pool.query('SELECT id,slug,name,logo_url,minimum_order,whatsapp,accent,seasonal_theme FROM stores WHERE id=$1 LIMIT 1', [storeId])
  if (!storeResult.rowCount) return res.status(404).json({ error: 'Loja não encontrada.' })
  const catalog = catalogResult.rows[0]
  if (!catalog.is_default && req.catalogStore.plan_tier !== 'ouro') return res.status(403).json({
    error: 'Exportação de catálogos adicionais disponível somente no plano Gold.', code: 'GOLD_REQUIRED',
  })
  const products = await pool.query(
    `SELECT p.id,p.sku,p.name,p.description,p.price,p.category,p.media_url,p.media_type,p.images,p.variations,cp.media_override,
            ${effectiveCatalogPrice} AS public_price
     FROM products p
     JOIN catalogs c ON c.id=$2
     LEFT JOIN catalog_products cp ON cp.product_id=p.id AND cp.catalog_id=$2
     WHERE p.store_id=$1 AND p.active=true AND (CASE WHEN c.explicit_membership THEN cp.visible=true ELSE COALESCE(cp.visible,true)=true END)
       AND ($3::text='' OR p.category=$3)
     ORDER BY p.category ASC,p.featured DESC,p.name ASC,p.id ASC`,
    [storeId, catalog.id, category],
  )
  await streamCatalogPdf({
    res,
    store: storeResult.rows[0],
    catalog,
    category,
    products: products.rows.map(withCatalogMedia),
    imageLoader: (url, variant = 'medium') => loadCatalogMedia(pool.query.bind(pool), url, variant),
  })
}

async function downloadProductsPdf(req, res) {
  const storeId = req.catalogStore.store_id
  const category = String(req.query?.category || '').trim().slice(0,80)
  await schemaReady()
  const storeResult = await pool.query(
    'SELECT id,slug,name,logo_url,minimum_order,whatsapp,accent,seasonal_theme FROM stores WHERE id=$1 LIMIT 1',
    [storeId],
  )
  if (!storeResult.rowCount) return res.status(404).json({ error: 'Loja não encontrada.' })

  const products = await pool.query(
    `SELECT p.id,p.sku,p.name,p.description,p.price,p.category,p.media_url,p.media_type,p.images,p.variations,
            p.price AS public_price
     FROM products p
     WHERE p.store_id=$1 AND p.active=true AND ($2::text='' OR p.category=$2)
     ORDER BY p.category ASC,p.featured DESC,p.name ASC,p.id ASC`,
    [storeId,category],
  )

  const store = storeResult.rows[0]
  await streamCatalogPdf({
    res,
    store,
    catalog: {
      name: 'Catálogo de produtos',
      kind: 'geral',
      minimum_order: store.minimum_order,
    },
    category,
    products: products.rows,
    imageLoader: (url, variant = 'medium') => loadCatalogMedia(pool.query.bind(pool), url, variant),
  })
}

async function deleteCatalog(req, res) {
  const result = await pool.query('DELETE FROM catalogs WHERE id=$1 AND store_id=$2 AND is_default=false RETURNING id', [req.params.catalogId, req.catalogStore.store_id])
  if (!result.rowCount) return res.status(400).json({ error: 'O catálogo principal não pode ser excluído.' })
  return res.status(204).end()
}

function ensureVisitor(req, res) {
  let visitor = parseCookies(req)[visitorCookie]
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(visitor || '')) {
    visitor = crypto.randomBytes(24).toString('base64url')
    const secure = req.secure || req.headers['x-forwarded-proto'] === 'https'
    res.cookie(visitorCookie, visitor, { httpOnly: true, sameSite: 'lax', secure, maxAge: 24 * 60 * 60 * 1000, path: '/' })
  }
  return visitor
}

function consume(key, windowMs, limit) {
  const now = Date.now()
  const bucketKey = `${key}:${windowMs}`
  const current = rateBuckets.get(bucketKey)
  if (!current || current.resetAt <= now) {
    rateBuckets.set(bucketKey, { count: 1, resetAt: now + windowMs })
    return { ok: true, retryAfter: 0 }
  }
  current.count += 1
  if (current.count <= limit) return { ok: true, retryAfter: 0 }
  return { ok: false, retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) }
}

function checkCatalogRate(req, visitor) {
  const ip = String(req.ip || req.socket?.remoteAddress || 'unknown')
  const ua = String(req.headers['user-agent'] || '')
  const automation = /(curl|wget|python-requests|scrapy|go-http-client|httpclient|libwww|aiohttp)/i.test(ua)
  const checks = [
    consume(`visitor:${visitor}`, 20_000, automation ? 3 : 10),
    consume(`visitor:${visitor}`, 10 * 60_000, automation ? 10 : 50),
    consume(`ip:${ip}`, 20_000, 45),
    consume(`ip:${ip}`, 10 * 60_000, 240),
  ]
  return checks.find((item) => !item.ok) || { ok: true, retryAfter: 0 }
}

function encodeCursor(payload) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', cursorKey, iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv, tag, ciphertext].map((part) => part.toString('base64url')).join('.')
}

function decodeCursor(token) {
  try {
    const [ivText, tagText, cipherText] = String(token || '').split('.')
    if (!ivText || !tagText || !cipherText) throw new Error('invalid')
    const iv = Buffer.from(ivText, 'base64url')
    const tag = Buffer.from(tagText, 'base64url')
    const ciphertext = Buffer.from(cipherText, 'base64url')
    const decipher = crypto.createDecipheriv('aes-256-gcm', cursorKey, iv)
    decipher.setAuthTag(tag)
    return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'))
  } catch { throw new Error('CURSOR_INVALID') }
}

function uniqueImages(row) {
  const values = [...(Array.isArray(row.images) ? row.images : []), row.media_type !== 'video' ? row.media_url : '']
  const seen = new Set()
  return values.map((value) => String(value || '').trim()).filter((value) => value && !seen.has(value) && seen.add(value)).slice(0, 40)
}

function publicProduct(product, catalog) {
  product=withCatalogMedia(product)
  const images = uniqueImages(product)
  const perBox = isBoxCatalog(catalog) ? Math.max(1, Number(product.units_per_box || 1)) : 1
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    description: product.description,
    price: Number(product.public_price ?? product.price),
    variantPrices: resolvedVariantPrices(product),
    category: product.category,
    mediaUrl: product.media_url || images[0] || '',
    mediaType: product.media_type,
    images,
    variantImages: Array.isArray(product.variant_images) ? product.variant_images : [],
    pack: product.pack || (perBox > 1 ? `Caixa fechada com ${perBox} unidades` : ''),
    unitsPerBox: perBox,
    variations: Array.isArray(product.variations) ? product.variations : [],
    featured: Boolean(product.featured),
    stockEnabled: Boolean(product.stock_enabled),
    stockQuantity: Math.floor(Math.max(0, Number(product.stock_quantity || 0)) / perBox),
    variantStock: product.variant_stock && typeof product.variant_stock === 'object'
      ? Object.fromEntries(Object.entries(product.variant_stock).map(([key,value])=>[key,Math.floor(Math.max(0,Number(value)||0)/perBox)])) : {},
  }
}

function catalogFromReferer(req) {
  try {
    const ref = new URL(String(req.headers.referer || ''))
    return String(ref.searchParams.get('catalog') || '')
  } catch { return '' }
}

async function protectedStore(req, res) {
  if (!pool) return res.status(503).json({ error: 'Loja ainda não conectada ao banco.' })
  await schemaReady()
  const visitor = ensureVisitor(req, res)
  const rate = checkCatalogRate(req, visitor)
  if (!rate.ok) {
    res.setHeader('Retry-After', String(rate.retryAfter))
    return res.status(429).json({ error: 'Navegação muito rápida. Aguarde alguns segundos e continue.' })
  }
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('X-Robots-Tag', 'noindex, noarchive, nosnippet')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Vary', 'Cookie')

  const storeResult = await pool.query('SELECT * FROM stores WHERE slug=$1 AND is_active=true LIMIT 1', [req.params.storeSlug])
  if (!storeResult.rowCount) return res.status(404).json({ error: 'Loja não encontrada.' })
  const store = storeResult.rows[0]
  const requestedCatalog = String(req.query.catalog || catalogFromReferer(req) || '').trim().slice(0, 60)
  const catalog = await resolveCatalog(store.id, requestedCatalog, store.plan_tier)
  if (!catalog) return res.status(404).json({ error: 'Catálogo não encontrado.' })

  let seller = null
  if (req.params.sellerSlug) {
    const sellerResult = await pool.query(
      "SELECT id,slug,name,phone FROM sellers WHERE store_id=$1 AND slug=$2 AND is_active=true AND length(regexp_replace(phone,'[^0-9]','','g'))>=10 LIMIT 1",
      [store.id, req.params.sellerSlug],
    )
    seller = sellerResult.rows[0] || null
  }
  if (!seller) {
    // URL geral ou vendedora indisponível: usar somente uma vendedora ativa, nunca o número da loja.
    const available = await pool.query(
      "SELECT id,slug,name,phone FROM sellers WHERE store_id=$1 AND is_active=true AND length(regexp_replace(phone,'[^0-9]','','g'))>=10 ORDER BY created_at ASC,id ASC LIMIT 1",
      [store.id],
    )
    seller = available.rows[0] || null
  }
  if (!seller) seller = { id: null, slug: '', name: 'Atendimento indisponível', phone: '' }

  const q = String(req.query.q || '').trim().slice(0, 100)
  const category = String(req.query.category || '').trim().slice(0, 80)
  const sort = ['newest', 'price_asc', 'price_desc'].includes(String(req.query.sort || '')) ? String(req.query.sort) : 'newest'
  const requestedLimit = Number(req.query.limit || 24)
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(24, Math.floor(requestedLimit))) : 24
  let cursor = null
  if (req.query.cursor) {
    try { cursor = decodeCursor(req.query.cursor) } catch { return res.status(400).json({ error: 'Página inválida. Atualize a loja para continuar.' }) }
    const valid = cursor?.storeId === store.id && cursor?.visitor === visitor && cursor?.sellerSlug === String(req.params.sellerSlug || '') && cursor?.q === q && cursor?.category === category && (cursor?.sort || 'newest') === sort && cursor?.catalogSlug === catalog.slug && Number(cursor?.expiresAt || 0) > Date.now()
    if (!valid) return res.status(400).json({ error: 'Página inválida. Atualize a loja para continuar.' })
  }

  // Optional pagination-only response for our storefront. First load, search and
  // external consumers retain the full response and all catalog metadata.
  const compactPage = Boolean(cursor && req.query.compactPage === '1')
  const params = [store.id, catalog.id]
  const conditions = ['p.store_id=$1', 'p.active=true', '(CASE WHEN c.explicit_membership THEN cp.visible=true ELSE COALESCE(cp.visible,true)=true END)']
  const sqlParam = (index) => String.fromCharCode(36) + index
  if (category) { params.push(category); conditions.push(`p.category=${sqlParam(params.length)}`) }
  if (q) { params.push(`%${q.toLowerCase()}%`); conditions.push(`lower(p.name || ' ' || p.sku || ' ' || p.category) LIKE ${sqlParam(params.length)}`) }
  const sortPrice = effectiveCatalogPrice
  if (cursor) {
    if (sort === 'newest') {
      params.push(Number(cursor.featured || 0), cursor.createdAt, cursor.id)
      const featuredIndex = params.length - 2
      const createdIndex = params.length - 1
      const idIndex = params.length
      conditions.push(`(p.featured::int < ${sqlParam(featuredIndex)} OR (p.featured::int=${sqlParam(featuredIndex)} AND p.created_at<${sqlParam(createdIndex)}::timestamptz) OR (p.featured::int=${sqlParam(featuredIndex)} AND p.created_at=${sqlParam(createdIndex)}::timestamptz AND p.id<${sqlParam(idIndex)}))`)
    } else {
      const price = Number(cursor.price)
      if (!Number.isFinite(price) || price < 0) return res.status(400).json({ error:'Página inválida. Atualize a loja para continuar.' })
      params.push(price,cursor.id)
      const priceIdx=params.length-1,idIdx=params.length
      const comparator=sort === 'price_asc' ? '>' : '<'
      conditions.push(`(${sortPrice} ${comparator} ${sqlParam(priceIdx)}::numeric OR (${sortPrice}=${sqlParam(priceIdx)}::numeric AND p.id<${sqlParam(idIdx)}))`)
    }
  }
  const orderBy = sort === 'price_asc' ? `${sortPrice} ASC,p.id DESC` : sort === 'price_desc' ? `${sortPrice} DESC,p.id DESC` : 'p.featured DESC,p.created_at DESC,p.id DESC'
  params.push(limit + 1)
  const productsResult = await pool.query(
    `SELECT p.*,p.created_at::text AS created_at_cursor,cp.media_override,${effectiveCatalogPrice} AS public_price
     FROM products p JOIN catalogs c ON c.id=$2
     LEFT JOIN catalog_products cp ON cp.product_id=p.id AND cp.catalog_id=$2
     WHERE ${conditions.join(' AND ')} ORDER BY ${orderBy} LIMIT ${sqlParam(params.length)}`,
    params,
  )
  const hasMore = productsResult.rows.length > limit
  const pageRows = productsResult.rows.slice(0, limit)
  const last = pageRows.at(-1)
  const nextCursor = hasMore && last ? encodeCursor({ storeId: store.id, visitor, sellerSlug: String(req.params.sellerSlug || ''), q, category, catalogSlug: catalog.slug, sort, price: Number(last.public_price), featured: last.featured ? 1 : 0, createdAt: last.created_at_cursor, id: last.id, expiresAt: Date.now() + 30 * 60_000 }) : null
  const [categoriesResult, catalogsResult] = compactPage ? [null, null] : await Promise.all([
    pool.query(
      `SELECT DISTINCT p.category FROM products p LEFT JOIN catalog_products cp ON cp.product_id=p.id AND cp.catalog_id=$2
       WHERE p.store_id=$1 AND p.active=true AND p.category<>'' AND EXISTS (SELECT 1 FROM catalogs c WHERE c.id=$2 AND (CASE WHEN c.explicit_membership THEN cp.visible=true ELSE COALESCE(cp.visible,true)=true END)) ORDER BY p.category ASC LIMIT 100`,
      [store.id, catalog.id],
    ),
    pool.query("SELECT * FROM catalogs WHERE store_id=$1 AND active=true AND ($2::boolean OR is_default=true) ORDER BY is_default DESC,created_at ASC", [store.id,store.plan_tier==='ouro']),
  ])
  return res.json({
    store: { slug: store.slug, name: store.name, eyebrow: store.eyebrow, tagline: store.tagline, minimumOrder: catalog.minimum_order == null ? Number(store.minimum_order) : Number(catalog.minimum_order), whatsapp: store.whatsapp, logoUrl: store.logo_url, accent: store.accent, seasonalTheme: store.seasonal_theme || 'padrao' },
    seller,
    ...(compactPage ? {} : {
      catalogs: catalogsResult.rows.map(catalogShape),
      activeCatalog: catalogShape(catalog),
      categories: categoriesResult.rows.map((row) => row.category),
    }),
    products: pageRows.map((product) => publicProduct(product, catalog)),
    page: { hasMore, nextCursor, limit },
  })
}

// Catálogos comerciais continuam públicos pelo link. Só a consulta iniciada
// no ambiente social exige identificação; o feed não entrega preços.
async function socialProductOffers(req, res) {
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('Vary', 'Cookie')
  const buyer = await currentSocialBuyer(req)
  // Proprietário autenticado pode consultar as ofertas somente da própria loja.
  // Não é uma sessão de comprador e NÃO autoriza preparar pedidos.
  const owner = buyer ? null : await currentStore(req)
  if (!buyer && !owner) return res.status(401).json({ code: 'BUYER_PROFILE_REQUIRED', error: 'Entre com WhatsApp e escolha seu perfil de compra para ver preços.' })
  await schemaReady()
  const slug = String(req.params.storeSlug || '').trim().slice(0, 80)
  const productId = String(req.params.productId || '').trim().slice(0, 100)
  const found = await pool.query(`SELECT p.*,s.plan_tier,s.minimum_order AS store_minimum_order
    FROM products p JOIN stores s ON s.id=p.store_id
    WHERE s.slug=$1 AND s.is_active=true AND s.social_enabled=true AND p.id=$2
      AND p.active=true AND p.social_published=true LIMIT 1`, [slug, productId])
  if (!found.rowCount) return res.status(404).json({ error: 'Produto indisponível.' })
  const p = found.rows[0]
  const ownerPreview = !buyer && owner?.store_id === p.store_id
  if (!buyer && !ownerPreview) return res.status(401).json({ code: 'BUYER_PROFILE_REQUIRED', error: 'Entre com WhatsApp para consultar preços de outras lojas.' })
  await ensureDefaultCatalog(p.store_id)
  const available = await pool.query(`SELECT c.id,c.slug,c.name,c.kind,c.custom_label,c.price_mode,c.is_default,c.minimum_order,
    ${effectiveCatalogPrice} AS public_price,cp.media_override
    FROM catalogs c JOIN products p ON p.id=$2
    LEFT JOIN catalog_products cp ON cp.catalog_id=c.id AND cp.product_id=p.id
    WHERE c.store_id=$1 AND c.active=true AND ($3::boolean OR c.is_default)
      AND (CASE WHEN c.explicit_membership THEN cp.visible=true ELSE COALESCE(cp.visible,true)=true END)
    ORDER BY c.is_default DESC,c.created_at ASC`, [p.store_id, p.id, p.plan_tier==='ouro'])
  if (!available.rowCount) return res.status(404).json({ error: 'Produto indisponível nos catálogos da loja.' })
  return res.json({
    product: { id:p.id, sku:p.sku, name:p.name, description:p.description, category:p.category,
      images:Array.isArray(p.images)?p.images:[], mediaUrl:p.media_url||'', mediaType:p.media_type==='video'?'video':'image', variations:Array.isArray(p.variations)?p.variations:[] },
    buyerPurpose: buyer?.purpose || 'revenda',
    ownerPreview,
    offers: available.rows.map(c => ({
      id:c.id, slug:c.slug, name:c.name, kind:c.kind, customLabel:c.custom_label||'', priceMode:c.price_mode||'base',
      ...catalogMediaProjection(withCatalogMedia({...p,media_override:c.media_override})),
      price:Number(c.public_price), variantPrices:resolvedVariantPrices(p,c.public_price), minimumOrder:c.minimum_order == null ? Number(p.store_minimum_order || 0) : Number(c.minimum_order),
      unitsPerBox:isBoxCatalog(c) ? Math.max(1,Number(p.units_per_box || 1)) : 1
    }))
  })
}

async function socialCreateOrder(req, res) {
  res.setHeader('Cache-Control', 'private, no-store')
  const buyer = await currentSocialBuyer(req)
  if (!buyer) return res.status(401).json({ code:'BUYER_PROFILE_REQUIRED', error:'Confirme seu perfil de comprador antes de enviar o pedido.' })
  const slug = String(req.body?.storeSlug || '').trim().slice(0, 80)
  const store = await pool.query('SELECT id FROM stores WHERE slug=$1 AND is_active=true AND social_enabled=true LIMIT 1', [slug])
  if (!store.rowCount) return res.status(404).json({ error: 'Loja não encontrada.' })
  const customer = await currentBuyerCustomer(req, store.rows[0].id)
  req.shopvaxCustomerId = customer?.id || null
  return createCatalogOrder(req, res)
}

function normalizeSelections(value) {
  return Object.fromEntries(Object.entries(value && typeof value === 'object' ? value : {}).map(([key, option]) => [String(key).trim().slice(0, 40), String(option).trim().slice(0, 60)]).filter(([key, option]) => key && option).sort(([a], [b]) => a.localeCompare(b, 'pt-BR')))
}
function variantKey(value) { return Object.entries(normalizeSelections(value)).map(([key, option]) => `${key}=${option}`).join('|') }
function clampStock(value) { return Math.max(0, Math.min(999999999, Math.floor(Number(value) || 0))) }
function normalizeVariantStock(value) {
  const result = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result
  for (const [key, qty] of Object.entries(value)) result[String(key).slice(0, 500)] = clampStock(qty)
  return result
}
function validateProductSelections(product, requested) {
  const selections = {}
  for (const group of Array.isArray(product.variations) ? product.variations : []) {
    const name = String(group?.name || '')
    const options = Array.isArray(group?.options) ? group.options.map(String) : []
    const selected = String(requested?.[name] || '')
    if (!selected || !options.includes(selected)) throw new Error(`Escolha ${name} para ${product.name}.`)
    selections[name] = selected
  }
  assertKnownOrderSelections(product, requested, selections)
  return normalizeSelections(selections)
}
function availableStock(product, selections) {
  if (!product.stock_enabled) return Number.POSITIVE_INFINITY
  const map = normalizeVariantStock(product.variant_stock)
  const key = variantKey(selections)
  return key && Object.prototype.hasOwnProperty.call(map, key) ? clampStock(map[key]) : clampStock(product.stock_quantity)
}

async function createCatalogOrder(req, res) {
  await schemaReady()
  const storeResult = await pool.query('SELECT * FROM stores WHERE slug=$1 AND is_active=true LIMIT 1', [String(req.body?.storeSlug || '')])
  if (!storeResult.rowCount) return res.status(404).json({ error: 'Loja não encontrada.' })
  const store = storeResult.rows[0]
  // O catálogo por link permanece aberto a visitantes. Quando há sessão
  // verificada, vincula-se o pedido à conta global para o histórico.
  if (!req.shopvaxCustomerId && await currentSocialBuyer(req)) {
    const customer = await currentBuyerCustomer(req,store.id)
    req.shopvaxCustomerId = customer?.id || null
  }
  const catalog = await resolveCatalog(store.id, String(req.body?.catalogSlug || '').trim(), store.plan_tier)
  if (!catalog) return res.status(404).json({ error: 'Catálogo não encontrado.' })
  const requestedItems = Array.isArray(req.body?.items) ? req.body.items : []
  if (!requestedItems.length) return res.status(400).json({ error: 'Carrinho vazio.' })
  const productIds = [...new Set(requestedItems.map((item) => String(item?.productId || '')).filter(Boolean))]
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const productsResult = await client.query(
      `SELECT p.*,cp.media_override,${effectiveCatalogPrice} AS public_price,(CASE WHEN c.explicit_membership THEN cp.visible=true ELSE COALESCE(cp.visible,true) END) AS catalog_visible
       FROM products p JOIN catalogs c ON c.id=$3
       LEFT JOIN catalog_products cp ON cp.product_id=p.id AND cp.catalog_id=$3
       WHERE p.store_id=$1 AND p.active=true AND p.id=ANY($2::text[]) ORDER BY p.id FOR UPDATE OF p`,
      [store.id, productIds, catalog.id],
    )
    const byId = new Map(productsResult.rows.map((product) => [product.id, product]))
    const items = []
    let total = 0
    for (const requested of requestedItems) {
      const product = byId.get(String(requested?.productId || ''))
      if (!product || !product.catalog_visible) continue
      let selections
      try { selections = validateProductSelections(product, requested?.selections) }
      catch (error) { await client.query('ROLLBACK'); return res.status(400).json({ error: error.message }) }
      const quantity = Math.max(1, Math.min(999, Math.floor(Number(requested?.quantity) || 1)))
      const unitsPerBox = isBoxCatalog(catalog) ? Math.max(1,Number(product.units_per_box || 1)) : 1
      const stockUnits = quantity * unitsPerBox
      const stock = availableStock(product, selections)
      if (stock < stockUnits) { await client.query('ROLLBACK'); return res.status(409).json({ error: stock <= 0 ? `${product.name} está sem estoque.` : `Restam apenas ${stock} unidade(s) de ${product.name} nessa variação.` }) }
      const unitPrice = variantUnitPrice(product, selections)
      const lineTotal = toMoney(unitPrice * quantity)
      total += lineTotal
      items.push({ productId: product.id, sku: product.sku, name: product.name, ...orderProductDetails(withCatalogMedia(product), selections), quantity, unitPrice, lineTotal, selections, stockKey: variantKey(selections), catalogId: catalog.id, stockUnits, unitsPerBox, stockDebited:Boolean(product.stock_enabled) })
      if (product.stock_enabled) {
        const map = normalizeVariantStock(product.variant_stock)
        const key = variantKey(selections)
        if (key && Object.prototype.hasOwnProperty.call(map, key)) {
          map[key] = clampStock(map[key] - stockUnits)
          await client.query('UPDATE products SET variant_stock=$1,updated_at=now() WHERE id=$2', [JSON.stringify(map), product.id])
          product.variant_stock = map
        } else {
          product.stock_quantity = clampStock(product.stock_quantity - stockUnits)
          await client.query('UPDATE products SET stock_quantity=$1,updated_at=now() WHERE id=$2', [product.stock_quantity, product.id])
        }
      }
    }
    total = toMoney(total)
    if (!items.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Nenhum produto válido no carrinho.' }) }
    const minimum = catalog.minimum_order == null ? Number(store.minimum_order) : Number(catalog.minimum_order)
    if (total < minimum) { await client.query('ROLLBACK'); return res.status(400).json({ error: `O pedido mínimo deste catálogo é R$ ${minimum.toFixed(2).replace('.', ',')}.` }) }
    let seller = null
    if (req.body?.sellerSlug) {
      const sellerResult = await client.query('SELECT * FROM sellers WHERE store_id=$1 AND slug=$2 AND is_active=true LIMIT 1', [store.id, req.body.sellerSlug])
      seller = sellerResult.rows[0] || null
    }
    if (!seller || digits(seller.phone).length < 10) {
      const available = await client.query(
        `SELECT * FROM sellers WHERE store_id=$1 AND is_active=true
         AND length(regexp_replace(phone, '[^0-9]', '', 'g'))>=10
         ORDER BY created_at ASC,id ASC LIMIT 1`,
        [store.id],
      )
      seller = available.rows[0] || null
    }
    const phone = digits(seller?.phone || '')
    if (phone.length < 10) {
      await client.query('ROLLBACK')
      return res.status(409).json({ code: 'NO_AVAILABLE_SELLER', error: 'Nenhuma vendedora disponível para receber o pedido. Ative uma vendedora antes de continuar.' })
    }
    const inputBuyer = req.body?.buyer && typeof req.body.buyer === 'object' && !Array.isArray(req.body.buyer) ? req.body.buyer : {}
    const safeText = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
    const buyer = {
      name: safeText(inputBuyer.name, 120),
      city: safeText(inputBuyer.city, 100),
      cep: digits(inputBuyer.cep).slice(0, 8),
      phone: digits(inputBuyer.phone).slice(0, 20),
    }
    if (buyer.cep && buyer.cep.length !== 8) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'O CEP precisa ter 8 dígitos.' })
    }
    if (buyer.phone && buyer.phone.length < 10) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'Informe um telefone válido ou deixe o campo em branco.' })
    }
    const notes = safeText(req.body?.notes, 500)
    const code = `AS-${Date.now().toString().slice(-6)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`
    const orderId = id()
    await client.query('INSERT INTO orders (id,code,store_id,seller_id,catalog_id,total,items,status,buyer,notes,customer_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [orderId, code, store.id, seller?.id || null, catalog.id, total, JSON.stringify(items), 'whatsapp', JSON.stringify(buyer), notes, req.shopvaxCustomerId || null])
    await client.query('INSERT INTO events (id,store_id,seller_id,kind) VALUES ($1,$2,$3,$4)', [id(), store.id, seller?.id || null, 'whatsapp'])
    await client.query('COMMIT')
    const message = buildOrderWhatsappMessage({ order: { code, items, buyer, notes }, store, seller, catalog, total })
    return res.status(201).json({ code, orderId, catalog: catalogShape(catalog), whatsappUrl: `https://wa.me/${phone}?text=${encodeURIComponent(message)}` })
  } catch (error) {
    try { await client.query('ROLLBACK') } catch {}
    throw error
  } finally { client.release() }
}


const sellerCookie='shopvax_seller_orders'
const sellerCookieOptions={httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV!=='test'&&process.env.NODE_ENV!=='development',path:'/api/seller-orders'}
const sellerToken=()=>crypto.randomBytes(32).toString('base64url')
function sellerTokenValid(token){return typeof token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(token)}
async function issueSellerOrderAccess(req,res){
  const seller=await pool.query('SELECT id FROM sellers WHERE id=$1 AND store_id=$2 AND is_active=true',[req.params.sellerId,req.catalogStore.store_id])
  if(!seller.rowCount)return res.status(404).json({error:'Vendedora ativa não encontrada.'})
  const token=sellerToken()
  await pool.query(`INSERT INTO seller_order_access(seller_id,invite_hash,invite_expires_at)
    VALUES($1,$2,now()+interval '24 hours') ON CONFLICT(seller_id) DO UPDATE
    SET invite_hash=EXCLUDED.invite_hash,invite_expires_at=EXCLUDED.invite_expires_at,session_hash=NULL,session_expires_at=NULL`,[seller.rows[0].id,hashToken(token)])
  res.set('Cache-Control','no-store').json({token})
}
async function revokeSellerOrderAccess(req,res){
  await pool.query('DELETE FROM seller_order_access a USING sellers s WHERE a.seller_id=s.id AND s.id=$1 AND s.store_id=$2',[req.params.sellerId,req.catalogStore.store_id])
  res.set('Cache-Control','no-store').json({ok:true})
}
async function exchangeSellerOrderAccess(req,res){
  await schemaReady()
  res.set('Cache-Control','no-store')
  const invite=req.body?.token
  if(!sellerTokenValid(invite))return res.status(401).json({error:'Convite inválido ou expirado.'})
  const token=sellerToken()
  const found=await pool.query(`UPDATE seller_order_access a SET invite_hash=NULL,invite_expires_at=NULL,
    session_hash=$2,session_expires_at=now()+interval '7 days' FROM sellers s
    WHERE a.seller_id=s.id AND s.is_active=true AND a.invite_hash=$1 AND a.invite_expires_at>now()
    RETURNING a.seller_id`,[hashToken(invite),hashToken(token)])
  if(!found.rowCount)return res.status(401).json({error:'Convite já utilizado ou expirado. Solicite um novo acesso à loja.'})
  res.cookie(sellerCookie,token,{...sellerCookieOptions,maxAge:7*86400000}).json({ok:true})
}
async function requireSellerOrder(req,res,next){
  try{
    res.set('Cache-Control','no-store')
    await schemaReady()
    const token=parseCookies(req)[sellerCookie]
    if(!sellerTokenValid(token))return res.status(401).json({error:'Acesso de vendedora necessário.'})
    const result=await pool.query(`SELECT s.id AS seller_id,s.slug AS seller_slug,s.name AS seller_name,
      st.id AS store_id,st.name AS store_name,st.plan_tier,st.billing_required,st.admin_grant_active,st.admin_grant_expires_at,
      b.subscription_status,b.active_plan_code,b.paid_until
      FROM seller_order_access a JOIN sellers s ON s.id=a.seller_id JOIN stores st ON st.id=s.store_id
      LEFT JOIN shopvax_stripe_billing b ON b.store_id=st.id
      WHERE a.session_hash=$1 AND a.session_expires_at>now() AND s.is_active=true AND st.is_active=true`,[hashToken(token)])
    const seller=result.rows[0]
    if(!seller)return res.status(401).json({error:'Acesso expirado ou revogado. Solicite um novo convite.'})
    if(!(process.env.NODE_ENV==='test'&&process.env.SHOPVAX_TEST_BILLING_BYPASS==='1')&&!subscriptionAccess(seller))
      return res.status(402).json({error:'A assinatura da loja precisa estar ativa.'})
    req.catalogStore={...seller,user_id:'seller:'+seller.seller_id,seller_session_hash:hashToken(token)}
    next()
  }catch(error){next(error)}
}
async function sellerOrders(req,res){
  const s=req.catalogStore
  const result=await pool.query('SELECT * FROM orders WHERE store_id=$1 AND seller_id=$2 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100',[s.store_id,s.seller_id])
  res.json({store:{name:s.store_name},sellers:[{id:s.seller_id,name:s.seller_name,slug:s.seller_slug}],orders:result.rows.map(o=>({...o,total:Number(o.total)}))})
}
async function sellerOrderProducts(req,res){
  const s=req.catalogStore
  const order=(await pool.query('SELECT catalog_id FROM orders WHERE id=$1 AND store_id=$2 AND seller_id=$3 AND deleted_at IS NULL',[req.params.orderId,s.store_id,s.seller_id])).rows[0]
  if(!order)return res.status(404).json({error:'Pedido não encontrado.'})
  const q=String(req.query.q||'').trim().slice(0,150)
  if(!q)return res.json({products:[]})
  const result=await pool.query(`SELECT p.id,p.name,p.sku,p.price,p.variations,p.variant_prices,p.active,
      CASE WHEN c.id IS NULL THEN p.price ELSE ${effectiveCatalogPrice} END AS catalog_price
    FROM products p LEFT JOIN catalogs c ON c.id=$3 AND c.store_id=p.store_id
    LEFT JOIN catalog_products cp ON cp.catalog_id=c.id AND cp.product_id=p.id
    WHERE p.store_id=$1 AND p.active=true AND lower(p.name||' '||p.sku) LIKE $2
      AND (c.id IS NULL OR CASE WHEN c.explicit_membership THEN cp.visible=true ELSE COALESCE(cp.visible,true) END)
    ORDER BY p.name,p.id LIMIT 20`,[s.store_id,'%'+q.toLowerCase()+'%',order.catalog_id])
  res.json({products:result.rows.map(p=>({...p,price:Number(p.price),catalogPrice:Number(p.catalog_price)}))})
}
async function logoutSellerOrder(req,res){
  const token=parseCookies(req)[sellerCookie]
  if(sellerTokenValid(token)){
    await schemaReady()
    await pool.query('UPDATE seller_order_access SET session_hash=NULL,session_expires_at=NULL WHERE session_hash=$1',[hashToken(token)])
  }
  res.clearCookie(sellerCookie,sellerCookieOptions).set('Cache-Control','no-store').json({ok:true})
}

async function editCatalogOrder(req,res) {
  const storeId=req.catalogStore.store_id
  const requested=req.body?.items
  if(!Array.isArray(requested)||!requested.length||requested.length>500)
    return res.status(400).json({error:'Informe de 1 a 500 itens no pedido.'})
  const client=await pool.connect()
  const reject=(status,message)=>Object.assign(new Error(message),{editStatus:status})
  try {
    await client.query('BEGIN')
    const sellerId=req.catalogStore.seller_id||null
    if(sellerId){
      const access=await client.query(`SELECT a.seller_id FROM seller_order_access a JOIN sellers s ON s.id=a.seller_id
        WHERE a.seller_id=$1 AND a.session_hash=$2 AND a.session_expires_at>now() AND s.is_active=true AND s.store_id=$3 FOR SHARE OF a,s`,
        [sellerId,req.catalogStore.seller_session_hash,storeId])
      if(!access.rowCount)throw reject(401,'Acesso de vendedora expirado ou revogado.')
    }
    const found=await client.query('SELECT * FROM orders WHERE id=$1 AND store_id=$2 AND ($3::text IS NULL OR seller_id=$3) AND deleted_at IS NULL FOR UPDATE',[req.params.orderId,storeId,sellerId])
    if(!found.rowCount)throw reject(404,'Pedido não encontrado.')
    const order=found.rows[0]
    if(!['whatsapp','em_atendimento','confirmado'].includes(order.status)||order.stock_reverted)
      throw reject(409,'Este pedido não pode mais ser editado.')
    if(String(order.payment_status||'none')!=='none'||Number(order.shipping_amount||0)>0||order.shipping_method)
      throw reject(409,'Pedido com cobrança ou frete online registrado não pode ser editado diretamente.')
    const paymentTables=(await client.query("SELECT to_regclass('order_payments') AS payments,to_regclass('shopvax_payment_claims') AS claims")).rows[0]
    if(paymentTables.payments&&(await client.query('SELECT 1 FROM order_payments WHERE store_id=$1 AND order_id=$2 LIMIT 1',[storeId,order.id])).rowCount)
      throw reject(409,'Já existe uma cobrança para este pedido.')
    if(paymentTables.claims&&(await client.query('SELECT 1 FROM shopvax_payment_claims WHERE store_id=$1 AND order_id=$2 LIMIT 1',[storeId,order.id])).rowCount)
      throw reject(409,'Existe uma cobrança em processamento ou conciliação.')
    const revision=Number(order.edit_revision||0)
    if(!Number.isSafeInteger(req.body?.revision)||req.body.revision!==revision)
      throw reject(409,'O pedido foi alterado em outra sessão. Atualize o painel e tente novamente.')
    const previous=Array.isArray(order.items)?order.items:[]
    const ids=[...new Set([...previous,...requested].map(i=>String(i?.productId||'')).filter(Boolean))].sort()
    const products=await client.query('SELECT * FROM products WHERE store_id=$1 AND id=ANY($2::text[]) ORDER BY id FOR UPDATE',[storeId,ids])
    const byId=new Map(products.rows.map(p=>[p.id,p]))
    const catalog=order.catalog_id?(await client.query('SELECT * FROM catalogs WHERE id=$1 AND store_id=$2',[order.catalog_id,storeId])).rows[0]:null
    const used=new Set(), nextItems=[], deltas=new Map()
    function delta(product,key,amount){
      if(!product?.stock_enabled||!amount)return
      const map=normalizeVariantStock(product.variant_stock)
      const bucket=key&&Object.hasOwn(map,key)?key:''
      const k=JSON.stringify([product.id,bucket])
      const entry=deltas.get(k)||{product,bucket,amount:0}
      entry.amount+=amount;deltas.set(k,entry)
    }
    for(const old of previous){
      const product=byId.get(String(old.productId||''))
      if(old.stockDebited===false)continue
      delta(product,String(old.stockKey||variantKey(old.selections)),Number(old.stockUnits??old.quantity))
    }
    let totalCents=0
    for(const item of requested){
      const quantity=Number(item?.quantity),unitPrice=Number(item?.unitPrice)
      if(!Number.isSafeInteger(quantity)||quantity<1||quantity>999||!Number.isFinite(unitPrice)||unitPrice<0||unitPrice>9999999999.99)
        throw reject(400,'Informe quantidade inteira de 1 a 999 e preço válido.')
      const cents=Math.round(unitPrice*100)
      const lineCents=cents*quantity
      totalCents+=lineCents
      if(!Number.isSafeInteger(totalCents)||totalCents>999999999999)throw reject(400,'Total do pedido excede o limite permitido.')
      let row,product
      if(item.originalIndex!==undefined){
        const index=item.originalIndex
        if(!Number.isSafeInteger(index)||index<0||index>=previous.length||used.has(index))
          throw reject(400,'Item original inválido ou duplicado.')
        used.add(index)
        const old=previous[index]
        if(String(item.productId||'')!==String(old.productId||''))throw reject(400,'Para trocar o produto, remova o item e adicione outro.')
        product=byId.get(String(old.productId||''))
        if(!product&&quantity>Number(old.quantity))throw reject(409,'Não é possível aumentar a quantidade de um produto excluído.')
        const multiplier=Math.max(1,Number(old.unitsPerBox||1))
        const stockUnits=quantity*multiplier
        row={...old,quantity,unitPrice:cents/100,lineTotal:lineCents/100,stockUnits,unitsPerBox:multiplier}
        if(old.stockDebited===false){
          // An originally untracked line stays untracked; increasing it with tracking
          // enabled requires a new line to avoid inventing historical stock.
          if(product?.stock_enabled&&quantity>Number(old.quantity))throw reject(409,'Adicione a quantidade extra em um novo item com estoque ativo.')
        }else delta(product,String(old.stockKey||variantKey(old.selections)),-stockUnits)
      }else{
        product=byId.get(String(item.productId||''))
        if(!product?.active)throw reject(400,'Produto não disponível nesta loja.')
        let mediaProduct=product
        if(catalog){
          const member=(await client.query('SELECT visible,media_override FROM catalog_products WHERE catalog_id=$1 AND product_id=$2',[catalog.id,product.id])).rows[0]
          mediaProduct=withCatalogMedia({...product,media_override:member?.media_override})
          if(catalog.explicit_membership?member?.visible!==true:member?.visible===false)
            throw reject(400,'Produto não disponível neste catálogo.')
        }
        let selections
        try{selections=validateProductSelections(product,item.selections)}catch(error){throw reject(400,error.message)}
        const unitsPerBox=catalog&&isBoxCatalog(catalog)?Math.max(1,Number(product.units_per_box||1)):1
        const stockUnits=quantity*unitsPerBox,stockKey=variantKey(selections)
        row={productId:product.id,sku:product.sku,name:product.name,...orderProductDetails(mediaProduct,selections),quantity,unitPrice:cents/100,lineTotal:lineCents/100,selections,stockKey,stockUnits,unitsPerBox,stockDebited:Boolean(product.stock_enabled),catalogId:catalog?.id||null}
        delta(product,stockKey,-stockUnits)
      }
      nextItems.push(row)
    }
    for(const {product,bucket,amount} of deltas.values()){
      if(!amount)continue
      const map=normalizeVariantStock(product.variant_stock)
      const current=bucket?clampStock(map[bucket]):clampStock(product.stock_quantity)
      const value=current+amount
      if(value<0)throw reject(409,'Estoque insuficiente para '+product.name+'.')
      if(value>999999999)throw reject(409,'Limite de estoque excedido.')
      if(bucket){map[bucket]=value;product.variant_stock=map}
      else product.stock_quantity=value
      await client.query('UPDATE products SET stock_quantity=$1,variant_stock=$2,updated_at=now() WHERE id=$3 AND store_id=$4',[clampStock(product.stock_quantity),JSON.stringify(normalizeVariantStock(product.variant_stock)),product.id,storeId])
    }
    await client.query('INSERT INTO order_edit_history(order_id,store_id,user_id,old_items,new_items,old_total,new_total) VALUES($1,$2,$3,$4,$5,$6,$7)',[order.id,storeId,req.catalogStore.user_id,JSON.stringify(previous),JSON.stringify(nextItems),order.total,totalCents/100])
    const result=await client.query('UPDATE orders SET items=$1,total=$2,edit_revision=edit_revision+1 WHERE id=$3 AND store_id=$4 RETURNING *',[JSON.stringify(nextItems),totalCents/100,order.id,storeId])
    await client.query('COMMIT')
    return res.json({order:{...result.rows[0],total:Number(result.rows[0].total)}})
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{})
    if(error.editStatus)return res.status(error.editStatus).json({error:error.message})
    throw error
  }finally{client.release()}
}

function install(app) {
  if (app.__atacadoCatalogFeaturesInstalled) return
  app.__atacadoCatalogFeaturesInstalled = true
  app.post('/api/admin/sellers/:sellerId/order-access',express.json({limit:'8kb'}),requireStore,(req,res,next)=>Promise.resolve(issueSellerOrderAccess(req,res)).catch(next))
  app.delete('/api/admin/sellers/:sellerId/order-access',requireStore,(req,res,next)=>Promise.resolve(revokeSellerOrderAccess(req,res)).catch(next))
  app.post('/api/seller-orders/session',express.json({limit:'8kb'}),(req,res,next)=>Promise.resolve(exchangeSellerOrderAccess(req,res)).catch(next))
  app.post('/api/seller-orders/logout',(req,res,next)=>Promise.resolve(logoutSellerOrder(req,res)).catch(next))
  app.get('/api/seller-orders',requireSellerOrder,(req,res,next)=>Promise.resolve(sellerOrders(req,res)).catch(next))
  app.get('/api/seller-orders/:orderId/products',requireSellerOrder,(req,res,next)=>Promise.resolve(sellerOrderProducts(req,res)).catch(next))
  app.patch('/api/seller-orders/:orderId/items',express.json({limit:'256kb'}),requireSellerOrder,(req,res,next)=>Promise.resolve(editCatalogOrder(req,res)).catch(next))
  app.patch('/api/admin/orders/:orderId/items', express.json({limit:'256kb'}), requireStore, (req,res,next)=>Promise.resolve(editCatalogOrder(req,res)).catch(next))
  app.get('/api/admin/products/pdf', requireStore, (req, res, next) => Promise.resolve(downloadProductsPdf(req, res)).catch(next))
  app.get('/api/admin/products/:productId/catalog-memberships',requireStore,(req,res,next)=>Promise.resolve(productCatalogMemberships(req,res)).catch(next))
  app.get('/api/admin/catalogs', requireStore, (req, res, next) => Promise.resolve(listCatalogs(req, res)).catch(next))
  app.post('/api/admin/catalogs', express.json({ limit: '64kb' }), requireStore, (req, res, next) => Promise.resolve(createCatalog(req, res)).catch(next))
  app.patch('/api/admin/catalogs/:catalogId', express.json({ limit: '2mb' }), requireStore, (req, res, next) => Promise.resolve(updateCatalog(req, res)).catch(next))
  app.get('/api/admin/catalogs/:catalogId/pdf', requireStore, (req, res, next) => Promise.resolve(downloadCatalogPdf(req, res)).catch(next))
  app.post('/api/admin/catalogs/:catalogId/members', express.json({limit:'32kb'}), requireStore, (req,res,next)=>Promise.resolve(setCatalogMembers(req,res)).catch(next))
  app.delete('/api/admin/catalogs/:catalogId', requireStore, (req, res, next) => Promise.resolve(deleteCatalog(req, res)).catch(next))
  app.get('/api/social/stores/:storeSlug/products/:productId/offers', (req,res,next) => Promise.resolve(socialProductOffers(req,res)).catch(next))
  app.post('/api/social/orders', express.json({ limit:'256kb' }), (req,res,next) => Promise.resolve(socialCreateOrder(req,res)).catch(next))
  app.get('/api/public/store/:storeSlug/:sellerSlug?', (req, res, next) => Promise.resolve(protectedStore(req, res)).catch(next))
  app.post('/api/business/orders', express.json({ limit: '256kb' }), (req, res, next) => Promise.resolve(createCatalogOrder(req, res)).catch(next))
}

const previousInit = express.application.init
express.application.init = function catalogFeaturesInit(...args) {
  const result = previousInit.apply(this, args)
  install(this)
  return result
}

const cleanup = setInterval(() => {
  const now = Date.now()
  for (const [key, bucket] of rateBuckets.entries()) if (bucket.resetAt <= now) rateBuckets.delete(key)
}, 60_000)
cleanup.unref()