import crypto from 'node:crypto'
import express from 'express'
import pg from 'pg'
import { prepareReview } from './scanner-review.mjs'
import { importParentHash, mergeImportParentProducts } from './scanner-import-grouping.mjs'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 4, connectionTimeoutMillis: 5000 }) : null
const sessionCookie = 'atacado_session'
const PUBLISH_BATCH_SIZE = 250
const PUBLISH_GROUP_BATCH_SIZE = 100

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
    ALTER TABLE import_normalized_products ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
    ALTER TABLE import_normalized_products ADD COLUMN IF NOT EXISTS published_product_id text;
    ALTER TABLE import_normalized_products ADD COLUMN IF NOT EXISTS publish_result text NOT NULL DEFAULT '';
    ALTER TABLE import_normalized_products ADD COLUMN IF NOT EXISTS published_at timestamptz;
    ALTER TABLE import_normalized_products ADD COLUMN IF NOT EXISTS publish_group_key text NOT NULL DEFAULT '';
    CREATE INDEX IF NOT EXISTS idx_import_normalized_publish_result ON import_normalized_products(job_id,publish_result);
    CREATE INDEX IF NOT EXISTS idx_import_normalized_publish_group ON import_normalized_products(job_id,selected,publish_group_key);
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
  const parentProducts = Number(job.published_count || 0) + Number(job.skipped_existing_count || 0)
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
      selected: parentProducts,
      source_rows: Number(job.selected_count || 0),
      created: Number(job.published_count || 0),
      skipped_existing: Number(job.skipped_existing_count || 0),
    },
    idempotent,
  }
}

async function assignPublishGroups(client, jobId, storeId) {
  let cursorId = ''
  while (true) {
    const result = await client.query(
      `SELECT id,COALESCE(review_data,normalized_data) AS data
       FROM import_normalized_products
       WHERE job_id=$1 AND store_id=$2 AND selected=true AND id>$3
       ORDER BY id ASC
       LIMIT $4
       FOR UPDATE`,
      [jobId, storeId, cursorId, PUBLISH_BATCH_SIZE],
    )
    if (!result.rowCount) break

    const updates = result.rows.map((row) => ({ id: row.id, group_key: importParentHash(row.data) }))
    await client.query(
      `UPDATE import_normalized_products p
       SET publish_group_key=x.group_key,updated_at=now()
       FROM jsonb_to_recordset($1::jsonb) AS x(id text,group_key text)
       WHERE p.id=x.id AND p.job_id=$2 AND p.store_id=$3`,
      [JSON.stringify(updates), jobId, storeId],
    )
    cursorId = result.rows.at(-1).id
  }
}

