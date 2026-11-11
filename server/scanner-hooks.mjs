import crypto from 'node:crypto'
import { isIP } from 'node:net'
import express from 'express'
import multer from 'multer'
import pg from 'pg'
import { collectPdfCatalog, MAX_PDF_BYTES } from './scanner-pdf.mjs'
import { requireCompleteCatalog } from './scanner-import-completeness.mjs'
import { traceUpload } from './upload-request-logging.mjs'
import { ensurePdfChunkSchema, installChunkedPdfRoutes, loadChunkedPdf, clearChunkedPdf } from './scanner-pdf-chunks.mjs'
import { collectCatalog } from './scanner-collector.mjs'
import { isTransientScannerNetworkError } from './scanner-network-retry.mjs'
import { whatsappCatalogPhone, uazapiCatalogConfig } from './scanner-uazapi-catalog.mjs'
import { sharedPhotoSourceKind } from './scanner-photo-albums.mjs'
import { normalizeCandidates } from './scanner-normalizer.mjs'
import { prepareReview } from './scanner-review.mjs'
import { requeueInterruptedScans, requeueFailedTransientFacilZapScans } from './scanner-scan-lease.mjs'
import { createScannerWorkScheduler } from './scanner-work-scheduler.mjs'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 6, connectionTimeoutMillis: 5000 }) : null
const sessionCookie = 'atacado_session'
const workerDisabled = process.env.SCANNER_WORKER_DISABLED === '1'
const SCANNER_DB_BATCH_SIZE = 250

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
  const pastedCatalog = value.match(/https:\/\/wa\.me\/c\/\d{10,15}\/?/i)
  if (pastedCatalog && !value.startsWith('http')) value = pastedCatalog[0]
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
  // Public photo links may need their signed query string to download media.
  // Regular store URLs keep their canonical no-query form for deduplication.
  if (!sharedPhotoSourceKind(url.toString())) url.search = ''
  url.hostname = url.hostname.toLowerCase()
  if (url.pathname === '') url.pathname = '/'
  return { url: url.toString(), host: url.hostname.toLowerCase() }
}

