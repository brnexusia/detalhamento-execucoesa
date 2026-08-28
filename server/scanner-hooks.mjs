import crypto from 'node:crypto'
import { isIP } from 'node:net'
import express from 'express'
import pg from 'pg'
import { collectCatalog } from './scanner-collector.mjs'
import { normalizeCandidates } from './scanner-normalizer.mjs'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 6, connectionTimeoutMillis: 5000 }) : null
const sessionCookie = 'atacado_session'
const workerDisabled = process.env.SCANNER_WORKER_DISABLED === '1'

if (pool) pool.on('error', (error) => console.error('[scanner] pool:', error.message))

const id = () => crypto.randomUUID()
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex')
const hashValue = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex')

function parseCookies(req) {
  const header = req.headers.cookie || ''
  return Object.fromEntries(header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=')
    return index < 0 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))]
  }))
}

function isBlockedIpv4(hostname) {
  const parts = hostname.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a, b] = parts
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
}

function isBlockedIpv6(hostname) {
  const value = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd') || /^fe[89ab]/.test(value)
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
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !/^https?:\/\//i.test(value)) throw new Error('A loja precisa usar uma URL http ou https.')
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`

  let url
  try { url = new URL(value) } catch { throw new Error('Informe uma URL válida da sua loja atual.') }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('A loja precisa usar uma URL http ou https.')
  if (url.username || url.password) throw new Error('A URL não pode conter usuário ou senha.')
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('Use a URL pública normal da loja, sem porta personalizada.')
  if (isBlockedHostname(url.hostname)) throw new Error('Essa URL não pode ser usada para importação.')

  url.hash = ''
  url.search = ''
  url.hostname = url.hostname.toLowerCase()
  if (url.pathname === '') url.pathname = '/'
  return { url: url.toString(), host: url.hostname.toLowerCase() }
}

let schemaPromise = null
export async function ensureScannerSchema() {
  if (!pool) throw new Error('DATABASE_URL não configurada.')
  if (schemaPromise) return schemaPromise
  schemaPromise = (async () => {
    await pool.query(`
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
      ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT '';
      ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS pages_scanned integer NOT NULL DEFAULT 0;
      ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS normalized_count integer NOT NULL DEFAULT 0;
      ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS warning_count integer NOT NULL DEFAULT 0;
      ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS duplicate_count integer NOT NULL DEFAULT 0;
      CREATE INDEX IF NOT EXISTS idx_import_jobs_store_created ON import_jobs(store_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_import_jobs_store_status ON import_jobs(store_id, status);

      CREATE TABLE IF NOT EXISTS import_candidates (
        id text PRIMARY KEY,
        job_id text NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
        store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        source_key text NOT NULL,
        source_url text NOT NULL,
        raw_data jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(job_id, source_key)
      );
      CREATE INDEX IF NOT EXISTS idx_import_candidates_job ON import_candidates(job_id, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_import_candidates_store ON import_candidates(store_id);

      CREATE TABLE IF NOT EXISTS import_normalized_products (
        id text PRIMARY KEY,
        job_id text NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
        store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        source_candidate_id text REFERENCES import_candidates(id) ON DELETE SET NULL,
        fingerprint text NOT NULL,
        normalized_data jsonb NOT NULL,
        warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
        confidence numeric(4,3) NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(job_id, fingerprint)
      );
      CREATE INDEX IF NOT EXISTS idx_import_normalized_job ON import_normalized_products(job_id, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_import_normalized_store ON import_normalized_products(store_id);
    `)
  })()
  try { await schemaPromise } finally { schemaPromise = null }
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
    normalized_count: Number(row.normalized_count || 0),
    warning_count: Number(row.warning_count || 0),
    duplicate_count: Number(row.duplicate_count || 0),
    platform: row.platform || '',
    pages_scanned: Number(row.pages_scanned || 0),
    error: row.error || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function compactCandidate(candidate) {
  const sourceUrl = String(candidate?.source_url || '').slice(0, 2048)
  return {
    source_url: sourceUrl,
    external_id: String(candidate?.external_id || '').slice(0, 200),
    title: String(candidate?.title || '').trim().slice(0, 500),
    description: String(candidate?.description || '').trim().slice(0, 12000),
    sku: String(candidate?.sku || '').trim().slice(0, 200),
    category: String(candidate?.category || '').trim().slice(0, 300),
    brand: String(candidate?.brand || '').trim().slice(0, 300),
    images: Array.isArray(candidate?.images) ? candidate.images.map(String).filter(Boolean).slice(0, 30) : [],
    variants: Array.isArray(candidate?.variants) ? candidate.variants.slice(0, 250) : [],
    properties: Array.isArray(candidate?.properties) ? candidate.properties.slice(0, 50) : [],
    price: Number.isFinite(Number(candidate?.price)) ? Number(candidate.price) : null,
    price_text: String(candidate?.price_text || '').slice(0, 100),
    currency: String(candidate?.currency || '').slice(0, 20),
    availability: String(candidate?.availability || '').slice(0, 200),
    source: String(candidate?.source || 'generic').slice(0, 80),
  }
}

export async function processImportJob(jobId, collector = collectCatalog) {
  await ensureScannerSchema()
  const claimed = await pool.query(
    `UPDATE import_jobs SET status='scanning',progress=1,error='',updated_at=now()
     WHERE id=$1 AND status='queued' RETURNING *`,
    [jobId],
  )
  if (!claimed.rowCount) return null
  const job = claimed.rows[0]

  try {
    const result = await collector(job.source_url, {
      onProgress: async ({ progress, pagesScanned, candidates, platform }) => {
        await pool.query(
          `UPDATE import_jobs
           SET progress=$1,pages_scanned=GREATEST(pages_scanned,$2),result_count=GREATEST(result_count,$3),platform=CASE WHEN $4<>'' THEN $4 ELSE platform END,updated_at=now()
           WHERE id=$5 AND status='scanning'`,
          [Math.max(1, Math.min(95, Number(progress || 1))), Number(pagesScanned || 0), Number(candidates || 0), String(platform || ''), job.id],
        )
      },
    })

    const rawCandidates = Array.isArray(result?.candidates) ? result.candidates : []
    const candidates = rawCandidates.map(compactCandidate).filter((item) => item.title && item.source_url)
    const rows = candidates.map((candidate) => ({
      id: id(), job_id: job.id, store_id: job.store_id,
      source_key: hashValue(`${candidate.external_id}|${candidate.source_url}|${candidate.title.toLowerCase()}`),
      source_url: candidate.source_url, raw_data: candidate,
    }))

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM import_normalized_products WHERE job_id=$1', [job.id])
      await client.query('DELETE FROM import_candidates WHERE job_id=$1', [job.id])
      if (rows.length) {
        await client.query(
          `INSERT INTO import_candidates (id,job_id,store_id,source_key,source_url,raw_data)
           SELECT x.id,x.job_id,x.store_id,x.source_key,x.source_url,x.raw_data
           FROM jsonb_to_recordset($1::jsonb) AS x(id text,job_id text,store_id text,source_key text,source_url text,raw_data jsonb)
           ON CONFLICT (job_id,source_key) DO UPDATE SET source_url=EXCLUDED.source_url,raw_data=EXCLUDED.raw_data`,
          [JSON.stringify(rows)],
        )
      }
      const updated = await client.query(
        `UPDATE import_jobs
         SET status='processing',progress=96,result_count=$1,normalized_count=0,warning_count=0,duplicate_count=0,platform=$2,pages_scanned=$3,error='',updated_at=now()
         WHERE id=$4 RETURNING *`,
        [rows.length, String(result?.platform || 'generic'), Number(result?.pagesScanned || 0), job.id],
      )
      await client.query('COMMIT')
      return publicJob(updated.rows[0])
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const failed = await pool.query(`UPDATE import_jobs SET status='failed',error=$1,updated_at=now() WHERE id=$2 RETURNING *`, [message.slice(0, 2000), job.id])
    console.error('[scanner] job failed:', job.id, message)
    return publicJob(failed.rows[0])
  }
}

export async function processNormalizationJob(jobId, normalizer = normalizeCandidates) {
  await ensureScannerSchema()
  const claimed = await pool.query(
    `UPDATE import_jobs SET progress=97,error='',updated_at=now()
     WHERE id=$1 AND status='processing' RETURNING *`,
    [jobId],
  )
  if (!claimed.rowCount) return null
  const job = claimed.rows[0]

  try {
    const candidatesResult = await pool.query(
      `SELECT id,raw_data FROM import_candidates WHERE job_id=$1 AND store_id=$2 ORDER BY created_at ASC`,
      [job.id, job.store_id],
    )
    const candidates = candidatesResult.rows.map((row) => ({ ...row.raw_data, __candidate_id: row.id }))
    const result = normalizer(candidates)
    const products = Array.isArray(result?.products) ? result.products : []
    const rows = products.map((product) => ({
      id: id(),
      job_id: job.id,
      store_id: job.store_id,
      source_candidate_id: product.source_candidate_id || null,
      fingerprint: hashValue(product.fingerprint),
      normalized_data: product.normalized,
      warnings: Array.isArray(product.warnings) ? product.warnings : [],
      confidence: Number.isFinite(Number(product.confidence)) ? Number(product.confidence) : 0,
    }))

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM import_normalized_products WHERE job_id=$1', [job.id])
      if (rows.length) {
        await client.query(
          `INSERT INTO import_normalized_products
           (id,job_id,store_id,source_candidate_id,fingerprint,normalized_data,warnings,confidence)
           SELECT x.id,x.job_id,x.store_id,x.source_candidate_id,x.fingerprint,x.normalized_data,x.warnings,x.confidence
           FROM jsonb_to_recordset($1::jsonb) AS x(
             id text,job_id text,store_id text,source_candidate_id text,fingerprint text,normalized_data jsonb,warnings jsonb,confidence numeric
           )
           ON CONFLICT (job_id,fingerprint) DO UPDATE
           SET source_candidate_id=EXCLUDED.source_candidate_id,normalized_data=EXCLUDED.normalized_data,warnings=EXCLUDED.warnings,confidence=EXCLUDED.confidence,updated_at=now()`,
          [JSON.stringify(rows)],
        )
      }
      const updated = await client.query(
        `UPDATE import_jobs
         SET status='review',progress=100,normalized_count=$1,warning_count=$2,duplicate_count=$3,error='',updated_at=now()
         WHERE id=$4 RETURNING *`,
        [rows.length, Number(result?.warningCount || 0), Number(result?.duplicateCount || 0), job.id],
      )
      await client.query('COMMIT')
      return publicJob(updated.rows[0])
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const failed = await pool.query(`UPDATE import_jobs SET status='failed',error=$1,updated_at=now() WHERE id=$2 RETURNING *`, [message.slice(0, 2000), job.id])
    console.error('[scanner] normalization failed:', job.id, message)
    return publicJob(failed.rows[0])
  }
}

let workerBusy = false
let workerTimer = null
async function runNextWork() {
  if (workerDisabled || workerBusy || !pool) return
  workerBusy = true
  try {
    await ensureScannerSchema()
    const processing = await pool.query("SELECT id FROM import_jobs WHERE status='processing' ORDER BY updated_at ASC LIMIT 1")
    if (processing.rowCount) await processNormalizationJob(processing.rows[0].id)
    else {
      const queued = await pool.query("SELECT id FROM import_jobs WHERE status='queued' ORDER BY created_at ASC LIMIT 1")
      if (queued.rowCount) await processImportJob(queued.rows[0].id)
    }
  } catch (error) {
    console.error('[scanner] worker:', error instanceof Error ? error.message : error)
  } finally {
    workerBusy = false
  }
}

function startWorker() {
  if (workerDisabled || workerTimer) return
  workerTimer = setInterval(() => void runNextWork(), 3000)
  workerTimer.unref()
  setImmediate(() => void runNextWork())
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
    const result = await pool.query(`SELECT * FROM import_jobs WHERE store_id=$1 ORDER BY created_at DESC LIMIT 10`, [req.scannerStore.store_id])
    res.json({ jobs: result.rows.map(publicJob) })
  }))

  router.get('/:jobId/candidates', requireStore, asyncRoute(async (req, res) => {
    const job = await pool.query('SELECT * FROM import_jobs WHERE id=$1 AND store_id=$2 LIMIT 1', [req.params.jobId, req.scannerStore.store_id])
    if (!job.rowCount) return res.status(404).json({ error: 'Importação não encontrada.' })
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 25)))
    const result = await pool.query(
      `SELECT id,source_url,raw_data,created_at FROM import_candidates WHERE job_id=$1 AND store_id=$2 ORDER BY created_at ASC LIMIT $3`,
      [req.params.jobId, req.scannerStore.store_id, limit],
    )
    res.json({ job: publicJob(job.rows[0]), candidates: result.rows })
  }))

  router.get('/:jobId/normalized', requireStore, asyncRoute(async (req, res) => {
    const job = await pool.query('SELECT * FROM import_jobs WHERE id=$1 AND store_id=$2 LIMIT 1', [req.params.jobId, req.scannerStore.store_id])
    if (!job.rowCount) return res.status(404).json({ error: 'Importação não encontrada.' })
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 25)))
    const result = await pool.query(
      `SELECT id,source_candidate_id,normalized_data,warnings,confidence,created_at
       FROM import_normalized_products WHERE job_id=$1 AND store_id=$2 ORDER BY created_at ASC LIMIT $3`,
      [req.params.jobId, req.scannerStore.store_id, limit],
    )
    res.json({
      job: publicJob(job.rows[0]),
      products: result.rows.map((row) => ({ ...row, confidence: Number(row.confidence) })),
    })
  }))

  router.post('/', requireStore, asyncRoute(async (req, res) => {
    let normalized
    try { normalized = normalizeImportUrl(req.body?.url) }
    catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : 'URL inválida.' }) }

    const existing = await pool.query(
      `SELECT * FROM import_jobs WHERE store_id=$1 AND source_url=$2 AND status IN ('queued','scanning','processing') ORDER BY created_at DESC LIMIT 1`,
      [req.scannerStore.store_id, normalized.url],
    )
    if (existing.rowCount) return res.json({ job: publicJob(existing.rows[0]), duplicated: true })

    const result = await pool.query(
      `INSERT INTO import_jobs (id,store_id,source_url,source_host,status) VALUES ($1,$2,$3,$4,'queued') RETURNING *`,
      [id(), req.scannerStore.store_id, normalized.url, normalized.host],
    )
    if (!workerDisabled) setImmediate(() => void runNextWork())
    res.status(201).json({ job: publicJob(result.rows[0]), duplicated: false })
  }))

  app.use('/api/admin/imports', router)
  void ensureScannerSchema().then(startWorker).catch((error) => console.error('[scanner] schema:', error.message))
}

const originalInit = express.application.init
express.application.init = function scannerPatchedInit(...args) {
  const result = originalInit.apply(this, args)
  installScannerRoutes(this)
  return result
}
