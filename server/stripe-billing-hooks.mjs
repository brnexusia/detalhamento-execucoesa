import crypto from 'node:crypto'
import express from 'express'
import pg from 'pg'
import { cycles, planPrice, subscriptionAccess, verifyStripeSignature } from './stripe-billing-policy.mjs'
import { blackFridayPromotion } from './black-friday-pricing.mjs'
import { requiresPaymentForSignup } from './signup-billing-mode.mjs'
import { parseStripeServerKey, resolveStripeServerKey } from './stripe-key-config.mjs'
import { trustedStripeCheckoutDestination } from './stripe-checkout-url.mjs'
import { ensureReferralSchema, captureReferral, qualifyReferralOnPaidInvoice, applyMerchantStripeCredits, reverseReferralForRefund } from './referral-program-core.mjs'

const { Pool } = pg
const keyConfig = resolveStripeServerKey(process.env)
const key = keyConfig.value
if (keyConfig.source === 'SHOPVAX_STRIPE_SECRET_KEY_URL') {
  console.warn('[stripe-billing] SHOPVAX_STRIPE_SECRET_KEY_URL é um nome legado; migre a credencial para SHOPVAX_STRIPE_SECRET_KEY no EasyPanel.')
}
const webhookSecret = String(process.env.SHOPVAX_STRIPE_WEBHOOK_SECRET || '').trim()
const stripeKey = parseStripeServerKey(key)
const stripeMode = stripeKey.mode || 'test'
const originValue = String(process.env.SHOPVAX_PUBLIC_URL || '').trim()
let publicOrigin = ''
try {
  const url = new URL(originValue)
  if (url.protocol === 'https:' || (process.env.NODE_ENV !== 'production' && url.hostname === 'localhost')) publicOrigin = url.origin
} catch {}
const keyReady = stripeKey.valid
const webhookReady = /^whsec_/.test(webhookSecret)
const originReady = Boolean(publicOrigin)
const ready = Boolean(keyReady && webhookReady && originReady)
const signupPaymentRequired = requiresPaymentForSignup()
if (!ready) console.error('[stripe-billing] assinatura indisponível; valide as variáveis no SERVIÇO DE BACKEND do EasyPanel:', {
  SHOPVAX_STRIPE_SECRET_KEY_valid: keyReady,
  SHOPVAX_STRIPE_WEBHOOK_SECRET_valid: webhookReady,
  SHOPVAX_PUBLIC_URL_https_valid: originReady,
})
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
      "stripe_mode text,",
      "customer_id text UNIQUE, subscription_id text UNIQUE, subscription_status text NOT NULL DEFAULT 'none',",
      "active_plan_code text, cycle text, paid_until timestamptz, last_invoice_id text,",
      "checkout_session_id text, checkout_plan text, checkout_cycle text, checkout_started_at timestamptz,",
      "cancel_at_period_end boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now());",
      "CREATE TABLE IF NOT EXISTS shopvax_stripe_events (",
      "event_id text PRIMARY KEY, event_type text NOT NULL, processed_at timestamptz NOT NULL DEFAULT now());",
      "CREATE TABLE IF NOT EXISTS shopvax_stripe_prices (",
      "stripe_mode text NOT NULL, plan_code text NOT NULL, cycle text NOT NULL, amount_cents integer NOT NULL,",
      "product_id text NOT NULL, price_id text NOT NULL UNIQUE,",
      "PRIMARY KEY(stripe_mode,plan_code,cycle,amount_cents));",
      "CREATE TABLE IF NOT EXISTS shopvax_stripe_settings (stripe_mode text PRIMARY KEY, portal_config_id text);",
      "CREATE TABLE IF NOT EXISTS shopvax_stripe_products (stripe_mode text NOT NULL, plan_code text NOT NULL, product_id text NOT NULL, PRIMARY KEY (stripe_mode,plan_code));",
      "CREATE OR REPLACE FUNCTION shopvax_stripe_insert_store() RETURNS trigger LANGUAGE plpgsql AS $$",
      "BEGIN IF NEW.billing_required THEN NEW.plan_tier := 'bronze'; END IF; RETURN NEW; END $$;",
      "DROP TRIGGER IF EXISTS trg_shopvax_stripe_new_store ON stores;",
      "CREATE TRIGGER trg_shopvax_stripe_new_store BEFORE INSERT ON stores",
      "FOR EACH ROW EXECUTE FUNCTION shopvax_stripe_insert_store();",
    ].join(' '))
    // Novas lojas recebem o modo de cadastro vigente; lojas existentes não são alteradas.
    await pool.query('ALTER TABLE stores ALTER COLUMN billing_required SET DEFAULT ' + (signupPaymentRequired ? 'true' : 'false'))
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
    'SELECT s.id,s.name,s.slug,s.plan_tier,s.billing_required,u.email,',
    'b.customer_id,b.stripe_mode,b.subscription_id,b.subscription_status,b.active_plan_code,',
    'b.cycle,b.paid_until,b.cancel_at_period_end,b.checkout_session_id,b.checkout_plan,b.checkout_cycle,b.checkout_started_at',
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