function groupedRows(rows) {
  const groups = new Map()
  for (const row of rows) {
    if (!groups.has(row.publish_group_key)) groups.set(row.publish_group_key, [])
    groups.get(row.publish_group_key).push(row)
  }
  return groups
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

    await assignPublishGroups(client, job.id, store.store_id)

    const groupCountResult = await client.query(
      `SELECT count(DISTINCT publish_group_key)::int AS count
       FROM import_normalized_products
       WHERE job_id=$1 AND store_id=$2 AND selected=true AND publish_group_key<>''`,
      [job.id, store.store_id],
    )
    const selectedParentCount = Number(groupCountResult.rows[0]?.count || 0)
    if (!selectedParentCount) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'Nenhum produto válido está selecionado para importação.' })
    }

    let created = 0
    let skippedExisting = 0
    let cursorGroupKey = ''

    while (true) {
      const keysResult = await client.query(
        `SELECT DISTINCT publish_group_key
         FROM import_normalized_products
         WHERE job_id=$1 AND store_id=$2 AND selected=true AND publish_group_key>$3
         ORDER BY publish_group_key ASC
         LIMIT $4`,
        [job.id, store.store_id, cursorGroupKey, PUBLISH_GROUP_BATCH_SIZE],
      )
      if (!keysResult.rowCount) break
      const groupKeys = keysResult.rows.map((row) => row.publish_group_key)

      const selectedResult = await client.query(
        `SELECT *
         FROM import_normalized_products
         WHERE job_id=$1 AND store_id=$2 AND selected=true AND publish_group_key=ANY($3::text[])
         ORDER BY publish_group_key ASC,id ASC
         FOR UPDATE`,
        [job.id, store.store_id, groupKeys],
      )
      const groups = groupedRows(selectedResult.rows)
      const preparedGroups = []
      for (const groupKey of groupKeys) {
        const members = groups.get(groupKey) || []
        if (!members.length) continue
        const memberData = members.map((row) => prepareReview(row.review_data || row.normalized_data).data)
        const merged = mergeImportParentProducts(memberData)
        const prepared = prepareReview(merged)
        preparedGroups.push({ groupKey, members, prepared })
      }

      const invalid = preparedGroups.filter((item) => !item.prepared.publishable)
      if (invalid.length) {
        await client.query('ROLLBACK')
        return res.status(409).json({
          error: `${invalid.length} produto(s) agrupado(s) ainda precisam de nome e preço válido. Corrija apenas essas exceções antes de importar.`,
        })
      }

      const skuKeys = [...new Set(preparedGroups
        .map((item) => String(item.prepared.data.sku || '').trim().toLowerCase())
        .filter(Boolean))]
      const existingBySku = new Map()
      if (skuKeys.length) {
        const existingResult = await client.query(
          `SELECT id,lower(btrim(sku)) AS sku_key FROM products
           WHERE store_id=$1 AND lower(btrim(sku))=ANY($2::text[])`,
          [store.store_id, skuKeys],
        )
        for (const row of existingResult.rows) existingBySku.set(row.sku_key, row.id)
      }

      const productRows = []
      const publishRows = []
      for (const item of preparedGroups) {
        const alreadyPublished = item.members.find((row) => row.published_product_id)
        if (alreadyPublished) {
          const result = alreadyPublished.publish_result || 'created'
          if (result === 'existing') skippedExisting += 1
          else created += 1
          for (const row of item.members) {
            publishRows.push({ row_id: row.id, product_id: alreadyPublished.published_product_id, result })
          }
          continue
        }

        const data = item.prepared.data
        const sku = String(data.sku || '').trim().slice(0, 80)
        const skuKey = sku.toLowerCase()
        const existingId = skuKey ? existingBySku.get(skuKey) : null
        if (existingId) {
          skippedExisting += 1
          for (const row of item.members) publishRows.push({ row_id: row.id, product_id: existingId, result: 'existing' })
          continue
        }

        const productId = id()
        const mediaUrl = String(data.media_url || data.images?.[0] || '').trim().slice(0, 1000)
        productRows.push({
          id: productId,
          store_id: store.store_id,
          sku,
          name: String(data.name || '').trim().slice(0, 180),
          description: String(data.description || '').trim().slice(0, 2000),
          price: Number(data.price),
          category: String(data.category || 'Geral').trim().slice(0, 80) || 'Geral',
          media_url: mediaUrl,
          media_type: data.media_type === 'video' ? 'video' : 'image',
          pack: String(data.pack || '').trim().slice(0, 160),
          variations: Array.isArray(data.variations) ? data.variations : [],
        })
        for (const row of item.members) publishRows.push({ row_id: row.id, product_id: productId, result: 'created' })
        created += 1
        if (skuKey) existingBySku.set(skuKey, productId)
      }

      if (productRows.length) {
        await client.query(
          `INSERT INTO products
           (id,store_id,sku,name,description,price,category,media_url,media_type,pack,variations,featured,active)
           SELECT x.id,x.store_id,x.sku,x.name,x.description,x.price,x.category,x.media_url,x.media_type,x.pack,x.variations,false,true
           FROM jsonb_to_recordset($1::jsonb) AS x(
             id text,store_id text,sku text,name text,description text,price numeric,category text,media_url text,media_type text,pack text,variations jsonb
           )`,
          [JSON.stringify(productRows)],
        )
      }
      if (publishRows.length) {
        await client.query(
          `UPDATE import_normalized_products p
           SET published_product_id=x.product_id,publish_result=x.result,published_at=now(),updated_at=now()
           FROM jsonb_to_recordset($1::jsonb) AS x(row_id text,product_id text,result text)
           WHERE p.id=x.row_id AND p.job_id=$2 AND p.store_id=$3`,
          [JSON.stringify(publishRows), job.id, store.store_id],
        )
      }

      cursorGroupKey = groupKeys.at(-1)
    }

    if (created + skippedExisting === 0) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'Nenhum produto válido está selecionado para importação.' })
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
}

const originalInit = express.application.init
express.application.init = function scannerPublisherPatchedInit(...args) {
  const result = originalInit.apply(this, args)
  installPublisherRoute(this)
  return result
}
