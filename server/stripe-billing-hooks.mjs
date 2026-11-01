import crypto from 'node:crypto'
import express from 'express'
import pg from 'pg'
import { cycles, planPrice, subscriptionAccess, verifyStripeSignature } from './stripe-billing-policy.mjs'

const { Pool } = pg
const key = String(process.env.SHOPVAX_STRIPE_SECRET_KEY || '').trim()
const webhookSecret = String(process.env.SHOPVAX_STRIPE_WEBHOOK_SECRET || '').trim()
const stripeMode = key.startsWith('sk_live_') ? 'live' : 'test'
const originValue = String(process.env.SHOPVAX_PUBLIC_URL || '').trim()
let publicOrigin = ''
try {
  const url = new URL(originValue)
  if (url.protocol === 'https:' || (process.env.NODE_ENV !== 'production' && url.hostname === 'localhost')) publicOrigin = url.origin
} catch {}
const ready = Boolean(/^sk_(test|live)_/.test(key) && /^whsec_/.test(webhookSecret) && publicOrigin)
const pool = process.env.DATABASE_URL?.trim()
  ? new Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 5000 }) : null
if (pool) pool.on('error', (error) => console.error('[stripe-billing] database:', error.message))

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex')
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next)
const headersNoCache = (_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next() }
const apiError = (res, status, message, code) => res.status(status).json({ error: message, code })
let schemaPromise
async function ensureSchema() {
  if (!pool) throw new Error('PostgreSQL indisponível.')
  if (!schemaPromise) schemaPromise = (async () => {
    await pool.query([
      "ALTER TABLE stores ADD COLUMN IF NOT EXISTS billing_required boolean NOT NULL DEFAULT false;",
      "CREATE TABLE IF NOT EXISTS shopvax_stripe_billing (",
      "store_id text PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,",
      "stripe_mode text,"
      "customer_id text UNIQUE, subscription_id text UNIQUE, subscription_status text NOT NULL DEFAULT 'none',",
      "active_plan_code text, cycle text, paid_until timestamptz, last_invoice_id text,",
      "checkout_session_id text, checkout_plan text, checkout_cycle text,",
      "cancel_at_period_end boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now());",
      "CREATE TABLE IF NOT EXISTS shopvax_stripe_events (",
      "event_id text PRIMARY KEY, event_type text NOT NULL, processed_at timestamptz NOT NULL DEFAULT now());",
      "CREATE TABLE IF NOT EXISTS shopvax_stripe_prices (",
      "stripe_mode text NOT NULL, plan_code text NOT NULL, cycle text NOT NULL, amount_cents integer NOT NULL,",
      "product_id text NOT NULL, price_id text NOT NULL UNIQUE,",
      "PRIMARY KEY(stripe_mode,plan_code,cycle,amount_cents));",
      "CREATE OR REPLACE FUNCTION shopvax_stripe_insert_store() RETURNS trigger LANGUAGE plpgsql AS $$",
      "BEGIN IF NEW.billing_required THEN NEW.plan_tier := 'bronze'; END IF; RETURN NEW; END $$;",
      "DROP TRIGGER IF EXISTS trg_shopvax_stripe_new_store ON stores;",
      "CREATE TRIGGER trg_shopvax_stripe_new_store BEFORE INSERT ON stores",
      "FOR EACH ROW EXECUTE FUNCTION shopvax_stripe_insert_store();",
    ].join(' '))
    // Existing accounts remain grandfathered; only NEW stores start paywalled after full configuration.
    await pool.query('ALTER TABLE stores ALTER COLUMN billing_required SET DEFAULT ' + (ready ? 'true' : 'false'))
  })().catch((error) => { schemaPromise = null; throw error })
  return schemaPromise
}

function sessionCookie(req) {
  const raw = String(req.headers.cookie || '')
  const cookies = Object.fromEntries(raw.split(';').map((item) => {
    const i = item.indexOf('=')
    if (i === -1) return ['', '']
    try { return [item.slice(0, i).trim(), decodeURIComponent(item.slice(i + 1))] }
    catch { return ['', ''] }
  }).filter((item) => item[0]))
  return cookies.atacado_session || cookies.shopvax_session || ''
}