// Uma fonte de verdade para preços: platform_plans, editada em /admin.
async function activeSystemPlans() {
  if (!pool) throw new Error('PostgreSQL indisponível para consulta de preços.')
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const found = await pool.query("SELECT to_regclass('public.platform_plans') AS plans")
    if (found.rows[0]?.plans) break
    if (attempt === 79) throw new Error('Tabela de planos indisponível.')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const result = await pool.query(`
    SELECT code,name,monthly_price,semester_discount,annual_discount,
      seller_limit,product_limit,catalog_limit,photo_limit,franchisee_limit
    FROM platform_plans
    WHERE is_system=true AND active=true AND code IN ('bronze','prata','ouro')
    ORDER BY CASE code WHEN 'bronze' THEN 1 WHEN 'prata' THEN 2 ELSE 3 END
  `)
  return result.rows
}

function priceForCycle(row, cycle) {
  const price = planPrice(row.code, cycle, row)
  if (!price) return null
  const promotion = blackFridayPromotion(row.code, row.monthly_price)
  const originalPrice = promotion
    ? planPrice(row.code, cycle, { ...row, monthly_price: promotion.originalMonthlyPrice })
    : null
  return {
    code: row.code, cycle, amount: price.amountCents, label: price.name,
    interval: price.interval, count: price.intervalCount,
    promotion, previousAmountCents: originalPrice?.amountCents ?? null,
  }
}

function amountOptions(rows) {
  return rows.flatMap((row) => Object.keys(cycles).map((cycle) => priceForCycle(row, cycle)).filter(Boolean))
}

async function currentPlanPrice(code, cycle) {
  const rows = await activeSystemPlans()
  const row = rows.find((plan) => plan.code === code)
  const price = row ? planPrice(code, cycle, row) : null
  return price ? { ...price, promotion: blackFridayPromotion(row.code, row.monthly_price) } : null
}

