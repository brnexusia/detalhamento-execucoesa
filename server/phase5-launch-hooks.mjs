import crypto from 'node:crypto'
import express from 'express'
import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 5000 }) : null
const ownerCookies = ['shopvax_session', 'atacado_session']
const adminSessionMaxDays = 7
const defaultGraceDays = Math.max(0, Math.min(30, Number(process.env.SHOPVAX_BILLING_GRACE_DAYS) || 7))
const bootstrapTokenConfigured = String(process.env.SHOPVAX_ADMIN_BOOTSTRAP_TOKEN || '').trim().length >= 24
const integrationSecretConfigured = String(process.env.SHOPVAX_INTEGRATION_SECRET || '').length >= 32
const publicUrl = String(process.env.SHOPVAX_PUBLIC_URL || '').trim()
const rateLimitEnabled = process.env.SHOPVAX_SECURITY_RATE_LIMIT_DISABLED !== '1'
const planLimitsEnabled = process.env.SHOPVAX_PLAN_LIMITS_DISABLED !== '1'

if (pool) pool.on('error', (error) => console.error('[phase5] pool:', error.message))

const id = () => crypto.randomUUID()
const hash = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex')
const money = (value) => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0
}
const clampInt = (value, min, max) => Math.max(min, Math.min(max, Math.floor(Number(value) || 0)))

function parseCookies(req) {
  const header = req.headers.cookie || ''
  return Object.fromEntries(header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=')
    return index < 0 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))]
  }))
}

function sessionToken(req) {
  const cookies = parseCookies(req)
  for (const name of ownerCookies) if (cookies[name]) return cookies[name]
  return ''
}

function verifyPassword(password, stored) {
  try {
    const [salt, expectedHex] = String(stored || '').split(':')
    const actual = crypto.scryptSync(password, salt, 64)
    const expected = Buffer.from(expectedHex, 'hex')
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
  } catch { return false }
}

async function waitForBaseSchema() {
  if (!pool) throw new Error('DATABASE_URL não configurada.')
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const result = await pool.query(`SELECT
      to_regclass('public.stores') AS stores,
      to_regclass('public.platform_plans') AS plans,
      to_regclass('public.platform_admins') AS admins,
      to_regclass('public.platform_audit_log') AS audit,
      to_regclass('public.sessions') AS sessions,
      to_regclass('public.store_customer_sessions') AS customer_sessions,
      to_regclass('public.order_payments') AS order_payments,
      to_regclass('public.erp_webhook_deliveries') AS erp_deliveries`)
    const row = result.rows[0] || {}
    if (row.stores && row.plans && row.admins && row.audit && row.sessions && row.customer_sessions && row.order_payments && row.erp_deliveries) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Schema base não ficou pronto para a Fase 5.')
}

let schemaPromise = null
async function ensureSchema() {
  if (!pool) throw new Error('DATABASE_URL não configurada.')
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await waitForBaseSchema()
      await pool.query(`
        ALTER TABLE stores ADD COLUMN IF NOT EXISTS billing_credit_months integer NOT NULL DEFAULT 0;
        ALTER TABLE stores ADD COLUMN IF NOT EXISTS billing_status text NOT NULL DEFAULT 'active';
        ALTER TABLE stores ADD COLUMN IF NOT EXISTS billing_cycle text NOT NULL DEFAULT 'monthly';
        ALTER TABLE stores ADD COLUMN IF NOT EXISTS billing_period_started_at timestamptz;
        ALTER TABLE stores ADD COLUMN IF NOT EXISTS billing_period_ends_at timestamptz;
        ALTER TABLE stores ADD COLUMN IF NOT EXISTS billing_grace_ends_at timestamptz;
        ALTER TABLE stores ADD COLUMN IF NOT EXISTS billing_last_renewed_at timestamptz;
        ALTER TABLE stores ADD COLUMN IF NOT EXISTS billing_last_amount numeric(12,2) NOT NULL DEFAULT 0;
        ALTER TABLE stores ADD COLUMN IF NOT EXISTS billing_note text NOT NULL DEFAULT '';
        ALTER TABLE stores ADD COLUMN IF NOT EXISTS billing_suspended_at timestamptz;

        CREATE TABLE IF NOT EXISTS platform_billing_ledger (
          id text PRIMARY KEY,
          store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
          actor_user_id text REFERENCES users(id) ON DELETE SET NULL,
          kind text NOT NULL,
          cycle text NOT NULL DEFAULT '',
          months integer NOT NULL DEFAULT 0,
          gross_amount numeric(12,2) NOT NULL DEFAULT 0,
          discount_amount numeric(12,2) NOT NULL DEFAULT 0,
          credit_months_used integer NOT NULL DEFAULT 0,
          charged_amount numeric(12,2) NOT NULL DEFAULT 0,
          note text NOT NULL DEFAULT '',
          period_started_at timestamptz,
          period_ends_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_platform_billing_store_created ON platform_billing_ledger(store_id,created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_stores_billing_status_period ON stores(billing_status,billing_period_ends_at,billing_grace_ends_at);
      `)
    })().catch((error) => {
      schemaPromise = null
      throw error
    })
  }
  return schemaPromise
}

