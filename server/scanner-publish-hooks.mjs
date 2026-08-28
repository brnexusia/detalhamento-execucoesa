import crypto from 'node:crypto'
import express from 'express'
import pg from 'pg'
import { prepareReview } from './scanner-review.mjs'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 4, connectionTimeoutMillis: 5000 }) : null
const sessionCookie = 'atacado_session'

if (pool) pool.on('error', (error) => console.error('[scanner publish] pool:', error.message))

const id = () => crypto.randomUUID()
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex')

function parseCookies(req) {
  const header = req.headers.cookie || ''
  return Object.fromEntries(header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=')
    return index < 0 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))]
  }))
}

async function ensurePublisherSchema() {
  if (!pool) throw new Error('DATABASE_URL não configurada.')
  await pool.query(`
    ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS published_count integer NOT NULL DEFAULT 0;
    ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS skipped_existing_count integer NOT NULL DEFAULT 0;
    ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS published_at timestamptz;
    ALTER TABLE import_normalized_products ADD COLUMN IF NOT EXISTS published_product_id text;
    ALTER TABLE import_normalized_products ADD COLUMN IF NOT EXISTS publish_result text NOT NULL DEFAULT '';
    ALTER TABLE import_normalized_products ADD COLUMN IF NOT EXISTS published_at timestamptz;
    CREATE INDEX IF NOT EXISTS idx_import_normalized_publish_result ON import_normalized_products(job_id,publish_result);
  `)
}

async function currentStore(req) {
  if (!pool) return null
  const token = parseCookies(req)[sessionCookie]
  if (!token) return null
  const result = await pool.query(
    `SELECT s.id AS store_id,u.id AS user_id
     FROM sessions se
     JOIN users u ON u.id=se.user_id
     JOIN stores s ON s.owner_id=u.id
     WHERE se.token_hash=$1 AND se.expires_at>now()
     LIMIT 1`,
    [hashToken(token)],
  )
  return result.rows[0] || null
}

function publicResult(job, idempotent = false) {
  return {
    job: {
      id: job.id,
      status: job.status,
      selected_count: Number(job.selected_count || 0),
      published_count: Number(job.published_count || 0),
      skipped_existing_count: Number(job.skipped_existing_count || 0),
      published_at: job.published_at || null,
    },
    result: {
      selected: Number(job.selected_count || 0),
      created: Number(job.published_count || 0),
      skipped_existing: Number(job.skipped_existing_count || 0),
    },
    idempotent,
  }
}

async function publishJob(req, res) {
  await ensurePublisherSchema()
  const store = await currentStore(req)
  if (!store) return res.status(401).json({ error: 'Sessão necessária.' })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [`scanner-publish-store:${store.store_id}`])
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [`scanner-publish-job:${req.params.jobId}`])

    const jobResult = await client.query(
      'SELECT * FROM import_jobs WHERE id=$1 AND store_id=$2 LIMIT 1 FOR UPDATE',
      [req.params.jobId, store.store_id],
    )
    if (!jobResult.rowCount) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Importação não encontrada.' })
    }
    const job = jobResult.rows[0]

    if (job.status === 'completed') {
      await client.query('COMMIT')
      return res.json(publicResult(job, true))
    }
    if (job.status !== 'review') {
      await client.query('ROLLBACK')
      return res.status(409).json({ error: 'Essa importação ainda não está pronta para publicação.' })
    }

    const selectedResult = await client.query(
      `SELECT * FROM import_normalized_products
       WHERE job_id=$1 AND store_id=$2 AND selected=true
       ORDER BY created_at ASC
       FOR UPDATE`,
      [job.id, store.store_id],
    )
    if (!selectedResult.rowCount) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'Nenhum produto válido está selecionado para importação.' })
    }

    const preparedRows = selectedResult.rows.map((row) => ({ row, prepared: prepareReview(row.review_data || row.normalized_data) }))
    const invalid = preparedRows.filter((item) => !item.prepared.publishable)
    if (invalid.length) {
      await client.query('ROLLBACK')
      return res.status(409).json({
        error: `${invalid.length} produto(s) selecionado(s) ainda precisam de nome e preço válido. Corrija apenas essas exceções antes de importar.`,
      })
    }

    let created = 0
    let skippedExisting = 0

    for (const item of preparedRows) {
      const row = item.row
      const data = item.prepared.data

      if (row.published_product_id) {
        if (row.publish_result === 'created') created += 1
        else if (row.publish_result === 'existing') skippedExisting += 1
        continue
      }

      let existing = null
      const sku = String(data.sku || '').trim()
      if (sku) {
        const existingResult = await client.query(
          `SELECT id FROM products
           WHERE store_id=$1 AND lower(btrim(sku))=lower(btrim($2))
           ORDER BY created_at ASC LIMIT 1`,
          [store.store_id, sku],
        )
        existing = existingResult.rows[0] || null
      }

      if (existing) {
        skippedExisting += 1
        await client.query(
          `UPDATE import_normalized_products
           SET published_product_id=$1,publish_result='existing',published_at=now(),updated_at=now()
           WHERE id=$2 AND job_id=$3 AND store_id=$4`,
          [existing.id, row.id, job.id, store.store_id],
        )
        continue
      }

      const productId = id()
      const mediaUrl = String(data.media_url || data.images?.[0] || '').trim().slice(0, 1000)
      await client.query(
        `INSERT INTO products
         (id,store_id,sku,name,description,price,category,media_url,media_type,pack,variations,featured,active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false,true)`,
        [
          productId,
          store.store_id,
          sku.slice(0, 80),
          String(data.name || '').trim().slice(0, 180),
          String(data.description || '').trim().slice(0, 2000),
          Number(data.price),
          String(data.category || 'Geral').trim().slice(0, 80) || 'Geral',
          mediaUrl,
          data.media_type === 'video' ? 'video' : 'image',
          String(data.pack || '').trim().slice(0, 160),
          JSON.stringify(Array.isArray(data.variations) ? data.variations : []),
        ],
      )
      created += 1
      await client.query(
        `UPDATE import_normalized_products
         SET published_product_id=$1,publish_result='created',published_at=now(),updated_at=now()
         WHERE id=$2 AND job_id=$3 AND store_id=$4`,
        [productId, row.id, job.id, store.store_id],
      )
    }

    const updated = await client.query(
      `UPDATE import_jobs
       SET status='completed',published_count=$1,skipped_existing_count=$2,published_at=now(),updated_at=now()
       WHERE id=$3 AND store_id=$4
       RETURNING *`,
      [created, skippedExisting, job.id, store.store_id],
    )
    await client.query('COMMIT')
    return res.json(publicResult(updated.rows[0], false))
  } catch (error) {
    try { await client.query('ROLLBACK') } catch {}
    throw error
  } finally {
    client.release()
  }
}

function installPublisherRoute(app) {
  if (app.__atacadoScannerPublisherInstalled) return
  app.__atacadoScannerPublisherInstalled = true
  app.post('/api/admin/imports/:jobId/publish', express.json({ limit: '16kb' }), (req, res, next) => {
    Promise.resolve(publishJob(req, res)).catch(next)
  })
  void ensurePublisherSchema().catch((error) => console.error('[scanner publish] schema:', error.message))
}

const originalInit = express.application.init
express.application.init = function scannerPublisherPatchedInit(...args) {
  const result = originalInit.apply(this, args)
  installPublisherRoute(this)
  return result
}