// Produtos são permanentes por plano; os Prices são versionados por valor/ciclo.
// Em bancos antigos, selecionamos um produto já cadastrado para evitar criar novos.
async function canonicalStripeProduct(plan) {
  await ensureSchema()
  const mapped = await pool.query('SELECT product_id FROM shopvax_stripe_products WHERE stripe_mode=$1 AND plan_code=$2', [stripeMode, plan.code])
  if (mapped.rowCount) return mapped.rows[0].product_id
  const legacy = await pool.query(`
    SELECT product_id FROM shopvax_stripe_prices WHERE stripe_mode=$1 AND plan_code=$2
    ORDER BY CASE WHEN cycle='monthly' THEN 0 ELSE 1 END, product_id
    LIMIT 1
  `, [stripeMode, plan.code])
  let productId = legacy.rows[0]?.product_id
  if (productId) {
    // Remove a campanha do NOME canônico quando reutilizamos um produto
    // de Black Friday; o texto da promoção continua no Price correspondente.
    try {
      const legacyProduct = await stripe('GET','products/'+encodeURIComponent(productId))
      if (legacyProduct.active === false) productId = null
      else if (legacyProduct.name !== 'Shopvax ' + plan.name) {
        await stripe('POST','products/'+encodeURIComponent(productId),{
          name:'Shopvax ' + plan.name,
        }, 'shopvax-product-normalize-' + stripeMode + '-' + plan.code + '-v1')
      }
    } catch (error) {
      // Se a chave restrita não permitir ler/renomear produtos, preserve a
      // referência existente: falhar aqui não pode bloquear uma cobrança.
      console.warn('[stripe-billing] produto legado não normalizado:',plan.code,error?.status||'api')
    }
  }
  if (!productId) {
    const product = await stripe('POST', 'products', {
      name: 'Shopvax ' + plan.name,
      description: 'Assinatura de acesso ao Shopvax; não processa pedidos de compradores.',
      'metadata[product]': 'shopvax_subscription',
      'metadata[plan_code]': plan.code,
    }, 'shopvax-canonical-product-' + stripeMode + '-' + plan.code + '-v1')
    productId = product.id
  }
  await pool.query(`
    INSERT INTO shopvax_stripe_products (stripe_mode,plan_code,product_id)
    VALUES ($1,$2,$3) ON CONFLICT (stripe_mode,plan_code) DO NOTHING
  `, [stripeMode, plan.code, productId])
  const actual = await pool.query('SELECT product_id FROM shopvax_stripe_products WHERE stripe_mode=$1 AND plan_code=$2', [stripeMode, plan.code])
  return actual.rows[0].product_id
}

async function ensureStripePrice(plan) {
  await ensureSchema()
  const existing = await pool.query('SELECT price_id FROM shopvax_stripe_prices WHERE stripe_mode=$1 AND plan_code=$2 AND cycle=$3 AND amount_cents=$4', [stripeMode, plan.code, plan.cycle, plan.amountCents])
  if (existing.rowCount) return existing.rows[0].price_id
  const productId = await canonicalStripeProduct(plan)
  const price = await stripe('POST', 'prices', {
    product: productId,
    currency: 'brl',
    unit_amount: String(plan.amountCents),
    'recurring[interval]': plan.interval,
    'recurring[interval_count]': String(plan.intervalCount),
    nickname: plan.name + ' ' + cycles[plan.cycle].label + (plan.promotion ? ' - Black Friday' : ''),
    'metadata[plan_code]': plan.code,
    'metadata[cycle]': plan.cycle,
  }, 'shopvax-price-' + stripeMode + '-' + plan.code + '-' + plan.cycle + '-' + plan.amountCents + '-v2')
  await pool.query('INSERT INTO shopvax_stripe_prices (stripe_mode,plan_code,cycle,amount_cents,product_id,price_id) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING', [stripeMode, plan.code, plan.cycle, plan.amountCents, productId, price.id])
  const stored = await pool.query('SELECT price_id FROM shopvax_stripe_prices WHERE stripe_mode=$1 AND plan_code=$2 AND cycle=$3 AND amount_cents=$4', [stripeMode, plan.code, plan.cycle, plan.amountCents])
  return stored.rows[0].price_id
}

export const shopvaxStripeAdminRuntime = Object.freeze({
  get ready() { return ready },
  get stripeMode() { return stripeMode },
  stripe, ensureStripePrice, ensureSchema,
})