async function currentAdmin(req) {
  await ensureSchema()
  const token = sessionToken(req)
  if (!token) return null
  const result = await pool.query(`
    SELECT u.id,u.email,u.name,u.password_hash,se.created_at AS session_created_at
    FROM sessions se
    JOIN users u ON u.id=se.user_id
    JOIN platform_admins pa ON pa.user_id=u.id
    WHERE se.token_hash=$1 AND se.expires_at>now() AND se.created_at>now()-($2::text || ' days')::interval
    LIMIT 1
  `, [hash(token), adminSessionMaxDays])
  return result.rows[0] || null
}

async function currentOwner(req) {
  await ensureSchema()
  const token = sessionToken(req)
  if (!token) return null
  const result = await pool.query(`
    SELECT u.id AS user_id,u.name AS owner_name,u.email AS owner_email,
      s.*,pp.name AS plan_name,pp.monthly_price,pp.semester_discount,pp.annual_discount,
      pp.seller_limit,pp.product_limit,pp.catalog_limit,pp.photo_limit,pp.franchisee_limit
    FROM sessions se
    JOIN users u ON u.id=se.user_id
    JOIN stores s ON s.owner_id=u.id
    LEFT JOIN platform_plans pp ON pp.code=COALESCE(s.plan_tier,'bronze')
    WHERE se.token_hash=$1 AND se.expires_at>now() LIMIT 1
  `, [hash(token)])
  return result.rows[0] || null
}

async function requireAdmin(req, res, next) {
  try {
    const admin = await currentAdmin(req)
    if (!admin) return res.status(403).json({ error: 'Acesso restrito aos administradores do Shopvax.' })
    req.phase5Admin = admin
    next()
  } catch (error) { next(error) }
}

async function requireOwner(req, res, next) {
  try {
    const owner = await currentOwner(req)
    if (!owner) return res.status(401).json({ error: 'Sessão necessária.' })
    req.phase5Owner = owner
    next()
  } catch (error) { next(error) }
}

function requireReauth(req, res) {
  const password = String(req.body?.password || '')
  if (!password) { res.status(400).json({ error: 'Confirme sua senha administrativa para esta ação.' }); return false }
  if (!verifyPassword(password, req.phase5Admin?.password_hash)) { res.status(403).json({ error: 'Senha administrativa incorreta.' }); return false }
  return true
}

async function audit(actorId, action, targetType, targetId = null, meta = {}) {
  await pool.query('INSERT INTO platform_audit_log(id,actor_user_id,action,target_type,target_id,meta) VALUES ($1,$2,$3,$4,$5,$6::jsonb)', [id(), actorId || null, action, targetType, targetId, JSON.stringify(meta || {})])
}

function billingShape(row) {
  return {
    status: row.billing_status || 'active',
    cycle: row.billing_cycle || 'monthly',
    periodStartedAt: row.billing_period_started_at,
    periodEndsAt: row.billing_period_ends_at,
    graceEndsAt: row.billing_grace_ends_at,
    lastRenewedAt: row.billing_last_renewed_at,
    lastAmount: Number(row.billing_last_amount || 0),
    creditMonths: Number(row.billing_credit_months || 0),
    note: row.billing_note || '',
    suspendedAt: row.billing_suspended_at,
  }
}

function planPricing(row, cycle) {
  const monthly = Number(row.monthly_price || 0)
  if (cycle === 'semester') return { months: 6, discountRate: Number(row.semester_discount || 0), monthly }
  if (cycle === 'annual') return { months: 12, discountRate: Number(row.annual_discount || 0), monthly }
  return { months: 1, discountRate: 0, monthly }
}