async function owner(req) {
  await ensureSchema()
  const token = sessionCookie(req)
  if (!token) return null
  const result = await pool.query([
    'SELECT s.id,s.name,s.slug,s.billing_required,u.email,',
    'b.customer_id,b.stripe_mode,b.subscription_id,b.subscription_status,b.active_plan_code,',
    'b.cycle,b.paid_until,b.cancel_at_period_end,b.checkout_session_id,b.checkout_plan,b.checkout_cycle',
    'FROM sessions se JOIN users u ON se.user_id=u.id JOIN stores s ON s.owner_id=u.id',
    'LEFT JOIN shopvax_stripe_billing b ON b.store_id=s.id',
    'WHERE se.token_hash=$1 AND se.expires_at>now() LIMIT 1',
  ].join(' '), [hash(token)])
  return result.rows[0] || null
}

async function stripe(method, path, fields, idempotencyKey) {
  if (!ready) throw Object.assign(new Error('Stripe ainda não vinculada.'), { status: 503 })
  const params = fields ? new URLSearchParams(fields) : null
  const response = await fetch('https://api.stripe.com/v1/' + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + key,
      'Stripe-Version': '2024-06-20',
      ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: params?.toString(),
    signal: AbortSignal.timeout(16000),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    console.error('[stripe-billing] Stripe request failed:', response.status, path.split('/')[0], payload?.error?.code || '')
    throw Object.assign(new Error('A Stripe não conseguiu concluir esta operação. Verifique a configuração e tente novamente.'), { status: 502 })
  }
  return payload
}

function amountOptions() {
  return ['bronze', 'prata', 'ouro'].flatMap((code) =>
    Object.keys(cycles).map((cycle) => {
      const plan = planPrice(code, cycle)
      return { code, cycle, amount: plan.amountCents, label: plan.name, interval: plan.interval, count: plan.intervalCount }
    }))
}

async function ensureStripePrice(plan) {
  const existing = await pool.query('SELECT price_id FROM shopvax_stripe_prices WHERE stripe_mode=$1 AND plan_code=$2 AND cycle=$3 AND amount_cents=$4', [stripeMode, plan.code, plan.cycle, plan.amountCents])
  if (existing.rowCount) return existing.rows[0].price_id
  const product = await stripe('POST', 'products', {
    name: 'Shopvax ' + plan.name,
    description: 'Assinatura de acesso ao Shopvax; não processa pedidos de compradores.',
    'metadata[product]': 'shopvax_subscription',
    'metadata[plan_code]': plan.code,
  }, 'shopvax-product-' + plan.code + '-v1')
  const price = await stripe('POST', 'prices', {
    product: product.id,
    currency: 'brl',
    unit_amount: String(plan.amountCents),
    'recurring[interval]': plan.interval,
    'recurring[interval_count]': String(plan.intervalCount),
    nickname: plan.name + ' ' + cycles[plan.cycle].label,
    'metadata[plan_code]': plan.code,
    'metadata[cycle]': plan.cycle,
  }, 'shopvax-price-' + plan.code + '-' + plan.cycle + '-' + plan.amountCents + '-v1')
  await pool.query('INSERT INTO shopvax_stripe_prices (stripe_mode,plan_code,cycle,amount_cents,product_id,price_id) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING', [stripeMode, plan.code, plan.cycle, plan.amountCents, product.id, price.id])
  return price.id
}

function billingShape(row) {
  return {
    enabled: ready,
    required: Boolean(row?.billing_required),
    accessGranted: row ? subscriptionAccess(row) : false,
    status: row?.subscription_status || 'none',
    planCode: row?.active_plan_code || null,
    cycle: row?.cycle || null,
    paidUntil: row?.paid_until || null,
    cancelAtPeriodEnd: Boolean(row?.cancel_at_period_end),
    prices: amountOptions(),
  }
}

async function requireOwner(req, res) {
  const account = await owner(req)
  if (!account) { apiError(res, 401, 'Entre na conta da sua loja.', 'AUTH_REQUIRED'); return null }
  return account
}

async function status(req, res) {
  const account = await requireOwner(req, res)
  if (!account) return
  res.json(billingShape(account))
}

async function customerFor(account, client) {
  if (account.customer_id && account.stripe_mode !== stripeMode) throw Object.assign(new Error('A conta Stripe teste/produção foi trocada. Utilize um banco separado ou uma migração validada.'), { status: 409 })
  if (account.customer_id) return account.customer_id
  const customer = await stripe('POST', 'customers', {
    email: account.email,
    name: account.name,
    'metadata[shopvax_store_id]': account.id,
  }, 'shopvax-customer-' + account.id)
  await client.query([
    'INSERT INTO shopvax_stripe_billing (store_id,customer_id,stripe_mode) VALUES ($1,$2,$3)',
    'ON CONFLICT (store_id) DO UPDATE SET customer_id=EXCLUDED.customer_id',
    'WHERE shopvax_stripe_billing.customer_id IS NULL',
  ].join(' '), [account.id, customer.id, stripeMode])
  return customer.id
}