function billingShape(row, prices) {
  return {
    enabled: ready,
    required: Boolean(row?.billing_required),
    accessGranted: row ? subscriptionAccess(row) : false,
    status: row?.subscription_status || 'none',
    planCode: row?.active_plan_code || (!row?.billing_required ? row?.plan_tier || null : null),
    cycle: row?.cycle || null,
    paidUntil: row?.paid_until || null,
    cancelAtPeriodEnd: Boolean(row?.cancel_at_period_end),
    prices,
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
  await ensureReferralSchema()
  const referral = (await pool.query('SELECT referral_code,status FROM shopvax_referral_claims WHERE referred_store_id=$1',[account.id])).rows[0]
  const prices = amountOptions(await activeSystemPlans())
  res.json({ ...billingShape(account, prices), referralCode: referral?.referral_code || '', referralStatus: referral?.status || null })
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

const checkoutRedirectPath = '/api/billing/checkout/redirect'

// A navegação usa uma rota no próprio Shopvax. O servidor consulta novamente a
// sessão Stripe e valida vínculo com a loja antes de emitir o redirecionamento.
async function redirectToCheckout(req, res) {
  const fallback = '/painel/assinatura?checkout=error'
  const account = await owner(req)
  if (!account) return res.redirect(303, '/entrar')
  if (!account.checkout_session_id || !account.customer_id || !ready) return res.redirect(303, fallback)
  try {
    const session = await stripe('GET', 'checkout/sessions/' + encodeURIComponent(account.checkout_session_id))
    const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id
    if (session.id !== account.checkout_session_id ||
        session.status !== 'open' || session.mode !== 'subscription' ||
        session.client_reference_id !== account.id || customerId !== account.customer_id) {
      console.warn('[stripe-billing] sessão de checkout não corresponde à conta autenticada')
      return res.redirect(303, fallback)
    }
    if (!trustedStripeCheckoutDestination(session.url, process.env.SHOPVAX_STRIPE_CHECKOUT_HOST)) {
      // Exibir somente o host para diagnóstico: a URL completa da sessão é sensível.
      let host = 'ausente'
      try { host = new URL(session.url).hostname } catch {}
      console.error('[stripe-billing] domínio de checkout não autorizado:', host)
      return res.redirect(303, fallback)
    }
    res.set('Cache-Control', 'private, no-store')
    res.set('Referrer-Policy', 'no-referrer')
    return res.redirect(303, session.url)
  } catch (error) {
    console.error('[stripe-billing] falha ao recuperar sessão para redirecionamento:', error?.status || 'network')
    return res.redirect(303, fallback)
  }
}

async function checkout(req, res) {
  const account = await requireOwner(req, res)
  if (!account) return
  if (!ready) return apiError(res, 503, 'A cobrança online ainda não está disponível.', 'BILLING_NOT_CONFIGURED')
  const plan = await currentPlanPrice(String(req.body?.planCode || '').toLowerCase(), String(req.body?.cycle || 'monthly'))
  if (!plan) return apiError(res, 400, 'Selecione um plano e um ciclo válidos.', 'INVALID_PLAN')
  await ensureReferralSchema()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['shopvax-billing:' + account.id])
    if (req.body?.referralCode) {
      const previousPayment = (await client.query('SELECT last_invoice_id FROM shopvax_stripe_billing WHERE store_id=$1',[account.id])).rows[0]
      if (previousPayment?.last_invoice_id) { await client.query('ROLLBACK'); return apiError(res,409,'O código só pode ser atribuído antes do primeiro pagamento.','REFERRAL_TOO_LATE') }
      const linked = await captureReferral(account.id,req.body.referralCode,client)
      if (!linked.ok) {
        await client.query('ROLLBACK')
        return apiError(res,409,linked.error,'REFERRAL_INVALID')
      }
    }
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
      if (old.status === 'open' && Number(old.amount_subtotal ?? old.amount_total) === plan.amountCents && current.checkout_plan === plan.code && current.checkout_cycle === plan.cycle) {
        await client.query('COMMIT')
        return res.json({ url: checkoutRedirectPath })
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
      'INSERT INTO shopvax_stripe_billing (store_id,customer_id,stripe_mode,checkout_session_id,checkout_plan,checkout_cycle,checkout_started_at)',
      'VALUES ($1,$2,$3,$4,$5,$6,now()) ON CONFLICT (store_id) DO UPDATE SET',
      'customer_id=EXCLUDED.customer_id,stripe_mode=EXCLUDED.stripe_mode,checkout_session_id=EXCLUDED.checkout_session_id,checkout_started_at=EXCLUDED.checkout_started_at,',
      "subscription_id=NULL,subscription_status='none',active_plan_code=NULL,cycle=NULL,paid_until=NULL,",
      'checkout_plan=EXCLUDED.checkout_plan,checkout_cycle=EXCLUDED.checkout_cycle,updated_at=now()',
    ].join(' '), [account.id, customer, stripeMode, session.id, plan.code, plan.cycle])
    await client.query('COMMIT')
    res.json({ url: checkoutRedirectPath })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally { client.release() }
}