async function storeForAdmin(storeId) {
  const result = await pool.query(`
    SELECT s.*,u.name AS owner_name,u.email AS owner_email,
      pp.name AS plan_name,pp.code AS plan_code,pp.monthly_price,pp.semester_discount,pp.annual_discount,
      pp.seller_limit,pp.product_limit,pp.catalog_limit,pp.photo_limit,pp.franchisee_limit
    FROM stores s JOIN users u ON u.id=s.owner_id
    LEFT JOIN platform_plans pp ON pp.code=COALESCE(s.plan_tier,'bronze')
    WHERE s.id=$1 LIMIT 1
  `, [storeId])
  return result.rows[0] || null
}

async function renewBilling(req, res) {
  if (!requireReauth(req, res)) return
  const store = await storeForAdmin(req.params.storeId)
  if (!store) return res.status(404).json({ error: 'Loja não encontrada.' })
  const cycle = ['monthly', 'semester', 'annual'].includes(String(req.body?.cycle)) ? String(req.body.cycle) : 'monthly'
  const useCredits = req.body?.useCredits !== false
  const note = String(req.body?.note || '').trim().slice(0, 500)
  const pricing = planPricing(store, cycle)
  const gross = money(pricing.monthly * pricing.months)
  const cycleDiscount = money(gross * pricing.discountRate / 100)
  const afterDiscount = money(gross - cycleDiscount)
  const availableCredits = Math.max(0, Number(store.billing_credit_months || 0))
  const creditsUsed = useCredits ? Math.min(availableCredits, pricing.months) : 0
  const effectiveMonthValue = pricing.months > 0 ? afterDiscount / pricing.months : 0
  const creditDiscount = money(effectiveMonthValue * creditsUsed)
  const charged = money(Math.max(0, afterDiscount - creditDiscount))
  const client = await pool.connect()
  let updated
  try {
    await client.query('BEGIN')
    const locked = await client.query('SELECT * FROM stores WHERE id=$1 FOR UPDATE', [store.id])
    if (!locked.rowCount) throw new Error('Loja não encontrada.')
    const current = locked.rows[0]
    const currentCredits = Math.max(0, Number(current.billing_credit_months || 0))
    const finalCreditsUsed = useCredits ? Math.min(currentCredits, pricing.months) : 0
    const finalCreditDiscount = money(effectiveMonthValue * finalCreditsUsed)
    const finalCharged = money(Math.max(0, afterDiscount - finalCreditDiscount))
    const baseResult = await client.query(`SELECT CASE
      WHEN $1::timestamptz IS NOT NULL AND $1::timestamptz>now() THEN $1::timestamptz
      ELSE now() END AS period_start`, [current.billing_period_ends_at])
    const periodStart = baseResult.rows[0].period_start
    const periodEndResult = await client.query("SELECT $1::timestamptz + ($2::text || ' months')::interval AS period_end", [periodStart, pricing.months])
    const periodEnd = periodEndResult.rows[0].period_end
    const nextCredits = currentCredits - finalCreditsUsed
    const storeResult = await client.query(`
      UPDATE stores SET billing_status='active',billing_cycle=$1,billing_period_started_at=$2,billing_period_ends_at=$3,
        billing_grace_ends_at=NULL,billing_last_renewed_at=now(),billing_last_amount=$4,billing_credit_months=$5,
        billing_note=$6,billing_suspended_at=NULL,
        is_active=CASE WHEN billing_suspended_at IS NOT NULL THEN true ELSE is_active END,updated_at=now()
      WHERE id=$7 RETURNING *
    `, [cycle, periodStart, periodEnd, finalCharged, nextCredits, note, store.id])
    updated = storeResult.rows[0]
    await client.query(`
      INSERT INTO platform_billing_ledger(id,store_id,actor_user_id,kind,cycle,months,gross_amount,discount_amount,credit_months_used,charged_amount,note,period_started_at,period_ends_at)
      VALUES ($1,$2,$3,'renewal',$4,$5,$6,$7,$8,$9,$10,$11,$12)
    `, [id(), store.id, req.phase5Admin.id, cycle, pricing.months, gross, money(cycleDiscount + finalCreditDiscount), finalCreditsUsed, finalCharged, note, periodStart, periodEnd])
    await client.query('COMMIT')
  } catch (error) {
    try { await client.query('ROLLBACK') } catch {}
    throw error
  } finally { client.release() }
  await audit(req.phase5Admin.id, 'billing.renew', 'store', store.id, { cycle, chargedAmount: Number(updated.billing_last_amount || 0), creditMonthsRemaining: Number(updated.billing_credit_months || 0) })
  return res.json({ billing: billingShape(updated), pricing: { cycle, months: pricing.months, gross, cycleDiscount, creditsUsed, chargedAmount: Number(updated.billing_last_amount || 0) } })
}

