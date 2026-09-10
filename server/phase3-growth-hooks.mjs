import crypto from 'node:crypto'
import express from 'express'
import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 6, connectionTimeoutMillis: 5000 }) : null
const ownerCookie = 'atacado_session'
const customerCookie = 'shopvax_customer_session'
const visitorCookie = 'atacado_public'
const planGatesDisabled = process.env.SHOPVAX_PLAN_LIMITS_DISABLED === '1'

if (pool) pool.on('error', (error) => console.error('[phase3] pool:', error.message))

const id = () => crypto.randomUUID()
const hash = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex')
const digits = (value) => String(value || '').replace(/\D/g, '')
const money = (value) => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0
}

function parseCookies(req) {
  const header = req.headers.cookie || ''
  return Object.fromEntries(header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=')
    return index < 0 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))]
  }))
}

function visitorKey(req) {
  const token = parseCookies(req)[visitorCookie]
  if (token) return hash(`visitor:${token}`).slice(0, 40)
  return hash(`fallback:${req.ip || ''}:${req.headers['user-agent'] || ''}`).slice(0, 40)
}

function couponCode(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 30)
}

function rate(value) {
  return Math.max(0, Math.min(100, Math.round((Number(value) || 0) * 100) / 100))
}

async function waitForBaseSchema() {
  if (!pool) throw new Error('DATABASE_URL não configurada.')
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const result = await pool.query(`SELECT
      to_regclass('public.stores') AS stores,
      to_regclass('public.sellers') AS sellers,
      to_regclass('public.orders') AS orders,
      to_regclass('public.platform_plans') AS plans,
      to_regclass('public.catalogs') AS catalogs,
      to_regclass('public.store_customers') AS customers,
      to_regclass('public.store_customer_sessions') AS customer_sessions`)
    const row = result.rows[0] || {}
    if (row.stores && row.sellers && row.orders && row.plans && row.catalogs && row.customers && row.customer_sessions) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Schema base não ficou pronto para a Fase 3.')
}

let schemaPromise = null
async function ensureSchema() {
  if (!pool) throw new Error('DATABASE_URL não configurada.')
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await waitForBaseSchema()
      await pool.query(`
        ALTER TABLE platform_plans ADD COLUMN IF NOT EXISTS feature_flags jsonb NOT NULL DEFAULT '{}'::jsonb;
        ALTER TABLE sellers ADD COLUMN IF NOT EXISTS commission_rate numeric(5,2) NOT NULL DEFAULT 0;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS sale_confirmed_at timestamptz;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS commission_rate numeric(5,2);
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS commission_amount numeric(12,2) NOT NULL DEFAULT 0;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal numeric(12,2);
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount numeric(12,2) NOT NULL DEFAULT 0;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_id text;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code text NOT NULL DEFAULT '';
        ALTER TABLE stores ADD COLUMN IF NOT EXISTS referral_code text NOT NULL DEFAULT '';
        ALTER TABLE stores ADD COLUMN IF NOT EXISTS billing_credit_months integer NOT NULL DEFAULT 0;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_stores_referral_code_unique
          ON stores(upper(referral_code)) WHERE referral_code<>'';

        CREATE TABLE IF NOT EXISTS coupons (
          id text PRIMARY KEY,
          store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
          code text NOT NULL,
          discount_type text NOT NULL,
          value numeric(12,2) NOT NULL,
          minimum_subtotal numeric(12,2) NOT NULL DEFAULT 0,
          max_uses integer,
          used_count integer NOT NULL DEFAULT 0,
          active boolean NOT NULL DEFAULT true,
          starts_at timestamptz,
          expires_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE(store_id,code)
        );
        CREATE INDEX IF NOT EXISTS idx_coupons_store_active ON coupons(store_id,active,created_at DESC);

        CREATE TABLE IF NOT EXISTS cart_recoveries (
          id text PRIMARY KEY,
          store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
          visitor_key text NOT NULL,
          customer_id text REFERENCES store_customers(id) ON DELETE SET NULL,
          seller_id text REFERENCES sellers(id) ON DELETE SET NULL,
          catalog_id text REFERENCES catalogs(id) ON DELETE SET NULL,
          items jsonb NOT NULL DEFAULT '[]'::jsonb,
          subtotal numeric(12,2) NOT NULL DEFAULT 0,
          state text NOT NULL DEFAULT 'active',
          order_id text REFERENCES orders(id) ON DELETE SET NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE(store_id,visitor_key)
        );
        CREATE INDEX IF NOT EXISTS idx_cart_recoveries_store_state ON cart_recoveries(store_id,state,updated_at DESC);

        CREATE TABLE IF NOT EXISTS store_referrals (
          id text PRIMARY KEY,
          referrer_store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
          referred_store_id text NOT NULL UNIQUE REFERENCES stores(id) ON DELETE CASCADE,
          credit_months integer NOT NULL DEFAULT 1,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_store_referrals_referrer ON store_referrals(referrer_store_id,created_at DESC);

        CREATE TABLE IF NOT EXISTS store_reviews (
          id text PRIMARY KEY,
          store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
          customer_id text NOT NULL REFERENCES store_customers(id) ON DELETE CASCADE,
          rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
          comment text NOT NULL DEFAULT '',
          active boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE(store_id,customer_id)
        );
        CREATE INDEX IF NOT EXISTS idx_store_reviews_public ON store_reviews(store_id,active,updated_at DESC);
      `)
    })().catch((error) => {
      schemaPromise = null
      throw error
    })
  }
  return schemaPromise
}

async function ownerStore(req) {
  await ensureSchema()
  const token = parseCookies(req)[ownerCookie]
  if (!token) return null
  const result = await pool.query(`
    SELECT s.id,s.slug,s.name,s.whatsapp,s.plan_tier,s.referral_code,s.billing_credit_months,
           pp.name AS plan_name,pp.code AS plan_code,pp.feature_flags
    FROM sessions se
    JOIN users u ON u.id=se.user_id
    JOIN stores s ON s.owner_id=u.id
    LEFT JOIN platform_plans pp ON pp.code=COALESCE(s.plan_tier,'bronze')
    WHERE se.token_hash=$1 AND se.expires_at>now() LIMIT 1
  `, [hash(token)])
  return result.rows[0] || null
}

