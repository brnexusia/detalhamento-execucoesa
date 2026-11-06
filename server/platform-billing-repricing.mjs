import crypto from 'node:crypto'
import { planPrice } from './stripe-billing-policy.mjs'
import { shopvaxStripeAdminRuntime } from './stripe-billing-hooks.mjs'

const VALID_PLANS = new Set(['bronze', 'prata', 'ouro'])
const MAX_BATCH = 50

// A stored, paid subscription may be repriced only through an authenticated
// platform admin action. Never reprice on a plan edit, deploy or public API call.
export function registerPlatformBillingRepricing(router, requirePlatformAdmin, asyncRoute, pool, audit) {
  async function eligibility(code) {
    if (!VALID_PLANS.has(code)) return null
    const price = await pool.query(
      'SELECT code,name,monthly_price,semester_discount,annual_discount FROM platform_plans WHERE code=$1 AND is_system=true AND active=true LIMIT 1', [code],
    )
    return price.rows[0] || null
  }

  async function eligibleStores(code) {
    // 51st row prevents accidental unbounded bulk changes.
    const result = await pool.query(`
      SELECT s.id AS store_id,s.name AS store_name,u.email AS owner_email,
        b.subscription_id,b.customer_id,b.cycle,b.paid_until,b.active_plan_code
      FROM shopvax_stripe_billing b
      JOIN stores s ON s.id=b.store_id
      JOIN users u ON u.id=s.owner_id
      WHERE b.active_plan_code=$1 AND b.stripe_mode=$2
        AND b.subscription_id IS NOT NULL AND b.customer_id IS NOT NULL
        AND b.subscription_status='active' AND b.paid_until>now()
        AND b.cancel_at_period_end=false
        AND b.cycle IN ('monthly','semiannual','annual')
      ORDER BY s.name,s.id LIMIT $3
    `, [code, shopvaxStripeAdminRuntime.stripeMode, MAX_BATCH + 1])
    return result.rows
  }

  function requestedRows(body, found) {
    const scope = body?.scope === 'all' ? 'all' : body?.scope === 'selected' ? 'selected' : null
    if (!scope) return { error: 'Escolha somente lojas selecionadas ou todas as elegíveis.' }
    if (scope === 'all' && found.length > MAX_BATCH) return { error: 'Há mais de 50 assinaturas elegíveis. Selecione um lote de até 50 lojas por operação.' }
    if (scope === 'all') return { rows: found }
    const ids = body?.storeIds
    if (!Array.isArray(ids) || !ids.length || ids.length > MAX_BATCH ||
        ids.some((id) => typeof id !== 'string' || id.length > 128) ||
        new Set(ids).size !== ids.length) return { error: 'Selecione de 1 a 50 lojas distintas.' }
    const selected = found.filter((row) => ids.includes(row.store_id))
    if (selected.length !== ids.length) return { error: 'A seleção mudou ou possui uma assinatura inelegível. Atualize a lista.' }
    return { rows: selected }
  }

  function shape(plan, rows) {
    const targets = rows.map((row) => {
      const price = planPrice(plan.code, row.cycle, plan)
      return {
        storeId: row.store_id, name: row.store_name, email: row.owner_email,
        cycle: row.cycle, paidUntil: row.paid_until,
        targetAmountCents: price?.amountCents ?? null,
      }
    })
    const digest = crypto.createHash('sha256').update(JSON.stringify({
      plan: plan.code, monthly: plan.monthly_price,
      semester: plan.semester_discount, annual: plan.annual_discount,
      targets: targets.map((row) => [row.storeId,row.cycle,row.targetAmountCents]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))),
    })).digest('hex')
    return { targets, previewHash: digest }
  }

  router.get('/billing/repricing', requirePlatformAdmin, asyncRoute(async (req,res) => {
    res.set('Cache-Control','private, no-store')
    if (!shopvaxStripeAdminRuntime.ready) return res.status(503).json({ error: 'Stripe indisponível neste ambiente.' })
    await shopvaxStripeAdminRuntime.ensureSchema()
    const code = String(req.query?.planCode || '').toLowerCase()
    const plan = await eligibility(code)
    if (!plan) return res.status(400).json({ error: 'Selecione Bronze, Prata ou Ouro ativo.' })
    const rows = await eligibleStores(code)
    const preview = shape(plan, rows.slice(0,MAX_BATCH))
    res.json({ planCode:code, count: rows.length, truncated:rows.length>MAX_BATCH, maxBatch:MAX_BATCH, ...preview })
  }))

  router.post('/billing/repricing/preview', requirePlatformAdmin, asyncRoute(async (req,res) => {
    res.set('Cache-Control','private, no-store')
    if (!shopvaxStripeAdminRuntime.ready) return res.status(503).json({ error: 'Stripe indisponível.' })
    await shopvaxStripeAdminRuntime.ensureSchema()
    const code = String(req.body?.planCode || '').toLowerCase()
    const plan = await eligibility(code)
    if (!plan) return res.status(400).json({ error: 'Plano inválido ou inativo.' })
    const selection = requestedRows(req.body,await eligibleStores(code))
    if (selection.error) return res.status(409).json({ error: selection.error })
    if (!selection.rows.length) return res.status(400).json({ error: 'Nenhuma assinatura elegível.' })
    res.json({ planCode:code, ...shape(plan,selection.rows) })
  }))

  router.post('/billing/repricing/apply', requirePlatformAdmin, asyncRoute(async (req,res) => {
    res.set('Cache-Control','private, no-store')
    if (!shopvaxStripeAdminRuntime.ready) return res.status(503).json({ error: 'Stripe indisponível.' })
    if (req.body?.confirmation !== 'REAJUSTAR' || req.body?.noticeAcknowledged !== true)
      return res.status(400).json({ error: 'Confirme REAJUSTAR e a responsabilidade pela comunicação prévia aos clientes.' })
    if (typeof req.body?.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(req.body.requestId))
      return res.status(400).json({ error: 'Identificador da operação inválido.' })
    await shopvaxStripeAdminRuntime.ensureSchema()
    const code = String(req.body?.planCode || '').toLowerCase()
    const plan = await eligibility(code)
    if (!plan) return res.status(400).json({ error: 'Plano inválido.' })
    const selection = requestedRows(req.body, await eligibleStores(code))
    if (selection.error) return res.status(409).json({ error: selection.error })
    const preview = shape(plan,selection.rows)
    if (!selection.rows.length || req.body?.previewHash !== preview.previewHash)
      return res.status(409).json({ error: 'A prévia ficou desatualizada. Revise os valores e clientes antes de continuar.' })

    const client = await pool.connect()
    let locked = false
    const results = []
    try {
      // Disallow concurrent bulk repricing jobs for this plan on any worker.
      const lock = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', ['shopvax-billing-reprice:' + code])
      locked = lock.rows[0]?.ok === true
      if (!locked) return res.status(409).json({ error: 'Outro reajuste deste plano já está em andamento.' })
      for (const row of selection.rows) {
        const target = planPrice(code,row.cycle,plan)
        try {
          if (!target) throw new Error('Preço de destino inválido.')
          const subscription = await shopvaxStripeAdminRuntime.stripe('GET','subscriptions/'+encodeURIComponent(row.subscription_id))
          const first = subscription.items?.data?.[0]
          const currentPrice = first?.price
          const customer = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id
          const cycle = target.interval === 'year' ? { interval:'year',count:1 } :
            { interval:'month',count:target.intervalCount }
          if (subscription.id !== row.subscription_id ||
              subscription.metadata?.shopvax_store_id !== row.store_id ||
              customer !== row.customer_id || subscription.status !== 'active' ||
              subscription.cancel_at_period_end || subscription.pending_update ||
              subscription.items?.data?.length !== 1 || !first?.id ||
              typeof currentPrice !== 'object' || currentPrice.currency !== 'brl' ||
              currentPrice.recurring?.interval !== cycle.interval ||
              Number(currentPrice.recurring?.interval_count) !== cycle.count) {
            throw new Error('Assinatura ou ciclo não corresponde ao registro local; nenhuma alteração feita.')
          }
          if (Number(currentPrice.unit_amount) === target.amountCents) {
            results.push({ storeId:row.store_id,status:'unchanged' })
            continue
          }
          const priceId = await shopvaxStripeAdminRuntime.ensureStripePrice(target)
          await shopvaxStripeAdminRuntime.stripe('POST','subscriptions/'+encodeURIComponent(subscription.id),{
            'items[0][id]':first.id,
            'items[0][price]':priceId,
            proration_behavior:'none',
            // Same recurring interval: Stripe retains the billing date.
          }, 'svx-reprice-'+req.body.requestId+'-'+row.store_id)
          await audit(req.platformUser.id,'billing.reprice.scheduled','store',row.store_id,{
            planCode:code, cycle:row.cycle, fromCents:currentPrice.unit_amount,
            toCents:target.amountCents, effective:'next_invoice', requestId:req.body.requestId,
          })
          results.push({ storeId:row.store_id,status:'updated',fromCents:currentPrice.unit_amount,toCents:target.amountCents })
        } catch (error) {
          // The Stripe error is intentionally not returned verbatim.
          console.error('[stripe-repricing] store failed:', row.store_id, error?.status || error?.code || 'validation')
          results.push({ storeId:row.store_id,status:'failed',reason:'Não foi possível validar ou atualizar a assinatura; consulte os logs.' })
        }
      }
      res.json({ planCode:code, results, updated:results.filter(r=>r.status==='updated').length,
        unchanged:results.filter(r=>r.status==='unchanged').length,
        failed:results.filter(r=>r.status==='failed').length,
        effective:'next_invoice', immediateCharge:false })
    } finally {
      if (locked) await client.query('SELECT pg_advisory_unlock(hashtext($1))',['shopvax-billing-reprice:'+code]).catch(()=>undefined)
      client.release()
    }
  }))
}