async function checkout(req, res) {
  const account = await requireOwner(req, res)
  if (!account) return
  if (!ready) return apiError(res, 503, 'A cobrança online ainda não está disponível.', 'BILLING_NOT_CONFIGURED')
  const plan = planPrice(String(req.body?.planCode || '').toLowerCase(), String(req.body?.cycle || 'monthly'))
  if (!plan) return apiError(res, 400, 'Selecione um plano e um ciclo válidos.', 'INVALID_PLAN')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['shopvax-billing:' + account.id])
    const current = (await client.query('SELECT * FROM shopvax_stripe_billing WHERE store_id=$1 FOR UPDATE', [account.id])).rows[0]
    if (current?.customer_id && current.stripe_mode !== stripeMode) {
      await client.query('ROLLBACK')
      return apiError(res, 409, 'Ambiente Stripe diferente do utilizado nesta loja. Separe dados de teste e produção.', 'STRIPE_MODE_MISMATCH')
    }
    if (current?.subscription_id && !['canceled', 'incomplete_expired', 'unpaid', 'none'].includes(current.subscription_status)) {
      await client.query('ROLLBACK')
      return apiError(res, 409, 'Existe uma assinatura. Use a opção de alterar plano ou gerenciar cobrança.', 'SUBSCRIPTION_EXISTS')
    }
    if (current?.checkout_session_id) {
      const old = await stripe('GET', 'checkout/sessions/' + encodeURIComponent(current.checkout_session_id))
      if (old.status === 'open' && current.checkout_plan === plan.code && current.checkout_cycle === plan.cycle) {
        await client.query('COMMIT')
        return res.json({ url: old.url })
      }
      if (old.status === 'open') await stripe('POST', 'checkout/sessions/' + encodeURIComponent(old.id) + '/expire', {})
      if (old.status === 'complete' && old.subscription) {
        await client.query('ROLLBACK')
        return apiError(res, 409, 'O pagamento anterior está em processamento. Atualize o status.', 'CHECKOUT_PROCESSING')
      }
    }
    const customer = await customerFor({ ...account, customer_id: current?.customer_id || account.customer_id, stripe_mode: current?.stripe_mode || account.stripe_mode }, client)
    const priceId = await ensureStripePrice(plan)
    const session = await stripe('POST', 'checkout/sessions', {
      mode: 'subscription',
      customer,
      'payment_method_types[0]': 'card',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      client_reference_id: account.id,
      success_url: publicOrigin + '/painel/assinatura?stripe=success',
      cancel_url: publicOrigin + '/painel/assinatura?stripe=cancel',
      'metadata[shopvax_store_id]': account.id,
      'subscription_data[metadata][shopvax_store_id]': account.id,
    })
    await client.query([
      'INSERT INTO shopvax_stripe_billing (store_id,customer_id,checkout_session_id,checkout_plan,checkout_cycle)',
      'VALUES ($1,$2,$3,$4,$5) ON CONFLICT (store_id) DO UPDATE SET',
      'customer_id=EXCLUDED.customer_id,checkout_session_id=EXCLUDED.checkout_session_id,',
      "subscription_id=NULL,subscription_status='none',active_plan_code=NULL,cycle=NULL,paid_until=NULL,",
      'checkout_plan=EXCLUDED.checkout_plan,checkout_cycle=EXCLUDED.checkout_cycle,updated_at=now()',
    ].join(' '), [account.id, customer, session.id, plan.code, plan.cycle])
    await client.query('COMMIT')
    res.json({ url: session.url })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally { client.release() }
}

async function portal(req, res) {
  const account = await requireOwner(req, res)
  if (!account) return
  if (!account.customer_id || !ready || account.stripe_mode !== stripeMode) return apiError(res, 409, 'Nenhuma assinatura Stripe válida neste ambiente.', 'NO_BILLING_CUSTOMER')
  const config = await stripe('POST', 'billing_portal/configurations', {
    'features[invoice_history][enabled]': 'true',
    'features[payment_method_update][enabled]': 'true',
    'features[subscription_cancel][enabled]': 'true',
    'features[subscription_cancel][mode]': 'at_period_end',
    'features[subscription_update][enabled]': 'false',
  }, 'shopvax-portal-config-v1')
  const session = await stripe('POST', 'billing_portal/sessions', {
    customer: account.customer_id,
    configuration: config.id,
    return_url: publicOrigin + '/painel/assinatura',
  })
  res.json({ url: session.url })
}