async function requireOwner(req, res, next) {
  try {
    const store = await ownerStore(req)
    if (!store) return res.status(401).json({ error: 'Sessão necessária.' })
    req.phase3Store = store
    next()
  } catch (error) { next(error) }
}

function featureEnabled(store, feature) {
  if (planGatesDisabled) return true
  const flags = store?.feature_flags && typeof store.feature_flags === 'object' ? store.feature_flags : {}
  return flags[feature] === true
}

function denyFeature(res, label) {
  return res.status(403).json({ error: `${label} não está disponível no seu plano atual.`, code: 'PLAN_FEATURE' })
}

async function currentCustomer(req, storeId) {
  await ensureSchema()
  const token = parseCookies(req)[customerCookie]
  if (!token) return null
  const result = await pool.query(`
    SELECT c.id,c.store_id,c.name,c.email,c.phone
    FROM store_customer_sessions se JOIN store_customers c ON c.id=se.customer_id
    WHERE se.token_hash=$1 AND se.expires_at>now() AND c.active=true AND c.store_id=$2 LIMIT 1
  `, [hash(token), storeId])
  return result.rows[0] || null
}

async function storeBySlug(slug) {
  await ensureSchema()
  const result = await pool.query(`
    SELECT s.id,s.slug,s.name,s.whatsapp,s.plan_tier,pp.feature_flags
    FROM stores s LEFT JOIN platform_plans pp ON pp.code=COALESCE(s.plan_tier,'bronze')
    WHERE s.slug=$1 AND s.is_active=true LIMIT 1
  `, [String(slug || '')])
  return result.rows[0] || null
}

async function intelligenceGate(req, res, next) {
  try {
    const store = await ownerStore(req)
    if (!store) return res.status(401).json({ error: 'Sessão necessária.' })
    if (!featureEnabled(store, 'commercialIntelligence')) return denyFeature(res, 'Inteligência comercial')
    next()
  } catch (error) { next(error) }
}

async function setSellerCommission(req, res) {
  const store = req.phase3Store
  if (!featureEnabled(store, 'sellerCommission')) return denyFeature(res, 'Comissão de vendedoras')
  const commissionRate = rate(req.body?.rate)
  const result = await pool.query(
    'UPDATE sellers SET commission_rate=$1 WHERE id=$2 AND store_id=$3 RETURNING id,name,slug,commission_rate',
    [commissionRate, req.params.sellerId, store.id],
  )
  if (!result.rowCount) return res.status(404).json({ error: 'Vendedora não encontrada.' })
  return res.json({ seller: { ...result.rows[0], commissionRate: Number(result.rows[0].commission_rate || 0) } })
}

async function confirmSale(req, res) {
  const store = req.phase3Store
  if (!featureEnabled(store, 'sellerCommission')) return denyFeature(res, 'Comissão de vendedoras')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const orderResult = await client.query(`
      SELECT o.*,COALESCE(s.commission_rate,0) AS seller_commission_rate
      FROM orders o LEFT JOIN sellers s ON s.id=o.seller_id
      WHERE o.id=$1 AND o.store_id=$2 FOR UPDATE OF o
    `, [req.params.orderId, store.id])
    if (!orderResult.rowCount) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Pedido não encontrado.' })
    }
    const order = orderResult.rows[0]
    if (order.status === 'cancelled') {
      await client.query('ROLLBACK')
      return res.status(409).json({ error: 'Pedido cancelado não pode ser confirmado como venda.' })
    }
    const commissionRate = rate(order.seller_commission_rate)
    const commissionAmount = money(Number(order.total || 0) * commissionRate / 100)
    const updated = await client.query(`
      UPDATE orders SET status='confirmado',sale_confirmed_at=COALESCE(sale_confirmed_at,now()),
        commission_rate=$1,commission_amount=$2,status_updated_at=now()
      WHERE id=$3 RETURNING id,code,status,total,sale_confirmed_at,commission_rate,commission_amount,seller_id
    `, [commissionRate, commissionAmount, order.id])
    await client.query('COMMIT')
    return res.json({ order: {
      ...updated.rows[0],
      total: Number(updated.rows[0].total || 0),
      commissionRate: Number(updated.rows[0].commission_rate || 0),
      commissionAmount: Number(updated.rows[0].commission_amount || 0),
    } })
  } catch (error) {
    try { await client.query('ROLLBACK') } catch {}
    throw error
  } finally { client.release() }
}

async function unconfirmSale(req, res) {
  const store = req.phase3Store
  if (!featureEnabled(store, 'sellerCommission')) return denyFeature(res, 'Comissão de vendedoras')
  const result = await pool.query(`
    UPDATE orders SET status='em_atendimento',sale_confirmed_at=NULL,commission_rate=NULL,commission_amount=0,status_updated_at=now()
    WHERE id=$1 AND store_id=$2 AND status<>'cancelled'
    RETURNING id,code,status,total,sale_confirmed_at,commission_amount
  `, [req.params.orderId, store.id])
  if (!result.rowCount) return res.status(404).json({ error: 'Pedido não encontrado ou cancelado.' })
  return res.json({ order: result.rows[0] })
}

async function commissions(req, res) {
  const store = req.phase3Store
  if (!featureEnabled(store, 'sellerCommission')) return denyFeature(res, 'Comissão de vendedoras')
  const days = Math.max(1, Math.min(365, Math.floor(Number(req.query.days) || 30)))
  const result = await pool.query(`
    SELECT s.id AS seller_id,s.name,s.slug,COALESCE(s.commission_rate,0) AS configured_rate,
      count(o.id) FILTER (WHERE o.sale_confirmed_at IS NOT NULL AND o.status<>'cancelled')::int AS confirmed_sales,
      COALESCE(sum(o.total) FILTER (WHERE o.sale_confirmed_at IS NOT NULL AND o.status<>'cancelled'),0)::numeric AS confirmed_total,
      COALESCE(sum(o.commission_amount) FILTER (WHERE o.sale_confirmed_at IS NOT NULL AND o.status<>'cancelled'),0)::numeric AS commission_total
    FROM sellers s
    LEFT JOIN orders o ON o.seller_id=s.id AND o.store_id=s.store_id AND o.created_at>=now()-($2::int*interval '1 day')
    WHERE s.store_id=$1
    GROUP BY s.id,s.name,s.slug,s.commission_rate ORDER BY commission_total DESC,s.name ASC
  `, [store.id, days])
  return res.json({ periodDays: days, sellers: result.rows.map((row) => ({
    sellerId: row.seller_id,
    name: row.name,
    slug: row.slug,
    configuredRate: Number(row.configured_rate || 0),
    confirmedSales: Number(row.confirmed_sales || 0),
    confirmedTotal: Number(row.confirmed_total || 0),
    commissionTotal: Number(row.commission_total || 0),
  })), interpretation: 'Comissões consideram somente vendas confirmadas manualmente e não canceladas.' })
}

