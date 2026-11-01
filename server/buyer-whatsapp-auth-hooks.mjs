import crypto from 'node:crypto'
import express from 'express'
import pg from 'pg'

// Serviço independente: jamais modifica o webhook da central, o Chatwoot ou o n8n.
const pool = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 }) : null
const COOKIE = 'shopvax_buyer_session'
const LEGACY_COOKIE = 'shopvax_customer_session'
const enabled = () => process.env.SHOPVAX_BUYER_WHATSAPP_LOGIN === '1'
export const buyerWhatsappReady = () => enabled() && /^https:\/\//.test(process.env.UAZAPI_BASE_URL || '') &&
  Boolean(process.env.UAZAPI_INSTANCE_TOKEN) && (process.env.SHOPVAX_OTP_HMAC_SECRET || '').length >= 32
const mac = (value) => crypto.createHmac('sha256', process.env.SHOPVAX_OTP_HMAC_SECRET).update(value).digest('hex')
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')
const uuid = () => crypto.randomUUID()
const digits = (v) => String(v ?? '').replace(/\D/g, '')
export function normalizeBuyerPhone(value) {
  if (String(value ?? '').trim().startsWith('+') && !String(value).trim().startsWith('+55')) return null
  const raw = digits(value)
  const phone = raw.startsWith('55') && raw.length >= 12 ? raw : '55' + raw
  return /^55\d{10,11}$/.test(phone) ? phone : null
}
const purposes = new Set(['revenda', 'pessoal', 'ambos', 'futuro'])
const channelsAllowed = new Set(['loja', 'virtual', 'social', 'whatsapp', 'market', 'autonomo', 'outros'])
const businesses = new Set(['sim', 'nao', 'abrindo'])
const cnpjStatuses = new Set(['sim', 'nao', 'processo'])
const clean = (v, max) => String(v ?? '').trim().slice(0, max)
function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map(v => v.trim()).filter(Boolean).map(v => {
    const index = v.indexOf('=')
    return [v.slice(0, index), v.slice(index + 1)]
  }))
}
const opts = (req) => ({ httpOnly: true, sameSite: 'lax', secure: req.secure || req.headers['x-forwarded-proto'] === 'https', path: '/', maxAge: 30 * 86400000 })
const fail = (res, status, error) => res.status(status).json({ error })
const noCache = (_req, res, next) => { res.set('Cache-Control', 'no-store, private'); next() }
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
let schemaPromise
async function schema() {
  if (!pool) throw new Error('DATABASE_URL indisponível')
  if (!schemaPromise) schemaPromise = (async () => {
    for (let i = 0; i < 100; i++) {
      const r = await pool.query("SELECT to_regclass('public.store_customers') AS customers, to_regclass('public.stores') AS stores")
      if (r.rows[0]?.customers && r.rows[0]?.stores) break
      if (i === 99) throw new Error('Schema de clientes ainda não disponível')
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    await pool.query([
      "CREATE TABLE IF NOT EXISTS buyer_accounts (id text PRIMARY KEY, phone text UNIQUE NOT NULL, name text NOT NULL DEFAULT '', email text NOT NULL DEFAULT '', city text NOT NULL DEFAULT '', state text NOT NULL DEFAULT '', purpose text NOT NULL DEFAULT '', business_status text NOT NULL DEFAULT '', business_name text NOT NULL DEFAULT '', cnpj text NOT NULL DEFAULT '', cnpj_status text NOT NULL DEFAULT '', segment text NOT NULL DEFAULT '', instagram text NOT NULL DEFAULT '', channels jsonb NOT NULL DEFAULT '[]'::jsonb, profile_completed boolean NOT NULL DEFAULT false, marketing_consent boolean NOT NULL DEFAULT false, privacy_accepted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())",
      'CREATE TABLE IF NOT EXISTS buyer_sessions (token_hash text PRIMARY KEY, buyer_id text NOT NULL REFERENCES buyer_accounts(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now())',
      'CREATE INDEX IF NOT EXISTS idx_buyer_sessions_lookup ON buyer_sessions(buyer_id,expires_at DESC)',
      'CREATE TABLE IF NOT EXISTS buyer_otp_challenges (id text PRIMARY KEY, phone text NOT NULL, code_mac text NOT NULL, expires_at timestamptz NOT NULL, attempts integer NOT NULL DEFAULT 0, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now())',
      'CREATE INDEX IF NOT EXISTS idx_buyer_otp_phone ON buyer_otp_challenges(phone,created_at DESC)',
      'CREATE TABLE IF NOT EXISTS buyer_otp_requests (id text PRIMARY KEY, phone_mac text NOT NULL, ip_mac text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())',
      'CREATE INDEX IF NOT EXISTS idx_buyer_otp_phone_rate ON buyer_otp_requests(phone_mac,created_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_buyer_otp_ip_rate ON buyer_otp_requests(ip_mac,created_at DESC)',
      'ALTER TABLE store_customers ADD COLUMN IF NOT EXISTS buyer_account_id text REFERENCES buyer_accounts(id) ON DELETE SET NULL',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_store_customer_buyer_unique ON store_customers(store_id,buyer_account_id) WHERE buyer_account_id IS NOT NULL',
    ].join(';') + ';')
  })().finally(() => { schemaPromise = null })
  return schemaPromise
}
const publicBuyer = (b) => b ? ({
  id: b.id, phone: b.phone, name: b.name, email: b.email, city: b.city, state: b.state,
  purpose: b.purpose, businessStatus: b.business_status, businessName: b.business_name,
  cnpj: b.cnpj, cnpjStatus: b.cnpj_status, segment: b.segment, instagram: b.instagram,
  channels: b.channels, profileCompleted: b.profile_completed, marketingConsent: b.marketing_consent,
}) : null
async function buyer(req, client = pool) {
  const token = cookies(req)[COOKIE]
  if (!token) return null
  const r = await client.query('SELECT b.* FROM buyer_sessions s JOIN buyer_accounts b ON b.id=s.buyer_id WHERE s.token_hash=$1 AND s.expires_at>now() LIMIT 1', [sha(token)])
  return r.rows[0] || null
}
async function store(slug) {
  const r = await pool.query('SELECT id FROM stores WHERE slug=$1 AND is_active=true AND customer_login_enabled=true LIMIT 1', [String(slug || '')])
  return r.rows[0] || null
}
async function deliver(phone, code, trackingId) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(new URL('/send/text', process.env.UAZAPI_BASE_URL), {
      method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', token: process.env.UAZAPI_INSTANCE_TOKEN },
      body: JSON.stringify({
        number: phone, text: 'ShopVax: seu código de verificação é ' + code + '. Válido por 5 minutos. Não compartilhe.',
        track_source: 'shopvax_auth', track_id: trackingId, async: false,
      }),
    })
    if (!response.ok) throw new Error('UAZAPI indisponível')
  } finally { clearTimeout(timeout) }
}
async function requestCode(req, res) {
  if (!buyerWhatsappReady()) return fail(res, 503, 'Verificação indisponível.')
  const phone = normalizeBuyerPhone(req.body?.phone)
  if (!phone) return fail(res, 400, 'Informe um WhatsApp brasileiro válido com DDD.')
  await schema()
  if (!await store(req.body?.storeSlug)) return fail(res, 404, 'Loja não encontrada.')
  const phoneMac = mac('rate-phone:' + phone), ipMac = mac('rate-ip:' + req.ip)
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0')
  const challengeId = uuid()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [phoneMac])
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['ip:' + ipMac])
    const count = await client.query("SELECT (SELECT count(*)::int FROM buyer_otp_requests WHERE phone_mac=$1 AND created_at>now()-interval '15 minutes') AS phone_count, (SELECT count(*)::int FROM buyer_otp_requests WHERE ip_mac=$2 AND created_at>now()-interval '1 hour') AS ip_count", [phoneMac, ipMac])
    if (count.rows[0].phone_count >= 3 || count.rows[0].ip_count >= 20) {
      await client.query('ROLLBACK')
      return fail(res, 429, 'Muitas solicitações. Tente mais tarde.')
    }
    const last = await client.query('SELECT created_at FROM buyer_otp_requests WHERE phone_mac=$1 ORDER BY created_at DESC LIMIT 1', [phoneMac])
    if (last.rowCount && Date.now() - new Date(last.rows[0].created_at).getTime() < 60000) {
      await client.query('ROLLBACK')
      return fail(res, 429, 'Aguarde 60 segundos antes de reenviar.')
    }
    await client.query('UPDATE buyer_otp_challenges SET consumed_at=now() WHERE phone=$1 AND consumed_at IS NULL', [phone])
    await client.query("INSERT INTO buyer_otp_challenges(id,phone,code_mac,expires_at) VALUES($1,$2,$3,now()+interval '5 minutes')", [challengeId, phone, mac(challengeId + ':' + phone + ':' + code)])
    await client.query('INSERT INTO buyer_otp_requests(id,phone_mac,ip_mac) VALUES($1,$2,$3)', [uuid(),phoneMac,ipMac])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally { client.release() }
  try { await deliver(phone, code, challengeId) }
  catch {
    await pool.query('UPDATE buyer_otp_challenges SET consumed_at=now() WHERE id=$1', [challengeId])
    return fail(res, 503, 'Não foi possível enviar o código agora.')
  }
  return res.json({ ok: true, expiresInSeconds: 300, resendAfterSeconds: 60 })
}
async function verifyCode(req, res) {
  if (!buyerWhatsappReady()) return fail(res, 503, 'Verificação indisponível.')
  const phone = normalizeBuyerPhone(req.body?.phone), code = String(req.body?.code ?? '')
  if (!phone || !/^\d{6}$/.test(code)) return fail(res, 400, 'Telefone ou código inválido.')
  await schema()
  if (!await store(req.body?.storeSlug)) return fail(res, 404, 'Loja não encontrada.')
  const token = crypto.randomBytes(32).toString('base64url')
  const client = await pool.connect()
  let account
  try {
    await client.query('BEGIN')
    const result = await client.query('SELECT * FROM buyer_otp_challenges WHERE phone=$1 AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE', [phone])
    const challenge = result.rows[0]
    if (!challenge || new Date(challenge.expires_at).getTime() <= Date.now() || challenge.attempts >= 5) {
      await client.query('ROLLBACK')
      return fail(res, 401, 'Código inválido ou expirado.')
    }
    const received = Buffer.from(mac(challenge.id + ':' + phone + ':' + code), 'hex')
    const expected = Buffer.from(challenge.code_mac, 'hex')
    if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
      await client.query('UPDATE buyer_otp_challenges SET attempts=attempts+1 WHERE id=$1', [challenge.id])
      await client.query('COMMIT')
      return fail(res, 401, 'Código incorreto ou expirado.')
    }
    await client.query('UPDATE buyer_otp_challenges SET consumed_at=now() WHERE id=$1', [challenge.id])
    const saved = await client.query('INSERT INTO buyer_accounts(id,phone) VALUES($1,$2) ON CONFLICT(phone) DO UPDATE SET updated_at=buyer_accounts.updated_at RETURNING *', [uuid(),phone])
    account = saved.rows[0]
    await client.query("INSERT INTO buyer_sessions(token_hash,buyer_id,expires_at) VALUES($1,$2,now()+interval '30 days')", [sha(token),account.id])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally { client.release() }
  res.cookie(COOKIE, token, opts(req))
  return res.json({ ok: true, needsProfile: !account.profile_completed, buyer: publicBuyer(account) })
}
function profileFields(body) {
  const name = clean(body?.name, 120), email = clean(body?.email, 240).toLowerCase(), purpose = String(body?.purpose || '')
  if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !purposes.has(purpose) || body?.privacyAccepted !== true)
    return { error: 'Informe nome, e-mail, finalidade e aceite a política de privacidade.' }
  const personal = purpose === 'pessoal'
  const businessStatus = personal ? '' : String(body?.businessStatus || '')
  const cnpjStatus = personal ? '' : String(body?.cnpjStatus || '')
  if (!personal && (!businesses.has(businessStatus) || !cnpjStatuses.has(cnpjStatus)))
    return { error: 'Informe a situação do negócio e do CNPJ.' }
  const channels = personal ? [] : Array.isArray(body?.channels) ? [...new Set(body.channels)].filter(v => channelsAllowed.has(v)).slice(0, 7) : []
  const cnpj = cnpjStatus === 'sim' ? digits(body?.cnpj).slice(0, 14) : ''
  if (cnpj && cnpj.length !== 14) return { error: 'CNPJ deve ter 14 dígitos.' }
  return {
    name, email, purpose, businessStatus, cnpjStatus, cnpj, channels,
    businessName: personal ? '' : clean(body?.businessName, 160),
    city: clean(body?.city, 100), state: clean(body?.state, 2).toUpperCase(),
    segment: personal ? '' : clean(body?.segment, 100), instagram: personal ? '' : clean(body?.instagram, 100),
    marketingConsent: body?.marketingConsent === true,
  }
}
async function saveProfile(req,res) {
  if (!buyerWhatsappReady()) return fail(res, 503, 'Serviço indisponível.')
  await schema()
  const account = await buyer(req)
  if (!account) return fail(res, 401, 'Verifique seu WhatsApp para continuar.')
  const f = profileFields(req.body)
  if (f.error) return fail(res, 400, f.error)
  const updated = await pool.query('UPDATE buyer_accounts SET name=$1,email=$2,purpose=$3,business_status=$4,cnpj_status=$5,cnpj=$6,channels=$7::jsonb,business_name=$8,city=$9,state=$10,segment=$11,instagram=$12,marketing_consent=$13,profile_completed=true,privacy_accepted_at=COALESCE(privacy_accepted_at,now()),updated_at=now() WHERE id=$14 RETURNING *',
    [f.name,f.email,f.purpose,f.businessStatus,f.cnpjStatus,f.cnpj,JSON.stringify(f.channels),f.businessName,f.city,f.state,f.segment,f.instagram,f.marketingConsent,account.id])
  await pool.query('UPDATE store_customers SET name=$1,phone=$2,updated_at=now() WHERE buyer_account_id=$3', [f.name,account.phone,account.id])
  return res.json({ ok: true, buyer: publicBuyer(updated.rows[0]) })
}
export async function currentBuyerCustomer(req,storeId) {
  if (!buyerWhatsappReady() || !storeId || !cookies(req)[COOKIE]) return null
  await schema()
  const account = await buyer(req)
  if (!account?.profile_completed) return null
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [account.id + ':' + storeId])
    let result = await client.query('SELECT id FROM store_customers WHERE store_id=$1 AND buyer_account_id=$2 LIMIT 1', [storeId,account.id])
    if (!result.rowCount) {
      // Associar legado somente pelo telefone previamente verificado.
      const legacy = await client.query("SELECT id FROM store_customers WHERE store_id=$1 AND CASE WHEN length(regexp_replace(phone,'[^0-9]','','g')) IN (10,11) THEN '55'||regexp_replace(phone,'[^0-9]','','g') ELSE regexp_replace(phone,'[^0-9]','','g') END=$2 AND buyer_account_id IS NULL ORDER BY created_at ASC LIMIT 1 FOR UPDATE", [storeId,account.phone])
      if (legacy.rowCount) {
        result = await client.query('UPDATE store_customers SET buyer_account_id=$1,name=$2,updated_at=now() WHERE id=$3 RETURNING id', [account.id,account.name,legacy.rows[0].id])
      } else {
        const customerId = uuid()
        const collision = await client.query('SELECT 1 FROM store_customers WHERE store_id=$1 AND email=$2 LIMIT 1', [storeId,account.email])
        const storedEmail = collision.rowCount ? 'buyer+' + customerId + '@shopvax.invalid' : account.email
        result = await client.query("INSERT INTO store_customers(id,store_id,name,email,phone,password_hash,buyer_account_id) VALUES($1,$2,$3,$4,$5,'',$6) RETURNING id", [customerId,storeId,account.name,storedEmail,account.phone,account.id])
      }
    }
    await client.query('COMMIT')
    return { id: result.rows[0].id,store_id:storeId,name:account.name,email:account.email,phone:account.phone,buyer_account_id:account.id }
  } catch(error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally { client.release() }
}
export async function buyerProfilesForStore(storeId) {
  if (!buyerWhatsappReady()) return []
  await schema()
  const r = await pool.query('SELECT c.id AS customer_id,b.purpose,b.business_status,b.business_name,b.cnpj_status,b.segment,b.channels FROM store_customers c JOIN buyer_accounts b ON b.id=c.buyer_account_id WHERE c.store_id=$1', [storeId])
  return r.rows
}
async function me(req,res) {
  if (!buyerWhatsappReady()) return fail(res,503,'Serviço indisponível.')
  await schema()
  const account = await buyer(req)
  if (!account) return fail(res,401,'Entre com seu WhatsApp.')
  return res.json({ buyer: publicBuyer(account) })
}
async function logout(req,res,next) {
  if (!cookies(req)[COOKIE]) return next()
  if (!pool) return fail(res,503,'Sessão indisponível.')
  await schema()
  const old = cookies(req)[LEGACY_COOKIE]
  if (old) await pool.query('DELETE FROM store_customer_sessions WHERE token_hash=$1',[sha(old)])
  await pool.query('DELETE FROM buyer_sessions WHERE token_hash=$1',[sha(cookies(req)[COOKIE])])
  res.clearCookie(COOKIE,opts(req))
  res.clearCookie(LEGACY_COOKIE,opts(req))
  return res.json({ok:true})
}
function install(app) {
  if (app.__shopvaxBuyerWhatsappAuthInstalled) return
  app.__shopvaxBuyerWhatsappAuthInstalled = true
  app.get('/api/public/buyer-auth/config',noCache,(_req,res)=>res.json({enabled:buyerWhatsappReady()}))
  app.post('/api/public/buyer-auth/request-code',express.json({limit:'8kb'}),noCache,wrap(requestCode))
  app.post('/api/public/buyer-auth/verify-code',express.json({limit:'8kb'}),noCache,wrap(verifyCode))
  app.get('/api/public/buyer-auth/me',noCache,wrap(me))
  app.put('/api/public/buyer-auth/profile',express.json({limit:'16kb'}),noCache,wrap(saveProfile))
  app.post('/api/public/customers/logout',noCache,wrap(logout))
}
const previousInit = express.application.init
express.application.init = function buyerWhatsappInit(...args) {
  const result=previousInit.apply(this,args)
  install(this)
  return result
}
