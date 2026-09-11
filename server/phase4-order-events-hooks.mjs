import crypto from 'node:crypto'
import express from 'express'
import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 3, connectionTimeoutMillis: 5000 }) : null
const integrationSecret = process.env.SHOPVAX_INTEGRATION_SECRET || ''

if (pool) pool.on('error', (error) => console.error('[phase4 order events] pool:', error.message))

const id = () => crypto.randomUUID()
const money = (value) => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0
}

function decryptSecret(value) {
  if (!value || !integrationSecret) return ''
  try {
    const [version, ivRaw, tagRaw, encryptedRaw] = String(value).split('.')
    if (version !== 'v1' || !ivRaw || !tagRaw || !encryptedRaw) return ''
    const key = crypto.createHash('sha256').update(integrationSecret).digest()
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivRaw, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(encryptedRaw, 'base64url')), decipher.final()]).toString('utf8')
  } catch { return '' }
}

async function webhookTablesReady() {
  if (!pool) return false
  const result = await pool.query(`SELECT to_regclass('public.erp_webhooks') AS hooks,to_regclass('public.erp_webhook_deliveries') AS deliveries`)
  return Boolean(result.rows[0]?.hooks && result.rows[0]?.deliveries)
}

async function dispatchOrderCreated(order) {
  if (!pool || !(await webhookTablesReady())) return
  const targets = await pool.query(`
    SELECT w.* FROM erp_webhooks w
    JOIN store_phase4_integrations i ON i.store_id=w.store_id
    WHERE w.store_id=$1 AND w.active=true AND i.erp_api_enabled=true
  `, [order.store_id])
  for (const target of targets.rows) {
    if (!Array.isArray(target.events) || !target.events.includes('order.created')) continue
    const secret = decryptSecret(target.secret_encrypted)
    if (!secret) continue
    const payload = {
      id: id(),
      event: 'order.created',
      createdAt: new Date().toISOString(),
      data: {
        orderId: order.id,
        code: order.code,
        total: Number(order.total || 0),
        customerId: order.customer_id || null,
        sellerId: order.seller_id || null,
        catalogId: order.catalog_id || null,
        items: Array.isArray(order.items) ? order.items : [],
      },
    }
    const body = JSON.stringify(payload)
    const signature = crypto.createHmac('sha256', secret).update(body).digest('hex')
    let status = 'failed'
    let responseStatus = null
    let errorText = ''
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      try {
        const response = await fetch(target.url, {
          method: 'POST', signal: controller.signal,
          headers: { 'content-type': 'application/json', 'x-shopvax-event': 'order.created', 'x-shopvax-signature': `sha256=${signature}` },
          body,
        })
        responseStatus = response.status
        status = response.ok ? 'delivered' : 'failed'
        if (!response.ok) errorText = `HTTP ${response.status}`
      } finally { clearTimeout(timeout) }
    } catch (error) { errorText = error instanceof Error ? error.message : String(error) }
    await pool.query(`
      INSERT INTO erp_webhook_deliveries(id,store_id,webhook_id,event_type,status,response_status,error)
      VALUES ($1,$2,$3,'order.created',$4,$5,$6)
    `, [id(), order.store_id, target.id, status, responseStatus, errorText.slice(0, 500)]).catch(() => undefined)
  }
}

async function enrichOrderPayload(payload) {
  if (!pool || !payload?.orderId) return payload
  const result = await pool.query(`
    SELECT id,code,store_id,seller_id,catalog_id,customer_id,total,items,status,
      COALESCE(shipping_method,'') AS shipping_method,
      COALESCE(shipping_amount,0) AS shipping_amount,
      COALESCE(payment_status,'none') AS payment_status
    FROM orders WHERE id=$1 LIMIT 1
  `, [payload.orderId]).catch(() => ({ rows: [] }))
  const order = result.rows[0]
  if (!order) return payload
  void dispatchOrderCreated(order).catch((error) => console.error('[phase4 order events] webhook:', error.message))
  const total = Number(order.total || 0)
  const shippingAmount = Number(order.shipping_amount || 0)
  return {
    ...payload,
    total: payload.total == null ? total : Number(payload.total),
    shippingAmount,
    grandTotal: money((payload.total == null ? total : Number(payload.total)) + shippingAmount),
    paymentStatus: order.payment_status || 'none',
  }
}

function install(app) {
  if (app.__shopvaxPhase4OrderEventsInstalled) return
  app.__shopvaxPhase4OrderEventsInstalled = true
  app.post('/api/business/orders', express.json({ limit: '256kb' }), (req, res, next) => {
    const originalJson = res.json.bind(res)
    res.json = (payload) => {
      if (res.statusCode !== 201 || !payload?.orderId) return originalJson(payload)
      Promise.resolve(enrichOrderPayload(payload))
        .then((nextPayload) => originalJson(nextPayload))
        .catch((error) => {
          console.error('[phase4 order events] enrich:', error.message)
          originalJson(payload)
        })
      return res
    }
    next()
  })
}

const previousInit = express.application.init
express.application.init = function phase4OrderEventsInit(...args) {
  const result = previousInit.apply(this, args)
  install(this)
  return result
}