async function portal(req, res) {
  const account = await requireOwner(req, res)
  if (!account) return
  if (!account.customer_id || !ready || account.stripe_mode !== stripeMode) return apiError(res, 409, 'Nenhuma assinatura Stripe válida neste ambiente.', 'NO_BILLING_CUSTOMER')
  const cached = await pool.query('SELECT portal_config_id FROM shopvax_stripe_settings WHERE stripe_mode=$1', [stripeMode])
  let configId = cached.rows[0]?.portal_config_id || null
  if (!configId) {
    const config = await stripe('POST', 'billing_portal/configurations', {
    'features[invoice_history][enabled]': 'true',
    'features[payment_method_update][enabled]': 'true',
    'features[subscription_cancel][enabled]': 'true',
    'features[subscription_cancel][mode]': 'at_period_end',
    'features[subscription_update][enabled]': 'false',
    }, 'shopvax-portal-config-v1')
    await pool.query('INSERT INTO shopvax_stripe_settings (stripe_mode,portal_config_id) VALUES ($1,$2) ON CONFLICT (stripe_mode) DO NOTHING', [stripeMode, config.id])
    configId = (await pool.query('SELECT portal_config_id FROM shopvax_stripe_settings WHERE stripe_mode=$1', [stripeMode])).rows[0].portal_config_id
  }
  const session = await stripe('POST', 'billing_portal/sessions', {
    customer: account.customer_id,
    configuration: configId,
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
  const plan = await currentPlanPrice(String(req.body?.planCode || '').toLowerCase(), String(req.body?.cycle || 'monthly'))
  if (!plan) return apiError(res, 400, 'Plano ou ciclo inválido.', 'INVALID_PLAN')
  if (plan.code === account.active_plan_code && plan.cycle === account.cycle) return res.json({ ok: true, unchanged: true })
  const sub = await stripe('GET', 'subscriptions/' + encodeURIComponent(account.subscription_id))
  if (sub.customer !== account.customer_id || !sub.items?.data?.[0]?.id || sub.status !== 'active') {
    return apiError(res, 409, 'A assinatura está em processamento. Atualize o status.', 'SUBSCRIPTION_UNAVAILABLE')
  }
  if (sub.pending_update) return apiError(res, 409, 'Há uma mudança de plano pendente de pagamento. Conclua-a antes de fazer outra.', 'PLAN_CHANGE_PENDING')
  const priceId = await ensureStripePrice(plan)
  const currentStripePrice = typeof sub.items.data[0].price === 'string' ? sub.items.data[0].price : sub.items.data[0].price?.id
  if (currentStripePrice === priceId) return res.json({ ok: true, pending: true, message: 'Esta mudança já está em processamento na Stripe.' })
  const requestId = typeof req.body?.requestId === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(req.body.requestId)
    ? req.body.requestId : crypto.randomUUID()
  const updated = await stripe('POST', 'subscriptions/' + encodeURIComponent(sub.id), {
    'items[0][id]': sub.items.data[0].id,
    'items[0][price]': priceId,
    proration_behavior: 'always_invoice',
    payment_behavior: 'pending_if_incomplete',
  }, 'shopvax-change-' + sub.id + '-' + priceId + '-' + requestId)
  res.json({ ok: true, status: updated.status, pending: Boolean(updated.pending_update), message: 'A alteração só será liberada após a confirmação da cobrança, quando necessária.' })
}

async function syncSubscription(client, id, eventType, paidInvoiceId = null) {
  const subscription = await stripe('GET', 'subscriptions/' + encodeURIComponent(id))
  const storeId = String(subscription?.metadata?.shopvax_store_id || '')
  if (!storeId || !subscription.customer) return null
  const row = (await client.query('SELECT * FROM shopvax_stripe_billing WHERE store_id=$1 FOR UPDATE', [storeId])).rows[0]
  if (!row || row.stripe_mode !== stripeMode || row.customer_id !== subscription.customer) {
    throw new Error('Assinatura Stripe não corresponde à loja vinculada.')
  }
  // Eventos atrasados de uma assinatura já substituída não podem afetar a nova.
  if (row.subscription_id && row.subscription_id !== subscription.id) return null
  if (!row.subscription_id && row.checkout_started_at && Number(subscription.created) * 1000 < new Date(row.checkout_started_at).getTime() - 30_000) return null
  const line = subscription.items?.data?.[0]
  const priceId = typeof line?.price === 'string' ? line.price : line?.price?.id
  const mapped = priceId ? (await client.query('SELECT plan_code,cycle FROM shopvax_stripe_prices WHERE price_id=$1 AND stripe_mode=$2', [priceId, stripeMode])).rows[0] : null
  const paid = eventType === 'invoice.paid' && Boolean(paidInvoiceId) && mapped && subscription.status === 'active'
  const firstPaid = paid && !row.last_invoice_id
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
  return { storeId, paid, firstPaid }
}

async function webhook(req, res) {
  if (!ready) return apiError(res, 503, 'Webhook não configurado.', 'BILLING_NOT_CONFIGURED')
  if (!verifyStripeSignature(req.body, req.get('stripe-signature'), webhookSecret)) return apiError(res, 400, 'Assinatura inválida.', 'INVALID_STRIPE_SIGNATURE')
  let event
  try { event = JSON.parse(req.body.toString('utf8')) }
  catch { return apiError(res, 400, 'JSON inválido.', 'INVALID_EVENT') }
  if (!event?.id || !event?.type || !event?.data?.object) return apiError(res, 400, 'Evento inválido.', 'INVALID_EVENT')
  await ensureSchema()
  await ensureReferralSchema()
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
        'WHERE store_id=$1 AND customer_id=$2 AND checkout_session_id=$4 AND (subscription_id IS NULL OR subscription_id=$3)',
      ].join(' '), [storeId, obj.customer, obj.subscription, obj.id])
      // Nunca liberar acesso somente porque o usuário retornou do Checkout.
    } else if (event.type === 'invoice.paid' && obj.status === 'paid' && obj.paid_out_of_band !== true) {
      const sub = typeof obj.subscription === 'string' ? obj.subscription : obj.parent?.subscription_details?.subscription
      if (typeof sub === 'string') {
        const confirmed = await syncSubscription(client, sub, event.type, obj.id)
        if (confirmed?.paid) {
          const referred = confirmed.firstPaid ? await qualifyReferralOnPaidInvoice(client,confirmed.storeId,obj.id) : null
          if (referred?.referrerStoreId) await applyMerchantStripeCredits(client,referred.referrerStoreId,stripe,stripeMode)
          await applyMerchantStripeCredits(client,confirmed.storeId,stripe,stripeMode)
        }
      }
    } else if ((event.type === 'invoice.voided' && obj.id) ||
      (event.type === 'charge.refunded' && obj.refunded === true && Number(obj.amount_refunded) >= Number(obj.amount) && obj.invoice)) {
      const refundedInvoice = event.type === 'charge.refunded' ? obj.invoice : obj.id
      await reverseReferralForRefund(client,refundedInvoice,stripe,stripeMode)
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
  const protectedAdmin = req.path.startsWith('/api/admin/') && req.path !== '/api/admin/plan-context'
  const buyerOrder = req.method === 'POST' && req.path === '/api/business/orders'
  const register = req.method === 'POST' && ['/api/auth/register','/api/auth/google'].includes(req.path)
  if (!protectedAdmin && !buyerOrder && !register) return next()
  try {
    await ensureSchema()
    // A configuração de cobrança precisa estar aplicada ANTES da criação da loja.
    if (register) {
      const isGoogleSignup = req.path === '/api/auth/google' && req.body?.intent === 'register'
      const isNewStore = req.path === '/api/auth/register' || isGoogleSignup
      const localTestBypass = process.env.NODE_ENV === 'test' && process.env.SHOPVAX_TEST_BILLING_BYPASS === '1'
      if (isNewStore && signupPaymentRequired && !ready && !localTestBypass)
        return apiError(res, 503, 'Não é possível criar lojas enquanto a cobrança Stripe estiver indisponível. Tente novamente após a conexão ser restabelecida.', 'BILLING_NOT_CONFIGURED')
      return next()
    }
    // Somente suítes locais de integração, nunca produção, podem simular
    // lojas legadas com acesso à API sem um pagamento na Stripe.
    if (process.env.NODE_ENV === 'test' && process.env.SHOPVAX_TEST_BILLING_BYPASS === '1') return next()
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
    if (!subscriptionAccess(row)) return apiError(res, 402, 'Pagamento da assinatura necessário para acessar a loja. Acesse Plano e cobrança.', 'PAYMENT_REQUIRED')
    next()
  } catch (error) { next(error) }
}