function couponShape(row) {
  return {
    id: row.id,
    code: row.code,
    type: row.discount_type,
    value: Number(row.value || 0),
    minimumSubtotal: Number(row.minimum_subtotal || 0),
    maxUses: row.max_uses == null ? null : Number(row.max_uses),
    usedCount: Number(row.used_count || 0),
    active: Boolean(row.active),
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }
}

async function listCoupons(req, res) {
  const result = await pool.query('SELECT * FROM coupons WHERE store_id=$1 ORDER BY created_at DESC', [req.phase3Store.id])
  return res.json({ coupons: result.rows.map(couponShape) })
}

async function createCoupon(req, res) {
  const store = req.phase3Store
  const code = couponCode(req.body?.code)
  const type = req.body?.type === 'fixed' ? 'fixed' : 'percent'
  const value = money(req.body?.value)
  const minimumSubtotal = Math.max(0, money(req.body?.minimumSubtotal))
  const maxUsesRaw = req.body?.maxUses
  const maxUses = maxUsesRaw == null || maxUsesRaw === '' ? null : Math.max(1, Math.min(1000000, Math.floor(Number(maxUsesRaw) || 1)))
  if (code.length < 3) return res.status(400).json({ error: 'Use um código de cupom com pelo menos 3 caracteres.' })
  if (value <= 0 || (type === 'percent' && value > 100)) return res.status(400).json({ error: type === 'percent' ? 'Desconto percentual deve estar entre 0,01% e 100%.' : 'Informe um desconto maior que zero.' })
  const startsAt = req.body?.startsAt ? new Date(req.body.startsAt) : null
  const expiresAt = req.body?.expiresAt ? new Date(req.body.expiresAt) : null
  if (startsAt && Number.isNaN(startsAt.getTime())) return res.status(400).json({ error: 'Data inicial inválida.' })
  if (expiresAt && Number.isNaN(expiresAt.getTime())) return res.status(400).json({ error: 'Data final inválida.' })
  if (startsAt && expiresAt && expiresAt <= startsAt) return res.status(400).json({ error: 'A validade final deve ser posterior ao início.' })
  try {
    const result = await pool.query(`
      INSERT INTO coupons (id,store_id,code,discount_type,value,minimum_subtotal,max_uses,active,starts_at,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9) RETURNING *
    `, [id(), store.id, code, type, value, minimumSubtotal, maxUses, startsAt, expiresAt])
    return res.status(201).json({ coupon: couponShape(result.rows[0]) })
  } catch (error) {
    if (error?.code === '23505') return res.status(409).json({ error: 'Já existe um cupom com esse código.' })
    throw error
  }
}

async function updateCoupon(req, res) {
  const store = req.phase3Store
  const currentResult = await pool.query('SELECT * FROM coupons WHERE id=$1 AND store_id=$2 LIMIT 1', [req.params.couponId, store.id])
  if (!currentResult.rowCount) return res.status(404).json({ error: 'Cupom não encontrado.' })
  const current = currentResult.rows[0]
  const active = req.body?.active == null ? current.active : req.body.active === true
  const maxUsesRaw = req.body?.maxUses
  const maxUses = maxUsesRaw === undefined ? current.max_uses : (maxUsesRaw == null || maxUsesRaw === '' ? null : Math.max(1, Math.floor(Number(maxUsesRaw) || 1)))
  const expiresAt = req.body?.expiresAt === undefined ? current.expires_at : (req.body.expiresAt ? new Date(req.body.expiresAt) : null)
  if (expiresAt && Number.isNaN(expiresAt.getTime())) return res.status(400).json({ error: 'Data final inválida.' })
  const result = await pool.query(`
    UPDATE coupons SET active=$1,max_uses=$2,expires_at=$3,updated_at=now()
    WHERE id=$4 AND store_id=$5 RETURNING *
  `, [active, maxUses, expiresAt, current.id, store.id])
  return res.json({ coupon: couponShape(result.rows[0]) })
}

async function deleteCoupon(req, res) {
  const result = await pool.query('DELETE FROM coupons WHERE id=$1 AND store_id=$2 RETURNING id', [req.params.couponId, req.phase3Store.id])
  if (!result.rowCount) return res.status(404).json({ error: 'Cupom não encontrado.' })
  return res.status(204).end()
}

function calculateDiscount(coupon, subtotal) {
  const value = Number(coupon.value || 0)
  const raw = coupon.discount_type === 'fixed' ? value : subtotal * value / 100
  return Math.max(0, Math.min(subtotal, money(raw)))
}

function couponUsable(coupon, subtotal) {
  if (!coupon || !coupon.active) return { ok: false, error: 'Cupom inválido ou inativo.' }
  const now = Date.now()
  if (coupon.starts_at && new Date(coupon.starts_at).getTime() > now) return { ok: false, error: 'Este cupom ainda não está válido.' }
  if (coupon.expires_at && new Date(coupon.expires_at).getTime() <= now) return { ok: false, error: 'Este cupom expirou.' }
  if (coupon.max_uses != null && Number(coupon.used_count || 0) >= Number(coupon.max_uses)) return { ok: false, error: 'Este cupom atingiu o limite de usos.' }
  if (subtotal < Number(coupon.minimum_subtotal || 0)) return { ok: false, error: `Este cupom exige subtotal mínimo de R$ ${Number(coupon.minimum_subtotal || 0).toFixed(2).replace('.', ',')}.` }
  return { ok: true }
}

