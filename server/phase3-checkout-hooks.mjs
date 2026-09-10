import crypto from 'node:crypto'
import express from 'express'
import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 4, connectionTimeoutMillis: 5000 }) : null
const visitorCookie = 'atacado_public'

if (pool) pool.on('error', (error) => console.error('[phase3 checkout] pool:', error.message))

const hash = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex')
const digits = (value) => String(value || '').replace(/\D/g, '')
const money = (value) => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0
}
const codeOf = (value) => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 30)

function parseCookies(req) {
  const header = req.headers.cookie || ''
  return Object.fromEntries(header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=')
    return index < 0 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))]
  }))
}

function visitorKey(req) {
  const token = parseCookies(req)[visitorCookie]
  if (token) return hash(`visitor:${token}`).slice(0, 40)
  return hash(`fallback:${req.ip || ''}:${req.headers['user-agent'] || ''}`).slice(0, 40)
}

let readyPromise = null
async function ready() {
  if (!pool) throw new Error('DATABASE_URL não configurada.')
  if (!readyPromise) {
    readyPromise = (async () => {
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const result = await pool.query(`SELECT
          to_regclass('public.coupons') AS coupons,
          to_regclass('public.cart_recoveries') AS carts,
          to_regclass('public.orders') AS orders,
          to_regclass('public.catalogs') AS catalogs`)
        const row = result.rows[0] || {}
        if (row.coupons && row.carts && row.orders && row.catalogs) return
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      throw new Error('Schema da Fase 3 não ficou pronto para checkout.')
    })().catch((error) => { readyPromise = null; throw error })
  }
  return readyPromise
}

function usable(coupon) {
  if (!coupon || !coupon.active) return { ok: false, error: 'Cupom inválido ou inativo.' }
  const now = Date.now()
  if (coupon.starts_at && new Date(coupon.starts_at).getTime() > now) return { ok: false, error: 'Este cupom ainda não está válido.' }
  if (coupon.expires_at && new Date(coupon.expires_at).getTime() <= now) return { ok: false, error: 'Este cupom expirou.' }
  if (coupon.max_uses != null && Number(coupon.used_count || 0) >= Number(coupon.max_uses)) return { ok: false, error: 'Este cupom atingiu o limite de usos.' }
  return { ok: true }
}

async function reserveCoupon(storeSlug, rawCode) {
  const code = codeOf(rawCode)
  if (!code) return null
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const store = await client.query('SELECT id FROM stores WHERE slug=$1 AND is_active=true LIMIT 1', [storeSlug])
    if (!store.rowCount) {
      await client.query('ROLLBACK')
      return { error: 'Loja não encontrada.', status: 404 }
    }
    const result = await client.query('SELECT * FROM coupons WHERE store_id=$1 AND code=$2 FOR UPDATE', [store.rows[0].id, code])
    const coupon = result.rows[0]
    const check = usable(coupon)
    if (!check.ok) {
      await client.query('ROLLBACK')
      return { error: check.error, status: 400 }
    }
    await client.query('UPDATE coupons SET used_count=used_count+1,updated_at=now() WHERE id=$1', [coupon.id])
    await client.query('COMMIT')
    return { ...coupon, used_count: Number(coupon.used_count || 0) + 1, reserved: true }
  } catch (error) {
    try { await client.query('ROLLBACK') } catch {}
    throw error
  } finally { client.release() }
}

async function releaseCoupon(couponId) {
  if (!couponId) return
  await pool.query('UPDATE coupons SET used_count=GREATEST(0,used_count-1),updated_at=now() WHERE id=$1', [couponId]).catch(() => undefined)
}

function discountFor(coupon, subtotal) {
  const value = Number(coupon?.value || 0)
  const raw = coupon?.discount_type === 'fixed' ? value : subtotal * value / 100
  return Math.max(0, Math.min(subtotal, money(raw)))
}

function buildMessage(order, store, seller, catalog, subtotal, discount, total, coupon) {
  const formatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
  const items = Array.isArray(order.items) ? order.items : []
  const lines = items.map((item) => {
    const selections = item?.selections && typeof item.selections === 'object'
      ? Object.entries(item.selections).map(([key, value]) => `${key}: ${value}`).join(' · ')
      : ''
    return `${Number(item.quantity || 0)}x ${item.name || 'Produto'}${selections ? ` (${selections})` : ''} — ${formatter.format(Number(item.lineTotal || 0))}`
  })
  return [
    `Olá! Montei este pedido na ${store.name}:`,
    catalog?.name ? `Catálogo: ${catalog.name}` : '',
    '',
    ...lines,
    '',
    `Subtotal: ${formatter.format(subtotal)}`,
    discount > 0 ? `Cupom ${coupon.code}: -${formatter.format(discount)}` : '',
    `Total dos produtos: ${formatter.format(total)}`,
    `Pedido: ${order.code}`,
    '',
    `Quero finalizar com ${seller?.name || 'atendimento'}.`,
  ].filter((line, index, linesAll) => line !== '' || (index > 0 && linesAll[index - 1] !== '')).join('\n')
}

