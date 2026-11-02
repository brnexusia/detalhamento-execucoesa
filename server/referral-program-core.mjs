import crypto from 'node:crypto'
import pg from 'pg'
import { planPrice } from './stripe-billing-policy.mjs'

const { Pool } = pg
const pool = process.env.DATABASE_URL?.trim() ? new Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 5000 }) : null
if (pool) pool.on('error', error => console.error('[referral] database:', error.message))
const validCode = /^[A-Z0-9-]{5,40}$/
export const referralCode = raw => String(raw || '').trim().toUpperCase().slice(0, 40)
export const referralPool = pool
let schemaPromise
export function ensureReferralSchema() {
  if (!pool) return Promise.reject(new Error('PostgreSQL não configurado.'))
  if (!schemaPromise) schemaPromise = pool.query([
    "ALTER TABLE stores ADD COLUMN IF NOT EXISTS referral_code text NOT NULL DEFAULT '';",
    "ALTER TABLE stores ADD COLUMN IF NOT EXISTS billing_credit_months integer NOT NULL DEFAULT 0;",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_stores_referral_code_unique ON stores(upper(referral_code)) WHERE referral_code<>'';",
    "CREATE TABLE IF NOT EXISTS shopvax_partners (",
    "id text PRIMARY KEY, user_id text UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "code text UNIQUE NOT NULL, status text NOT NULL DEFAULT 'active',",
    "commission_cents integer NOT NULL DEFAULT 0 CHECK (commission_cents>=0),",
    "pix_key text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(),",
    "updated_at timestamptz NOT NULL DEFAULT now());",
    "CREATE TABLE IF NOT EXISTS shopvax_referral_claims (",
    "referred_store_id text PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,",
    "referral_code text NOT NULL,",
    "referrer_store_id text REFERENCES stores(id) ON DELETE SET NULL,",
    "partner_id text REFERENCES shopvax_partners(id) ON DELETE SET NULL,",
    "status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','qualified','reversed')),",
    "first_invoice_id text UNIQUE, qualified_at timestamptz, reversed_at timestamptz,",
    "credit_months integer NOT NULL DEFAULT 0,",
    "credit_status text NOT NULL DEFAULT 'none',",
    "stripe_credit_txn_id text, credit_amount_cents integer NOT NULL DEFAULT 0,",
    "commission_cents integer NOT NULL DEFAULT 0,",
    "commission_status text NOT NULL DEFAULT 'none',",
    "payout_reference text, paid_at timestamptz,",
    "created_at timestamptz NOT NULL DEFAULT now(),",
    "CHECK (num_nonnulls(referrer_store_id,partner_id)=1));",
    "CREATE INDEX IF NOT EXISTS idx_svx_claims_store ON shopvax_referral_claims(referrer_store_id,status,created_at DESC);",
    "CREATE INDEX IF NOT EXISTS idx_svx_claims_partner ON shopvax_referral_claims(partner_id,status,created_at DESC);",
    "CREATE TABLE IF NOT EXISTS store_referrals (id text PRIMARY KEY,referrer_store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,referred_store_id text NOT NULL UNIQUE REFERENCES stores(id) ON DELETE CASCADE,credit_months integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now());",
    "CREATE TABLE IF NOT EXISTS shopvax_referral_visits ("
    "id text PRIMARY KEY, code text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());",
    "CREATE INDEX IF NOT EXISTS idx_svx_referral_visits ON shopvax_referral_visits(code,created_at DESC);",
    "CREATE TABLE IF NOT EXISTS shopvax_referral_audit (",
    "id text PRIMARY KEY, actor_user_id text REFERENCES users(id) ON DELETE SET NULL,",
    "action text NOT NULL, claim_store_id text, meta jsonb NOT NULL DEFAULT '{}'::jsonb,",
    "created_at timestamptz NOT NULL DEFAULT now());",
  ].join(' ')).then(() => undefined).catch(error => { schemaPromise = null; throw error })
  return schemaPromise
}