async function validateCoupon(req, res) {
  const store = await storeBySlug(req.body?.storeSlug)
  if (!store) return res.status(404).json({ error: 'Loja não encontrada.' })
  const code = couponCode(req.body?.code)
  const subtotal = Math.max(0, money(req.body?.subtotal))
  const result = await pool.query('SELECT * FROM coupons WHERE store_id=$1 AND code=$2 LIMIT 1', [store.id, code])
  const coupon = result.rows[0]
  const usable = couponUsable(coupon, subtotal)
  if (!usable.ok) return res.status(400).json({ error: usable.error, code: 'COUPON_INVALID' })
  const discount = calculateDiscount(coupon, subtotal)
  return res.json({ coupon: couponShape(coupon), subtotal, discount, total: money(subtotal - discount) })
}

async function reserveCoupon(storeSlug, rawCode) {
  const code = couponCode(rawCode)
  if (!code) return null
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const storeResult = await client.query('SELECT id FROM stores WHERE slug=$1 AND is_active=true LIMIT 1', [storeSlug])
    if (!storeResult.rowCount) {
      await client.query('ROLLBACK')
      return { error: 'Loja não encontrada.', status: 404 }
    }
    const result = await client.query('SELECT * FROM coupons WHERE store_id=$1 AND code=$2 FOR UPDATE', [storeResult.rows[0].id, code])
    const coupon = result.rows[0]
    const usable = couponUsable(coupon, Number.POSITIVE_INFINITY)
    if (!coupon || !coupon.active || (coupon.starts_at && new Date(coupon.starts_at).getTime() > Date.now()) || (coupon.expires_at && new Date(coupon.expires_at).getTime() <= Date.now()) || (coupon.max_uses != null && Number(coupon.used_count || 0) >= Number(coupon.max_uses))) {
      await client.query('ROLLBACK')
      return { error: usable.error || 'Cupom inválido.', status: 400 }
    }
    await client.query('UPDATE coupons SET used_count=used_count+1,updated_at=now() WHERE id=$1', [coupon.id])
    await client.query('COMMIT')
    return { ...coupon, used_count: Number(coupon.used_count || 0) + 1, reserved: true }
  } catch (error) {
    try { await client.query('ROLLBACK') } catch {}
    throw error
  } finally { client.release() }
}

async function releaseCoupon(couponId) {
  if (!couponId) return
  await pool.query('UPDATE coupons SET used_count=GREATEST(0,used_count-1),updated_at=now() WHERE id=$1', [couponId]).catch(() => undefined)
}

function orderMessage(order, store, seller, catalog, subtotal, discount, total, code) {
  const formatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
  const items = Array.isArray(order.items) ? order.items : []
  const lines = items.map((item) => {
    const selections = item?.selections && typeof item.selections === 'object'
      ? Object.entries(item.selections).map(([key, value]) => `${key}: ${value}`).join(' · ')
      : ''
    return `${Number(item.quantity || 0)}x ${item.name || 'Produto'}${selections ? ` (${selections})` : ''} — ${formatter.format(Number(item.lineTotal || 0))}`
  })
  const message = [
    `Olá! Montei este pedido na ${store.name}:`,
    catalog?.name ? `Catálogo: ${catalog.name}` : '',
    '',
    ...lines,
    '',
    `Subtotal: ${formatter.format(subtotal)}`,
    discount > 0 ? `Cupom ${code}: -${formatter.format(discount)}` : '',
    `Total dos produtos: ${formatter.format(total)}`,
    `Pedido: ${order.code}`,
    '',
    `Quero finalizar com ${seller?.name || 'atendimento'}.`,
  ].filter((line, index, all) => line !== '' || (index > 0 && all[index - 1] !== ''))
  return message.join('\n')
}

async function markRecoveryConverted(req, orderId, storeId) {
  const key = visitorKey(req)
  await pool.query(`
    UPDATE cart_recoveries SET state='converted',order_id=$1,updated_at=now()
    WHERE store_id=$2 AND visitor_key=$3 AND state='active'
  `, [orderId, storeId, key]).catch(() => undefined)
}

