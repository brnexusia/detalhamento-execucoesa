import pg from 'pg'

const { Pool } = pg
const originalQuery = Pool.prototype.query
const phase4Signature = 'ALTER TABLE store_customers ADD COLUMN IF NOT EXISTS cpf_cnpj'
let migrationGate = null

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function baseSchemasReady(pool) {
  const result = await originalQuery.call(pool, `
    SELECT
      to_regclass('public.platform_plans') IS NOT NULL AS plans_table,
      to_regclass('public.store_customers') IS NOT NULL AS customers_table,
      to_regclass('public.coupons') IS NOT NULL AS phase3_table,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='platform_plans' AND column_name='feature_flags') AS plans_ready,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='products' AND column_name='stock_enabled') AS stock_ready,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='products' AND column_name='social_published') AS social_ready,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='coupon_code') AS phase3_ready,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='customer_id') AS customers_ready
  `)
  const row = result.rows[0] || {}
  return Object.values(row).every(Boolean)
}

async function waitForStableBase(pool) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    try {
      if (await baseSchemasReady(pool)) {
        // Deixa as últimas transações de migração do core liberarem seus locks.
        await sleep(300)
        if (await baseSchemasReady(pool)) return
      }
    } catch {}
    await sleep(50)
  }
  throw new Error('Schemas-base não estabilizaram antes da migração da Fase 4.')
}

async function runPhase4Migration(pool, args) {
  await waitForStableBase(pool)
  let lastError = null
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await originalQuery.apply(pool, args)
    } catch (error) {
      lastError = error
      if (!['40P01', '23505'].includes(String(error?.code || ''))) throw error
      await sleep(250 + attempt * 200)
    }
  }
  throw lastError
}

Pool.prototype.query = function phase4SchemaGateQuery(...args) {
  const text = typeof args[0] === 'string' ? args[0] : String(args[0]?.text || '')
  if (!text.includes(phase4Signature)) return originalQuery.apply(this, args)
  if (!migrationGate) {
    migrationGate = runPhase4Migration(this, args).catch((error) => {
      migrationGate = null
      throw error
    })
  }
  return migrationGate
}
