import assert from 'node:assert/strict'
import pg from 'pg'

const base = process.env.BASE_URL || 'http://127.0.0.1:3000'
const dbUrl = process.env.DATABASE_URL
if (!dbUrl) throw new Error('DATABASE_URL necessária para integração de schema Stripe')
const pool = new pg.Pool({ connectionString: dbUrl, max: 1 })
try {
  let tables = null
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const result = await pool.query([
      "SELECT to_regclass('public.shopvax_stripe_billing') IS NOT NULL AS billing,",
      "to_regclass('public.shopvax_stripe_events') IS NOT NULL AS events,",
      "to_regclass('public.shopvax_stripe_prices') IS NOT NULL AS prices,",
      "to_regclass('public.shopvax_stripe_settings') IS NOT NULL AS settings",
    ].join(' '))
    tables = result.rows[0]
    if (Object.values(tables).every(Boolean)) break
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  assert.deepEqual(tables, { billing: true, events: true, prices: true, settings: true })

  const trigger = await pool.query([
    "SELECT count(*)::int AS total FROM pg_trigger",
    "WHERE tgname='trg_shopvax_stripe_new_store' AND NOT tgisinternal",
  ].join(' '))
  assert.equal(trigger.rows[0].total, 1, 'Bloqueio automático de plano no INSERT de loja ausente')

  const legacy = await pool.query([
    "SELECT column_default FROM information_schema.columns",
    "WHERE table_schema='public' AND table_name='stores' AND column_name='billing_required'",
  ].join(' '))
  assert.equal(legacy.rowCount, 1)
  assert.match(legacy.rows[0].column_default, /false/, 'Sem Stripe configurada, cadastros continuam isentos')

  // Provar que um plano escolhido no cadastro não é uma concessão gratuita.
  const seed = 'stripe-test-' + Math.random().toString(36).slice(2)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('INSERT INTO users (id,email,name,password_hash) VALUES ($1,$2,$3,$4)', [seed, seed + '@example.invalid', 'Loja Teste', null])
    const protectedStore = await client.query([
      'INSERT INTO stores (id,owner_id,slug,name,plan_tier,billing_required)',
      'VALUES ($1,$2,$3,$4,$5,true) RETURNING plan_tier,billing_required',
    ].join(' '), [seed, seed, seed, 'Teste Stripe', 'ouro'])
    assert.equal(protectedStore.rows[0].plan_tier, 'bronze', 'Plano Ouro não pode ser ativado só por seleção do cadastro')
    assert.equal(protectedStore.rows[0].billing_required, true)
    await client.query('ROLLBACK')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }

  const anonymous = await fetch(base + '/api/billing/status')
  assert.equal(anonymous.status, 401, 'Dados da cobrança exigem sessão do lojista')

  const disabled = await fetch(base + '/api/billing/stripe/webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'evt_not_verified' }),
  })
  assert.equal(disabled.status, 503, 'Webhook não deve aceitar pagamentos quando sem credenciais')

  console.log('Stripe schema, trigger, isolamento de sessão e indisponibilidade segura: OK')
} finally {
  await pool.end()
}