async function finalizeOrder(req, payload, reservedCoupon) {
  if (!payload?.orderId) return payload
  const orderResult = await pool.query('SELECT * FROM orders WHERE id=$1 LIMIT 1', [payload.orderId])
  if (!orderResult.rowCount) return payload
  const order = orderResult.rows[0]
  await markRecoveryConverted(req, order.id, order.store_id)
  if (!reservedCoupon?.reserved) return payload

  const subtotal = money(order.total)
  const usable = couponUsable(reservedCoupon, subtotal)
  if (!usable.ok) {
    await releaseCoupon(reservedCoupon.id)
    return { ...payload, couponRejected: true, couponError: usable.error }
  }
  const discount = calculateDiscount(reservedCoupon, subtotal)
  const total = money(subtotal - discount)
  await pool.query(`
    UPDATE orders SET subtotal=$1,discount=$2,total=$3,coupon_id=$4,coupon_code=$5 WHERE id=$6
  `, [subtotal, discount, total, reservedCoupon.id, reservedCoupon.code, order.id])

  const [storeResult, sellerResult, catalogResult] = await Promise.all([
    pool.query('SELECT name,whatsapp FROM stores WHERE id=$1 LIMIT 1', [order.store_id]),
    order.seller_id ? pool.query('SELECT name,phone FROM sellers WHERE id=$1 LIMIT 1', [order.seller_id]) : Promise.resolve({ rows: [] }),
    order.catalog_id ? pool.query('SELECT name FROM catalogs WHERE id=$1 LIMIT 1', [order.catalog_id]) : Promise.resolve({ rows: [] }),
  ])
  const store = storeResult.rows[0] || { name: 'Loja', whatsapp: '' }
  const seller = sellerResult.rows[0] || null
  const catalog = catalogResult.rows[0] || null
  const phone = digits(seller?.phone || store.whatsapp)
  const message = orderMessage(order, store, seller, catalog, subtotal, discount, total, reservedCoupon.code)
  return {
    ...payload,
    subtotal,
    discount,
    total,
    couponCode: reservedCoupon.code,
    whatsappUrl: phone.length >= 10 ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}` : payload.whatsappUrl,
  }
}

async function orderEnhancer(req, res, next) {
  try {
    await ensureSchema()
    const rawCode = req.body?.couponCode
    const reserved = rawCode ? await reserveCoupon(String(req.body?.storeSlug || ''), rawCode) : null
    if (reserved?.error) return res.status(reserved.status || 400).json({ error: reserved.error, code: 'COUPON_INVALID' })
    const originalJson = res.json.bind(res)
    let sent = false
    res.json = function phase3OrderJson(payload) {
      if (sent) return originalJson(payload)
      sent = true
      const successfulOrder = res.statusCode >= 200 && res.statusCode < 300 && payload?.orderId
      Promise.resolve(successfulOrder ? finalizeOrder(req, payload, reserved) : payload)
        .then(async (finalPayload) => {
          if (!successfulOrder && reserved?.reserved) await releaseCoupon(reserved.id)
          originalJson(finalPayload)
        })
        .catch(async (error) => {
          if (reserved?.reserved) await releaseCoupon(reserved.id)
          console.error('[phase3] order finalize:', error.message)
          originalJson({ ...payload, phase3Error: 'Não foi possível aplicar os benefícios da Fase 3 neste pedido.' })
        })
      return res
    }
    next()
  } catch (error) { next(error) }
}

function normalizeCartItems(value) {
  if (!Array.isArray(value)) return []
  return value.slice(0, 100).map((item) => ({
    productId: String(item?.productId || '').slice(0, 100),
    name: String(item?.name || '').slice(0, 160),
    quantity: Math.max(1, Math.min(999, Math.floor(Number(item?.quantity) || 1))),
    selections: item?.selections && typeof item.selections === 'object' ? item.selections : {},
  })).filter((item) => item.productId)
}

async function saveCartRecovery(req, res) {
  const store = await storeBySlug(req.body?.storeSlug)
  if (!store) return res.status(404).json({ error: 'Loja não encontrada.' })
  const items = normalizeCartItems(req.body?.items)
  const key = visitorKey(req)
  if (!items.length) {
    await pool.query(`UPDATE cart_recoveries SET state='dismissed',items='[]'::jsonb,subtotal=0,updated_at=now() WHERE store_id=$1 AND visitor_key=$2`, [store.id, key])
    return res.status(204).end()
  }
  const customer = await currentCustomer(req, store.id)
  let sellerId = null
  let catalogId = null
  if (req.body?.sellerSlug) {
    const seller = await pool.query('SELECT id FROM sellers WHERE store_id=$1 AND slug=$2 AND is_active=true LIMIT 1', [store.id, String(req.body.sellerSlug)])
    sellerId = seller.rows[0]?.id || null
  }
  if (req.body?.catalogSlug) {
    const catalog = await pool.query('SELECT id FROM catalogs WHERE store_id=$1 AND slug=$2 AND active=true LIMIT 1', [store.id, String(req.body.catalogSlug)])
    catalogId = catalog.rows[0]?.id || null
  }
  const subtotal = Math.max(0, money(req.body?.subtotal))
  const result = await pool.query(`
    INSERT INTO cart_recoveries (id,store_id,visitor_key,customer_id,seller_id,catalog_id,items,subtotal,state)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active')
    ON CONFLICT (store_id,visitor_key) DO UPDATE SET
      customer_id=COALESCE(EXCLUDED.customer_id,cart_recoveries.customer_id),seller_id=EXCLUDED.seller_id,
      catalog_id=EXCLUDED.catalog_id,items=EXCLUDED.items,subtotal=EXCLUDED.subtotal,state='active',order_id=NULL,updated_at=now()
    RETURNING id,state,updated_at
  `, [id(), store.id, key, customer?.id || null, sellerId, catalogId, JSON.stringify(items), subtotal])
  return res.status(202).json({ recovery: result.rows[0] })
}

async function listCartRecoveries(req, res) {
  const result = await pool.query(`
    SELECT r.id,r.items,r.subtotal,r.state,r.created_at,r.updated_at,r.customer_id,
      c.name AS customer_name,c.phone AS customer_phone,c.email AS customer_email,
      s.name AS seller_name,ca.name AS catalog_name,
      EXTRACT(EPOCH FROM (now()-r.updated_at))/60 AS age_minutes
    FROM cart_recoveries r
    LEFT JOIN store_customers c ON c.id=r.customer_id
    LEFT JOIN sellers s ON s.id=r.seller_id
    LEFT JOIN catalogs ca ON ca.id=r.catalog_id
    WHERE r.store_id=$1 AND r.state='active' AND r.updated_at>=now()-interval '30 days'
    ORDER BY r.updated_at ASC LIMIT 300
  `, [req.phase3Store.id])
  const recoveries = result.rows.map((row) => {
    const phone = digits(row.customer_phone)
    const text = `Olá${row.customer_name ? `, ${String(row.customer_name).split(' ')[0]}` : ''}! Você deixou alguns itens no carrinho da ${req.phase3Store.name}. Se quiser, posso te ajudar a concluir o pedido.`
    return {
      id: row.id,
      items: Array.isArray(row.items) ? row.items : [],
      subtotal: Number(row.subtotal || 0),
      state: row.state,
      updatedAt: row.updated_at,
      ageMinutes: Math.floor(Number(row.age_minutes || 0)),
      abandoned: Number(row.age_minutes || 0) >= 15,
      customer: row.customer_id ? { id: row.customer_id, name: row.customer_name, email: row.customer_email, phone: row.customer_phone } : null,
      sellerName: row.seller_name,
      catalogName: row.catalog_name,
      whatsappUrl: phone.length >= 10 ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : null,
    }
  })
  return res.json({ recoveries, contactable: recoveries.filter((item) => item.whatsappUrl).length, anonymous: recoveries.filter((item) => !item.customer).length })
}

async function dismissRecovery(req, res) {
  const result = await pool.query(`UPDATE cart_recoveries SET state='dismissed',updated_at=now() WHERE id=$1 AND store_id=$2 RETURNING id`, [req.params.recoveryId, req.phase3Store.id])
  if (!result.rowCount) return res.status(404).json({ error: 'Carrinho não encontrado.' })
  return res.status(204).end()
}

async function ensureReferralCode(storeId) {
  const existing = await pool.query('SELECT referral_code FROM stores WHERE id=$1 LIMIT 1', [storeId])
  if (existing.rows[0]?.referral_code) return existing.rows[0].referral_code
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = `SVX-${crypto.randomBytes(4).toString('hex').toUpperCase()}`
    try {
      const result = await pool.query(`UPDATE stores SET referral_code=$1 WHERE id=$2 AND referral_code='' RETURNING referral_code`, [code, storeId])
      if (result.rowCount) return result.rows[0].referral_code
      const current = await pool.query('SELECT referral_code FROM stores WHERE id=$1 LIMIT 1', [storeId])
      if (current.rows[0]?.referral_code) return current.rows[0].referral_code
    } catch (error) {
      if (error?.code !== '23505') throw error
    }
  }
  throw new Error('Não foi possível gerar o código de indicação.')
}

async function referralStatus(req, res) {
  const code = await ensureReferralCode(req.phase3Store.id)
  const result = await pool.query('SELECT count(*)::int AS referrals,COALESCE(sum(credit_months),0)::int AS credited FROM store_referrals WHERE referrer_store_id=$1', [req.phase3Store.id])
  const freshStore = await pool.query('SELECT billing_credit_months FROM stores WHERE id=$1', [req.phase3Store.id])
  return res.json({
    code,
    referrals: Number(result.rows[0]?.referrals || 0),
    creditedMonths: Number(result.rows[0]?.credited || 0),
    availableCreditMonths: Number(freshStore.rows[0]?.billing_credit_months || 0),
    rule: '1 indicação válida = 1 mês grátis',
    billingNote: 'O crédito fica registrado para ser consumido pela cobrança recorrente quando o módulo de billing estiver ativo.',
  })
}

async function awardReferral(referrerStoreId, referredSlug) {
  if (!referrerStoreId || !referredSlug) return false
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const referred = await client.query('SELECT id FROM stores WHERE slug=$1 FOR UPDATE', [referredSlug])
    if (!referred.rowCount || referred.rows[0].id === referrerStoreId) {
      await client.query('ROLLBACK')
      return false
    }
    const inserted = await client.query(`
      INSERT INTO store_referrals (id,referrer_store_id,referred_store_id,credit_months)
      VALUES ($1,$2,$3,1) ON CONFLICT (referred_store_id) DO NOTHING RETURNING id
    `, [id(), referrerStoreId, referred.rows[0].id])
    if (inserted.rowCount) await client.query('UPDATE stores SET billing_credit_months=billing_credit_months+1 WHERE id=$1', [referrerStoreId])
    await client.query('COMMIT')
    return Boolean(inserted.rowCount)
  } catch (error) {
    try { await client.query('ROLLBACK') } catch {}
    throw error
  } finally { client.release() }
}

async function referralRegistration(req, res, next) {
  try {
    await ensureSchema()
    const code = couponCode(req.body?.referralCode)
    if (!code) return next()
    const referrer = await pool.query('SELECT id FROM stores WHERE upper(referral_code)=upper($1) AND is_active=true LIMIT 1', [code])
    if (!referrer.rowCount) return res.status(400).json({ error: 'Código de indicação inválido.', code: 'REFERRAL_INVALID' })
    const referrerStoreId = referrer.rows[0].id
    const originalJson = res.json.bind(res)
    let sent = false
    res.json = function phase3ReferralJson(payload) {
      if (sent) return originalJson(payload)
      sent = true
      if (res.statusCode === 201 && payload?.storeSlug) {
        Promise.resolve(awardReferral(referrerStoreId, payload.storeSlug))
          .then((credited) => originalJson({ ...payload, referralCredited: credited }))
          .catch((error) => {
            console.error('[phase3] referral award:', error.message)
            originalJson(payload)
          })
        return res
      }
      return originalJson(payload)
    }
    next()
  } catch (error) { next(error) }
}

async function publicReviews(req, res) {
  const store = await storeBySlug(req.params.storeSlug)
  if (!store) return res.status(404).json({ error: 'Loja não encontrada.' })
  if (!featureEnabled(store, 'reviews')) return res.json({ enabled: false, average: 0, count: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, reviews: [] })
  const [summary, rows] = await Promise.all([
    pool.query(`SELECT count(*)::int AS count,COALESCE(avg(rating),0)::numeric AS average,
      count(*) FILTER (WHERE rating=1)::int AS r1,count(*) FILTER (WHERE rating=2)::int AS r2,
      count(*) FILTER (WHERE rating=3)::int AS r3,count(*) FILTER (WHERE rating=4)::int AS r4,
      count(*) FILTER (WHERE rating=5)::int AS r5
      FROM store_reviews WHERE store_id=$1 AND active=true`, [store.id]),
    pool.query(`SELECT r.rating,r.comment,r.updated_at,c.name FROM store_reviews r JOIN store_customers c ON c.id=r.customer_id
      WHERE r.store_id=$1 AND r.active=true ORDER BY r.updated_at DESC LIMIT 50`, [store.id]),
  ])
  const s = summary.rows[0] || {}
  return res.json({
    enabled: true,
    average: Math.round(Number(s.average || 0) * 10) / 10,
    count: Number(s.count || 0),
    distribution: { 1: Number(s.r1 || 0), 2: Number(s.r2 || 0), 3: Number(s.r3 || 0), 4: Number(s.r4 || 0), 5: Number(s.r5 || 0) },
    reviews: rows.rows.map((row) => ({ rating: Number(row.rating), comment: row.comment, updatedAt: row.updated_at, reviewer: String(row.name || 'Cliente').split(' ')[0] })),
  })
}

async function myReview(req, res) {
  const store = await storeBySlug(req.params.storeSlug)
  if (!store) return res.status(404).json({ error: 'Loja não encontrada.' })
  if (!featureEnabled(store, 'reviews')) return denyFeature(res, 'Avaliações')
  const customer = await currentCustomer(req, store.id)
  if (!customer) return res.status(401).json({ error: 'Entre na sua conta para avaliar.' })
  const review = await pool.query('SELECT id,rating,comment,created_at,updated_at FROM store_reviews WHERE store_id=$1 AND customer_id=$2 LIMIT 1', [store.id, customer.id])
  return res.json({ review: review.rows[0] || null })
}

async function saveReview(req, res) {
  const store = await storeBySlug(req.params.storeSlug)
  if (!store) return res.status(404).json({ error: 'Loja não encontrada.' })
  if (!featureEnabled(store, 'reviews')) return denyFeature(res, 'Avaliações')
  const customer = await currentCustomer(req, store.id)
  if (!customer) return res.status(401).json({ error: 'Entre na sua conta para avaliar.' })
  const ordered = await pool.query(`SELECT 1 FROM orders WHERE store_id=$1 AND customer_id=$2 AND status<>'cancelled' LIMIT 1`, [store.id, customer.id])
  if (!ordered.rowCount) return res.status(403).json({ error: 'Somente clientes que já fizeram um pedido podem avaliar esta loja.' })
  const ratingValue = Math.floor(Number(req.body?.rating) || 0)
  const comment = String(req.body?.comment || '').trim().slice(0, 1000)
  if (ratingValue < 1 || ratingValue > 5) return res.status(400).json({ error: 'A nota deve estar entre 1 e 5.' })
  const result = await pool.query(`
    INSERT INTO store_reviews (id,store_id,customer_id,rating,comment,active)
    VALUES ($1,$2,$3,$4,$5,true)
    ON CONFLICT (store_id,customer_id) DO UPDATE SET rating=EXCLUDED.rating,comment=EXCLUDED.comment,active=true,updated_at=now()
    RETURNING id,rating,comment,created_at,updated_at
  `, [id(), store.id, customer.id, ratingValue, comment])
  return res.json({ review: result.rows[0] })
}

function pdfEscape(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function wrapText(value, width = 88) {
  const words = String(value || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  const lines = []
  let line = ''
  for (const word of words) {
    if (!line) line = word
    else if (`${line} ${word}`.length <= width) line += ` ${word}`
    else { lines.push(line); line = word }
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

function buildPdf(pages) {
  const objects = []
  const push = (idNumber, body) => { objects[idNumber] = Buffer.from(`${idNumber} 0 obj\n${body}\nendobj\n`, 'latin1') }
  const pageIds = pages.map((_, index) => 4 + index * 2)
  push(1, '<< /Type /Catalog /Pages 2 0 R >>')
  push(2, `<< /Type /Pages /Kids [${pageIds.map((pageId) => `${pageId} 0 R`).join(' ')}] /Count ${pages.length} >>`)
  push(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  pages.forEach((lines, index) => {
    const pageId = 4 + index * 2
    const contentId = pageId + 1
    const commands = ['BT', '/F1 10 Tf', '44 800 Td', '14 TL']
    lines.forEach((line) => { commands.push(`(${pdfEscape(line)}) Tj`, 'T*') })
    commands.push('ET')
    const stream = Buffer.from(commands.join('\n'), 'latin1')
    push(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`)
    objects[contentId] = Buffer.concat([
      Buffer.from(`${contentId} 0 obj\n<< /Length ${stream.length} >>\nstream\n`, 'latin1'),
      stream,
      Buffer.from('\nendstream\nendobj\n', 'latin1'),
    ])
  })
  const header = Buffer.from('%PDF-1.4\n%ShopVax\n', 'latin1')
  const chunks = [header]
  const offsets = [0]
  let offset = header.length
  for (let i = 1; i < objects.length; i += 1) {
    offsets[i] = offset
    chunks.push(objects[i])
    offset += objects[i].length
  }
  const xrefOffset = offset
  const xref = [`xref`, `0 ${objects.length}`, '0000000000 65535 f ']
  for (let i = 1; i < objects.length; i += 1) xref.push(`${String(offsets[i]).padStart(10, '0')} 00000 n `)
  xref.push(`trailer`, `<< /Size ${objects.length} /Root 1 0 R >>`, `startxref`, String(xrefOffset), '%%EOF')
  chunks.push(Buffer.from(`${xref.join('\n')}\n`, 'latin1'))
  return Buffer.concat(chunks)
}