async function setBillingStatus(req, res) {
  if (!requireReauth(req, res)) return
  const store = await storeForAdmin(req.params.storeId)
  if (!store) return res.status(404).json({ error: 'Loja não encontrada.' })
  const status = String(req.body?.status || '')
  if (!['active', 'past_due', 'suspended', 'cancelled'].includes(status)) return res.status(400).json({ error: 'Status de cobrança inválido.' })
  const graceDays = clampInt(req.body?.graceDays ?? defaultGraceDays, 0, 30)
  const note = String(req.body?.note || '').trim().slice(0, 500)
  const result = await pool.query(`
    UPDATE stores SET billing_status=$1,
      billing_grace_ends_at=CASE WHEN $1='past_due' THEN now()+($2::text || ' days')::interval ELSE NULL END,
      billing_note=$3,
      billing_suspended_at=CASE WHEN $1 IN ('suspended','cancelled') THEN COALESCE(billing_suspended_at,now()) ELSE NULL END,
      is_active=CASE WHEN $1 IN ('suspended','cancelled') THEN false ELSE is_active END,
      updated_at=now()
    WHERE id=$4 RETURNING *
  `, [status, graceDays, note, store.id])
  await pool.query(`INSERT INTO platform_billing_ledger(id,store_id,actor_user_id,kind,note) VALUES ($1,$2,$3,$4,$5)`, [id(), store.id, req.phase5Admin.id, `status:${status}`, note])
  await audit(req.phase5Admin.id, 'billing.status.change', 'store', store.id, { status, graceDays })
  return res.json({ billing: billingShape(result.rows[0]), storeActive: Boolean(result.rows[0].is_active) })
}

async function adjustCredits(req, res) {
  if (!requireReauth(req, res)) return
  const delta = clampInt(req.body?.months, -120, 120)
  if (!delta) return res.status(400).json({ error: 'Informe uma quantidade de meses diferente de zero.' })
  const note = String(req.body?.note || '').trim().slice(0, 500)
  const result = await pool.query(`
    UPDATE stores SET billing_credit_months=GREATEST(0,billing_credit_months+$1),updated_at=now()
    WHERE id=$2 RETURNING *
  `, [delta, req.params.storeId])
  if (!result.rowCount) return res.status(404).json({ error: 'Loja não encontrada.' })
  await pool.query(`INSERT INTO platform_billing_ledger(id,store_id,actor_user_id,kind,months,note) VALUES ($1,$2,$3,'credit_adjustment',$4,$5)`, [id(), req.params.storeId, req.phase5Admin.id, delta, note])
  await audit(req.phase5Admin.id, 'billing.credit.adjust', 'store', req.params.storeId, { delta, creditMonths: Number(result.rows[0].billing_credit_months || 0) })
  return res.json({ billing: billingShape(result.rows[0]) })
}

async function billingLedger(req, res) {
  const store = await storeForAdmin(req.params.storeId)
  if (!store) return res.status(404).json({ error: 'Loja não encontrada.' })
  const ledger = await pool.query(`
    SELECT l.*,u.name AS actor_name,u.email AS actor_email
    FROM platform_billing_ledger l LEFT JOIN users u ON u.id=l.actor_user_id
    WHERE l.store_id=$1 ORDER BY l.created_at DESC LIMIT 100
  `, [store.id])
  return res.json({ store: { id: store.id, name: store.name, ownerName: store.owner_name, ownerEmail: store.owner_email, planCode: store.plan_code || store.plan_tier }, billing: billingShape(store), ledger: ledger.rows.map((row) => ({ id: row.id, kind: row.kind, cycle: row.cycle, months: Number(row.months || 0), grossAmount: Number(row.gross_amount || 0), discountAmount: Number(row.discount_amount || 0), creditMonthsUsed: Number(row.credit_months_used || 0), chargedAmount: Number(row.charged_amount || 0), note: row.note || '', periodStartedAt: row.period_started_at, periodEndsAt: row.period_ends_at, createdAt: row.created_at, actorName: row.actor_name, actorEmail: row.actor_email })) })
}

