import crypto from 'node:crypto'
import { promisify } from 'node:util'
import { normalizeBuyerDocument, isValidBuyerDocument } from './buyer-document.mjs'

// Credentials are bound to the globally unique buyer account, never to a store.
// An unverified phone is a contact field, NOT proof that the caller owns legacy
// accounts or previously-registered store customer records.
const scrypt = promisify(crypto.scrypt)
const HASH_BYTES = 64
const MIN_PASSWORD = 10
const MAX_PASSWORD = 128
const token = () => crypto.randomBytes(32).toString('base64url')
const sha = value => crypto.createHash('sha256').update(value).digest('hex')
const normalPhone = value => {
  if (String(value ?? '').trim().startsWith('+') && !String(value).trim().startsWith('+55')) return null
  const numbers = String(value ?? '').replace(/\D/g, '')
  const phone = numbers.startsWith('55') && numbers.length >= 12 ? numbers : '55' + numbers
  return /^55\d{10,11}$/.test(phone) ? phone : null
}
const validPassword = value => typeof value === 'string' &&
  value.length >= MIN_PASSWORD && value.length <= MAX_PASSWORD
const fail = (res, status, error) => res.status(status).json({ error })
const wrap = handler => (req,res,next) => Promise.resolve(handler(req,res)).catch(next)
const allowedOrigin = req => {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    const url = new URL(origin)
    return url.protocol === 'https:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1'
      ? url.host === req.headers.host : false
  } catch { return false }
}

export async function hashBuyerPassword(password) {
  if (!validPassword(password)) throw new Error('Senha deve ter entre 10 e 128 caracteres.')
  const salt = crypto.randomBytes(16).toString('hex')
  const derived = await scrypt(password, Buffer.from(salt,'hex'), HASH_BYTES)
  return 'scrypt-v1$' + salt + '$' + derived.toString('hex')
}

export async function verifyBuyerPassword(password, stored) {
  if (typeof password !== 'string' || !stored || typeof stored !== 'string') return false
  const [type, salt, digest] = stored.split('$')
  if (type !== 'scrypt-v1' || !/^[a-f0-9]{32}$/i.test(salt || '') ||
      !/^[a-f0-9]{128}$/i.test(digest || '') || password.length > MAX_PASSWORD) return false
  const actual = await scrypt(password, Buffer.from(salt,'hex'), HASH_BYTES)
  const expected = Buffer.from(digest, 'hex')
  return crypto.timingSafeEqual(actual,expected)
}