async function catalogPdf(req, res) {
  const store = req.phase3Store
  const catalogResult = await pool.query('SELECT * FROM catalogs WHERE id=$1 AND store_id=$2 LIMIT 1', [req.params.catalogId, store.id])
  if (!catalogResult.rowCount) return res.status(404).json({ error: 'Catálogo não encontrado.' })
  const catalog = catalogResult.rows[0]
  const products = await pool.query(`
    SELECT p.id,p.sku,p.name,p.description,p.price,p.category,p.pack,p.variations,cp.price_override,COALESCE(cp.visible,true) AS visible
    FROM products p LEFT JOIN catalog_products cp ON cp.product_id=p.id AND cp.catalog_id=$1
    WHERE p.store_id=$2 AND p.active=true AND COALESCE(cp.visible,true)=true
    ORDER BY p.category,p.name
  `, [catalog.id, store.id])
  const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
  const content = [store.name, `Catálogo: ${catalog.name}`, '']
  for (const product of products.rows) {
    const priceValue = product.price_override == null ? Number(product.price || 0) : Number(product.price_override)
    content.push(...wrapText(`${product.name} — ${currency.format(priceValue)}`))
    if (product.sku) content.push(`SKU: ${product.sku}`)
    if (product.category) content.push(`Categoria: ${product.category}`)
    if (product.pack) content.push(`Pacote: ${product.pack}`)
    const variations = Array.isArray(product.variations) ? product.variations : []
    for (const variation of variations) content.push(...wrapText(`${variation.name}: ${(variation.options || []).join(', ')}`))
    if (product.description) content.push(...wrapText(product.description))
    content.push('')
  }
  if (!products.rowCount) content.push('Nenhum produto ativo neste catálogo.')
  const pages = []
  for (let index = 0; index < content.length; index += 46) {
    const pageLines = content.slice(index, index + 46)
    while (pageLines.length < 49) pageLines.push('')
    pageLines.push(`Página ${pages.length + 1} · Catálogo gerado com ShopVax`)
    pages.push(pageLines)
  }
  if (!pages.length) pages.push([store.name, `Catálogo: ${catalog.name}`, '', 'Catálogo gerado com ShopVax'])
  const pdf = buildPdf(pages)
  const filename = `${String(catalog.slug || 'catalogo').replace(/[^a-z0-9-]/gi, '-')}-shopvax.pdf`
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.setHeader('Content-Length', pdf.length)
  res.setHeader('Cache-Control', 'private, no-store')
  return res.status(200).send(pdf)
}

