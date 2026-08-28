import crypto from 'node:crypto'
import { isIP } from 'node:net'
import express from 'express'
import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 4, connectionTimeoutMillis: 5000 }) : null
const sessionCookie = 'atacado_session'

if (pool) pool.on('error', (error) => console.error('[scanner] pool:', error.message))

const id = () => crypto.randomUUID()
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex')

function parseCookies(req) {
  const header = req.headers.cookie || ''
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=')
        return index < 0 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))]
      }),
  )
}

function isBlockedIpv4(hostname) {
  const parts = hostname.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a, b] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

function isBlockedIpv6(hostname) {
  const value = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return (
    value === '::' ||
    value === '::1' ||
    value.startsWith('fc') ||
    value.startsWith('fd') ||
    /^fe[89ab]/.test(value)
  )
}

function isBlockedHostname(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  if (!host) return true
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true
  const ipVersion = isIP(host.replace(/^\[|\]$/g, ''))
  if (ipVersion === 4) return isBlockedIpv4(host)
  if (ipVersion === 6) return isBlockedIpv6(host)
  return false
}

export function normalizeImportUrl(input) {
  let value = String(input || '').trim()
  if (!value || value.length > 2048) throw new Error('Informe uma URL válida da sua loja atual.')
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !/^https?:\/\//i.test(value)) {
    throw new Error('A loja precisa usar uma URL http ou https.')
  }
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`

  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('Informe uma URL válida da sua loja atual.')
  }

  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('A loja precisa usar uma URL http ou https.')
  if (url.username || url.password) throw new Error('A URL não pode conter usuário ou senha.')
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('Use a URL pública normal da loja, sem porta personalizada.')
  if (isBlockedHostname(url.hostname)) throw new Error('Essa URL não pode ser usada para importação.')

  url.hash = ''
  url.search = ''
  url.hostname = url.hostname.toLowerCase()
  if (url.pathname === '') url.pathname = '/'

  return {
    url: url.toString(),
    host: url.hostname.toLowerCase(),
  }
}

let schemaPromise = null
async function ensureScannerSchema() {
  if (!pool) throw new Error('DATABASE_URL não configurada.')
  if (schemaPromise) return schemaPromise
  schemaPromise = pool.query(`
    CREATE TABLE IF NOT EXISTS import_jobs (
      id text PRIMARY KEY,
      store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      source_url text NOT NULL,
      source_host text NOT NULL,
      status text NOT NULL DEFAULT 'queued',
      progress integer NOT NULL DEFAULT 0,
      result_count integer NOT NULL DEFAULT 0,
      error text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK (status IN ('queued','scanning','processing','review','completed','failed','cancelled')),
      CHECK (progress >= 0 AND progress <= 100)
    );
    CREATE INDEX IF NOT EXISTS idx_import_jobs_store_created ON import_jobs(store_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_import_jobs_store_status ON import_jobs(store_id, status);
  `)
  try {
    await schemaPromise
  } finally {
    schemaPromise = null
  }
}

async function currentStore(req) {
  if (!pool) return null
  const token = parseCookies(req)[sessionCookie]
  if (!token) return null
  const result = await pool.query(
    `SELECT s.id AS store_id,u.id AS user_id,u.email,u.name
     FROM sessions se
     JOIN users u ON u.id=se.user_id
     JOIN stores s ON s.owner_id=u.id
     WHERE se.token_hash=$1 AND se.expires_at>now()
     LIMIT 1`,
    [hashToken(token)],
  )
  return result.rows[0] || null
}

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)

function publicJob(row) {
  return {
    id: row.id,
    source_url: row.source_url,
    source_host: row.source_host,
    status: row.status,
    progress: Number(row.progress || 0),
    result_count: Number(row.result_count || 0),
    error: row.error || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function installScannerRoutes(app) {
  if (app.__atacadoScannerRoutesInstalled) return
  app.__atacadoScannerRoutesInstalled = true

  const router = express.Router()
  router.use(express.json({ limit: '64kb' }))

  const requireStore = asyncRoute(async (req, res, next) => {
    await ensureScannerSchema()
    const store = await currentStore(req)
    if (!store) return res.status(401).json({ error: 'Sessão necessária.' })
    req.scannerStore = store
    next()
  })

  router.get('/', requireStore, asyncRoute(async (req, res) => {
    const result = await pool.query(
      `SELECT * FROM import_jobs
       WHERE store_id=$1
       ORDER BY created_at DESC
       LIMIT 10`,
      [req.scannerStore.store_id],
    )
    res.json({ jobs: result.rows.map(publicJob) })
  }))

  router.post('/', requireStore, asyncRoute(async (req, res) => {
    let normalized
    try {
      normalized = normalizeImportUrl(req.body?.url)
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'URL inválida.' })
    }

    const existing = await pool.query(
      `SELECT * FROM import_jobs
       WHERE store_id=$1 AND source_url=$2 AND status IN ('queued','scanning','processing')
       ORDER BY created_at DESC
       LIMIT 1`,
      [req.scannerStore.store_id, normalized.url],
    )
    if (existing.rowCount) return res.json({ job: publicJob(existing.rows[0]), duplicated: true })

    const result = await pool.query(
      `INSERT INTO import_jobs (id,store_id,source_url,source_host,status)
       VALUES ($1,$2,$3,$4,'queued')
       RETURNING *`,
      [id(), req.scannerStore.store_id, normalized.url, normalized.host],
    )
    res.status(201).json({ job: publicJob(result.rows[0]), duplicated: false })
  }))

  app.use('/api/admin/imports', router)
}

const originalInit = express.application.init
express.application.init = function scannerPatchedInit(...args) {
  const result = originalInit.apply(this, args)
  installScannerRoutes(this)
  return result
}
