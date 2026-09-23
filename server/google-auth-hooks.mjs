import crypto from 'node:crypto'
import express from 'express'
import pg from 'pg'
import { OAuth2Client } from 'google-auth-library'
import { publicPlanCodes } from './system-plans.mjs'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 4, connectionTimeoutMillis: 5000 }) : null
const googleClientId = String(process.env.GOOGLE_CLIENT_ID || '').trim()
const googleClient = googleClientId ? new OAuth2Client(googleClientId) : null
const sessionCookie = 'atacado_session'
const sessionDays = 30

if (pool) pool.on('error', (error) => console.error('[shopvax-google-auth] pool:', error.message))

const id = () => crypto.randomUUID()
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex')
const digits = (value) => String(value || '').replace(/\D/g, '')
const slugify = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'loja'

let schemaReady = false
async function ensureSchema() {
  if (!pool) throw new Error('DATABASE_URL não configurada.')
  if (schemaReady) return
  await pool.query(`
    ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub text;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url text NOT NULL DEFAULT '';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub_unique
      ON users(google_sub) WHERE google_sub IS NOT NULL;
  `)
  schemaReady = true
}

function setSessionCookie(req, res, token) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https'
  res.cookie(sessionCookie, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: sessionDays * 24 * 60 * 60 * 1000,
    path: '/',
  })
}

async function createSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url')
  await pool.query('DELETE FROM sessions WHERE expires_at<=now()')
  await pool.query(
    "INSERT INTO sessions (token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '30 days')",
    [hashToken(token), userId],
  )
  setSessionCookie(req, res, token)
}

async function uniqueStoreSlug(base) {
  const root = slugify(base)
  let candidate = root
  let suffix = 1
  while (true) {
    const found = await pool.query('SELECT 1 FROM stores WHERE slug=$1 LIMIT 1', [candidate])
    if (!found.rowCount) return candidate
    suffix += 1
    candidate = `${root}-${suffix}`
  }
}

async function googleProfile(credential) {
  if (!googleClient || !googleClientId) {
    const error = new Error('Login com Google ainda não foi configurado.')
    error.code = 'GOOGLE_NOT_CONFIGURED'
    throw error
  }
  if (!credential || credential.length > 16_000) {
    const error = new Error('Credencial do Google inválida.')
    error.code = 'GOOGLE_INVALID_CREDENTIAL'
    throw error
  }
  const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: googleClientId })
  const payload = ticket.getPayload()
  const email = String(payload?.email || '').trim().toLowerCase()
  const sub = String(payload?.sub || '').trim()
  if (!sub || !email || payload?.email_verified !== true) {
    const error = new Error('A conta do Google não possui um e-mail verificado.')
    error.code = 'GOOGLE_EMAIL_NOT_VERIFIED'
    throw error
  }
  return {
    sub,
    email,
    name: String(payload?.name || email.split('@')[0] || 'Lojista').trim().slice(0, 180),
    picture: String(payload?.picture || '').trim().slice(0, 1000),
  }
}

async function findGoogleUser(profile) {
  const [bySub, byEmail] = await Promise.all([
    pool.query('SELECT id,email,name,google_sub FROM users WHERE google_sub=$1 LIMIT 1', [profile.sub]),
    pool.query('SELECT id,email,name,google_sub FROM users WHERE lower(email)=lower($1) LIMIT 1', [profile.email]),
  ])
  const subUser = bySub.rows[0] || null
  const emailUser = byEmail.rows[0] || null
  if (subUser && emailUser && subUser.id !== emailUser.id) {
    const error = new Error('Este Google já está vinculado a outra conta Shopvax.')
    error.code = 'GOOGLE_ACCOUNT_CONFLICT'
    throw error
  }
  const user = subUser || emailUser
  if (!user) return null
  if (user.google_sub && user.google_sub !== profile.sub) {
    const error = new Error('Este e-mail já está vinculado a outra conta Google.')
    error.code = 'GOOGLE_ACCOUNT_CONFLICT'
    throw error
  }
  if (!user.google_sub) {
    await pool.query(
      "UPDATE users SET google_sub=$1,avatar_url=CASE WHEN avatar_url='' THEN $2 ELSE avatar_url END WHERE id=$3",
      [profile.sub, profile.picture, user.id],
    )
  } else if (profile.picture) {
    await pool.query("UPDATE users SET avatar_url=$1 WHERE id=$2", [profile.picture, user.id])
  }
  return user
}