async function phase3Context(req, res) {
  const store = req.phase3Store
  const features = store.feature_flags && typeof store.feature_flags === 'object' ? store.feature_flags : {}
  const [couponResult, recoveryResult, referralResult, orderResult, sellerResult] = await Promise.all([
    pool.query('SELECT count(*)::int AS total FROM coupons WHERE store_id=$1 AND active=true', [store.id]),
    pool.query("SELECT count(*)::int AS total FROM cart_recoveries WHERE store_id=$1 AND state='active'", [store.id]),
    pool.query('SELECT count(*)::int AS total FROM store_referrals WHERE referrer_store_id=$1', [store.id]),
    pool.query(`SELECT id,code,total,status,seller_id,sale_confirmed_at,commission_amount,coupon_code,discount,created_at FROM orders WHERE store_id=$1 ORDER BY created_at DESC LIMIT 100`, [store.id]),
    pool.query('SELECT id,name,slug,commission_rate,is_active FROM sellers WHERE store_id=$1 ORDER BY created_at ASC', [store.id]),
  ])
  return res.json({
    plan: { code: store.plan_code || store.plan_tier || 'bronze', name: store.plan_name || 'Plano', features },
    summary: {
      activeCoupons: Number(couponResult.rows[0]?.total || 0),
      activeCarts: Number(recoveryResult.rows[0]?.total || 0),
      referrals: Number(referralResult.rows[0]?.total || 0),
      creditMonths: Number(store.billing_credit_months || 0),
    },
    sellers: sellerResult.rows.map((row) => ({ ...row, commissionRate: Number(row.commission_rate || 0) })),
    orders: orderResult.rows.map((row) => ({ ...row, total: Number(row.total || 0), discount: Number(row.discount || 0), commissionAmount: Number(row.commission_amount || 0) })),
  })
}