function install(app) {
  if (app.__shopvaxStripeInstalled) return
  app.__shopvaxStripeInstalled = true
  app.post('/api/billing/stripe/webhook', express.raw({ type: 'application/json', limit: '256kb' }), wrap(webhook))
  app.get('/api/billing/public-plans', wrap(async (_req,res) => {
    res.set('Cache-Control','no-store')
    const rows = await activeSystemPlans()
    res.json({ enabled:ready, paymentRequired:signupPaymentRequired, plans: rows.map(row => ({
      code:row.code,name:row.name,monthlyPrice:Number(row.monthly_price),
      sellerLimit:row.seller_limit == null ? null : Number(row.seller_limit),
      productLimit:row.product_limit == null ? null : Number(row.product_limit),
      catalogLimit:row.catalog_limit == null ? null : Number(row.catalog_limit),
      photoLimit:row.photo_limit == null ? null : Number(row.photo_limit),
      franchiseeLimit:row.franchisee_limit == null ? null : Number(row.franchisee_limit),
      promotion:blackFridayPromotion(row.code, row.monthly_price),
      cycles:Object.keys(cycles).map(cycle => {
        const item = priceForCycle(row, cycle)
        return { code:cycle, amountCents:item?.amount ?? null, previousAmountCents:item?.previousAmountCents ?? null }
      }),
    })) })
  }))
  app.get('/api/billing/status', headersNoCache, wrap(status))
  app.post('/api/billing/checkout', express.json({ limit: '8kb' }), headersNoCache, wrap(checkout))
  app.get(checkoutRedirectPath, headersNoCache, wrap(redirectToCheckout))
  app.post('/api/billing/portal', express.json({ limit: '8kb' }), headersNoCache, wrap(portal))
  app.post('/api/billing/change', express.json({ limit: '8kb' }), headersNoCache, wrap(change))
  // O gate de cadastro Google precisa ler intent=register, mesmo antes do
  // express.json global ser instalado por server/app.mjs.
  app.use('/api/auth/google', express.json({ limit: '64kb' }))
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