async function createStoreForUser(userId, storeName, whatsapp, planCode) {
  const storeId = id()
  const storeSlug = await uniqueStoreSlug(storeName)
  await pool.query(
    'INSERT INTO stores (id,owner_id,slug,name,whatsapp,plan_tier,signup_plan_selected_at) VALUES ($1,$2,$3,$4,$5,$6,now())',
    [storeId, userId, storeSlug, storeName, digits(whatsapp), planCode],
  )
  return storeSlug
}

async function googleAuth(req, res) {
  if (!pool) return res.status(503).json({ error: 'Banco ainda não está disponível.' })
  if (!googleClientId) return res.status(503).json({ error: 'Login com Google ainda não foi configurado.', code: 'GOOGLE_NOT_CONFIGURED' })

  await ensureSchema()

  let profile
  try {
    profile = await googleProfile(String(req.body?.credential || ''))
  } catch (error) {
    console.warn('[shopvax-google-auth] verify:', error?.message || error)
    return res.status(error?.code === 'GOOGLE_NOT_CONFIGURED' ? 503 : 401).json({
      error: error?.message || 'Não foi possível validar sua conta Google.',
      code: error?.code || 'GOOGLE_INVALID_CREDENTIAL',
    })
  }

  const intent = req.body?.intent === 'register' ? 'register' : 'login'
  const existing = await findGoogleUser(profile)

  if (existing) {
    const storeResult = await pool.query('SELECT slug FROM stores WHERE owner_id=$1 LIMIT 1', [existing.id])
    let storeSlug = storeResult.rows[0]?.slug || ''

    if (!storeSlug && intent === 'register') {
      const storeName = String(req.body?.storeName || '').trim().slice(0, 180)
      const planCode = String(req.body?.planCode || '').trim().toLowerCase()
      if (!storeName) return res.status(400).json({ error: 'Informe o nome da loja.' })
      if (!publicPlanCodes.includes(planCode)) return res.status(400).json({ error: 'Selecione Bronze, Prata ou Ouro.' })
      storeSlug = await createStoreForUser(existing.id, storeName, req.body?.whatsapp, planCode)
    }

    await createSession(req, res, existing.id)
    return res.json({ ok: true, created: false, storeSlug, profile: { name: existing.name, email: existing.email } })
  }

  if (intent !== 'register') {
    return res.json({
      ok: false,
      needsSignup: true,
      profile: { name: profile.name, email: profile.email, picture: profile.picture },
    })
  }

  const storeName = String(req.body?.storeName || '').trim().slice(0, 180)
  const planCode = String(req.body?.planCode || '').trim().toLowerCase()
  if (!storeName) return res.status(400).json({ error: 'Informe o nome da loja.' })
  if (!publicPlanCodes.includes(planCode)) return res.status(400).json({ error: 'Selecione Bronze, Prata ou Ouro.' })

  const userId = id()
  const storeSlug = await uniqueStoreSlug(storeName)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      'INSERT INTO users (id,email,name,password_hash,google_sub,avatar_url) VALUES ($1,$2,$3,NULL,$4,$5)',
      [userId, profile.email, profile.name, profile.sub, profile.picture],
    )
    await client.query(
      'INSERT INTO stores (id,owner_id,slug,name,whatsapp,plan_tier,signup_plan_selected_at) VALUES ($1,$2,$3,$4,$5,$6,now())',
      [id(), userId, storeSlug, storeName, digits(req.body?.whatsapp), planCode],
    )
    await client.query('COMMIT')
  } catch (error) {
    try { await client.query('ROLLBACK') } catch {}
    if (error?.code === '23505') {
      return res.status(409).json({ error: 'Esta conta Google já está cadastrada. Tente entrar novamente.', code: 'GOOGLE_ALREADY_REGISTERED' })
    }
    throw error
  } finally {
    client.release()
  }

  await createSession(req, res, userId)
  return res.status(201).json({
    ok: true,
    created: true,
    storeSlug,
    profile: { name: profile.name, email: profile.email, picture: profile.picture },
  })
}

function install(app) {
  if (app.__shopvaxGoogleAuthInstalled) return
  app.__shopvaxGoogleAuthInstalled = true

  app.get('/api/public/auth/google-config', (_req, res) => {
    res.json({ enabled: Boolean(googleClientId), clientId: googleClientId || null })
  })
  app.post('/api/auth/google', express.json({ limit: '64kb' }), (req, res, next) => {
    Promise.resolve(googleAuth(req, res)).catch(next)
  })
}

const previousInit = express.application.init
express.application.init = function googleAuthInit(...args) {
  const result = previousInit.apply(this, args)
  install(this)
  return result
}