function install(app) {
  if (app.__shopvaxPhase3GrowthInstalled) return
  app.__shopvaxPhase3GrowthInstalled = true

  // Gate antes da rota legada de analytics. Em suíte interna com limites desligados, preserva compatibilidade.
  app.get('/api/admin/intent-reports', intelligenceGate)

  // O enriquecimento de pedido precisa executar antes da rota de catálogo/estoque.
  app.post('/api/business/orders', express.json({ limit: '256kb' }), orderEnhancer)
  app.post('/api/auth/register', express.json({ limit: '64kb' }), referralRegistration)

  app.get('/api/admin/phase3', requireOwner, (req, res, next) => Promise.resolve(phase3Context(req, res)).catch(next))
  app.get('/api/admin/phase3/commissions', requireOwner, (req, res, next) => Promise.resolve(commissions(req, res)).catch(next))
  app.patch('/api/admin/phase3/sellers/:sellerId/commission', express.json({ limit: '32kb' }), requireOwner, (req, res, next) => Promise.resolve(setSellerCommission(req, res)).catch(next))
  app.post('/api/admin/phase3/orders/:orderId/confirm-sale', requireOwner, (req, res, next) => Promise.resolve(confirmSale(req, res)).catch(next))
  app.post('/api/admin/phase3/orders/:orderId/unconfirm-sale', requireOwner, (req, res, next) => Promise.resolve(unconfirmSale(req, res)).catch(next))

  app.get('/api/admin/phase3/coupons', requireOwner, (req, res, next) => Promise.resolve(listCoupons(req, res)).catch(next))
  app.post('/api/admin/phase3/coupons', express.json({ limit: '32kb' }), requireOwner, (req, res, next) => Promise.resolve(createCoupon(req, res)).catch(next))
  app.patch('/api/admin/phase3/coupons/:couponId', express.json({ limit: '32kb' }), requireOwner, (req, res, next) => Promise.resolve(updateCoupon(req, res)).catch(next))
  app.delete('/api/admin/phase3/coupons/:couponId', requireOwner, (req, res, next) => Promise.resolve(deleteCoupon(req, res)).catch(next))
  app.post('/api/public/coupons/validate', express.json({ limit: '32kb' }), (req, res, next) => Promise.resolve(validateCoupon(req, res)).catch(next))

  app.post('/api/public/cart-recovery', express.json({ limit: '128kb' }), (req, res, next) => Promise.resolve(saveCartRecovery(req, res)).catch(next))
  app.get('/api/admin/phase3/cart-recovery', requireOwner, (req, res, next) => Promise.resolve(listCartRecoveries(req, res)).catch(next))
  app.post('/api/admin/phase3/cart-recovery/:recoveryId/dismiss', requireOwner, (req, res, next) => Promise.resolve(dismissRecovery(req, res)).catch(next))

  app.get('/api/admin/phase3/referral', requireOwner, (req, res, next) => Promise.resolve(referralStatus(req, res)).catch(next))

  app.get('/api/public/reviews/:storeSlug', (req, res, next) => Promise.resolve(publicReviews(req, res)).catch(next))
  app.get('/api/public/store/:storeSlug/customers/review', (req, res, next) => Promise.resolve(myReview(req, res)).catch(next))
  app.put('/api/public/store/:storeSlug/customers/review', express.json({ limit: '32kb' }), (req, res, next) => Promise.resolve(saveReview(req, res)).catch(next))

  app.get('/api/admin/phase3/catalogs/:catalogId/pdf', requireOwner, (req, res, next) => Promise.resolve(catalogPdf(req, res)).catch(next))

  if (pool) void ensureSchema().catch((error) => console.error('[phase3] schema:', error.message))
}

const previousInit = express.application.init
express.application.init = function phase3GrowthInit(...args) {
  const result = previousInit.apply(this, args)
  install(this)
  return result
}