async function change(req, res) {
  const account = await requireOwner(req, res)
  if (!account) return
  if (!ready || !account.subscription_id || account.stripe_mode !== stripeMode || !subscriptionAccess(account)) {
    return apiError(res, 409, 'É necessária uma assinatura ativa para alterar seu plano.', 'SUBSCRIPTION_NOT_ACTIVE')
  }
  const plan = planPrice(String(req.body?.planCode || '').toLowerCase(), String(req.body?.cycle || 'monthly'))
  if (!plan) return apiError(res, 400, 'Plano ou ciclo inválido.', 'INVALID_PLAN')
  if (plan.code === account.active_plan_code && plan.cycle === account.cycle) return res.json({ ok: true, unchanged: true })
  const sub = await stripe('GET', 'subscriptions/' + encodeURIComponent(account.subscription_id))
  if (sub.customer !== account.customer_id || !sub.items?.data?.[0]?.id || sub.status !== 'active') {
    return apiError(res, 409, 'A assinatura está em processamento. Atualize o status.', 'SUBSCRIPTION_UNAVAILABLE')
  }
  const priceId = await ensureStripePrice(plan)
  const currentStripePrice = typeof sub.items.data[0].price === 'string' ? sub.items.data[0].price : sub.items.data[0].price?.id
  if (currentStripePrice === priceId) return res.json({ ok: true, pending: true, message: 'Esta mudança já está em processamento na Stripe.' })
  const updated = await stripe('POST', 'subscriptions/' + encodeURIComponent(sub.id), {
    'items[0][id]': sub.items.data[0].id,
    'items[0][price]': priceId,
    proration_behavior: 'always_invoice',
    payment_behavior: 'pending_if_incomplete',
  }, 'shopvax-change-' + sub.id + '-' + priceId + '-' + (req.body?.requestId || 'change'))
  res.json({ ok: true, status: updated.status, pending: Boolean(updated.pending_update), message: 'A alteração só será liberada após a confirmação da cobrança, quando necessária.' })
}

async function syncSubscription(client, id, eventType, paidInvoiceId = null) {
  const subscription = await stripe('GET', 'subscriptions/' + encodeURIComponent(id))
  const storeId = String(subscription?.metadata?.shopvax_store_id || '')
  if (!storeId || !subscription.customer) return
  const row = (await client.query('SELECT * FROM shopvax_stripe_billing WHERE store_id=$1 FOR UPDATE', [storeId])).rows[0]
  if (!row || row.stripe_mode !== stripeMode || row.customer_id !== subscription.customer) {
    throw new Error('Assinatura Stripe não corresponde à loja vinculada.')
  }
  // Eventos atrasados de uma assinatura já substituída não podem afetar a nova.
  if (row.subscription_id && row.subscription_id !== subscription.id) return
  const line = subscription.items?.data?.[0]
  const priceId = typeof line?.price === 'string' ? line.price : line?.price?.id
  const mapped = priceId ? (await client.query('SELECT plan_code,cycle FROM shopvax_stripe_prices WHERE price_id=$1 AND stripe_mode=$2', [priceId, stripeMode])).rows[0] : null
  const paid = eventType === 'invoice.paid' && Boolean(paidInvoiceId) && mapped && subscription.status === 'active'
  const periodEnd = Number(line?.current_period_end || subscription.current_period_end || 0)
  const until = paid && periodEnd > 0 ? new Date(periodEnd * 1000) : null
  await client.query([
    'UPDATE shopvax_stripe_billing SET subscription_id=$2,subscription_status=$3,',
    'cancel_at_period_end=$4,active_plan_code=CASE WHEN $5::boolean THEN $6 ELSE active_plan_code END,',
    'cycle=CASE WHEN $5::boolean THEN $7 ELSE cycle END,',
    'paid_until=CASE WHEN $5::boolean THEN $8 ELSE paid_until END,',
    'last_invoice_id=CASE WHEN $5::boolean THEN $9 ELSE last_invoice_id END,updated_at=now()',
    'WHERE store_id=$1',
  ].join(' '), [storeId, subscription.id, subscription.status, Boolean(subscription.cancel_at_period_end), Boolean(paid), mapped?.plan_code || null, mapped?.cycle || null, until, paidInvoiceId])
  if (paid) {
    await client.query('UPDATE stores SET plan_tier=$2,billing_required=true,updated_at=now() WHERE id=$1', [storeId, mapped.plan_code])
  }
}