async function convertRecovery(req, order) {
  await pool.query(`
    UPDATE cart_recoveries SET state='converted',order_id=$1,updated_at=now()
    WHERE store_id=$2 AND visitor_key=$3 AND state='active'
  `, [order.id, order.store_id, visitorKey(req)]).catch(() => undefined)
}

async function finalize(req, payload, coupon) {
  if (!payload?.orderId) return payload
  const orderResult = await pool.query('SELECT * FROM orders WHERE id=$1 LIMIT 1', [payload.orderId])
  if (!orderResult.rowCount) return payload
  const order = orderResult.rows[0]
  await convertRecovery(req, order)
  if (!coupon?.reserved) return payload

  const subtotal = money(order.total)
  if (subtotal < Number(coupon.minimum_subtotal || 0)) {
    await releaseCoupon(coupon.id)
    return { ...payload, couponRejected: true, couponError: `Este cupom exige subtotal mínimo de R$ ${Number(coupon.minimum_subtotal || 0).toFixed(2).replace('.', ',')}.` }
  }
  const discount = discountFor(coupon, subtotal)
  const total = money(subtotal - discount)
  await pool.query('UPDATE orders SET subtotal=$1,discount=$2,total=$3,coupon_id=$4,coupon_code=$5 WHERE id=$6', [subtotal, discount, total, coupon.id, coupon.code, order.id])

  const [storeResult, sellerResult, catalogResult] = await Promise.all([
    pool.query('SELECT name,whatsapp FROM stores WHERE id=$1 LIMIT 1', [order.store_id]),
    order.seller_id ? pool.query('SELECT name,phone FROM sellers WHERE id=$1 LIMIT 1', [order.seller_id]) : Promise.resolve({ rows: [] }),
    order.catalog_id ? pool.query('SELECT name FROM catalogs WHERE id=$1 LIMIT 1', [order.catalog_id]) : Promise.resolve({ rows: [] }),
  ])
  const store = storeResult.rows[0] || { name: 'Loja', whatsapp: '' }
  const seller = sellerResult.rows[0] || null
  const catalog = catalogResult.rows[0] || null
  const phone = digits(seller?.phone || store.whatsapp)
  const message = buildMessage(order, store, seller, catalog, subtotal, discount, total, coupon)
  return {
    ...payload,
    subtotal,
    discount,
    total,
    couponCode: coupon.code,
    whatsappUrl: phone.length >= 10 ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}` : payload.whatsappUrl,
  }
}

async function callCoreOrder(req) {
  const port = Number(process.env.PORT || 80)
  const body = { ...(req.body || {}) }
  delete body.couponCode
  const headers = {
    'content-type': 'application/json',
    'user-agent': String(req.headers['user-agent'] || 'ShopVaxPhase3Checkout'),
  }
  if (req.headers.cookie) headers.cookie = String(req.headers.cookie)
  if (req.headers.referer) headers.referer = String(req.headers.referer)
  if (req.headers['x-forwarded-for']) headers['x-forwarded-for'] = String(req.headers['x-forwarded-for'])
  return fetch(`http://127.0.0.1:${port}/api/business/orders`, { method: 'POST', headers, body: JSON.stringify(body) })
}

async function checkout(req, res) {
  await ready()
  const storeSlug = String(req.body?.storeSlug || '')
  const coupon = req.body?.couponCode ? await reserveCoupon(storeSlug, req.body.couponCode) : null
  if (coupon?.error) return res.status(coupon.status || 400).json({ error: coupon.error, code: 'COUPON_INVALID' })

  let coreResponse
  try { coreResponse = await callCoreOrder(req) }
  catch (error) {
    if (coupon?.reserved) await releaseCoupon(coupon.id)
    throw error
  }
  const text = await coreResponse.text()
  let payload = null
  try { payload = text ? JSON.parse(text) : null } catch { payload = { error: text || 'Falha no checkout.' } }
  if (!coreResponse.ok) {
    if (coupon?.reserved) await releaseCoupon(coupon.id)
    return res.status(coreResponse.status).json(payload)
  }
  try {
    const finalPayload = await finalize(req, payload, coupon)
    return res.status(coreResponse.status).json(finalPayload)
  } catch (error) {
    if (coupon?.reserved) await releaseCoupon(coupon.id)
    console.error('[phase3 checkout] finalize:', error.message)
    return res.status(500).json({ error: 'O pedido foi criado, mas não foi possível finalizar o benefício aplicado. Confira o pedido antes de tentar novamente.', orderId: payload?.orderId || null })
  }
}

function install(app) {
  if (app.__shopvaxPhase3CheckoutInstalled) return
  app.__shopvaxPhase3CheckoutInstalled = true
  app.post('/api/business/orders/phase3', express.json({ limit: '256kb' }), (req, res, next) => Promise.resolve(checkout(req, res)).catch(next))
}

const previousInit = express.application.init
express.application.init = function phase3CheckoutInit(...args) {
  const result = previousInit.apply(this, args)
  install(this)
  return result
}