async function revokeSessions(req, res) {
  if (!requireReauth(req, res)) return
  const store = await storeForAdmin(req.params.storeId)
  if (!store) return res.status(404).json({ error: 'Loja não encontrada.' })
  const scope = ['owner', 'customers', 'all'].includes(String(req.body?.scope)) ? String(req.body.scope) : 'all'
  let ownerSessions = 0
  let customerSessions = 0
  if (scope === 'owner' || scope === 'all') {
    const result = await pool.query('DELETE FROM sessions WHERE user_id=$1', [store.owner_id])
    ownerSessions = result.rowCount || 0
  }
  if (scope === 'customers' || scope === 'all') {
    const result = await pool.query(`DELETE FROM store_customer_sessions WHERE customer_id IN (SELECT id FROM store_customers WHERE store_id=$1)`, [store.id])
    customerSessions = result.rowCount || 0
  }
  await audit(req.phase5Admin.id, 'security.sessions.revoke', 'store', store.id, { scope, ownerSessions, customerSessions })
  return res.json({ ok: true, revoked: { ownerSessions, customerSessions } })
}

async function ownerSecurity(req, res) {
  const token = sessionToken(req)
  const tokenHash = hash(token)
  const active = await pool.query('SELECT count(*)::int AS total,min(created_at) AS oldest,max(expires_at) AS latest_expiry FROM sessions WHERE user_id=$1 AND expires_at>now()', [req.phase5Owner.user_id])
  return res.json({ sessions: { active: Number(active.rows[0]?.total || 0), oldestAt: active.rows[0]?.oldest, latestExpiryAt: active.rows[0]?.latest_expiry, currentTokenHashPrefix: tokenHash.slice(0, 8) } })
}

async function revokeOtherOwnerSessions(req, res) {
  const token = sessionToken(req)
  const currentHash = hash(token)
  const result = await pool.query('DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2 RETURNING token_hash', [req.phase5Owner.user_id, currentHash])
  return res.json({ ok: true, revoked: result.rowCount || 0 })
}

function usageRatio(current, max) {
  if (max == null || Number(max) <= 0) return null
  return Math.round((Number(current || 0) / Number(max)) * 100)
}

async function ownerStatus(req, res) {
  const store = req.phase5Owner
  const usage = await pool.query(`SELECT
    (SELECT count(*)::int FROM products WHERE store_id=$1) AS products,
    (SELECT count(*)::int FROM sellers WHERE store_id=$1) AS sellers,
    (SELECT count(*)::int FROM catalogs WHERE store_id=$1) AS catalogs,
    (SELECT count(*)::int FROM store_franchisees WHERE store_id=$1 AND active=true) AS franchisees`, [store.id])
  const u = usage.rows[0] || {}
  const limits = {
    products: store.product_limit == null ? null : Number(store.product_limit),
    sellers: store.seller_limit == null ? null : Number(store.seller_limit),
    catalogs: store.catalog_limit == null ? null : Number(store.catalog_limit),
    franchisees: store.franchisee_limit == null ? null : Number(store.franchisee_limit),
    photosPerProduct: store.photo_limit == null ? null : Number(store.photo_limit),
  }
  const ratios = {
    products: usageRatio(u.products, limits.products), sellers: usageRatio(u.sellers, limits.sellers), catalogs: usageRatio(u.catalogs, limits.catalogs), franchisees: usageRatio(u.franchisees, limits.franchisees),
  }
  const warnings = []
  if (store.billing_status === 'past_due') warnings.push('Sua assinatura está em atraso dentro do período de tolerância.')
  if (['suspended', 'cancelled'].includes(store.billing_status)) warnings.push('Sua assinatura está suspensa e a loja pode ficar indisponível.')
  for (const [key, ratio] of Object.entries(ratios)) if (ratio != null && ratio >= 80) warnings.push(`Uso de ${key} está em ${ratio}% do limite do plano.`)
  return res.json({
    plan: { code: store.plan_tier || 'bronze', name: store.plan_name || 'Plano', monthlyPrice: Number(store.monthly_price || 0), limits },
    usage: { products: Number(u.products || 0), sellers: Number(u.sellers || 0), catalogs: Number(u.catalogs || 0), franchisees: Number(u.franchisees || 0), ratios },
    billing: billingShape(store), warnings,
  })
}

