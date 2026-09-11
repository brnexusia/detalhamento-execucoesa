import crypto from 'node:crypto'
import express from 'express'
import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 8, connectionTimeoutMillis: 5000 }) : null
const ownerCookie = 'atacado_session'
const customerCookie = 'shopvax_customer_session'
const integrationSecret = process.env.SHOPVAX_INTEGRATION_SECRET || ''
const publicUrl = String(process.env.SHOPVAX_PUBLIC_URL || '').replace(/\/+$/, '')
const asaasMock = process.env.SHOPVAX_ASAAS_MOCK === '1'
const planGatesDisabled = process.env.SHOPVAX_PLAN_LIMITS_DISABLED === '1'

if (pool) pool.on('error', (error) => console.error('[phase4] pool:', error.message))

const id = () => crypto.randomUUID()
const hash = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex')
const digits = (value) => String(value || '').replace(/\D/g, '')
const money = (value) => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0
}
const allowedPaymentMethods = new Set(['PIX', 'BOLETO', 'CREDIT_CARD', 'UNDEFINED'])
const allowedApiScopes = new Set(['products:read', 'orders:read', 'customers:read', 'payments:read', 'stock:write'])

function parseCookies(req) {
  const header = req.headers.cookie || ''
  return Object.fromEntries(header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=')
    return index < 0 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))]
  }))
}

function encryptionKey() {
  if (!integrationSecret) return null
  return crypto.createHash('sha256').update(integrationSecret).digest()
}