let schemaPromise = null
let schemaInitialized = false
export async function ensureScannerSchema() {
  if (!pool) throw new Error('DATABASE_URL não configurada.')
  if (schemaInitialized) return
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
      ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS target_catalog_id text;
      ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS pages_scanned integer NOT NULL DEFAULT 0;
      ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS scan_lease_at timestamptz;
      ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS scan_worker_token text;
      ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS scan_next_page integer NOT NULL DEFAULT 1;
      ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS scan_network_retries integer NOT NULL DEFAULT 0;
      ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS normalized_count integer NOT NULL DEFAULT 0;
      ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS warning_count integer NOT NULL DEFAULT 0;
      ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS duplicate_count integer NOT NULL DEFAULT 0;
      ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS selected_count integer NOT NULL DEFAULT 0;
      ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS review_changed_count integer NOT NULL DEFAULT 0;
      CREATE INDEX IF NOT EXISTS idx_import_jobs_store_created ON import_jobs(store_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_import_jobs_store_status ON import_jobs(store_id, status);
      CREATE TABLE IF NOT EXISTS import_pdf_uploads (
        job_id text PRIMARY KEY REFERENCES import_jobs(id) ON DELETE CASCADE,
        data bytea NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );

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
      ALTER TABLE import_normalized_products ADD COLUMN IF NOT EXISTS review_data jsonb;
      ALTER TABLE import_normalized_products ADD COLUMN IF NOT EXISTS selected boolean;
      ALTER TABLE import_normalized_products ADD COLUMN IF NOT EXISTS review_updated_at timestamptz;
      UPDATE import_normalized_products SET selected=(jsonb_array_length(warnings)=0) WHERE selected IS NULL;
      ALTER TABLE import_normalized_products ALTER COLUMN selected SET DEFAULT false;
      ALTER TABLE import_normalized_products ALTER COLUMN selected SET NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_import_normalized_job ON import_normalized_products(job_id, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_import_normalized_store ON import_normalized_products(store_id);
      CREATE INDEX IF NOT EXISTS idx_import_normalized_selected ON import_normalized_products(job_id, selected);

      UPDATE import_jobs j
      SET selected_count=x.selected_count,
          warning_count=x.warning_count,
          review_changed_count=x.review_changed_count
      FROM (
        SELECT job_id,
          count(*) FILTER (WHERE selected)::int AS selected_count,
          count(*) FILTER (WHERE jsonb_array_length(warnings)>0)::int AS warning_count,
          count(*) FILTER (WHERE review_data IS NOT NULL)::int AS review_changed_count
        FROM import_normalized_products
        GROUP BY job_id
      ) x
      WHERE j.id=x.job_id;
    `)
    await ensurePdfChunkSchema(pool)
  })().then(() => { schemaInitialized = true }).finally(() => { schemaPromise = null })
  return schemaPromise
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
    selected_count: Number(row.selected_count || 0),
    review_changed_count: Number(row.review_changed_count || 0),
    published_count: Number(row.published_count || 0),
    skipped_existing_count: Number(row.skipped_existing_count || 0),
    publish_mode: row.publish_mode || null,
    target_catalog_id: row.target_catalog_id || null,
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
    price: candidate?.price != null && candidate.price !== '' && Number.isFinite(Number(candidate.price)) ? Number(candidate.price) : null,
    price_text: String(candidate?.price_text || '').slice(0, 100),
    currency: String(candidate?.currency || '').slice(0, 20),
    availability: String(candidate?.availability || '').slice(0, 200),
    source: String(candidate?.source || 'generic').slice(0, 80),
  }
}

async function refreshReviewStats(client, jobId, storeId) {
  const stats = await client.query(
    `SELECT
       count(*)::int AS total_count,
       count(*) FILTER (WHERE selected)::int AS selected_count,
       count(*) FILTER (WHERE jsonb_array_length(warnings)>0)::int AS warning_count,
       count(*) FILTER (WHERE jsonb_array_length(warnings)=0)::int AS ready_count,
       count(*) FILTER (WHERE review_data IS NOT NULL)::int AS review_changed_count
     FROM import_normalized_products WHERE job_id=$1 AND store_id=$2`,
    [jobId, storeId],
  )
  const row = stats.rows[0]
  await client.query(
    `UPDATE import_jobs SET selected_count=$1,warning_count=$2,review_changed_count=$3,updated_at=now()
     WHERE id=$4 AND store_id=$5`,
    [row.selected_count, row.warning_count, row.review_changed_count, jobId, storeId],
  )
  return {
    total_count: Number(row.total_count || 0),
    selected_count: Number(row.selected_count || 0),
    warning_count: Number(row.warning_count || 0),
    ready_count: Number(row.ready_count || 0),
    review_changed_count: Number(row.review_changed_count || 0),
  }
}

function publicReviewProduct(row) {
  return {
    id: row.id,
    source_candidate_id: row.source_candidate_id,
    data: row.review_data || row.normalized_data,
    original_data: row.normalized_data,
    warnings: Array.isArray(row.warnings) ? row.warnings : [],
    confidence: Number(row.confidence || 0),
    selected: Boolean(row.selected),
    edited: Boolean(row.review_data),
    review_updated_at: row.review_updated_at,
    created_at: row.created_at,
  }
}

export async function processImportJob(jobId, collector = collectCatalog) {
  await ensureScannerSchema()
  const workerToken = id()
  const claimed = await pool.query(
    `UPDATE import_jobs SET status='scanning',progress=1,error='',
       scan_worker_token=$2,scan_lease_at=now(),updated_at=now()
     WHERE id=$1 AND status='queued' RETURNING *`,
    [jobId, workerToken],
  )
  if (!claimed.rowCount) return null
  const job = claimed.rows[0]
  let persistedBatches = 0
  let scanningPlatform = String(job.platform || '')
  const storedImportAssetIds = []
  // A process can die after claiming a job. Other replicas may reclaim it
  // only after this lease stops being renewed; no in-flight job is reset.
  const leaseTimer = setInterval(() => {
    void pool.query(
      "UPDATE import_jobs SET scan_lease_at=now() WHERE id=$1 AND status='scanning' AND scan_worker_token=$2",
      [job.id, workerToken],
    ).catch(error => console.warn('[scanner] scan heartbeat:', job.id, error.message))
  }, 10000)
  leaseTimer.unref()

  const persistBatch = async (rawBatch) => {
    const candidates = (Array.isArray(rawBatch) ? rawBatch : [])
      .map(compactCandidate)
      .filter((item) => item.title && item.source_url)
    for (let start = 0; start < candidates.length; start += SCANNER_DB_BATCH_SIZE) {
      const chunk = candidates.slice(start, start + SCANNER_DB_BATCH_SIZE)
      const rows = chunk.map((candidate) => ({
        id: id(), job_id: job.id, store_id: job.store_id,
        source_key: hashValue(`${candidate.external_id}|${candidate.source_url}|${candidate.title.toLowerCase()}`),
        source_url: candidate.source_url, raw_data: candidate,
      }))
      if (!rows.length) continue
      const stillActive = await pool.query(
        "SELECT 1 FROM import_jobs WHERE id=$1 AND store_id=$2 AND status='scanning' AND scan_worker_token=$3 LIMIT 1",
        [job.id, job.store_id, workerToken],
      )
      if (!stillActive.rowCount) throw new Error('O scanner perdeu a reserva de execução; outra instância retomou o trabalho.')
      await pool.query(
        `INSERT INTO import_candidates (id,job_id,store_id,source_key,source_url,raw_data)
         SELECT x.id,x.job_id,x.store_id,x.source_key,x.source_url,x.raw_data
         FROM jsonb_to_recordset($1::jsonb) AS x(id text,job_id text,store_id text,source_key text,source_url text,raw_data jsonb)
         ON CONFLICT (job_id,source_key) DO UPDATE SET source_url=EXCLUDED.source_url,raw_data=EXCLUDED.raw_data`,
        [JSON.stringify(rows)],
      )
      persistedBatches += 1
    }
  }

  try {
    const proposedResumePage = job.platform === 'facilzap'
      ? Math.max(1, Number(job.scan_next_page || 1)) : 1
    const priorCandidates = proposedResumePage > 1
      ? await pool.query(
        'SELECT count(*)::int AS count FROM import_candidates WHERE job_id=$1 AND store_id=$2',
        [job.id, job.store_id],
      ) : { rows:[{ count:0 }] }
    const savedCount = Number(priorCandidates.rows[0]?.count || 0)
    const resumePage = proposedResumePage > 1 && savedCount > 0 ? proposedResumePage : 1
    await pool.query('DELETE FROM import_normalized_products WHERE job_id=$1', [job.id])
    if (resumePage === 1) {
      await pool.query('DELETE FROM import_candidates WHERE job_id=$1', [job.id])
      await pool.query(
        "UPDATE import_jobs SET scan_next_page=1 WHERE id=$1 AND scan_worker_token=$2",
        [job.id, workerToken],
      )
    }
    if (resumePage > 1) console.warn('[scanner] resuming large FácilZap import:', {
      jobId:job.id, nextPage:resumePage, savedProducts:savedCount,
    })

    const collectorOptions = {
      resumePage,
      initialCandidatesCount: resumePage > 1 ? savedCount : 0,
      resumePagesScanned: resumePage > 1 ? Number(job.pages_scanned || 1) : 1,
      onPageCheckpoint: async ({ nextPage, pagesScanned, candidates }) => {
        const checkpoint = await pool.query(
          `UPDATE import_jobs
           SET scan_next_page=GREATEST(scan_next_page,$1),
               pages_scanned=GREATEST(pages_scanned,$2),
               result_count=GREATEST(result_count,$3),updated_at=now()
           WHERE id=$4 AND status='scanning' AND scan_worker_token=$5 RETURNING id`,
          [nextPage, pagesScanned, candidates, job.id, workerToken],
        )
        if (!checkpoint.rowCount) throw new Error('O scanner perdeu a reserva; checkpoint não gravado.')
      },
      collectInMemory: false,
      onBatch: persistBatch,
      onProgress: async ({ progress, pagesScanned, candidates, platform }) => {
        if (platform) scanningPlatform = String(platform)
        await pool.query(
          `UPDATE import_jobs
           SET progress=GREATEST(progress,$1),pages_scanned=GREATEST(pages_scanned,$2),result_count=GREATEST(result_count,$3),platform=CASE WHEN $4<>'' THEN $4 ELSE platform END,updated_at=now()
           WHERE id=$5 AND status='scanning' AND scan_worker_token=$6`,
          [Math.max(1, Math.min(95, Number(progress || 1))), Number(pagesScanned || 0), Number(candidates || 0), String(platform || ''), job.id, workerToken],
        )
      },
      onImage: async (image, mime, filename) => {
        const assetId = id()
        await pool.query(
          'INSERT INTO media_assets (id,store_id,mime_type,original_name,byte_size,data) VALUES ($1,$2,$3,$4,$5,$6)',
          [assetId, job.store_id, mime, filename, image.length, image],
        )
        storedImportAssetIds.push(assetId)
        return '/media/' + assetId
      },
    }
    let result
    if (job.platform === 'pdf') {
      const upload = await pool.query('SELECT data FROM import_pdf_uploads WHERE job_id=$1 LIMIT 1', [job.id])
      const bytes = upload.rows[0]?.data || await loadChunkedPdf(pool, job.id, MAX_PDF_BYTES)
      if (!bytes) throw new Error('Arquivo PDF temporário não encontrado. Descarte e envie o catálogo novamente.')
      result = await collectPdfCatalog(bytes, collectorOptions)
    } else {
      result = await collector(job.source_url, collectorOptions)
    }

    // Do not progress to review as if a truncated site scan were complete.
    // Streaming batches from an incomplete scan are discarded by the existing
    // catch/cleanup branch so a seller can retry without importing missing items.
    requireCompleteCatalog(result)

    // Compatibilidade com coletores de testes/integrações que ainda retornam array.
    if (!persistedBatches && Array.isArray(result?.candidates) && result.candidates.length) await persistBatch(result.candidates)

    const countResult = await pool.query('SELECT count(*)::int AS count FROM import_candidates WHERE job_id=$1 AND store_id=$2', [job.id, job.store_id])
    const persistedCount = Number(countResult.rows[0]?.count || 0)
    const updated = await pool.query(
      `UPDATE import_jobs
       SET status='processing',progress=95,result_count=$1,normalized_count=0,warning_count=0,duplicate_count=0,selected_count=0,review_changed_count=0,platform=$2,pages_scanned=$3,error='',scan_worker_token=NULL,scan_lease_at=NULL,updated_at=now()
       WHERE id=$4 AND status='scanning' AND scan_worker_token=$5 RETURNING *`,
      [persistedCount, String(result?.platform || 'generic'), Number(result?.pagesScanned || 0), job.id, workerToken],
    )
    if (!updated.rowCount) throw new Error('O scanner foi retomado por outra instância; resultado antigo descartado.')
    return publicJob(updated.rows[0])
  } catch (error) {
    const ownership = await pool.query(
      "SELECT 1 FROM import_jobs WHERE id=$1 AND status='scanning' AND scan_worker_token=$2",
      [job.id, workerToken],
    ).catch(() => ({ rowCount:0 }))
    if (!ownership.rowCount) {
      console.warn('[scanner] stale worker halted after losing lease:', job.id)
      return null
    }
    if (storedImportAssetIds.length) {
      await pool.query('DELETE FROM media_assets WHERE store_id=$1 AND id=ANY($2::text[])', [job.store_id, storedImportAssetIds]).catch((cleanupError) =>
        console.warn('[scanner] imported media cleanup:', cleanupError.message))
    }
    // A transient error after a successfully persisted FácilZap page is
    // recoverable. Keep the durable checkpoint and candidate rows; they are
    // NEVER published unless the next attempt confirms the final page.
    const transientNetworkFailure = isTransientScannerNetworkError(error)
    const checkpoint = transientNetworkFailure && scanningPlatform === 'facilzap'
      ? await pool.query(
        'SELECT scan_next_page FROM import_jobs WHERE id=$1 AND scan_worker_token=$2',
        [job.id, workerToken],
      ).catch(() => ({ rows:[] })) : { rows:[] }
    const keepCheckpoint = Number(checkpoint.rows[0]?.scan_next_page || 1) > 1
    try {
      await pool.query('DELETE FROM import_normalized_products WHERE job_id=$1', [job.id])
      if (!keepCheckpoint) await pool.query('DELETE FROM import_candidates WHERE job_id=$1', [job.id])
    } catch {}
    const message = error instanceof Error ? error.message : String(error)
    const failed = await pool.query(
      "UPDATE import_jobs SET status='failed',error=$1,scan_worker_token=NULL,scan_lease_at=NULL,updated_at=now() WHERE id=$2 AND scan_worker_token=$3 AND status='scanning' RETURNING *",
      [message.slice(0, 2000), job.id, workerToken],
    )
    console.error('[scanner] job failed:', job.id, message)
    return publicJob(failed.rows[0])
  } finally {
    clearInterval(leaseTimer)
    if (job.platform === 'pdf') {
      // A stale PDF worker must not remove the uploaded bytes after another
      // worker has requeued or reclaimed that same job.
      const pdfState = await pool.query(
        'SELECT status,scan_worker_token FROM import_jobs WHERE id=$1',
        [job.id],
      ).catch(() => ({ rows:[] }))
      const current = pdfState.rows[0]
      const ownedOrFinished = current && (
        current.status === 'processing' ||
        current.status === 'review' ||
        current.status === 'completed' ||
        current.status === 'failed' ||
        current.status === 'cancelled' ||
        (current.status === 'scanning' && current.scan_worker_token === workerToken)
      )
      if (ownedOrFinished) {
        await pool.query('DELETE FROM import_pdf_uploads WHERE job_id=$1', [job.id]).catch((error) =>
          console.warn('[scanner] PDF cleanup:', error.message))
        await clearChunkedPdf(pool, job.id).catch((error) => console.warn('[scanner] PDF chunks cleanup:', error.message))
      }
    }
  }
}

export async function processNormalizationJob(jobId, normalizer = normalizeCandidates) {
  await ensureScannerSchema()
  // Normalize each import exactly once across EasyPanel replicas. Without
  // a cross-process lock, two instances can simultaneously delete/recreate
  // review rows for the same PDF or website job.
  const normalizerGuard = await pool.connect()
  const lockKey = 'scanner-normalize:' + jobId
  let acquired = false
  try {
    const lock = await normalizerGuard.query(
      'SELECT pg_try_advisory_lock(hashtext($1)::bigint) AS ok',
      [lockKey],
    )
    if (!lock.rows[0]?.ok) return null
    acquired = true
  const claimed = await pool.query(
    `UPDATE import_jobs SET error='',updated_at=now()
     WHERE id=$1 AND status='processing' RETURNING *`,
    [jobId],
  )
  if (!claimed.rowCount) return null
  const job = claimed.rows[0]

  try {
    await pool.query('DELETE FROM import_normalized_products WHERE job_id=$1', [job.id])
    let cursorCreatedAt = null
    let cursorId = ''
    const totalToNormalize = Math.max(0,Number(job.result_count || 0))
    let normalizedInputCount = 0

    while (true) {
      const candidatesResult = await pool.query(
        `SELECT id,raw_data,created_at::text AS cursor_created_at
         FROM import_candidates
         WHERE job_id=$1 AND store_id=$2
           AND ($3::timestamptz IS NULL OR created_at>$3::timestamptz OR (created_at=$3::timestamptz AND id>$4))
         ORDER BY created_at ASC,id ASC
         LIMIT $5`,
        [job.id, job.store_id, cursorCreatedAt, cursorId, SCANNER_DB_BATCH_SIZE],
      )
      if (!candidatesResult.rowCount) break

      const candidates = candidatesResult.rows.map((row) => ({ ...row.raw_data, __candidate_id: row.id }))
      const result = await normalizer(candidates)
      const products = Array.isArray(result?.products) ? result.products : []
      const sourceById = new Map(candidates.map((candidate) => [candidate.__candidate_id, candidate]))
      const rows = products.map((product) => {
        const warnings = Array.isArray(product.warnings) ? [...product.warnings] : []
        if (job.platform === 'pdf') {
          const original = sourceById.get(product.source_candidate_id)
          const normalized = product.normalized || {}
          if (!normalized.images?.length && !warnings.includes('missing_image')) warnings.push('missing_image')
          if (/^(?:Geral|Outros)$/i.test(String(normalized.category || original?.category || '')) && !warnings.includes('uncertain_category')) warnings.push('uncertain_category')
          if ((original?.pdf_review_required === true || /REVISÃO OBRIGATÓRIA/i.test(String(original?.description || ''))) && !warnings.includes('manual_review')) warnings.push('manual_review')
        }
        return {
          id: id(),
          job_id: job.id,
          store_id: job.store_id,
          source_candidate_id: product.source_candidate_id || null,
          fingerprint: hashValue(product.fingerprint),
          normalized_data: product.normalized,
          warnings,
          confidence: Number.isFinite(Number(product.confidence)) ? Number(product.confidence) : 0,
          // Editorial PDF lookbooks require an explicit review/selection
          // before publication, even when prices and images appear complete.
          // Simple named product PDFs keep the previous selection behavior.
          selected: warnings.length === 0 && job.platform !== 'whatsapp' && !(job.platform === 'pdf' &&
            /^pdf-(?:lookbook|fashion)-/.test(String(sourceById.get(product.source_candidate_id)?.external_id || ''))),
        }
      })
      if (rows.length) {
        await pool.query(
          `INSERT INTO import_normalized_products
           (id,job_id,store_id,source_candidate_id,fingerprint,normalized_data,warnings,confidence,selected)
           SELECT x.id,x.job_id,x.store_id,x.source_candidate_id,x.fingerprint,x.normalized_data,x.warnings,x.confidence,x.selected
           FROM jsonb_to_recordset($1::jsonb) AS x(
             id text,job_id text,store_id text,source_candidate_id text,fingerprint text,normalized_data jsonb,warnings jsonb,confidence numeric,selected boolean
           )
           ON CONFLICT (job_id,fingerprint) DO UPDATE
           SET source_candidate_id=EXCLUDED.source_candidate_id,normalized_data=EXCLUDED.normalized_data,warnings=EXCLUDED.warnings,
               confidence=EXCLUDED.confidence,selected=EXCLUDED.selected,review_data=NULL,review_updated_at=NULL,updated_at=now()
           WHERE EXCLUDED.confidence >= import_normalized_products.confidence`,
          [JSON.stringify(rows)],
        )
      }

      normalizedInputCount += candidatesResult.rows.length
      await pool.query(
        `UPDATE import_jobs SET progress=LEAST(99,GREATEST(progress,$1)),updated_at=now()
         WHERE id=$2 AND store_id=$3 AND status='processing'`,
        [95+Math.floor(4*normalizedInputCount/Math.max(1,totalToNormalize)),job.id,job.store_id],
      )
      const last = candidatesResult.rows.at(-1)
      cursorCreatedAt = last.cursor_created_at
      cursorId = last.id
    }

    const stats = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM import_candidates WHERE job_id=$1 AND store_id=$2) AS candidate_count,
         count(*)::int AS normalized_count,
         count(*) FILTER (WHERE jsonb_array_length(warnings)>0)::int AS warning_count,
         count(*) FILTER (WHERE selected)::int AS selected_count
       FROM import_normalized_products WHERE job_id=$1 AND store_id=$2`,
      [job.id, job.store_id],
    )
    const row = stats.rows[0]
    const candidateCount = Number(row.candidate_count || 0)
    const normalizedCount = Number(row.normalized_count || 0)
    const duplicateCount = Math.max(0, candidateCount - normalizedCount)
    const updated = await pool.query(
      `UPDATE import_jobs
       SET status='review',progress=100,normalized_count=$1,warning_count=$2,duplicate_count=$3,selected_count=$4,review_changed_count=0,error='',updated_at=now()
       WHERE id=$5 RETURNING *`,
      [normalizedCount, Number(row.warning_count || 0), duplicateCount, Number(row.selected_count || 0), job.id],
    )
    return publicJob(updated.rows[0])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const failed = await pool.query(`UPDATE import_jobs SET status='failed',error=$1,updated_at=now() WHERE id=$2 RETURNING *`, [message.slice(0, 2000), job.id])
    console.error('[scanner] normalization failed:', job.id, message)
    return publicJob(failed.rows[0])
  }
  } finally {
    if (acquired) {
      await normalizerGuard.query(
        'SELECT pg_advisory_unlock(hashtext($1)::bigint)',
        [lockKey],
      ).catch(error => console.warn('[scanner] normalization unlock:', error.message))
    }
    normalizerGuard.release()
  }
}