async function launchOverview(req, res) {
  await sweepBilling()
  const stores = await pool.query(`
    SELECT s.id,s.slug,s.name,s.is_active,s.plan_tier,s.billing_status,s.billing_cycle,s.billing_period_ends_at,s.billing_grace_ends_at,
      s.billing_last_amount,s.billing_credit_months,s.billing_note,u.name AS owner_name,u.email AS owner_email,
      pp.name AS plan_name,pp.monthly_price,
      (SELECT count(*)::int FROM products p WHERE p.store_id=s.id) AS products,
      (SELECT count(*)::int FROM sellers se WHERE se.store_id=s.id) AS sellers,
      (SELECT count(*)::int FROM catalogs c WHERE c.store_id=s.id) AS catalogs,
      (SELECT count(*)::int FROM sessions ss WHERE ss.user_id=s.owner_id AND ss.expires_at>now()) AS owner_sessions,
      (SELECT count(*)::int FROM store_customer_sessions cs JOIN store_customers cst ON cst.id=cs.customer_id WHERE cst.store_id=s.id AND cs.expires_at>now()) AS customer_sessions
    FROM stores s JOIN users u ON u.id=s.owner_id
    LEFT JOIN platform_plans pp ON pp.code=COALESCE(s.plan_tier,'bronze')
    ORDER BY s.created_at DESC
  `)
  const stats = await pool.query(`SELECT
    count(*)::int AS stores,
    count(*) FILTER (WHERE billing_status='active')::int AS billing_active,
    count(*) FILTER (WHERE billing_status='past_due')::int AS billing_past_due,
    count(*) FILTER (WHERE billing_status='suspended')::int AS billing_suspended,
    count(*) FILTER (WHERE billing_status='cancelled')::int AS billing_cancelled,
    count(*) FILTER (WHERE billing_period_ends_at BETWEEN now() AND now()+interval '7 days')::int AS expires_7d,
    count(*) FILTER (WHERE billing_period_ends_at BETWEEN now() AND now()+interval '30 days')::int AS expires_30d
    FROM stores`)
  const operations = await pool.query(`SELECT
    (SELECT count(*)::int FROM sessions WHERE expires_at>now()) AS active_owner_sessions,
    (SELECT count(*)::int FROM store_customer_sessions WHERE expires_at>now()) AS active_customer_sessions,
    (SELECT count(*)::int FROM erp_webhook_deliveries WHERE status='failed' AND created_at>now()-interval '24 hours') AS failed_erp_24h,
    (SELECT count(*)::int FROM order_payments WHERE status IN ('overdue','chargeback') AND updated_at>now()-interval '30 days') AS risky_payments_30d`)
  const checks = [
    { key: 'database', label: 'Banco PostgreSQL', ok: true, critical: true },
    { key: 'production', label: 'NODE_ENV=production', ok: process.env.NODE_ENV === 'production', critical: false },
    { key: 'bootstrap', label: 'Token de bootstrap admin configurado', ok: bootstrapTokenConfigured, critical: true },
    { key: 'integration_secret', label: 'Segredo de integrações configurado', ok: integrationSecretConfigured, critical: true },
    { key: 'public_url', label: 'URL pública configurada', ok: /^https:\/\//i.test(publicUrl), critical: true },
    { key: 'rate_limit', label: 'Rate limit de segurança ativo', ok: rateLimitEnabled, critical: true },
    { key: 'plan_limits', label: 'Limites de plano ativos', ok: planLimitsEnabled, critical: true },
  ]
  return res.json({
    stats: { ...stats.rows[0], ...operations.rows[0] },
    checks,
    launchReady: checks.filter((item) => item.critical).every((item) => item.ok),
    stores: stores.rows.map((row) => ({ id: row.id, slug: row.slug, name: row.name, isActive: Boolean(row.is_active), planCode: row.plan_tier || 'bronze', planName: row.plan_name || '', monthlyPrice: Number(row.monthly_price || 0), ownerName: row.owner_name, ownerEmail: row.owner_email, billing: billingShape(row), products: Number(row.products || 0), sellers: Number(row.sellers || 0), catalogs: Number(row.catalogs || 0), ownerSessions: Number(row.owner_sessions || 0), customerSessions: Number(row.customer_sessions || 0) })),
  })
}

let sweepPromise = null
async function sweepBilling() {
  await ensureSchema()
  if (sweepPromise) return sweepPromise
  sweepPromise = (async () => {
    await pool.query(`
      UPDATE stores SET billing_status='past_due',billing_grace_ends_at=COALESCE(billing_grace_ends_at,now()+($1::text || ' days')::interval),updated_at=now()
      WHERE billing_status='active' AND billing_period_ends_at IS NOT NULL AND billing_period_ends_at<now();
      UPDATE stores SET billing_status='suspended',billing_suspended_at=COALESCE(billing_suspended_at,now()),is_active=false,updated_at=now()
      WHERE billing_status='past_due' AND billing_grace_ends_at IS NOT NULL AND billing_grace_ends_at<now();
    `, [defaultGraceDays])
  })().finally(() => { sweepPromise = null })
  return sweepPromise
}

async function billingMutationGate(req, res, next) {
  try {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !req.path.startsWith('/api/admin/')) return next()
    const owner = await currentOwner(req)
    if (!owner) return next()
    if (owner.billing_status === 'past_due' && owner.billing_grace_ends_at && new Date(owner.billing_grace_ends_at).getTime() <= Date.now()) {
      await sweepBilling()
      return res.status(402).json({ error: 'Assinatura vencida. Regularize a cobrança para continuar alterando a loja.', code: 'BILLING_SUSPENDED' })
    }
    if (['suspended', 'cancelled'].includes(owner.billing_status)) return res.status(402).json({ error: 'Assinatura suspensa. Regularize a cobrança para continuar alterando a loja.', code: 'BILLING_SUSPENDED' })
    next()
  } catch (error) { next(error) }
}