function encryptSecret(value) {
  const key = encryptionKey()
  if (!key) throw new Error('SHOPVAX_INTEGRATION_SECRET não configurada.')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(String(value || ''), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`
}

function decryptSecret(value) {
  if (!value) return ''
  const key = encryptionKey()
  if (!key) throw new Error('SHOPVAX_INTEGRATION_SECRET não configurada.')
  const [version, ivRaw, tagRaw, encryptedRaw] = String(value).split('.')
  if (version !== 'v1' || !ivRaw || !tagRaw || !encryptedRaw) throw new Error('Credencial de integração inválida.')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivRaw, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(encryptedRaw, 'base64url')), decipher.final()]).toString('utf8')
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left || ''))
  const b = Buffer.from(String(right || ''))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function normalizeMethods(value) {
  const source = Array.isArray(value) ? value : []
  const methods = [...new Set(source.map((item) => String(item || '').trim().toUpperCase()).filter((item) => allowedPaymentMethods.has(item)))]
  return methods.length ? methods : ['PIX', 'BOLETO', 'CREDIT_CARD']
}

function normalizeScopes(value) {
  const source = Array.isArray(value) ? value : []
  return [...new Set(source.map((item) => String(item || '').trim()).filter((item) => allowedApiScopes.has(item)))]
}

function normalizeState(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2)
}

function normalizePrefixes(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => digits(item).slice(0, 8)).filter((item) => item.length >= 2))].slice(0, 50)
}

function normalizeStates(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(normalizeState).filter((item) => item.length === 2))].slice(0, 27)
}

function normalizeUrl(value, { allowHttpLocal = false } = {}) {
  try {
    const url = new URL(String(value || '').trim())
    if (url.protocol === 'https:') return url.toString()
    if (allowHttpLocal && url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) return url.toString()
  } catch {}
  return ''
}

async function waitForBaseSchema() {
  if (!pool) throw new Error('DATABASE_URL não configurada.')
  for (let attempt = 0; attempt < 140; attempt += 1) {
    const result = await pool.query(`SELECT
      to_regclass('public.stores') AS stores,
      to_regclass('public.products') AS products,
      to_regclass('public.orders') AS orders,
      to_regclass('public.platform_plans') AS plans,
      to_regclass('public.store_customers') AS customers,
      to_regclass('public.store_customer_sessions') AS customer_sessions`)
    const row = result.rows[0] || {}
    if (row.stores && row.products && row.orders && row.plans && row.customers && row.customer_sessions) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Schema base não ficou pronto para a Fase 4.')
}

let schemaPromise = null
async function ensureSchema() {
  if (!pool) throw new Error('DATABASE_URL não configurada.')
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await waitForBaseSchema()
      await pool.query(`
        ALTER TABLE store_customers ADD COLUMN IF NOT EXISTS cpf_cnpj text NOT NULL DEFAULT '';
        ALTER TABLE store_customers ADD COLUMN IF NOT EXISTS asaas_customer_id text NOT NULL DEFAULT '';
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_method text NOT NULL DEFAULT '';
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_amount numeric(12,2) NOT NULL DEFAULT 0;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'none';
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_paid_at timestamptz;

        CREATE TABLE IF NOT EXISTS store_phase4_integrations (
          store_id text PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
          asaas_enabled boolean NOT NULL DEFAULT false,
          asaas_environment text NOT NULL DEFAULT 'sandbox',
          asaas_api_key_encrypted text NOT NULL DEFAULT '',
          asaas_api_key_last4 text NOT NULL DEFAULT '',
          asaas_webhook_public_id text NOT NULL DEFAULT '',
          asaas_webhook_token_encrypted text NOT NULL DEFAULT '',
          payment_methods jsonb NOT NULL DEFAULT '["PIX","BOLETO","CREDIT_CARD"]'::jsonb,
          shipping_enabled boolean NOT NULL DEFAULT false,
          meta_catalog_enabled boolean NOT NULL DEFAULT false,
          meta_brand text NOT NULL DEFAULT '',
          erp_api_enabled boolean NOT NULL DEFAULT false,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_phase4_asaas_webhook_public
          ON store_phase4_integrations(asaas_webhook_public_id) WHERE asaas_webhook_public_id<>'';

        CREATE TABLE IF NOT EXISTS shipping_rules (
          id text PRIMARY KEY,
          store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
          name text NOT NULL,
          states jsonb NOT NULL DEFAULT '[]'::jsonb,
          cep_prefixes jsonb NOT NULL DEFAULT '[]'::jsonb,
          amount numeric(12,2) NOT NULL DEFAULT 0,
          free_over numeric(12,2),
          min_subtotal numeric(12,2) NOT NULL DEFAULT 0,
          delivery_days_min integer NOT NULL DEFAULT 1,
          delivery_days_max integer NOT NULL DEFAULT 7,
          active boolean NOT NULL DEFAULT true,
          sort_order integer NOT NULL DEFAULT 0,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_shipping_rules_store ON shipping_rules(store_id,active,sort_order,created_at);

        CREATE TABLE IF NOT EXISTS shipping_quotes (
          id text PRIMARY KEY,
          store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
          rule_id text NOT NULL REFERENCES shipping_rules(id) ON DELETE CASCADE,
          postal_code text NOT NULL,
          state text NOT NULL DEFAULT '',
          subtotal numeric(12,2) NOT NULL,
          amount numeric(12,2) NOT NULL,
          method_name text NOT NULL,
          delivery_days_min integer NOT NULL,
          delivery_days_max integer NOT NULL,
          expires_at timestamptz NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_shipping_quotes_store_expiry ON shipping_quotes(store_id,expires_at DESC);

        CREATE TABLE IF NOT EXISTS order_payments (
          id text PRIMARY KEY,
          store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
          order_id text NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          customer_id text REFERENCES store_customers(id) ON DELETE SET NULL,
          provider text NOT NULL DEFAULT 'asaas',
          external_id text NOT NULL DEFAULT '',
          external_customer_id text NOT NULL DEFAULT '',
          billing_type text NOT NULL,
          status text NOT NULL DEFAULT 'pending',
          value numeric(12,2) NOT NULL,
          invoice_url text NOT NULL DEFAULT '',
          raw_response jsonb NOT NULL DEFAULT '{}'::jsonb,
          paid_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE(provider,external_id)
        );
        CREATE INDEX IF NOT EXISTS idx_order_payments_store_order ON order_payments(store_id,order_id,created_at DESC);

        CREATE TABLE IF NOT EXISTS phase4_webhook_events (
          id text PRIMARY KEY,
          store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
          provider text NOT NULL,
          event_type text NOT NULL,
          payload jsonb NOT NULL DEFAULT '{}'::jsonb,
          processed_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS erp_api_tokens (
          id text PRIMARY KEY,
          store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
          name text NOT NULL,
          token_prefix text NOT NULL,
          token_hash text NOT NULL UNIQUE,
          scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
          active boolean NOT NULL DEFAULT true,
          last_used_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_erp_api_tokens_store ON erp_api_tokens(store_id,active,created_at DESC);

        CREATE TABLE IF NOT EXISTS erp_webhooks (
          id text PRIMARY KEY,
          store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
          name text NOT NULL,
          url text NOT NULL,
          secret_encrypted text NOT NULL,
          events jsonb NOT NULL DEFAULT '["order.created","payment.updated","stock.updated"]'::jsonb,
          active boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_erp_webhooks_store ON erp_webhooks(store_id,active,created_at DESC);

        CREATE TABLE IF NOT EXISTS erp_webhook_deliveries (
          id text PRIMARY KEY,
          store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
          webhook_id text REFERENCES erp_webhooks(id) ON DELETE SET NULL,
          event_type text NOT NULL,
          status text NOT NULL,
          response_status integer,
          error text NOT NULL DEFAULT '',
          created_at timestamptz NOT NULL DEFAULT now()
        );
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
    SELECT s.id,s.slug,s.name,s.whatsapp,s.plan_tier,u.name AS owner_name,u.email AS owner_email,
           pp.code AS plan_code,pp.name AS plan_name
    FROM sessions se
    JOIN users u ON u.id=se.user_id
    JOIN stores s ON s.owner_id=u.id
    LEFT JOIN platform_plans pp ON pp.code=COALESCE(s.plan_tier,'bronze')
    WHERE se.token_hash=$1 AND se.expires_at>now() LIMIT 1
  `, [hash(token)])
  return result.rows[0] || null
}

async function currentCustomer(req, storeId) {
  await ensureSchema()
  const token = parseCookies(req)[customerCookie]
  if (!token) return null
  const result = await pool.query(`
    SELECT c.id,c.store_id,c.name,c.email,c.phone,c.cpf_cnpj,c.asaas_customer_id
    FROM store_customer_sessions se
    JOIN store_customers c ON c.id=se.customer_id
    WHERE se.token_hash=$1 AND se.expires_at>now() AND c.active=true AND c.store_id=$2 LIMIT 1
  `, [hash(token), storeId])
  return result.rows[0] || null
}

async function storeBySlug(slug) {
  await ensureSchema()
  const result = await pool.query(`
    SELECT s.id,s.slug,s.name,s.plan_tier,pp.code AS plan_code,pp.name AS plan_name
    FROM stores s LEFT JOIN platform_plans pp ON pp.code=COALESCE(s.plan_tier,'bronze')
    WHERE s.slug=$1 AND s.is_active=true LIMIT 1
  `, [String(slug || '')])
  return result.rows[0] || null
}

function phase4Eligible(store) {
  return planGatesDisabled || String(store?.plan_code || store?.plan_tier || '') === 'ouro'
}

function denyPhase4(res) {
  return res.status(403).json({ error: 'Pagamentos, frete avançado, Meta e API/ERP estão disponíveis no Plano 3.', code: 'PLAN_FEATURE' })
}

async function requireOwner(req, res, next) {
  try {
    const store = await ownerStore(req)
    if (!store) return res.status(401).json({ error: 'Sessão necessária.' })
    req.phase4Store = store
    next()
  } catch (error) { next(error) }
}

async function requirePhase4Owner(req, res, next) {
  await requireOwner(req, res, () => {
    if (!phase4Eligible(req.phase4Store)) return denyPhase4(res)
    next()
  })
}

async function integrationRow(storeId) {
  await ensureSchema()
  await pool.query(`INSERT INTO store_phase4_integrations(store_id) VALUES ($1) ON CONFLICT (store_id) DO NOTHING`, [storeId])
  const result = await pool.query('SELECT * FROM store_phase4_integrations WHERE store_id=$1 LIMIT 1', [storeId])
  return result.rows[0]
}

function integrationShape(row, storeSlug = '') {
  const webhookUrl = row.asaas_webhook_public_id
    ? `${publicUrl || ''}/api/webhooks/asaas/${row.asaas_webhook_public_id}`
    : ''
  return {
    asaas: {
      enabled: Boolean(row.asaas_enabled),
      environment: row.asaas_environment,
      apiKeyConfigured: Boolean(row.asaas_api_key_encrypted),
      apiKeyLast4: row.asaas_api_key_last4 || '',
      paymentMethods: normalizeMethods(row.payment_methods),
      webhookConfigured: Boolean(row.asaas_webhook_token_encrypted),
      webhookUrl,
    },
    shippingEnabled: Boolean(row.shipping_enabled),
    meta: {
      enabled: Boolean(row.meta_catalog_enabled),
      brand: row.meta_brand || '',
      feedUrl: row.meta_catalog_enabled && storeSlug ? `${publicUrl || ''}/api/public/meta-feed/${encodeURIComponent(storeSlug)}.csv` : '',
    },
    erpApiEnabled: Boolean(row.erp_api_enabled),
  }
}

function asaasBase(environment) {
  const override = String(process.env.SHOPVAX_ASAAS_BASE_URL || '').replace(/\/+$/, '')
  if (override) return override
  return environment === 'production' ? 'https://api.asaas.com' : 'https://api-sandbox.asaas.com'
}

async function asaasRequest(integration, path, { method = 'GET', body } = {}) {
  if (asaasMock) {
    const random = crypto.randomBytes(6).toString('hex')
    if (path === '/v3/customers' && method === 'POST') return { id: `cus_mock_${random}`, ...body }
    if (path === '/v3/payments' && method === 'POST') return {
      id: `pay_mock_${random}`,
      status: 'PENDING',
      invoiceUrl: `https://sandbox.asaas.test/invoice/${random}`,
      customer: body?.customer,
      value: body?.value,
      billingType: body?.billingType,
      externalReference: body?.externalReference,
    }
    if (path === '/v3/webhooks' && method === 'POST') {
      if (!String(body?.email || '').trim()) throw new Error('Mock Asaas exige email no webhook.')
      return { id: `wbh_mock_${random}`, ...body }
    }
    throw new Error(`Mock Asaas não cobre ${method} ${path}`)
  }

  const apiKey = decryptSecret(integration.asaas_api_key_encrypted)
  if (!apiKey) throw new Error('Chave da API Asaas não configurada.')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)
  try {
    const response = await fetch(`${asaasBase(integration.asaas_environment)}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        access_token: apiKey,
        'user-agent': 'ShopVax/1.0',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      const detail = Array.isArray(payload?.errors) ? payload.errors.map((item) => item.description || item.code).filter(Boolean).join('; ') : payload?.error || ''
      const error = new Error(detail || `Asaas respondeu HTTP ${response.status}.`)
      error.statusCode = response.status
      throw error
    }
    return payload
  } finally { clearTimeout(timeout) }
}

async function configureAsaas(req, res) {
  const store = req.phase4Store
  const current = await integrationRow(store.id)
  const enabled = req.body?.enabled === true
  const environment = req.body?.environment === 'production' ? 'production' : 'sandbox'
  const apiKey = String(req.body?.apiKey || '').trim()
  const methods = normalizeMethods(req.body?.paymentMethods)
  let encryptedKey = current.asaas_api_key_encrypted || ''
  let last4 = current.asaas_api_key_last4 || ''
  let publicId = current.asaas_webhook_public_id || ''
  let webhookTokenEncrypted = current.asaas_webhook_token_encrypted || ''
  let webhookToken = ''

  if (apiKey) {
    encryptedKey = encryptSecret(apiKey)
    last4 = apiKey.slice(-4)
  }
  if (enabled && !encryptedKey) return res.status(400).json({ error: 'Informe a chave da API Asaas antes de ativar pagamentos.' })
  if (!publicId) publicId = crypto.randomBytes(18).toString('hex')
  if (!webhookTokenEncrypted) {
    webhookToken = `svx_wh_${crypto.randomBytes(32).toString('base64url')}`
    webhookTokenEncrypted = encryptSecret(webhookToken)
  }

  const result = await pool.query(`
    UPDATE store_phase4_integrations SET
      asaas_enabled=$1,asaas_environment=$2,asaas_api_key_encrypted=$3,asaas_api_key_last4=$4,
      asaas_webhook_public_id=$5,asaas_webhook_token_encrypted=$6,payment_methods=$7::jsonb,updated_at=now()
    WHERE store_id=$8 RETURNING *
  `, [enabled, environment, encryptedKey, last4, publicId, webhookTokenEncrypted, JSON.stringify(methods), store.id])

  return res.json({
    integration: integrationShape(result.rows[0], store.slug),
    webhookAuthToken: webhookToken || undefined,
    warning: publicUrl ? null : 'SHOPVAX_PUBLIC_URL não configurada; o endereço de webhook ficará incompleto até definir a URL pública.',
  })
}

async function provisionAsaasWebhook(req, res) {
  const store = req.phase4Store
  const integration = await integrationRow(store.id)
  if (!integration.asaas_enabled || !integration.asaas_api_key_encrypted) return res.status(409).json({ error: 'Ative e configure o Asaas antes de provisionar o webhook.' })
  if (!publicUrl) return res.status(503).json({ error: 'SHOPVAX_PUBLIC_URL precisa estar configurada para provisionar o webhook.' })
  const ownerEmail = String(store.owner_email || '').trim()
  if (!ownerEmail) return res.status(409).json({ error: 'A conta proprietária precisa ter e-mail para provisionar o webhook do Asaas.' })
  const authToken = decryptSecret(integration.asaas_webhook_token_encrypted)
  const url = `${publicUrl}/api/webhooks/asaas/${integration.asaas_webhook_public_id}`
  const payload = await asaasRequest(integration, '/v3/webhooks', {
    method: 'POST',
    body: {
      name: `ShopVax · ${store.name}`.slice(0, 100),
      url,
      email: ownerEmail,
      enabled: true,
      interrupted: false,
      apiVersion: 3,
      authToken,
      sendType: 'SEQUENTIALLY',
      events: ['PAYMENT_CREATED', 'PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_OVERDUE', 'PAYMENT_DELETED', 'PAYMENT_REFUNDED', 'PAYMENT_CHARGEBACK_REQUESTED'],
    },
  })
  return res.status(201).json({ webhook: { id: payload.id || '', url } })
}

async function saveCoreSettings(req, res) {
  const store = req.phase4Store
  const current = await integrationRow(store.id)
  const shippingEnabled = req.body?.shippingEnabled == null ? current.shipping_enabled : req.body.shippingEnabled === true
  const metaEnabled = req.body?.metaEnabled == null ? current.meta_catalog_enabled : req.body.metaEnabled === true
  const metaBrand = String(req.body?.metaBrand ?? current.meta_brand ?? '').trim().slice(0, 120)
  const erpApiEnabled = req.body?.erpApiEnabled == null ? current.erp_api_enabled : req.body.erpApiEnabled === true
  const result = await pool.query(`
    UPDATE store_phase4_integrations SET shipping_enabled=$1,meta_catalog_enabled=$2,meta_brand=$3,erp_api_enabled=$4,updated_at=now()
    WHERE store_id=$5 RETURNING *
  `, [shippingEnabled, metaEnabled, metaBrand, erpApiEnabled, store.id])
  return res.json({ integration: integrationShape(result.rows[0], store.slug) })
}

function shippingRuleShape(row) {
  return {
    id: row.id,
    name: row.name,
    states: Array.isArray(row.states) ? row.states : [],
    cepPrefixes: Array.isArray(row.cep_prefixes) ? row.cep_prefixes : [],
    amount: Number(row.amount || 0),
    freeOver: row.free_over == null ? null : Number(row.free_over),
    minSubtotal: Number(row.min_subtotal || 0),
    deliveryDaysMin: Number(row.delivery_days_min || 0),
    deliveryDaysMax: Number(row.delivery_days_max || 0),
    active: Boolean(row.active),
    sortOrder: Number(row.sort_order || 0),
  }
}

async function listShippingRules(req, res) {
  const result = await pool.query('SELECT * FROM shipping_rules WHERE store_id=$1 ORDER BY sort_order,created_at', [req.phase4Store.id])
  return res.json({ rules: result.rows.map(shippingRuleShape) })
}

async function createShippingRule(req, res) {
  const store = req.phase4Store
  const name = String(req.body?.name || '').trim().slice(0, 100)
  if (!name) return res.status(400).json({ error: 'Informe o nome da regra de frete.' })
  const states = normalizeStates(req.body?.states)
  const prefixes = normalizePrefixes(req.body?.cepPrefixes)
  const amount = Math.max(0, money(req.body?.amount))
  const freeOver = req.body?.freeOver == null || req.body.freeOver === '' ? null : Math.max(0, money(req.body.freeOver))
  const minSubtotal = Math.max(0, money(req.body?.minSubtotal))
  const daysMin = Math.max(0, Math.min(180, Math.floor(Number(req.body?.deliveryDaysMin) || 1)))
  const daysMax = Math.max(daysMin, Math.min(365, Math.floor(Number(req.body?.deliveryDaysMax) || daysMin)))
  const sortOrder = Math.max(0, Math.min(9999, Math.floor(Number(req.body?.sortOrder) || 0)))
  const result = await pool.query(`
    INSERT INTO shipping_rules(id,store_id,name,states,cep_prefixes,amount,free_over,min_subtotal,delivery_days_min,delivery_days_max,active,sort_order)
    VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10,$11,$12) RETURNING *
  `, [id(), store.id, name, JSON.stringify(states), JSON.stringify(prefixes), amount, freeOver, minSubtotal, daysMin, daysMax, req.body?.active !== false, sortOrder])
  return res.status(201).json({ rule: shippingRuleShape(result.rows[0]) })
}

async function updateShippingRule(req, res) {
  const store = req.phase4Store
  const existing = await pool.query('SELECT * FROM shipping_rules WHERE id=$1 AND store_id=$2 LIMIT 1', [req.params.ruleId, store.id])
  if (!existing.rowCount) return res.status(404).json({ error: 'Regra de frete não encontrada.' })
  const row = existing.rows[0]
  const name = String(req.body?.name ?? row.name).trim().slice(0, 100)
  const states = req.body?.states == null ? row.states : normalizeStates(req.body.states)
  const prefixes = req.body?.cepPrefixes == null ? row.cep_prefixes : normalizePrefixes(req.body.cepPrefixes)
  const amount = req.body?.amount == null ? Number(row.amount) : Math.max(0, money(req.body.amount))
  const freeOver = req.body?.freeOver === undefined ? row.free_over : (req.body.freeOver == null || req.body.freeOver === '' ? null : Math.max(0, money(req.body.freeOver)))
  const minSubtotal = req.body?.minSubtotal == null ? Number(row.min_subtotal) : Math.max(0, money(req.body.minSubtotal))
  const daysMin = req.body?.deliveryDaysMin == null ? Number(row.delivery_days_min) : Math.max(0, Math.min(180, Math.floor(Number(req.body.deliveryDaysMin) || 0)))
  const daysMax = req.body?.deliveryDaysMax == null ? Number(row.delivery_days_max) : Math.max(daysMin, Math.min(365, Math.floor(Number(req.body.deliveryDaysMax) || daysMin)))
  const active = req.body?.active == null ? row.active : req.body.active === true
  const sortOrder = req.body?.sortOrder == null ? Number(row.sort_order) : Math.max(0, Math.min(9999, Math.floor(Number(req.body.sortOrder) || 0)))
  const result = await pool.query(`
    UPDATE shipping_rules SET name=$1,states=$2::jsonb,cep_prefixes=$3::jsonb,amount=$4,free_over=$5,min_subtotal=$6,
      delivery_days_min=$7,delivery_days_max=$8,active=$9,sort_order=$10,updated_at=now()
    WHERE id=$11 AND store_id=$12 RETURNING *
  `, [name, JSON.stringify(states), JSON.stringify(prefixes), amount, freeOver, minSubtotal, daysMin, daysMax, active, sortOrder, row.id, store.id])
  return res.json({ rule: shippingRuleShape(result.rows[0]) })
}

async function deleteShippingRule(req, res) {
  const result = await pool.query('DELETE FROM shipping_rules WHERE id=$1 AND store_id=$2 RETURNING id', [req.params.ruleId, req.phase4Store.id])
  if (!result.rowCount) return res.status(404).json({ error: 'Regra de frete não encontrada.' })
  return res.status(204).end()
}

function ruleMatches(rule, postalCode, state, subtotal) {
  if (!rule.active || subtotal < Number(rule.min_subtotal || 0)) return false
  const states = Array.isArray(rule.states) ? rule.states : []
  const prefixes = Array.isArray(rule.cep_prefixes) ? rule.cep_prefixes : []
  const stateMatch = !states.length || (state && states.includes(state))
  const prefixMatch = !prefixes.length || prefixes.some((prefix) => postalCode.startsWith(prefix))
  return stateMatch && prefixMatch
}

async function shippingQuote(req, res) {
  const store = await storeBySlug(req.body?.storeSlug)
  if (!store || !phase4Eligible(store)) return res.status(404).json({ error: 'Loja não encontrada.' })
  const integration = await integrationRow(store.id)
  if (!integration.shipping_enabled) return res.status(409).json({ error: 'Frete online não está ativo nesta loja.' })
  const postalCode = digits(req.body?.postalCode).slice(0, 8)
  if (postalCode.length !== 8) return res.status(400).json({ error: 'Informe um CEP válido com 8 dígitos.' })
  const state = normalizeState(req.body?.state)
  const subtotal = Math.max(0, money(req.body?.subtotal))
  const rulesResult = await pool.query('SELECT * FROM shipping_rules WHERE store_id=$1 AND active=true ORDER BY sort_order,created_at', [store.id])
  const matches = rulesResult.rows.filter((rule) => ruleMatches(rule, postalCode, state, subtotal)).slice(0, 12)
  const quotes = []
  for (const rule of matches) {
    const amount = rule.free_over != null && subtotal >= Number(rule.free_over) ? 0 : Number(rule.amount || 0)
    const quoteId = id()
    await pool.query(`
      INSERT INTO shipping_quotes(id,store_id,rule_id,postal_code,state,subtotal,amount,method_name,delivery_days_min,delivery_days_max,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()+interval '30 minutes')
    `, [quoteId, store.id, rule.id, postalCode, state, subtotal, amount, rule.name, rule.delivery_days_min, rule.delivery_days_max])
    quotes.push({ id: quoteId, name: rule.name, amount, deliveryDaysMin: Number(rule.delivery_days_min), deliveryDaysMax: Number(rule.delivery_days_max), expiresInMinutes: 30 })
  }
  return res.json({ quotes })
}

async function attachShipping(req, res) {
  const store = await storeBySlug(req.body?.storeSlug)
  if (!store || !phase4Eligible(store)) return res.status(404).json({ error: 'Loja não encontrada.' })
  const customer = await currentCustomer(req, store.id)
  const order = await pool.query('SELECT id,store_id,customer_id,total,status FROM orders WHERE id=$1 AND store_id=$2 LIMIT 1', [req.params.orderId, store.id])
  if (!order.rowCount) return res.status(404).json({ error: 'Pedido não encontrado.' })
  if (order.rows[0].customer_id && (!customer || order.rows[0].customer_id !== customer.id)) return res.status(403).json({ error: 'Este pedido pertence a outro cliente.' })
  const quote = await pool.query(`SELECT * FROM shipping_quotes WHERE id=$1 AND store_id=$2 AND expires_at>now() LIMIT 1`, [req.body?.quoteId, store.id])
  if (!quote.rowCount) return res.status(409).json({ error: 'Cotação de frete expirada ou inválida.' })
  const row = quote.rows[0]
  const updated = await pool.query(`
    UPDATE orders SET shipping_method=$1,shipping_amount=$2 WHERE id=$3
    RETURNING id,code,total,shipping_method,shipping_amount,payment_status
  `, [row.method_name, row.amount, order.rows[0].id])
  const shaped = updated.rows[0]
  return res.json({ order: { ...shaped, total: Number(shaped.total || 0), shippingAmount: Number(shaped.shipping_amount || 0), grandTotal: money(Number(shaped.total || 0) + Number(shaped.shipping_amount || 0)) } })
}

async function createPayment(req, res) {
  const store = await storeBySlug(req.body?.storeSlug)
  if (!store || !phase4Eligible(store)) return res.status(404).json({ error: 'Loja não encontrada.' })
  const integration = await integrationRow(store.id)
  if (!integration.asaas_enabled || !integration.asaas_api_key_encrypted) return res.status(409).json({ error: 'Pagamento online não está ativo nesta loja.' })
  const customer = await currentCustomer(req, store.id)
  if (!customer) return res.status(401).json({ error: 'Entre na sua conta de cliente para pagar online.', code: 'CUSTOMER_LOGIN_REQUIRED' })
  const orderResult = await pool.query(`
    SELECT id,code,store_id,customer_id,total,status,shipping_method,shipping_amount,payment_status
    FROM orders WHERE id=$1 AND store_id=$2 LIMIT 1
  `, [req.body?.orderId, store.id])
  if (!orderResult.rowCount) return res.status(404).json({ error: 'Pedido não encontrado.' })
  const order = orderResult.rows[0]
  if (order.customer_id && order.customer_id !== customer.id) return res.status(403).json({ error: 'Este pedido pertence a outro cliente.' })
  if (order.status === 'cancelled') return res.status(409).json({ error: 'Pedido cancelado não pode receber pagamento.' })
  if (order.payment_status === 'paid') return res.status(409).json({ error: 'Este pedido já está pago.' })
  const billingType = String(req.body?.billingType || 'PIX').toUpperCase()
  const configuredMethods = normalizeMethods(integration.payment_methods)
  if (!allowedPaymentMethods.has(billingType) || !configuredMethods.includes(billingType)) return res.status(400).json({ error: 'Forma de pagamento não habilitada para esta loja.' })
  const cpfCnpj = digits(req.body?.cpfCnpj || customer.cpf_cnpj)
  if (![11, 14].includes(cpfCnpj.length)) return res.status(400).json({ error: 'Informe CPF ou CNPJ para gerar a cobrança.' })
  const phone = digits(req.body?.phone || customer.phone)
  let asaasCustomerId = String(customer.asaas_customer_id || '')
  if (!asaasCustomerId) {
    const createdCustomer = await asaasRequest(integration, '/v3/customers', {
      method: 'POST',
      body: {
        name: customer.name,
        cpfCnpj,
        email: customer.email || undefined,
        mobilePhone: phone || undefined,
        externalReference: customer.id,
        notificationDisabled: false,
      },
    })
    asaasCustomerId = String(createdCustomer.id || '')
    if (!asaasCustomerId) return res.status(502).json({ error: 'Asaas não retornou o identificador do cliente.' })
    await pool.query('UPDATE store_customers SET cpf_cnpj=$1,asaas_customer_id=$2,updated_at=now() WHERE id=$3', [cpfCnpj, asaasCustomerId, customer.id])
  } else if (cpfCnpj !== customer.cpf_cnpj) {
    await pool.query('UPDATE store_customers SET cpf_cnpj=$1,updated_at=now() WHERE id=$2', [cpfCnpj, customer.id])
  }

  const grandTotal = money(Number(order.total || 0) + Number(order.shipping_amount || 0))
  if (grandTotal <= 0) return res.status(409).json({ error: 'Pedido sem valor para cobrança.' })
  const due = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const createdPayment = await asaasRequest(integration, '/v3/payments', {
    method: 'POST',
    body: {
      customer: asaasCustomerId,
      billingType,
      value: grandTotal,
      dueDate: due,
      description: `Pedido ShopVax ${order.code}`.slice(0, 250),
      externalReference: order.id,
    },
  })
  const externalId = String(createdPayment.id || '')
  if (!externalId) return res.status(502).json({ error: 'Asaas não retornou o identificador da cobrança.' })
  const paymentId = id()
  const invoiceUrl = String(createdPayment.invoiceUrl || createdPayment.bankSlipUrl || '')
  await pool.query(`
    INSERT INTO order_payments(id,store_id,order_id,customer_id,provider,external_id,external_customer_id,billing_type,status,value,invoice_url,raw_response)
    VALUES ($1,$2,$3,$4,'asaas',$5,$6,$7,$8,$9,$10,$11::jsonb)
    ON CONFLICT (provider,external_id) DO NOTHING
  `, [paymentId, store.id, order.id, customer.id, externalId, asaasCustomerId, billingType, String(createdPayment.status || 'PENDING').toLowerCase(), grandTotal, invoiceUrl, JSON.stringify(createdPayment)])
  await pool.query("UPDATE orders SET payment_status='pending' WHERE id=$1 AND payment_status<>'paid'", [order.id])
  void dispatchErpEvent(store.id, 'payment.updated', { orderId: order.id, paymentId: externalId, status: 'pending', value: grandTotal }).catch(() => undefined)
  return res.status(201).json({ payment: { id: paymentId, externalId, billingType, status: String(createdPayment.status || 'PENDING').toLowerCase(), value: grandTotal, invoiceUrl }, order: { id: order.id, code: order.code, grandTotal } })
}

function paymentEventStatus(eventName, payment) {
  const event = String(eventName || '')
  if (['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_RECEIVED_IN_CASH'].includes(event)) return 'paid'
  if (event === 'PAYMENT_OVERDUE') return 'overdue'
  if (event === 'PAYMENT_REFUNDED') return 'refunded'
  if (event === 'PAYMENT_DELETED') return 'deleted'
  if (event.includes('CHARGEBACK')) return 'chargeback'
  return String(payment?.status || 'pending').toLowerCase()
}

async function receiveAsaasWebhook(req, res) {
  await ensureSchema()
  const integrationResult = await pool.query(`
    SELECT i.*,s.slug FROM store_phase4_integrations i JOIN stores s ON s.id=i.store_id
    WHERE i.asaas_webhook_public_id=$1 LIMIT 1
  `, [req.params.publicId])
  if (!integrationResult.rowCount) return res.status(404).json({ error: 'Webhook não encontrado.' })
  const integration = integrationResult.rows[0]
  const expectedToken = decryptSecret(integration.asaas_webhook_token_encrypted)
  const receivedToken = String(req.get('asaas-access-token') || '')
  if (!expectedToken || !secureEqual(expectedToken, receivedToken)) return res.status(401).json({ error: 'Token de webhook inválido.' })
  const eventId = String(req.body?.id || '').slice(0, 200)
  const eventType = String(req.body?.event || '').slice(0, 120)
  const payment = req.body?.payment || {}
  if (!eventId || !eventType) return res.status(400).json({ error: 'Evento Asaas inválido.' })
  const inserted = await pool.query(`
    INSERT INTO phase4_webhook_events(id,store_id,provider,event_type,payload)
    VALUES ($1,$2,'asaas',$3,$4::jsonb) ON CONFLICT (id) DO NOTHING RETURNING id
  `, [eventId, integration.store_id, eventType, JSON.stringify(req.body || {})])
  if (!inserted.rowCount) return res.json({ ok: true, duplicate: true })
  const externalId = String(payment?.id || '')
  const orderId = String(payment?.externalReference || '')
  const status = paymentEventStatus(eventType, payment)
  const paid = status === 'paid'
  if (externalId || orderId) {
    await pool.query(`
      UPDATE order_payments SET status=$1,paid_at=CASE WHEN $2 THEN COALESCE(paid_at,now()) ELSE paid_at END,
        raw_response=$3::jsonb,updated_at=now()
      WHERE store_id=$4 AND provider='asaas' AND (($5<>'' AND external_id=$5) OR ($6<>'' AND order_id=$6))
    `, [status, paid, JSON.stringify(payment || {}), integration.store_id, externalId, orderId])
    if (orderId) {
      await pool.query(`
        UPDATE orders SET payment_status=$1,payment_paid_at=CASE WHEN $2 THEN COALESCE(payment_paid_at,now()) ELSE payment_paid_at END
        WHERE id=$3 AND store_id=$4
      `, [status, paid, orderId, integration.store_id])
    }
  }
  void dispatchErpEvent(integration.store_id, 'payment.updated', { orderId, paymentId: externalId, status, event: eventType }).catch(() => undefined)
  return res.json({ ok: true })
}

function csvCell(value) {
  const text = String(value ?? '').replace(/\r?\n/g, ' ').trim()
  return `"${text.replace(/"/g, '""')}"`
}

async function metaFeed(req, res) {
  const slug = String(req.params.storeSlug || '').replace(/\.csv$/i, '')
  const store = await storeBySlug(slug)
  if (!store || !phase4Eligible(store)) return res.status(404).send('Not found')
  const integration = await integrationRow(store.id)
  if (!integration.meta_catalog_enabled) return res.status(404).send('Not found')
  const origin = publicUrl || `${req.get('x-forwarded-proto') || req.protocol}://${req.get('host')}`
  const products = await pool.query(`SELECT id,sku,name,description,price,media_url,media_type,images,active FROM products WHERE store_id=$1 AND active=true ORDER BY created_at DESC`, [store.id])
  const rows = [['id','title','description','availability','condition','price','link','image_link','brand']]
  for (const product of products.rows) {
    const images = Array.isArray(product.images) ? product.images : []
    const image = images[0] || (product.media_type !== 'video' ? product.media_url : '') || ''
    const absoluteImage = image.startsWith('/') ? `${origin}${image}` : image
    const link = `${origin}/${encodeURIComponent(store.slug)}?produto=${encodeURIComponent(product.id)}`
    rows.push([
      product.sku || product.id,
      product.name,
      product.description || product.name,
      'in stock',
      'new',
      `${money(product.price).toFixed(2)} BRL`,
      link,
      absoluteImage,
      integration.meta_brand || store.name,
    ])
  }
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Cache-Control', 'public, max-age=300')
  return res.status(200).send(`\uFEFF${csv}`)
}

async function createApiToken(req, res) {
  const store = req.phase4Store
  const integration = await integrationRow(store.id)
  if (!integration.erp_api_enabled) return res.status(409).json({ error: 'Ative a API/ERP antes de criar tokens.' })
  const name = String(req.body?.name || '').trim().slice(0, 100) || 'Integração ERP'
  const scopes = normalizeScopes(req.body?.scopes)
  if (!scopes.length) return res.status(400).json({ error: 'Selecione ao menos um escopo para o token.' })
  const token = `svx_live_${crypto.randomBytes(32).toString('base64url')}`
  const tokenPrefix = token.slice(0, 18)
  const tokenId = id()
  await pool.query(`INSERT INTO erp_api_tokens(id,store_id,name,token_prefix,token_hash,scopes) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`, [tokenId, store.id, name, tokenPrefix, hash(token), JSON.stringify(scopes)])
  return res.status(201).json({ token: { id: tokenId, name, tokenPrefix, scopes, secret: token, createdAt: new Date().toISOString() }, warning: 'Copie este token agora. O segredo não será exibido novamente.' })
}

async function listApiTokens(req, res) {
  const result = await pool.query('SELECT id,name,token_prefix,scopes,active,last_used_at,created_at FROM erp_api_tokens WHERE store_id=$1 ORDER BY created_at DESC', [req.phase4Store.id])
  return res.json({ tokens: result.rows.map((row) => ({ id: row.id, name: row.name, tokenPrefix: row.token_prefix, scopes: Array.isArray(row.scopes) ? row.scopes : [], active: Boolean(row.active), lastUsedAt: row.last_used_at, createdAt: row.created_at })) })
}

async function revokeApiToken(req, res) {
  const result = await pool.query('UPDATE erp_api_tokens SET active=false WHERE id=$1 AND store_id=$2 RETURNING id', [req.params.tokenId, req.phase4Store.id])
  if (!result.rowCount) return res.status(404).json({ error: 'Token não encontrado.' })
  return res.status(204).end()
}

async function apiAuth(req, res, next) {
  try {
    await ensureSchema()
    const header = String(req.get('authorization') || '')
    const token = header.match(/^Bearer\s+(.+)$/i)?.[1] || String(req.get('x-shopvax-key') || '')
    if (!token) return res.status(401).json({ error: 'Token de API necessário.' })
    const result = await pool.query(`
      SELECT t.*,s.slug,s.plan_tier,pp.code AS plan_code,i.erp_api_enabled
      FROM erp_api_tokens t JOIN stores s ON s.id=t.store_id
      LEFT JOIN platform_plans pp ON pp.code=COALESCE(s.plan_tier,'bronze')
      LEFT JOIN store_phase4_integrations i ON i.store_id=s.id
      WHERE t.token_hash=$1 AND t.active=true LIMIT 1
    `, [hash(token)])
    if (!result.rowCount) return res.status(401).json({ error: 'Token de API inválido ou revogado.' })
    const row = result.rows[0]
    if (!phase4Eligible(row) || !row.erp_api_enabled) return res.status(403).json({ error: 'API/ERP não está ativa para esta loja.' })
    req.erpAuth = { storeId: row.store_id, storeSlug: row.slug, tokenId: row.id, scopes: Array.isArray(row.scopes) ? row.scopes : [] }
    void pool.query('UPDATE erp_api_tokens SET last_used_at=now() WHERE id=$1', [row.id]).catch(() => undefined)
    next()
  } catch (error) { next(error) }
}

function requireScope(scope) {
  return (req, res, next) => req.erpAuth?.scopes?.includes(scope) ? next() : res.status(403).json({ error: `Token sem escopo ${scope}.`, code: 'API_SCOPE' })
}

async function apiProducts(req, res) {
  const result = await pool.query(`SELECT id,sku,name,description,price,category,pack,variations,images,active,stock_enabled,stock_quantity,variant_stock,updated_at FROM products WHERE store_id=$1 ORDER BY updated_at DESC,id`, [req.erpAuth.storeId])
  return res.json({ data: result.rows.map((row) => ({ ...row, price: Number(row.price || 0), stockQuantity: Number(row.stock_quantity || 0) })) })
}

async function apiOrders(req, res) {
  const limit = Math.max(1, Math.min(200, Math.floor(Number(req.query.limit) || 100)))
  const result = await pool.query(`
    SELECT id,code,total,items,status,customer_id,seller_id,shipping_method,shipping_amount,payment_status,payment_paid_at,created_at,status_updated_at
    FROM orders WHERE store_id=$1 ORDER BY created_at DESC LIMIT $2
  `, [req.erpAuth.storeId, limit])
  return res.json({ data: result.rows.map((row) => ({ ...row, total: Number(row.total || 0), shippingAmount: Number(row.shipping_amount || 0) })) })
}

async function apiCustomers(req, res) {
  const result = await pool.query('SELECT id,name,email,phone,active,created_at,updated_at FROM store_customers WHERE store_id=$1 ORDER BY created_at DESC LIMIT 500', [req.erpAuth.storeId])
  return res.json({ data: result.rows })
}

async function apiPayments(req, res) {
  const result = await pool.query(`SELECT id,order_id,provider,external_id,billing_type,status,value,invoice_url,paid_at,created_at,updated_at FROM order_payments WHERE store_id=$1 ORDER BY created_at DESC LIMIT 500`, [req.erpAuth.storeId])
  return res.json({ data: result.rows.map((row) => ({ ...row, value: Number(row.value || 0) })) })
}

async function apiStockUpdate(req, res) {
  const sku = String(req.params.sku || '').trim()
  const quantity = Math.max(0, Math.floor(Number(req.body?.quantity) || 0))
  const enabled = req.body?.enabled !== false
  const variantStock = req.body?.variantStock && typeof req.body.variantStock === 'object' ? req.body.variantStock : {}
  const result = await pool.query(`
    UPDATE products SET stock_enabled=$1,stock_quantity=$2,variant_stock=$3::jsonb,updated_at=now()
    WHERE store_id=$4 AND sku=$5 RETURNING id,sku,name,stock_enabled,stock_quantity,variant_stock,updated_at
  `, [enabled, quantity, JSON.stringify(variantStock), req.erpAuth.storeId, sku])
  if (!result.rowCount) return res.status(404).json({ error: 'Produto não encontrado para este SKU.' })
  const product = result.rows[0]
  void dispatchErpEvent(req.erpAuth.storeId, 'stock.updated', { sku: product.sku, quantity: Number(product.stock_quantity || 0), variantStock: product.variant_stock }).catch(() => undefined)
  return res.json({ product: { ...product, stockQuantity: Number(product.stock_quantity || 0) } })
}

async function createErpWebhook(req, res) {
  const store = req.phase4Store
  const integration = await integrationRow(store.id)
  if (!integration.erp_api_enabled) return res.status(409).json({ error: 'Ative a API/ERP antes de criar webhooks.' })
  const allowLocal = process.env.NODE_ENV !== 'production'
  const url = normalizeUrl(req.body?.url, { allowHttpLocal: allowLocal })
  if (!url) return res.status(400).json({ error: allowLocal ? 'Informe uma URL HTTPS válida ou localhost HTTP para desenvolvimento.' : 'Webhooks ERP exigem URL HTTPS válida.' })
  const name = String(req.body?.name || 'ERP').trim().slice(0, 100)
  const allowedEvents = new Set(['order.created', 'payment.updated', 'stock.updated'])
  const events = [...new Set((Array.isArray(req.body?.events) ? req.body.events : []).map(String).filter((event) => allowedEvents.has(event)))]
  const selectedEvents = events.length ? events : [...allowedEvents]
  const secret = `whsec_${crypto.randomBytes(32).toString('base64url')}`
  const webhookId = id()
  await pool.query(`INSERT INTO erp_webhooks(id,store_id,name,url,secret_encrypted,events) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`, [webhookId, store.id, name, url, encryptSecret(secret), JSON.stringify(selectedEvents)])
  return res.status(201).json({ webhook: { id: webhookId, name, url, events: selectedEvents, secret }, warning: 'Copie o segredo agora. Ele não será exibido novamente.' })
}

async function listErpWebhooks(req, res) {
  const result = await pool.query('SELECT id,name,url,events,active,created_at,updated_at FROM erp_webhooks WHERE store_id=$1 ORDER BY created_at DESC', [req.phase4Store.id])
  return res.json({ webhooks: result.rows.map((row) => ({ id: row.id, name: row.name, url: row.url, events: Array.isArray(row.events) ? row.events : [], active: Boolean(row.active), createdAt: row.created_at, updatedAt: row.updated_at })) })
}

async function deleteErpWebhook(req, res) {
  const result = await pool.query('DELETE FROM erp_webhooks WHERE id=$1 AND store_id=$2 RETURNING id', [req.params.webhookId, req.phase4Store.id])
  if (!result.rowCount) return res.status(404).json({ error: 'Webhook ERP não encontrado.' })
  return res.status(204).end()
}

async function dispatchErpEvent(storeId, eventType, payload) {
  if (!pool) return
  await ensureSchema()
  const result = await pool.query(`SELECT * FROM erp_webhooks WHERE store_id=$1 AND active=true`, [storeId])
  const targets = result.rows.filter((row) => Array.isArray(row.events) && row.events.includes(eventType))
  for (const target of targets) {
    const body = JSON.stringify({ id: id(), event: eventType, createdAt: new Date().toISOString(), data: payload })
    let status = 'failed'
    let responseStatus = null
    let errorText = ''
    try {
      const secret = decryptSecret(target.secret_encrypted)
      const signature = crypto.createHmac('sha256', secret).update(body).digest('hex')
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      try {
        const response = await fetch(target.url, { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json', 'x-shopvax-event': eventType, 'x-shopvax-signature': `sha256=${signature}` }, body })
        responseStatus = response.status
        status = response.ok ? 'delivered' : 'failed'
        if (!response.ok) errorText = `HTTP ${response.status}`
      } finally { clearTimeout(timeout) }
    } catch (error) { errorText = error instanceof Error ? error.message : String(error) }
    await pool.query(`INSERT INTO erp_webhook_deliveries(id,store_id,webhook_id,event_type,status,response_status,error) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id(), storeId, target.id, eventType, status, responseStatus, errorText.slice(0, 500)])
  }
}

async function phase4Context(req, res) {
  const store = req.phase4Store
  const eligible = phase4Eligible(store)
  if (!eligible) return res.json({ plan: { code: store.plan_code || store.plan_tier || 'bronze', name: store.plan_name || 'Plano' }, eligible: false, reason: 'Disponível no Plano 3.' })
  const integration = await integrationRow(store.id)
  const [shipping, tokens, webhooks, payments, orders] = await Promise.all([
    pool.query('SELECT * FROM shipping_rules WHERE store_id=$1 ORDER BY sort_order,created_at', [store.id]),
    pool.query('SELECT id,name,token_prefix,scopes,active,last_used_at,created_at FROM erp_api_tokens WHERE store_id=$1 ORDER BY created_at DESC', [store.id]),
    pool.query('SELECT id,name,url,events,active,created_at,updated_at FROM erp_webhooks WHERE store_id=$1 ORDER BY created_at DESC', [store.id]),
    pool.query('SELECT id,order_id,external_id,billing_type,status,value,invoice_url,paid_at,created_at FROM order_payments WHERE store_id=$1 ORDER BY created_at DESC LIMIT 50', [store.id]),
    pool.query('SELECT id,code,total,shipping_method,shipping_amount,payment_status,payment_paid_at,created_at FROM orders WHERE store_id=$1 ORDER BY created_at DESC LIMIT 50', [store.id]),
  ])
  return res.json({
    plan: { code: store.plan_code || store.plan_tier || 'ouro', name: store.plan_name || 'Plano 3' },
    eligible: true,
    integration: integrationShape(integration, store.slug),
    shippingRules: shipping.rows.map(shippingRuleShape),
    apiTokens: tokens.rows.map((row) => ({ id: row.id, name: row.name, tokenPrefix: row.token_prefix, scopes: Array.isArray(row.scopes) ? row.scopes : [], active: Boolean(row.active), lastUsedAt: row.last_used_at, createdAt: row.created_at })),
    erpWebhooks: webhooks.rows.map((row) => ({ id: row.id, name: row.name, url: row.url, events: Array.isArray(row.events) ? row.events : [], active: Boolean(row.active), createdAt: row.created_at })),
    payments: payments.rows.map((row) => ({ ...row, value: Number(row.value || 0) })),
    orders: orders.rows.map((row) => ({ ...row, total: Number(row.total || 0), shippingAmount: Number(row.shipping_amount || 0), grandTotal: money(Number(row.total || 0) + Number(row.shipping_amount || 0)) })),
  })
}

function install(app) {
  if (app.__shopvaxPhase4IntegrationsInstalled) return
  app.__shopvaxPhase4IntegrationsInstalled = true

  app.get('/api/admin/phase4', requireOwner, (req, res, next) => Promise.resolve(phase4Context(req, res)).catch(next))
  app.patch('/api/admin/phase4/settings', express.json({ limit: '32kb' }), requirePhase4Owner, (req, res, next) => Promise.resolve(saveCoreSettings(req, res)).catch(next))
  app.patch('/api/admin/phase4/asaas', express.json({ limit: '32kb' }), requirePhase4Owner, (req, res, next) => Promise.resolve(configureAsaas(req, res)).catch(next))
  app.post('/api/admin/phase4/asaas/provision-webhook', requirePhase4Owner, (req, res, next) => Promise.resolve(provisionAsaasWebhook(req, res)).catch(next))

  app.get('/api/admin/phase4/shipping-rules', requirePhase4Owner, (req, res, next) => Promise.resolve(listShippingRules(req, res)).catch(next))
  app.post('/api/admin/phase4/shipping-rules', express.json({ limit: '32kb' }), requirePhase4Owner, (req, res, next) => Promise.resolve(createShippingRule(req, res)).catch(next))
  app.patch('/api/admin/phase4/shipping-rules/:ruleId', express.json({ limit: '32kb' }), requirePhase4Owner, (req, res, next) => Promise.resolve(updateShippingRule(req, res)).catch(next))
  app.delete('/api/admin/phase4/shipping-rules/:ruleId', requirePhase4Owner, (req, res, next) => Promise.resolve(deleteShippingRule(req, res)).catch(next))
  app.post('/api/public/phase4/shipping/quote', express.json({ limit: '32kb' }), (req, res, next) => Promise.resolve(shippingQuote(req, res)).catch(next))
  app.post('/api/public/phase4/orders/:orderId/shipping', express.json({ limit: '32kb' }), (req, res, next) => Promise.resolve(attachShipping(req, res)).catch(next))

  app.post('/api/public/phase4/payments', express.json({ limit: '64kb' }), (req, res, next) => Promise.resolve(createPayment(req, res)).catch(next))
  app.post('/api/webhooks/asaas/:publicId', express.json({ limit: '256kb' }), (req, res, next) => Promise.resolve(receiveAsaasWebhook(req, res)).catch(next))

  app.get('/api/public/meta-feed/:storeSlug.csv', (req, res, next) => Promise.resolve(metaFeed(req, res)).catch(next))

  app.get('/api/admin/phase4/api-tokens', requirePhase4Owner, (req, res, next) => Promise.resolve(listApiTokens(req, res)).catch(next))
  app.post('/api/admin/phase4/api-tokens', express.json({ limit: '32kb' }), requirePhase4Owner, (req, res, next) => Promise.resolve(createApiToken(req, res)).catch(next))
  app.delete('/api/admin/phase4/api-tokens/:tokenId', requirePhase4Owner, (req, res, next) => Promise.resolve(revokeApiToken(req, res)).catch(next))
  app.get('/api/admin/phase4/erp-webhooks', requirePhase4Owner, (req, res, next) => Promise.resolve(listErpWebhooks(req, res)).catch(next))
  app.post('/api/admin/phase4/erp-webhooks', express.json({ limit: '32kb' }), requirePhase4Owner, (req, res, next) => Promise.resolve(createErpWebhook(req, res)).catch(next))
  app.delete('/api/admin/phase4/erp-webhooks/:webhookId', requirePhase4Owner, (req, res, next) => Promise.resolve(deleteErpWebhook(req, res)).catch(next))

  app.get('/api/v1/products', apiAuth, requireScope('products:read'), (req, res, next) => Promise.resolve(apiProducts(req, res)).catch(next))
  app.get('/api/v1/orders', apiAuth, requireScope('orders:read'), (req, res, next) => Promise.resolve(apiOrders(req, res)).catch(next))
  app.get('/api/v1/customers', apiAuth, requireScope('customers:read'), (req, res, next) => Promise.resolve(apiCustomers(req, res)).catch(next))
  app.get('/api/v1/payments', apiAuth, requireScope('payments:read'), (req, res, next) => Promise.resolve(apiPayments(req, res)).catch(next))
  app.patch('/api/v1/stock/:sku', express.json({ limit: '32kb' }), apiAuth, requireScope('stock:write'), (req, res, next) => Promise.resolve(apiStockUpdate(req, res)).catch(next))

  if (pool) void ensureSchema().catch((error) => console.error('[phase4] schema:', error.message))
}

const previousInit = express.application.init
express.application.init = function phase4IntegrationsInit(...args) {
  const result = previousInit.apply(this, args)
  install(this)
  return result
}