async function webhook(req, res) {
  if (!ready) return apiError(res, 503, 'Webhook não configurado.', 'BILLING_NOT_CONFIGURED')
  if (!verifyStripeSignature(req.body, req.get('stripe-signature'), webhookSecret)) return apiError(res, 400, 'Assinatura inválida.', 'INVALID_STRIPE_SIGNATURE')
  let event
  try { event = JSON.parse(req.body.toString('utf8')) }
  catch { return apiError(res, 400, 'JSON inválido.', 'INVALID_EVENT') }
  if (!event?.id || !event?.type || !event?.data?.object) return apiError(res, 400, 'Evento inválido.', 'INVALID_EVENT')
  await ensureSchema()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const inserted = await client.query('INSERT INTO shopvax_stripe_events (event_id,event_type) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING event_id', [event.id, event.type])
    if (!inserted.rowCount) { await client.query('COMMIT'); return res.json({ received: true, duplicate: true }) }
    const obj = event.data.object
    if (event.type === 'checkout.session.completed' && obj.mode === 'subscription' && obj.subscription) {
      const storeId = String(obj.client_reference_id || '')
      await client.query([
        'UPDATE shopvax_stripe_billing SET subscription_id=COALESCE(subscription_id,$3),updated_at=now()',
        'WHERE store_id=$1 AND customer_id=$2 AND (subscription_id IS NULL OR subscription_id=$3)',
      ].join(' '), [storeId, obj.customer, obj.subscription])
      // Nunca liberar acesso somente porque o usuário retornou do Checkout.
    } else if (event.type === 'invoice.paid' && obj.status === 'paid') {
      const sub = typeof obj.subscription === 'string' ? obj.subscription : obj.parent?.subscription_details?.subscription
      if (typeof sub === 'string') await syncSubscription(client, sub, event.type, obj.id)
    } else if (['invoice.payment_failed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'].includes(event.type)) {
      const sub = event.type.startsWith('invoice.') ? (typeof obj.subscription === 'string' ? obj.subscription : obj.parent?.subscription_details?.subscription) : obj.id
      if (typeof sub === 'string') await syncSubscription(client, sub, event.type)
    }
    await client.query('COMMIT')
    res.json({ received: true })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally { client.release() }
}

async function gate(req, res, next) {
  if (!ready) return next()
  const protectedAdmin = req.path.startsWith('/api/admin/') && req.path !== '/api/admin/plan-context'
  const buyerOrder = req.method === 'POST' && req.path === '/api/business/orders'
  if (!protectedAdmin && !buyerOrder) return next()
  try {
    await ensureSchema()
    let row
    if (protectedAdmin) {
      row = await owner(req)
      if (!row) return next()
    } else {
      const slug = String(req.body?.storeSlug || '')
      if (!slug) return next()
      row = (await pool.query([
        'SELECT s.billing_required,b.subscription_status,b.active_plan_code,b.paid_until',
        'FROM stores s LEFT JOIN shopvax_stripe_billing b ON b.store_id=s.id WHERE s.slug=$1',
      ].join(' '), [slug])).rows[0]
      if (!row) return next()
    }
    if (!subscriptionAccess(row)) return apiError(res, 402, 'Assinatura necessária para utilizar a loja. Acesse Plano e uso.', 'PAYMENT_REQUIRED')
    next()
  } catch (error) { next(error) }
}

function install(app) {
  if (app.__shopvaxStripeInstalled) return
  app.__shopvaxStripeInstalled = true
  app.post('/api/billing/stripe/webhook', express.raw({ type: 'application/json', limit: '256kb' }), wrap(webhook))
  app.get('/api/billing/status', headersNoCache, wrap(status))
  app.post('/api/billing/checkout', express.json({ limit: '8kb' }), headersNoCache, wrap(checkout))
  app.post('/api/billing/portal', express.json({ limit: '8kb' }), headersNoCache, wrap(portal))
  app.post('/api/billing/change', express.json({ limit: '8kb' }), headersNoCache, wrap(change))
  app.use('/api/business/orders', express.json({ limit: '128kb' }))
  app.use(gate)
  if (pool) void ensureSchema().catch((error) => console.error('[stripe-billing] schema:', error.message))
}
const originalInit = express.application.init
express.application.init = function stripeBillingInit(...args) {
  const result = originalInit.apply(this, args)
  install(this)
  return result
}
