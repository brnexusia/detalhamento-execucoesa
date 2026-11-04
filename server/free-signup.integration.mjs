import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import pg from 'pg'
import { requiresPaymentForSignup } from './signup-billing-mode.mjs'

if (requiresPaymentForSignup()) throw new Error('Este teste precisa do cadastro sem cobrança')
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL necessária')
const base = process.env.BASE_URL || 'http://127.0.0.1:3000'
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const id = crypto.randomBytes(8).toString('hex')
const email = 'signup-free-' + id + '@example.test'
const storeName = 'Cadastro livre ' + id

try {
  const register = await fetch(base + '/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Lojista Teste', email, password: 'SenhaDeTeste2026!',
      storeName, whatsapp: '71999990000', planCode: 'prata',
    }),
  })
  const registration = await register.json()
  assert.equal(register.status, 201, JSON.stringify(registration))
  const cookie = register.headers.get('set-cookie')?.split(';')[0]
  assert.match(cookie || '', /(?:shopvax|atacado)_session=/)
  const store = await pool.query(
    'SELECT s.id,s.plan_tier,s.billing_required FROM stores s JOIN users u ON s.owner_id=u.id WHERE u.email=$1',
    [email],
  )
  assert.equal(store.rowCount, 1)
  assert.equal(store.rows[0].billing_required, false, 'Nova loja deve ser liberada sem assinatura')
  assert.equal(store.rows[0].plan_tier, 'prata', 'Plano escolhido mantém seus limites')
  const status = await fetch(base + '/api/billing/status', { headers: { cookie } })
  const billing = await status.json()
  assert.equal(status.status, 200)
  assert.equal(billing.required, false)
  assert.equal(billing.accessGranted, true)
  assert.equal(billing.planCode, 'prata')
  const stripe = await pool.query('SELECT 1 FROM shopvax_stripe_billing WHERE store_id=$1', [store.rows[0].id])
  assert.equal(stripe.rowCount, 0, 'Não criar cobrança nem assinatura Stripe')
  const panel = await fetch(base + '/api/admin/bootstrap', { headers: { cookie } })
  assert.notEqual(panel.status, 402, 'Nova conta deve passar pelo gate de acesso ao painel')
  console.log('FREE_SIGNUP_AND_PANEL_ACCESS_OK')
} finally {
  await pool.query('DELETE FROM users WHERE email=$1', [email])
  await pool.end()
}