export async function lookupReferral(client, rawCode) {
  const code = referralCode(rawCode)
  if (!validCode.test(code)) return null
  const store = await client.query('SELECT s.id,s.owner_id,s.name FROM stores s WHERE upper(s.referral_code)=$1 AND s.is_active=true LIMIT 1', [code])
  if (store.rowCount) return { code, type: 'merchant', referrerStoreId: store.rows[0].id, ownerUserId: store.rows[0].owner_id, name: store.rows[0].name }
  const partner = await client.query("SELECT p.id,p.user_id,u.name FROM shopvax_partners p JOIN users u ON u.id=p.user_id WHERE upper(p.code)=$1 AND p.status='active' LIMIT 1", [code])
  if (partner.rowCount) return { code, type: 'partner', partnerId: partner.rows[0].id, ownerUserId: partner.rows[0].user_id, name: partner.rows[0].name }
  return null
}

export async function captureReferral(referredStoreId, rawCode, client = pool) {
  await ensureReferralSchema()
  const referred = (await client.query('SELECT id,owner_id FROM stores WHERE id=$1', [referredStoreId])).rows[0]
  if (!referred) return { ok: false, error: 'Loja indicada não encontrada.' }
  const owner = await lookupReferral(client, rawCode)
  if (!owner) return { ok: false, error: 'Código de indicação inválido.' }
  if (owner.ownerUserId === referred.owner_id || owner.referrerStoreId === referredStoreId) return { ok: false, error: 'Não é permitido indicar a própria conta.' }
  const existing = (await client.query('SELECT referral_code,status FROM shopvax_referral_claims WHERE referred_store_id=$1', [referredStoreId])).rows[0]
  if (existing) return existing.referral_code === owner.code
    ? { ok: true, existing: true, status: existing.status, type: owner.type }
    : { ok: false, error: 'Esta loja já está vinculada a outra indicação.' }
  const inserted = await client.query([
    'INSERT INTO shopvax_referral_claims (referred_store_id,referral_code,referrer_store_id,partner_id)',
    'VALUES ($1,$2,$3,$4) ON CONFLICT (referred_store_id) DO NOTHING RETURNING referred_store_id',
  ].join(' '), [referredStoreId,owner.code,owner.referrerStoreId || null,owner.partnerId || null])
  if (!inserted.rowCount) return captureReferral(referredStoreId,owner.code,client)
  return { ok: true, existing: false, status: 'pending', type: owner.type }
}

export async function qualifyReferralOnPaidInvoice(client, referredStoreId, invoiceId) {
  if (!invoiceId || !referredStoreId) return null
  await ensureReferralSchema()
  const row = (await client.query('SELECT * FROM shopvax_referral_claims WHERE referred_store_id=$1 FOR UPDATE', [referredStoreId])).rows[0]
  if (!row || row.status !== 'pending') return null
  if (row.referrer_store_id) {
    // Legacy report: only an actually paid referral enters the credit ledger.
    await client.query([
      'INSERT INTO store_referrals (id,referrer_store_id,referred_store_id,credit_months)',
      'VALUES ($1,$2,$3,1) ON CONFLICT(referred_store_id) DO NOTHING',
    ].join(' '), [crypto.randomUUID(),row.referrer_store_id,referredStoreId])
    await client.query('UPDATE stores SET billing_credit_months=billing_credit_months+1 WHERE id=$1', [row.referrer_store_id])
    await client.query([
      "UPDATE shopvax_referral_claims SET status='qualified',first_invoice_id=$2,qualified_at=now(),",
      "credit_months=1,credit_status='pending' WHERE referred_store_id=$1",
    ].join(' '),[referredStoreId,invoiceId])
  } else {
    const partner = (await client.query("SELECT commission_cents FROM shopvax_partners WHERE id=$1 AND status='active' FOR UPDATE", [row.partner_id])).rows[0]
    // No invented commissions: zero means a rule is not configured yet.
    const amount = Math.max(0,Number(partner?.commission_cents || 0))
    await client.query([
      "UPDATE shopvax_referral_claims SET status='qualified',first_invoice_id=$2,qualified_at=now(),",
      "commission_cents=$3,commission_status=$4 WHERE referred_store_id=$1",
    ].join(' '),[referredStoreId,invoiceId,amount,amount > 0 ? 'pending_approval' : 'awaiting_rule'])
  }
  return { referrerStoreId: row.referrer_store_id || null, partnerId: row.partner_id || null }
}