export function installBuyerPasswordRoutes(app, { pool, ensureSchema, publicBuyer, cookieOptions, getBuyer }) {
  if (app.__shopvaxBuyerPasswordInstalled) return
  app.__shopvaxBuyerPasswordInstalled = true
  const ready = Boolean(pool)

  // Rate limit is persisted in PostgreSQL so requests across replicas count
  // toward the same quota. Never trust an incoming phone as proof of identity.
  const rate = async (req, kind, phone) => {
    const ip = String(req.ip || req.socket?.remoteAddress || '').slice(0,120)
    const keys = [
      { key: sha('buyer-password:'+kind+':ip:'+ip), max: kind==='register'?8:25 },
      { key: sha('buyer-password:'+kind+':phone:'+phone), max: kind==='register'?5:12 },
    ].sort((a,b)=>a.key.localeCompare(b.key))
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      for (const {key,max} of keys) {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[key])
        const count = await client.query("SELECT count(*)::int AS n FROM buyer_password_attempts WHERE key_hash=$1 AND created_at>now()-interval '1 hour'",[key])
        if (Number(count.rows[0]?.n || 0)>=max) {
          await client.query('ROLLBACK')
          return false
        }
      }
      for (const {key} of keys) {
        await client.query('INSERT INTO buyer_password_attempts(id,key_hash) VALUES($1,$2)',[crypto.randomUUID(),key])
      }
      await client.query('COMMIT')
      return true
    } catch (err) {
      await client.query('ROLLBACK').catch(()=>undefined)
      throw err
    } finally { client.release() }
  }
  const issueSession = async (req,res,buyer) => {
    const sessionToken = token()
    await pool.query("INSERT INTO buyer_sessions(token_hash,buyer_id,expires_at) VALUES($1,$2,now()+interval '30 days')",[sha(sessionToken),buyer.id])
    res.cookie('shopvax_buyer_session',sessionToken,cookieOptions(req))
  }

  const register = async (req,res) => {
    if (!ready) return fail(res,503,'Cadastro temporariamente indisponível.')
    if (!allowedOrigin(req)) return fail(res,403,'Origem não autorizada.')
    const phone = normalPhone(req.body?.phone)
    const name = String(req.body?.name ?? '').trim().slice(0,120)
    const document = normalizeBuyerDocument(req.body?.document)
    const password = req.body?.password
    if (!phone) return fail(res,400,'Informe um telefone brasileiro válido com DDD.')
    if (name.length<2) return fail(res,400,'Informe seu nome completo.')
    if (!isValidBuyerDocument(document)) return fail(res,400,'Informe um CPF ou CNPJ válido.')
    if (!validPassword(password)) return fail(res,400,'Crie uma senha com 10 a 128 caracteres.')
    await ensureSchema()
    if (!(await rate(req,'register',phone))) return fail(res,429,'Muitas tentativas. Tente novamente mais tarde.')
    const passwordHash = await hashBuyerPassword(password)
    const id = crypto.randomUUID()
    const client = await pool.connect()
    let account
    try {
      await client.query('BEGIN')
      const saved = await client.query(
        "INSERT INTO buyer_accounts(id,phone,name,document,cnpj,cnpj_status,profile_completed,phone_verified) VALUES($1,$2,$3,$4,$5,$6,true,false) RETURNING *",
        [id,phone,name,document,document.length===14?document:'',document.length===14?'sim':''],
      )
      account = saved.rows[0]
      await client.query('INSERT INTO buyer_password_credentials(buyer_id,password_hash) VALUES($1,$2)',[id,passwordHash])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(()=>undefined)
      if (error?.code === '23505') {
        return fail(res,409,'Já existe uma conta com este telefone. Entre com sua senha. Se você usava código, solicite ajuda para migrar seu acesso.')
      }
      throw error
    } finally { client.release() }
    await issueSession(req,res,account)
    return res.status(201).json({ok:true,created:true,buyer:publicBuyer(account)})
  }

  const login = async (req,res) => {
    if (!ready) return fail(res,503,'Acesso temporariamente indisponível.')
    if (!allowedOrigin(req)) return fail(res,403,'Origem não autorizada.')
    const phone = normalPhone(req.body?.phone)
    const password = req.body?.password
    if (!phone || typeof password !== 'string' || password.length>MAX_PASSWORD) return fail(res,401,'Telefone ou senha inválidos.')
    await ensureSchema()
    if (!(await rate(req,'login',phone))) return fail(res,429,'Muitas tentativas. Tente novamente mais tarde.')
    const result = await pool.query(
      'SELECT b.*,c.password_hash FROM buyer_accounts b JOIN buyer_password_credentials c ON c.buyer_id=b.id WHERE b.phone=$1 LIMIT 1',
      [phone],
    )
    const account = result.rows[0] || null
    if (!account || !(await verifyBuyerPassword(password,account.password_hash))) {
      return fail(res,401,'Telefone ou senha inválidos.')
    }
    await issueSession(req,res,account)
    return res.json({ok:true,buyer:publicBuyer(account)})
  }

  // Accounts previously created with OTP are never claimed through possession
  // of the phone number alone. An already authenticated session can add a
  // password without losing historical purchases.
  const setPassword = async (req,res) => {
    if (!ready) return fail(res,503,'Acesso temporariamente indisponível.')
    if (!allowedOrigin(req)) return fail(res,403,'Origem não autorizada.')
    if (!validPassword(req.body?.password)) return fail(res,400,'Crie uma senha com 10 a 128 caracteres.')
    await ensureSchema()
    const account = await getBuyer(req)
    if (!account) return fail(res,401,'Entre na sua conta para definir uma senha.')
    const existing = await pool.query('SELECT 1 FROM buyer_password_credentials WHERE buyer_id=$1',[account.id])
    if (existing.rowCount) return fail(res,409,'A conta já tem senha. Para trocá-la, use a recuperação de acesso.')
    const passwordHash = await hashBuyerPassword(req.body.password)
    await pool.query('INSERT INTO buyer_password_credentials(buyer_id,password_hash) VALUES($1,$2) ON CONFLICT DO NOTHING',[account.id,passwordHash])
    return res.json({ok:true})
  }

  app.post('/api/public/buyer-auth/register-password',noCache,appJson,wrap(register))
  app.post('/api/public/buyer-auth/login-password',noCache,appJson,wrap(login))
  app.post('/api/public/buyer-auth/set-password',noCache,appJson,wrap(setPassword))
}
const noCache = (_req,res,next) => {res.set('Cache-Control','private, no-store');next()}
import express from 'express'
const appJson = express.json({limit:'16kb'})