// Short polling ticks recover interrupted jobs even while another importer
// is busy. A PDF and a website scan may run at the same time, separately from
// normalization. Jobs are claimed atomically by their existing worker functions.
const scannerScheduler = createScannerWorkScheduler({
  ensureSchema: ensureScannerSchema,
  recover: async () => {
    const query = pool.query.bind(pool)
    const interrupted = await requeueInterruptedScans(query)
    const failedNetwork = await requeueFailedTransientFacilZapScans(query)
    return { rows:[...interrupted.rows,...failedNetwork.rows] }
  },
  findNext: async (lane) => {
    if (lane === 'normalization') {
      const result = await pool.query(
        "SELECT id FROM import_jobs WHERE status='processing' ORDER BY updated_at ASC LIMIT 1",
      )
      return result.rows[0] || null
    }
    const result = await pool.query(
      `SELECT id FROM import_jobs
       WHERE status='queued' AND (platform='pdf')=$1
       ORDER BY created_at ASC LIMIT 1`,
      [lane === 'pdf'],
    )
    return result.rows[0] || null
  },
  processScan: processImportJob,
  processNormalization: processNormalizationJob,
  log: (message, error) => console.warn(message,
    error instanceof Error ? error.message : error),
})

let workerTimer = null
async function runNextWork() {
  if (workerDisabled || !pool) return
  try {
    await scannerScheduler.tick()
  } catch (error) {
    console.error('[scanner] worker:', error instanceof Error ? error.message : error)
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
  const pdfUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_PDF_BYTES, files: 1, fields: 0 },
  })
  let pdfUploadsInFlight = 0
  const acceptPdfUpload = (req, res, next) => {
    // Large PDFs are held in memory while Multer validates the upload.
    // Bound concurrent allocations independently of the asynchronous worker.
    if (pdfUploadsInFlight >= 2) return res.status(429).json({ error: 'Há muitas importações de PDF sendo enviadas. Tente novamente após concluir o envio atual.' })
    pdfUploadsInFlight += 1
    pdfUpload.single('file')(req, res, (error) => {
      pdfUploadsInFlight -= 1
      const limitMB = Math.round(MAX_PDF_BYTES / (1024 * 1024))
      if (error?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'PDF maior que ' + limitMB + ' MB. Envie um arquivo de até ' + limitMB + ' MB.' })
      if (error) return res.status(400).json({ error: 'Não foi possível receber o PDF. Envie apenas um arquivo de até ' + limitMB + ' MB.' })
      next()
    })
  }

  const requireStore = asyncRoute(async (req, res, next) => {
    await ensureScannerSchema()
    const store = await currentStore(req)
    if (!store) return res.status(401).json({ error: 'Sessão necessária.' })
    req.scannerStore = store
    next()
  })

  const reviewJob = async (req, res) => {
    const result = await pool.query('SELECT * FROM import_jobs WHERE id=$1 AND store_id=$2 LIMIT 1', [req.params.jobId, req.scannerStore.store_id])
    if (!result.rowCount) {
      res.status(404).json({ error: 'Importação não encontrada.' })
      return null
    }
    if (result.rows[0].status !== 'review') {
      res.status(409).json({ error: 'Essa importação ainda não está disponível para revisão.' })
      return null
    }
    return result.rows[0]
  }

  installChunkedPdfRoutes(router, {
    pool, requireStore, asyncRoute, ensureSchema: ensureScannerSchema,
    maxPdfBytes: MAX_PDF_BYTES, makeId: id, publicJob, runNextWork, workerDisabled,
  })

  router.get('/', requireStore, asyncRoute(async (req, res) => {
    const result = await pool.query(`SELECT * FROM import_jobs WHERE store_id=$1 ORDER BY created_at DESC LIMIT 10`, [req.scannerStore.store_id])
    res.json({ jobs: result.rows.map(publicJob) })
  }))

  router.post('/pdf', traceUpload('pdf'), requireStore, acceptPdfUpload, asyncRoute(async (req, res) => {
    const file = req.file
    if (!file || !file.buffer?.subarray(0, 1024).toString('latin1').includes('%PDF-')) {
      return res.status(400).json({ error: 'Selecione um arquivo PDF válido.' })
    }
    const filename = String(file.originalname || 'catalogo.pdf').replace(/[\\/\x00-\x1f]/g, '').slice(0, 180) || 'catalogo.pdf'
    const jobId = id()
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const job = await client.query(
        "INSERT INTO import_jobs (id,store_id,source_url,source_host,status,platform) VALUES ($1,$2,$3,$4,'queued','pdf') RETURNING *",
        [jobId, req.scannerStore.store_id, 'pdf://' + jobId, filename],
      )
      await client.query('INSERT INTO import_pdf_uploads (job_id,data) VALUES ($1,$2)', [jobId, file.buffer])
      await client.query('COMMIT')
      if (!workerDisabled) setImmediate(() => void runNextWork())
      res.status(202).json({ job: publicJob(job.rows[0]), duplicated: false })
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }))


  router.delete('/:jobId', requireStore, asyncRoute(async (req, res) => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const job = await client.query(
        'SELECT id,status FROM import_jobs WHERE id=$1 AND store_id=$2 LIMIT 1 FOR UPDATE',
        [req.params.jobId, req.scannerStore.store_id],
      )
      if (!job.rowCount) {
        await client.query('ROLLBACK')
        return res.status(404).json({ error: 'Importação não encontrada.' })
      }
      await client.query("UPDATE import_jobs SET status='cancelled',updated_at=now() WHERE id=$1 AND store_id=$2", [req.params.jobId, req.scannerStore.store_id])
      await client.query('DELETE FROM import_jobs WHERE id=$1 AND store_id=$2', [req.params.jobId, req.scannerStore.store_id])
      await client.query('COMMIT')
      res.json({ ok: true })
    } catch (error) {
      try { await client.query('ROLLBACK') } catch {}
      throw error
    } finally {
      client.release()
    }
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
    res.json({ job: publicJob(job.rows[0]), products: result.rows.map((row) => ({ ...row, confidence: Number(row.confidence) })) })
  }))

  router.get('/:jobId/review', requireStore, asyncRoute(async (req, res) => {
    const job = await reviewJob(req, res)
    if (!job) return

    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 40)))
    const offset = Math.max(0, Number.isFinite(Number(req.query.offset)) ? Math.floor(Number(req.query.offset)) : 0)
    const filter = ['all', 'alerts', 'selected'].includes(String(req.query.filter)) ? String(req.query.filter) : 'all'
    const q = String(req.query.q || '').trim().slice(0, 100)
    const params = [job.id, req.scannerStore.store_id, filter, q]
    const where = `job_id=$1 AND store_id=$2
      AND ($3='all' OR ($3='alerts' AND jsonb_array_length(warnings)>0) OR ($3='selected' AND selected=true))
      AND ($4='' OR lower(COALESCE(review_data,normalized_data)->>'name') LIKE '%'||lower($4)||'%' OR lower(COALESCE(review_data,normalized_data)->>'sku') LIKE '%'||lower($4)||'%' OR lower(COALESCE(review_data,normalized_data)->>'category') LIKE '%'||lower($4)||'%')`

    const [result, countResult, summary] = await Promise.all([
      pool.query(
        `SELECT id,source_candidate_id,normalized_data,review_data,warnings,confidence,selected,review_updated_at,created_at
         FROM import_normalized_products WHERE ${where}
         ORDER BY CASE WHEN jsonb_array_length(warnings)>0 THEN 0 ELSE 1 END,
                  lower(COALESCE(review_data,normalized_data)->>'name'),created_at ASC
         LIMIT $5 OFFSET $6`,
        [...params, limit, offset],
      ),
      pool.query(`SELECT count(*)::int AS count FROM import_normalized_products WHERE ${where}`, params),
      pool.query(
        `SELECT count(*)::int AS total_count,
                count(*) FILTER (WHERE selected)::int AS selected_count,
                count(*) FILTER (WHERE jsonb_array_length(warnings)>0)::int AS warning_count,
                count(*) FILTER (WHERE jsonb_array_length(warnings)=0)::int AS ready_count,
                count(*) FILTER (WHERE review_data IS NOT NULL)::int AS review_changed_count
         FROM import_normalized_products WHERE job_id=$1 AND store_id=$2`,
        [job.id, req.scannerStore.store_id],
      ),
    ])

    res.json({
      job: publicJob(job),
      products: result.rows.map(publicReviewProduct),
      summary: Object.fromEntries(Object.entries(summary.rows[0]).map(([key, value]) => [key, Number(value || 0)])),
      pagination: { limit, offset, total: Number(countResult.rows[0]?.count || 0) },
    })
  }))

  // The publisher locks import_jobs before import_normalized_products.
  // Review writers MUST use the same order or concurrent edits/publication
  // can deadlock (40P01) and leave repeated failing publication attempts.
  router.patch('/:jobId/review/:productId', requireStore, asyncRoute(async (req, res) => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const lockedJob = await client.query(
        'SELECT id,status FROM import_jobs WHERE id=$1 AND store_id=$2 FOR UPDATE',
        [req.params.jobId, req.scannerStore.store_id],
      )
      if (!lockedJob.rowCount) {
        await client.query('ROLLBACK')
        return res.status(404).json({ error: 'Importação não encontrada.' })
      }
      if (lockedJob.rows[0].status !== 'review') {
        await client.query('ROLLBACK')
        return res.status(409).json({ error: 'Essa importação não está mais em revisão.' })
      }
      const current = await client.query(
        'SELECT * FROM import_normalized_products WHERE id=$1 AND job_id=$2 AND store_id=$3 LIMIT 1 FOR UPDATE',
        [req.params.productId, req.params.jobId, req.scannerStore.store_id],
      )
      if (!current.rowCount) {
        await client.query('ROLLBACK')
        return res.status(404).json({ error: 'Produto da revisão não encontrado.' })
      }
      const row = current.rows[0]
      const baseData = row.review_data || row.normalized_data
      const prepared = prepareReview({ ...baseData, ...(req.body?.data && typeof req.body.data === 'object' ? req.body.data : {}) })
      const selected = typeof req.body?.selected === 'boolean' ? req.body.selected : Boolean(row.selected)
      if (selected && !prepared.publishable) {
        await client.query('ROLLBACK')
        return res.status(400).json({ error: 'Para selecionar este produto, informe pelo menos nome e preço válido.' })
      }
      const updated = await client.query(
        `UPDATE import_normalized_products
         SET review_data=$1,warnings=$2,confidence=$3,selected=$4,review_updated_at=now(),updated_at=now()
         WHERE id=$5 AND job_id=$6 AND store_id=$7 RETURNING *`,
        [JSON.stringify(prepared.data), JSON.stringify(prepared.warnings), prepared.confidence, selected, row.id, req.params.jobId, req.scannerStore.store_id],
      )
      const summary = await refreshReviewStats(client, req.params.jobId, req.scannerStore.store_id)
      const updatedJob = await client.query('SELECT * FROM import_jobs WHERE id=$1', [req.params.jobId])
      await client.query('COMMIT')
      return res.json({ product: publicReviewProduct(updated.rows[0]), summary, job: publicJob(updatedJob.rows[0]) })
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }))

  router.patch('/:jobId/review-selection', requireStore, asyncRoute(async (req, res) => {
    const action = String(req.body?.action || '')
    if (!['ready', 'none'].includes(action)) return res.status(400).json({ error: 'Ação de seleção inválida.' })
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const lockedJob = await client.query(
        'SELECT id,status FROM import_jobs WHERE id=$1 AND store_id=$2 FOR UPDATE',
        [req.params.jobId, req.scannerStore.store_id],
      )
      if (!lockedJob.rowCount) {
        await client.query('ROLLBACK')
        return res.status(404).json({ error: 'Importação não encontrada.' })
      }
      if (lockedJob.rows[0].status !== 'review') {
        await client.query('ROLLBACK')
        return res.status(409).json({ error: 'Essa importação não está mais em revisão.' })
      }
      if (action === 'none') {
        await client.query('UPDATE import_normalized_products SET selected=false,updated_at=now() WHERE job_id=$1 AND store_id=$2', [req.params.jobId, req.scannerStore.store_id])
      } else {
        await client.query(
          `UPDATE import_normalized_products SET selected=(jsonb_array_length(warnings)=0),updated_at=now()
           WHERE job_id=$1 AND store_id=$2`,
          [req.params.jobId, req.scannerStore.store_id],
        )
      }
      const summary = await refreshReviewStats(client, req.params.jobId, req.scannerStore.store_id)
      const updatedJob = await client.query('SELECT * FROM import_jobs WHERE id=$1', [req.params.jobId])
      await client.query('COMMIT')
      return res.json({ summary, job: publicJob(updatedJob.rows[0]) })
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }))

  router.post('/', requireStore, asyncRoute(async (req, res) => {
    let normalized
    try { normalized = normalizeImportUrl(req.body?.url) }
    catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : 'URL inválida.' }) }

    // Known lookalike URL: the Alexandre Bijoux catalog belongs to
    // bijouxalexandre.com.br (name order reversed). Never queue a generic
    // crawler against the lookalike and report a misleading empty catalog.
    if (['alexandrebijoux.com.br', 'www.alexandrebijoux.com.br'].includes(normalized.host)) {
      return res.status(400).json({
        error: 'Endereço diferente: você informou alexandrebijoux.com.br. Para a loja Alexandre Bijoux, use https://bijouxalexandre.com.br (Bijoux antes de Alexandre). Nenhum scanner foi iniciado.',
        suggested_url: 'https://bijouxalexandre.com.br',
      })
    }
    if (normalized.host === 'wa.me' && !whatsappCatalogPhone(normalized.url)) {
      return res.status(400).json({ error:'Use o link do catálogo do WhatsApp no formato https://wa.me/c/55DDDNUMERO.' })
    }
    if (whatsappCatalogPhone(normalized.url)) {
      try { uazapiCatalogConfig() }
      catch(error) { return res.status(503).json({ error:error instanceof Error ? error.message : 'Integração de catálogo WhatsApp indisponível.' }) }
    }
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