export async function applyMerchantStripeCredits(client, referrerStoreId, stripe, stripeMode) {
  if (!referrerStoreId) return 0
  const bill = (await client.query("SELECT * FROM shopvax_stripe_billing WHERE store_id=$1 AND subscription_status='active' AND paid_until>now() FOR UPDATE", [referrerStoreId])).rows[0]
  if (!bill || bill.stripe_mode !== stripeMode || !bill.customer_id) return 0
  const month = planPrice(bill.active_plan_code,'monthly')
  if (!month?.amountCents) return 0
  const candidates = (await client.query([
    "SELECT * FROM shopvax_referral_claims WHERE referrer_store_id=$1 AND status='qualified'",
    "AND credit_status='pending' ORDER BY qualified_at FOR UPDATE",
  ].join(' '),[referrerStoreId])).rows
  for (const row of candidates) {
    const amountCents = month.amountCents
    const tx = await stripe('POST','customers/'+encodeURIComponent(bill.customer_id)+'/balance_transactions',{
      amount:String(-amountCents),currency:'brl',
      description:'Shopvax: credito de uma mensalidade por indicacao '+row.referral_code,
      'metadata[referral_store_id]':row.referred_store_id,
    },'shopvax-referral-credit-'+stripeMode+'-'+row.referred_store_id)
    await client.query([
      "UPDATE shopvax_referral_claims SET credit_status='applied',stripe_credit_txn_id=$2,credit_amount_cents=$3",
      "WHERE referred_store_id=$1 AND credit_status='pending'",
    ].join(' '),[row.referred_store_id,tx.id,amountCents])
    await client.query('UPDATE stores SET billing_credit_months=GREATEST(0,billing_credit_months-1) WHERE id=$1',[referrerStoreId])
  }
  return candidates.length
}

export async function reverseReferralForRefund(client, invoiceId, stripe, stripeMode) {
  if (!invoiceId) return false
  const row = (await client.query("SELECT * FROM shopvax_referral_claims WHERE first_invoice_id=$1 AND status='qualified' FOR UPDATE",[invoiceId])).rows[0]
  if (!row) return false
  if (row.referrer_store_id) {
    if (row.credit_status === 'pending') {
      await client.query('UPDATE stores SET billing_credit_months=GREATEST(0,billing_credit_months-1) WHERE id=$1',[row.referrer_store_id])
    } else if (row.credit_status === 'applied' && row.credit_amount_cents>0) {
      const bill=(await client.query('SELECT * FROM shopvax_stripe_billing WHERE store_id=$1 FOR UPDATE',[row.referrer_store_id])).rows[0]
      if (!bill?.customer_id || bill.stripe_mode!==stripeMode) throw new Error('Stripe: impossible to reverse a credited referral without same-mode customer.')
      await stripe('POST','customers/'+encodeURIComponent(bill.customer_id)+'/balance_transactions',{
        amount:String(row.credit_amount_cents),currency:'brl',
        description:'Shopvax: estorno integral da indicacao '+row.referral_code,
        'metadata[referral_store_id]':row.referred_store_id,
      },'shopvax-referral-reversal-'+stripeMode+'-'+row.referred_store_id)
    }
    await client.query('DELETE FROM store_referrals WHERE referred_store_id=$1',[row.referred_store_id])
  }
  await client.query([
    "UPDATE shopvax_referral_claims SET status='reversed',reversed_at=now(),",
    "credit_status=CASE WHEN credit_status='applied' THEN 'reversed' ELSE credit_status END,",
    "commission_status=CASE WHEN commission_status='paid' THEN 'reversal_due' ELSE 'reversed' END",
    "WHERE referred_store_id=$1",
  ].join(' '),[row.referred_store_id])
  return true
}