function install(app) {
  if (app.__shopvaxPhase5LaunchInstalled) return
  app.__shopvaxPhase5LaunchInstalled = true

  app.use((req, res, next) => Promise.resolve(billingMutationGate(req, res, next)).catch(next))

  app.get('/api/admin/phase5/status', requireOwner, (req, res, next) => Promise.resolve(ownerStatus(req, res)).catch(next))
  app.get('/api/auth/security/sessions', requireOwner, (req, res, next) => Promise.resolve(ownerSecurity(req, res)).catch(next))
  app.post('/api/auth/security/revoke-others', requireOwner, (req, res, next) => Promise.resolve(revokeOtherOwnerSessions(req, res)).catch(next))

  app.get('/api/platform/phase5/overview', requireAdmin, (req, res, next) => Promise.resolve(launchOverview(req, res)).catch(next))
  app.get('/api/platform/phase5/stores/:storeId/billing', requireAdmin, (req, res, next) => Promise.resolve(billingLedger(req, res)).catch(next))
  app.post('/api/platform/phase5/stores/:storeId/billing/renew', express.json({ limit: '32kb' }), requireAdmin, (req, res, next) => Promise.resolve(renewBilling(req, res)).catch(next))
  app.post('/api/platform/phase5/stores/:storeId/billing/status', express.json({ limit: '32kb' }), requireAdmin, (req, res, next) => Promise.resolve(setBillingStatus(req, res)).catch(next))
  app.post('/api/platform/phase5/stores/:storeId/billing/credits', express.json({ limit: '32kb' }), requireAdmin, (req, res, next) => Promise.resolve(adjustCredits(req, res)).catch(next))
  app.post('/api/platform/phase5/stores/:storeId/security/revoke-sessions', express.json({ limit: '32kb' }), requireAdmin, (req, res, next) => Promise.resolve(revokeSessions(req, res)).catch(next))

  if (pool) {
    void ensureSchema().then(() => sweepBilling()).catch((error) => console.error('[phase5] schema:', error.message))
    const sweep = setInterval(() => void sweepBilling().catch((error) => console.error('[phase5] billing sweep:', error.message)), 60 * 60 * 1000)
    sweep.unref()
  }
}

const previousInit = express.application.init
express.application.init = function phase5LaunchInit(...args) {
  const result = previousInit.apply(this, args)
  install(this)
  return result
}
