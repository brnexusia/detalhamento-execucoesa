import crypto from 'node:crypto'
import express from 'express'
import pg from 'pg'
import { prepareReview } from './scanner-review.mjs'
import { importPublishGroupHash, previewPdfPublishGroups, mergeImportParentProducts } from './scanner-import-grouping.mjs'
import { inferPdfProductCategory } from './scanner-pdf-category.mjs'
import { fetchBestImportImage, isBraavoImageUrl, localizeImportedProductMedia } from './import-media-localizer.mjs'
import { stageSelectedImportMedia } from './scanner-publish-media.mjs'
import { planAlexandreRecovery } from './scanner-alexandre-recovery.mjs'
import { createPublishTaskQueue, publicationPercent } from './scanner-publish-progress.mjs'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 4, connectionTimeoutMillis: 5000 }) : null
const publishTasks = pool ? createPublishTaskQueue(pool) : null
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
    ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS publish_mode text;
    ALTER TABLE import_normalized_products ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
    ALTER TABLE import_normalized_products ADD COLUMN IF NOT EXISTS published_product_id text;
    ALTER TABLE import_normalized_products ADD COLUMN IF NOT EXISTS publish_result text NOT NULL DEFAULT '';
    ALTER TABLE import_normalized_products ADD COLUMN IF NOT EXISTS published_at timestamptz;
    ALTER TABLE import_normalized_products ADD COLUMN IF NOT EXISTS publish_group_key text NOT NULL DEFAULT '';
    ALTER TABLE products ADD COLUMN IF NOT EXISTS images jsonb NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS variant_images jsonb NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS source_url text;
    ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS source_quality_checked_at timestamptz;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_media_assets_store_source_unique
      ON media_assets(store_id,source_url) WHERE source_url IS NOT NULL;
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
      publish_mode: job.publish_mode || null,
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

function pdfMode(value, platform) {
  if (platform !== 'pdf') return 'grouped'
  if (!value) return 'separate'
  return value === 'separate' || value === 'grouped' ? value : null
}

function categoryForPublication(data, platform) {
  const category = String(data?.category || '').trim()
  if (platform === 'pdf' && (!category || /^geral$/i.test(category))) return inferPdfProductCategory(data?.name)
  return category || 'Geral'
}

async function previewJob(req, res) {
  await ensurePublisherSchema()
  const store = await currentStore(req)
  if (!store) return res.status(401).json({ error: 'Sessão necessária.' })
  const found = await pool.query('SELECT * FROM import_jobs WHERE id=$1 AND store_id=$2 LIMIT 1', [req.params.jobId, store.store_id])
  if (!found.rowCount) return res.status(404).json({ error: 'Importação não encontrada.' })
  const job = found.rows[0]
  if (job.status !== 'review') return res.status(409).json({ error: 'A importação ainda não está em revisão.' })
  const mode = pdfMode(String(req.query.mode || ''), job.platform)
  if (!mode) return res.status(400).json({ error: 'Modo de importação inválido.' })
  const selected = await pool.query(
    `SELECT n.id,COALESCE(n.review_data,n.normalized_data) AS data,
       c.raw_data->>'external_id' AS external_id
     FROM import_normalized_products n
     LEFT JOIN import_candidates c ON c.id=n.source_candidate_id
     WHERE n.job_id=$1 AND n.store_id=$2 AND n.selected=true ORDER BY n.id ASC`,
    [job.id, store.store_id],
  )
  const preview = job.platform === 'alexandre-bijoux'
    ? (() => {
        const groups = new Set(selected.rows.map((row) =>
          importPublishGroupHash(row.data, {
            sourcePlatform: 'alexandre-bijoux',
            externalId: row.external_id,
          })))
        return {
          mode: 'separate', selected_count: selected.rows.length,
          publication_count: groups.size,
          grouped_count: selected.rows.length - groups.size,
          examples: [],
        }
      })()
    : previewPdfPublishGroups(selected.rows, mode)
  res.json({ preview, job: { id: job.id, platform: job.platform } })
}

async function assignPublishGroups(client, jobId, storeId, pdfSeparate = false, sourcePlatform = '', onProgress = async () => {}) {
  const totalRowsResult = await client.query(
    'SELECT COUNT(*)::int AS n FROM import_normalized_products WHERE job_id=$1 AND store_id=$2 AND selected=true',
    [jobId,storeId])
  const totalRows = Number(totalRowsResult.rows[0]?.n || 0)
  let processed = 0
  await onProgress({phase:'grouping',completed:0,total:totalRows})
  let cursorId = ''
  while (true) {
    const result = await client.query(
      `SELECT n.id,COALESCE(n.review_data,n.normalized_data) AS data,
         c.raw_data->>'external_id' AS external_id
       FROM import_normalized_products n
       LEFT JOIN import_candidates c ON c.id=n.source_candidate_id
       WHERE n.job_id=$1 AND n.store_id=$2 AND n.selected=true AND n.id>$3
       ORDER BY n.id ASC
       LIMIT $4
       FOR UPDATE OF n`,
      [jobId, storeId, cursorId, PUBLISH_BATCH_SIZE],
    )
    if (!result.rowCount) break

    const updates = result.rows.map((row) => ({
      id: row.id,
      group_key: importPublishGroupHash(row.data, {
        pdfSeparate, rowId: row.id, sourcePlatform, externalId: row.external_id,
      }),
    }))
    await client.query(
      `UPDATE import_normalized_products p
       SET publish_group_key=x.group_key,updated_at=now()
       FROM jsonb_to_recordset($1::jsonb) AS x(id text,group_key text)
       WHERE p.id=x.id AND p.job_id=$2 AND p.store_id=$3`,
      [JSON.stringify(updates), jobId, storeId],
    )
    processed += result.rows.length
    await onProgress({phase:'grouping',completed:processed,total:totalRows})
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

async function materializeRows(query, rows) {
  const stats = { localized: 0, failed: 0, changed: 0 }
  const queue = [...rows]
  const workers = Array.from({ length: Math.min(4, Math.max(1, queue.length)) }, async () => {
    while (queue.length) {
      const row = queue.shift()
      if (!row) break
      const result = await localizeImportedProductMedia({
        query,
        storeId: row.store_id,
        sourceUrl: row.source_url || '',
        product: row,
      })
      stats.localized += result.localized
      stats.failed += result.failed
      if (!result.changed) continue
      await query(
        `UPDATE products
         SET media_url=$1,images=$2,variant_images=$3,updated_at=now()
         WHERE id=$4 AND store_id=$5`,
        [result.mediaUrl, JSON.stringify(result.images), JSON.stringify(result.variantImages), row.id, row.store_id],
      )
      stats.changed += 1
    }
  })
  await Promise.all(workers)
  return stats
}

async function materializeJobMedia(query, jobId, storeId) {
  const result = await query(
    `SELECT DISTINCT ON (p.id)
       p.id,p.store_id,p.name,p.sku,p.media_url,p.media_type,p.images,p.variant_images,
       COALESCE(n.review_data,n.normalized_data)->>'source_url' AS source_url
     FROM import_normalized_products n
     JOIN products p ON p.id=n.published_product_id
     WHERE n.job_id=$1 AND n.store_id=$2
     ORDER BY p.id,n.id ASC`,
    [jobId, storeId],
  )
  return materializeRows(query, result.rows)
}

async function repairExistingImportedMedia() {
  if (!pool) return
  await ensurePublisherSchema()
  let cursor = ''
  while (true) {
    const result = await pool.query(
      `SELECT DISTINCT ON (p.id)
         p.id,p.store_id,p.name,p.sku,p.media_url,p.media_type,p.images,p.variant_images,
         COALESCE(n.review_data,n.normalized_data)->>'source_url' AS source_url
       FROM products p
       JOIN import_normalized_products n ON n.published_product_id=p.id
       WHERE p.id>$1
         AND (
           p.media_url ~ '^https?://'
           OR p.images::text ~ 'https?://'
           OR p.variant_images::text ~ 'https?://'
         )
       ORDER BY p.id,n.id ASC
       LIMIT 50`,
      [cursor],
    )
    if (!result.rowCount) break
    await materializeRows(pool.query.bind(pool), result.rows)
    cursor = result.rows.at(-1).id
  }
}

let braavoQualityUpgradePromise = null

async function upgradeExistingBraavoMediaAssets() {
  if (!pool) return { checked: 0, upgraded: 0, failed: 0 }
  if (braavoQualityUpgradePromise) return braavoQualityUpgradePromise

  braavoQualityUpgradePromise = (async () => {
    await ensurePublisherSchema()
    const stats = { checked: 0, upgraded: 0, failed: 0 }

    while (true) {
      const result = await pool.query(
        `SELECT id,source_url,byte_size
         FROM media_assets
         WHERE source_quality_checked_at IS NULL
           AND source_url IS NOT NULL
           AND source_url ~ '^https://thumb\\.braavo\\.me/slave/(0|200|600|1000)/'
         ORDER BY id
         LIMIT 100`,
      )
      if (!result.rowCount) break

      const queue = [...result.rows]
      const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
        while (queue.length) {
          const row = queue.shift()
          if (!row) break
          try {
            if (!isBraavoImageUrl(row.source_url)) {
              await pool.query('UPDATE media_assets SET source_quality_checked_at=now() WHERE id=$1', [row.id])
              stats.checked += 1
              continue
            }
            const fetched = await fetchBestImportImage(row.source_url)
            const nextBytes = fetched.buffer.length
            await pool.query(
              `UPDATE media_assets
               SET data=$1,mime_type=$2,byte_size=$3,source_quality_checked_at=now()
               WHERE id=$4`,
              [fetched.buffer, fetched.mimeType, nextBytes, row.id],
            )
            stats.checked += 1
            if (nextBytes !== Number(row.byte_size || 0) || fetched.resolvedUrl !== row.source_url) stats.upgraded += 1
          } catch {
            await pool.query('UPDATE media_assets SET source_quality_checked_at=now() WHERE id=$1', [row.id]).catch(() => undefined)
            stats.checked += 1
            stats.failed += 1
          }
        }
      })
      await Promise.all(workers)
    }

    return stats
  })().finally(() => { braavoQualityUpgradePromise = null })

  return braavoQualityUpgradePromise
}

async function publishJob(req, res) {
  await ensurePublisherSchema()
  const store = req.__publishWorkerStore || await currentStore(req)
  if (!store) return res.status(401).json({ error: 'Sessão necessária.' })
  const onProgress = typeof req.__publishWorkerProgress === 'function'
    ? req.__publishWorkerProgress : async () => {}

  // Remote downloads must finish BEFORE a publishing transaction. Previously
  // products were committed with external URLs and fixed in the background.
  try {
    await stageSelectedImportMedia({
      query:pool.query.bind(pool),
      storeId:store.store_id,
      jobId:req.params.jobId,
      onProgress,
    })
  } catch (error) {
    return res.status(409).json({ error:error instanceof Error ? error.message :
      'Não foi possível salvar as imagens antes da publicação.' })
  }

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

    const mode = pdfMode(String(req.body?.mode || ''), job.platform)
    if (!mode) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'Modo de importação inválido.' })
    }
    await assignPublishGroups(client, job.id, store.store_id,
      job.platform === 'pdf' && mode === 'separate', job.platform, onProgress)

    const groupCountResult = await client.query(
      `SELECT count(DISTINCT publish_group_key)::int AS count
       FROM import_normalized_products
       WHERE job_id=$1 AND store_id=$2 AND selected=true AND publish_group_key<>''`,
      [job.id, store.store_id],
    )
    const selectedParentCount = Number(groupCountResult.rows[0]?.count || 0)
    // A 1,308-item Alexandre catalog must never silently collapse into
    // 88 products again because dozens share a generic title and price.
    if (job.platform === 'alexandre-bijoux' && selectedParentCount !== Number(job.selected_count || 0)) {
      await client.query('ROLLBACK')
      return res.status(409).json({
        error: 'A publicação do Alexandre agrupou itens distintos. Nenhum produto foi gravado: revise as identidades e tente novamente.',
      })
    }
    if (!selectedParentCount) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'Nenhum produto válido está selecionado para importação.' })
    }

    let created = 0
    let skippedExisting = 0
    let cursorGroupKey = ''
    await onProgress({phase:'saving',completed:0,total:selectedParentCount})

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
          for (const row of item.members) publishRows.push({ row_id: row.id, product_id: alreadyPublished.published_product_id, result })
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
        const images = Array.isArray(data.images) ? data.images.slice(0, 40) : []
        const mediaUrl = String(data.media_url || images[0] || '').trim().slice(0, 1000)
        productRows.push({
          id: productId,
          store_id: store.store_id,
          sku,
          name: String(data.name || '').trim().slice(0, 180),
          description: String(data.description || '').trim().slice(0, 2000),
          price: Number(data.price),
          category: categoryForPublication(data, job.platform).slice(0, 80),
          media_url: mediaUrl,
          media_type: data.media_type === 'video' ? 'video' : 'image',
          images,
          variant_images: Array.isArray(data.variant_images) ? data.variant_images.slice(0, 80) : [],
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
           (id,store_id,sku,name,description,price,category,media_url,media_type,images,variant_images,pack,variations,featured,active)
           SELECT x.id,x.store_id,x.sku,x.name,x.description,x.price,x.category,x.media_url,x.media_type,x.images,x.variant_images,x.pack,x.variations,false,true
           FROM jsonb_to_recordset($1::jsonb) AS x(
             id text,store_id text,sku text,name text,description text,price numeric,category text,media_url text,media_type text,images jsonb,variant_images jsonb,pack text,variations jsonb
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

      await onProgress({
        phase:'saving',completed:created + skippedExisting,total:selectedParentCount,
      })
      cursorGroupKey = groupKeys.at(-1)
    }

    if (created + skippedExisting === 0) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'Nenhum produto válido está selecionado para importação.' })
    }

    const updated = await client.query(
      `UPDATE import_jobs
       SET status='completed',published_count=$1,skipped_existing_count=$2,publish_mode=$3,published_at=now(),updated_at=now()
       WHERE id=$4 AND store_id=$5
       RETURNING *`,
      [created, skippedExisting, mode, job.id, store.store_id],
    )
    await client.query('COMMIT')
    await onProgress({phase:'committed',completed:selectedParentCount,total:selectedParentCount})
      .catch(error => console.warn('[publish progress] committed, status update failed:',error.message))
    // Images were localized before publication. PDF images have always been
    // embedded at scan time; no asynchronous media repair is needed here.
    return res.json({ ...publicResult(updated.rows[0], false), media: { queued: false, localizedBeforePublish: true } })
  } catch (error) {
    try { await client.query('ROLLBACK') } catch {}
    throw error
  } finally {
    client.release()
  }
}


/**
 * Explicit repair of previously grouped PDF jobs. Only rows which the old job
 * created and linked to the same product are split. Existing product IDs, user
 * edits, prices, and media are preserved; re-running is idempotent.
 */
async function recoverLegacyPdfJob(req, res) {
  await ensurePublisherSchema()
  const store = await currentStore(req)
  if (!store) return res.status(401).json({ error: 'Sessão necessária.' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [`scanner-publish-store:${store.store_id}`])
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [`scanner-publish-job:${req.params.jobId}`])
    const found = await client.query(
      'SELECT * FROM import_jobs WHERE id=$1 AND store_id=$2 FOR UPDATE',
      [req.params.jobId, store.store_id],
    )
    if (!found.rowCount) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Importação não encontrada.' })
    }
    const job = found.rows[0]
    if (job.platform !== 'pdf' || job.status !== 'completed' || job.publish_mode) {
      await client.query('ROLLBACK')
      return res.status(409).json({ error: 'A recuperação é exclusiva de PDFs antigos publicados com agrupamento automático.' })
    }

    const result = await client.query(
      `SELECT id,published_product_id,publish_result,COALESCE(review_data,normalized_data) AS data
       FROM import_normalized_products
       WHERE job_id=$1 AND store_id=$2 AND selected=true AND published_product_id IS NOT NULL
       ORDER BY id ASC FOR UPDATE`,
      [job.id, store.store_id],
    )
    const groups = new Map()
    for (const row of result.rows) {
      if (row.publish_result !== 'created') continue
      if (!groups.has(row.published_product_id)) groups.set(row.published_product_id, [])
      groups.get(row.published_product_id).push(row)
    }

    const existingIds = [...groups.keys()]
    const existing = existingIds.length ? await client.query(
      'SELECT id,category FROM products WHERE store_id=$1 AND id=ANY($2::text[]) FOR UPDATE',
      [store.store_id, existingIds],
    ) : { rows: [] }
    const existingById = new Map(existing.rows.map((row) => [row.id, row]))
    if (existingById.size !== existingIds.length) {
      await client.query('ROLLBACK')
      return res.status(409).json({ error: 'Há produtos originais removidos. Requer revisão manual para evitar duplicações.' })
    }

    let recovered = 0
    let recategorized = 0
    let notSplitWithSku = 0
    for (const [originalId, members] of groups) {
      const original = existingById.get(originalId)
      const first = members[0]
      const inferred = categoryForPublication(first.data, 'pdf')
      if (inferred !== 'Outros' && (!original.category || /^geral$/i.test(original.category))) {
        const updated = await client.query(
          `UPDATE products SET category=$1 WHERE id=$2 AND store_id=$3
           AND (category IS NULL OR btrim(category)='' OR lower(btrim(category))='geral')`,
          [inferred, originalId, store.store_id],
        )
        recategorized += updated.rowCount
      }
      if (members.length < 2) continue
      // Identical SKUs may be the same stocked item across pages; never split them blindly.
      if (members.some((member) => String(member.data?.sku || '').trim())) {
        notSplitWithSku += members.length - 1
        continue
      }
      for (const member of members.slice(1)) {
        const prepared = prepareReview(member.data)
        if (!prepared.publishable) {
          await client.query('ROLLBACK')
          return res.status(409).json({ error: 'Uma peça do PDF não tem nome ou preço válido. Corrija antes de recuperar.' })
        }
        const data = prepared.data
        const images = Array.isArray(data.images) ? data.images.slice(0, 40) : []
        const productId = id()
        await client.query(
          `INSERT INTO products
           (id,store_id,sku,name,description,price,category,media_url,media_type,images,variant_images,pack,variations,featured,active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13::jsonb,false,true)`,
          [
            productId, store.store_id, '', String(data.name || '').trim().slice(0, 180),
            String(data.description || '').trim().slice(0, 2000), Number(data.price),
            categoryForPublication(data, 'pdf').slice(0, 80),
            String(data.media_url || images[0] || '').trim().slice(0, 1000),
            data.media_type === 'video' ? 'video' : 'image',
            JSON.stringify(images), JSON.stringify(Array.isArray(data.variant_images) ? data.variant_images.slice(0, 80) : []),
            String(data.pack || '').slice(0, 160),
            JSON.stringify(Array.isArray(data.variations) ? data.variations : []),
          ],
        )
        await client.query(
          `UPDATE import_normalized_products
           SET published_product_id=$1,publish_result='created',published_at=now(),updated_at=now()
           WHERE id=$2 AND job_id=$3 AND store_id=$4`,
          [productId, member.id, job.id, store.store_id],
        )
        recovered += 1
      }
    }

    const stats = await client.query(
      `SELECT count(DISTINCT published_product_id) FILTER (WHERE publish_result='created')::int AS created
       FROM import_normalized_products WHERE job_id=$1 AND store_id=$2 AND selected=true`,
      [job.id, store.store_id],
    )
    const totalCreated = Number(stats.rows[0]?.created || 0)
    await client.query(
      `UPDATE import_jobs SET published_count=$1,
       publish_mode=CASE WHEN $2=0 THEN 'separate' ELSE publish_mode END,updated_at=now()
       WHERE id=$3 AND store_id=$4`,
      [totalCreated, notSplitWithSku, job.id, store.store_id],
    )
    await client.query('COMMIT')
    res.json({ recovered, recategorized, preserved_originals: groups.size, total_published: totalCreated, not_split_with_sku: notSplitWithSku })
  } catch (error) {
    try { await client.query('ROLLBACK') } catch {}
    throw error
  } finally {
    client.release()
  }
}


async function alexandreRecoveryContext(query, jobId, storeId) {
  const rows = await query(
    `SELECT n.id,n.published_product_id,n.publish_result,
       COALESCE(n.review_data,n.normalized_data) AS data,
       c.raw_data->>'external_id' AS external_id
     FROM import_normalized_products n
     LEFT JOIN import_candidates c ON c.id=n.source_candidate_id
     WHERE n.job_id=$1 AND n.store_id=$2 AND n.selected=true
     ORDER BY n.id ASC`,
    [jobId,storeId],
  )
  if (!rows.rowCount) throw new Error('Histórico das peças não encontrado. Não é seguro recuperar automaticamente.')
  const ids=[...new Set(rows.rows.map(row=>row.published_product_id).filter(Boolean))]
  const products = await query(
    'SELECT id,media_url,images,active FROM products WHERE store_id=$1 AND id=ANY($2::text[])',
    [storeId, ids],
  )
  const plan = planAlexandreRecovery(rows.rows,products.rows)
  return plan
}

async function alexandreRecoveryPreview(req,res) {
  await ensurePublisherSchema()
  const store=await currentStore(req)
  if(!store)return res.status(401).json({error:'Sessão necessária.'})
  const found=await pool.query(
    'SELECT id,platform,status,selected_count,published_count FROM import_jobs WHERE id=$1 AND store_id=$2',
    [req.params.jobId,store.store_id],
  )
  const job=found.rows[0]
  if(!job)return res.status(404).json({error:'Importação não encontrada.'})
  if(job.platform!=='alexandre-bijoux' || job.status!=='completed')
    return res.status(409).json({error:'Recuperação exclusiva de importações Alexandre Bijoux já concluídas.'})
  try{
    const plan=await alexandreRecoveryContext(pool.query.bind(pool),job.id,store.store_id)
    return res.json({preview:{
      selected:plan.total,
      preserved:plan.originals,
      missing:plan.create.length,
      recoverable:plan.create.length>0,
    }})
  }catch(error){
    return res.status(409).json({error:error instanceof Error?error.message:'Histórico insuficiente para recuperação segura.'})
  }
}

async function recoverAlexandreJob(req,res) {
  await ensurePublisherSchema()
  const store=await currentStore(req)
  if(!store)return res.status(401).json({error:'Sessão necessária.'})
  if(req.body?.confirm!==true || !Number.isInteger(req.body?.expectedMissing))
    return res.status(400).json({error:'Confirmação e quantidade previstas são obrigatórias.'})
  const client=await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)",[`scanner-publish-store:${store.store_id}`])
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)",[`scanner-publish-job:${req.params.jobId}`])
    const found=await client.query(
      'SELECT * FROM import_jobs WHERE id=$1 AND store_id=$2 FOR UPDATE',
      [req.params.jobId,store.store_id],
    )
    const job=found.rows[0]
    if(!job){await client.query('ROLLBACK');return res.status(404).json({error:'Importação não encontrada.'})}
    if(job.platform!=='alexandre-bijoux' || job.status!=='completed'){
      await client.query('ROLLBACK')
      return res.status(409).json({error:'A recuperação é exclusiva do Alexandre Bijoux já publicado.'})
    }
    const plan=await alexandreRecoveryContext(client.query.bind(client),job.id,store.store_id)
    if(plan.total!==Number(job.selected_count||0) || plan.create.length!==req.body.expectedMissing){
      await client.query('ROLLBACK')
      return res.status(409).json({error:'A quantidade mudou desde a prévia. Atualize antes de recuperar.'})
    }
    if(plan.create.length===0){
      await client.query('COMMIT')
      return res.json({recovered:0,preserved_originals:plan.originals,total_published:plan.total,idempotent:true})
    }
    // Preserve existing product records and their IDs; never delete/recreate
    // them or overwrite owner edits. Only add the separate missing pieces.
    const toCreate=plan.create.map(item=>{
      const data=item.prepared
      return {
        id:id(),store_id:store.store_id,sku:String(data.sku||'').slice(0,80),
        name:String(data.name||'').slice(0,180),
        description:String(data.description||'').slice(0,2000),
        price:Number(data.price),category:categoryForPublication(data,'alexandre-bijoux').slice(0,80),
        media_url:String(data.media_url||'').slice(0,1000),
        media_type:data.media_type==='video'?'video':'image',
        images:Array.isArray(data.images)?data.images.slice(0,40):[],
        variant_images:Array.isArray(data.variant_images)?data.variant_images.slice(0,80):[],
        pack:String(data.pack||'').slice(0,160),
        variations:Array.isArray(data.variations)?data.variations:[],
        source_row_id:item.id,group_key:item.group_key,
      }
    })
    for(let offset=0;offset<toCreate.length;offset+=100){
      const part=toCreate.slice(offset,offset+100)
      await client.query(
        `INSERT INTO products
         (id,store_id,sku,name,description,price,category,media_url,media_type,images,variant_images,pack,variations,featured,active)
         SELECT x.id,x.store_id,x.sku,x.name,x.description,x.price,x.category,x.media_url,x.media_type,x.images,x.variant_images,x.pack,x.variations,false,true
         FROM jsonb_to_recordset($1::jsonb) AS x(
           id text,store_id text,sku text,name text,description text,price numeric,
           category text,media_url text,media_type text,images jsonb,variant_images jsonb,pack text,variations jsonb,source_row_id text,group_key text
         )`,
        [JSON.stringify(part)],
      )
      await client.query(
        `UPDATE import_normalized_products n SET
           published_product_id=x.id,publish_group_key=x.group_key,
           publish_result='created',updated_at=now()
         FROM jsonb_to_recordset($1::jsonb) AS x(id text,source_row_id text,group_key text)
         WHERE n.id=x.source_row_id AND n.job_id=$2 AND n.store_id=$3`,
        [JSON.stringify(part),job.id,store.store_id],
      )
    }
    const retained=plan.retain.map(item=>({row_id:item.id,group_key:item.group_key}))
    await client.query(
      `UPDATE import_normalized_products n SET publish_group_key=x.group_key,updated_at=now()
       FROM jsonb_to_recordset($1::jsonb) AS x(row_id text,group_key text)
       WHERE n.id=x.row_id AND n.job_id=$2 AND n.store_id=$3`,
      [JSON.stringify(retained),job.id,store.store_id],
    )
    const verify=await client.query(
      `SELECT COUNT(*)::int AS rows,
          COUNT(DISTINCT published_product_id)::int AS distinct_products
       FROM import_normalized_products
       WHERE job_id=$1 AND store_id=$2 AND selected=true AND published_product_id IS NOT NULL`,
      [job.id,store.store_id],
    )
    if(Number(verify.rows[0]?.rows)!==plan.total ||
       Number(verify.rows[0]?.distinct_products)!==plan.total)
      throw new Error('A recuperação não preservou a identidade de todas as peças. Transação revertida.')
    await client.query(
      `UPDATE import_jobs SET published_count=$1,skipped_existing_count=0,
         publish_mode='separate',updated_at=now()
       WHERE id=$2 AND store_id=$3`,
      [plan.total,job.id,store.store_id],
    )
    await client.query('COMMIT')
    return res.json({recovered:toCreate.length,preserved_originals:plan.originals,total_published:plan.total,idempotent:false})
  }catch(error){
    try{await client.query('ROLLBACK')}catch{}
    const message=String(error?.message||'')
    if(/SHOPVAX_PLAN_PRODUCT_LIMIT|SHOPVAX_PLAN_|plan.*limit/i.test(message))
      return res.status(409).json({error:'A quantidade ultrapassa o limite de produtos do plano atual. Atualize o plano antes de recuperar.'})
    return res.status(409).json({error:message.slice(0,300)||'Não foi possível recuperar as peças com segurança.'})
  }finally{client.release()}
}


/**
 * Public endpoint returns instantly. Work is drained from a durable queue and
 * survives navigation/reloads and temporary worker restarts.
 */
async function enqueuePublishJob(req,res){
  await ensurePublisherSchema()
  const store=await currentStore(req)
  if(!store)return res.status(401).json({error:'Sessão necessária.'})
  const selected=await pool.query(
    'SELECT status,platform FROM import_jobs WHERE id=$1 AND store_id=$2',
    [req.params.jobId,store.store_id])
  if(!selected.rowCount)return res.status(404).json({error:'Importação não encontrada.'})
  const job=selected.rows[0]
  if(job.status==='completed')return res.status(409).json({error:'Este catálogo já foi publicado. Atualize o painel.'})
  if(job.status!=='review')return res.status(409).json({error:'Revise os produtos antes de iniciar a publicação.'})
  const mode=pdfMode(req.body?.mode || '',job.platform)
  if(!mode)return res.status(400).json({error:'Modo de importação inválido.'})
  const task=await publishTasks.enqueue(req.params.jobId,store.store_id,mode)
  return res.status(202).json({progress:task})
}

async function readPublishProgress(req,res) {
  await ensurePublisherSchema()
  const store=await currentStore(req)
  if(!store)return res.status(401).json({error:'Sessão necessária.'})
  const found=await pool.query(
    'SELECT id FROM import_jobs WHERE id=$1 AND store_id=$2',
    [req.params.jobId,store.store_id])
  if(!found.rowCount)return res.status(404).json({error:'Importação não encontrada.'})
  return res.json({progress:await publishTasks.get(req.params.jobId,store.store_id)})
}

let publishWorkerBusy=false
async function runPublishWorker(){
  if(!pool || !publishTasks || publishWorkerBusy)return
  publishWorkerBusy=true
  let heartbeat
  let task
  try{
    task=await publishTasks.claim()
    if(!task)return
    heartbeat=setInterval(()=>{
      void publishTasks.heartbeat(task.job_id).catch(error=>
        console.warn('[publish worker] heartbeat:',error.message))
    },8000)
    heartbeat.unref()
    let lastPhase='',lastPercentage=-1,lastAt=0
    const onProgress=async event=>{
      const phase=String(event.phase||'queued')
      const completed=Number(event.completed||0)
      const total=Number(event.total||0)
      const now=Date.now()
      const percentage=publicationPercent(phase,completed,total)
      if(phase===lastPhase && percentage===lastPercentage && now-lastAt<1200)return
      lastPhase=phase;lastPercentage=percentage;lastAt=now
      await publishTasks.update(task.job_id,event)
    }
    const res={
      statusCode:200,
      payload:null,
      status(value){this.statusCode=value;return this},
      json(value){this.payload=value;return this},
    }
    await publishJob({
      params:{jobId:task.job_id},body:{mode:task.mode},
      __publishWorkerStore:{store_id:task.store_id},
      __publishWorkerProgress:onProgress,
    },res)
    if(res.statusCode>=400){
      throw new Error(res.payload?.error||'Não foi possível concluir a publicação.')
    }
    if(!res.payload?.job || res.payload.job.status!=='completed') {
      throw new Error('A publicação não confirmou o commit do catálogo.')
    }
    await publishTasks.finish(task.job_id,res.payload)
  } catch(error){
    if(task){
      await publishTasks.fail(task.job_id,error?.message||String(error))
        .catch(failure=>console.error('[publish worker] failed to persist error:',failure.message))
    }
    console.error('[publish worker]',error?.message||error)
  } finally {
    if(heartbeat)clearInterval(heartbeat)
    publishWorkerBusy=false
  }
}

function installPublisherRoute(app) {
  if (app.__atacadoScannerPublisherInstalled) return
  app.__atacadoScannerPublisherInstalled = true
  app.get('/api/admin/imports/:jobId/publish-preview', (req, res, next) => {
    Promise.resolve(previewJob(req, res)).catch(next)
  })
  app.post('/api/admin/imports/:jobId/publish', express.json({ limit: '16kb' }), (req, res, next) => {
    Promise.resolve(publishJob(req, res)).catch(next)
  })
  app.post('/api/admin/imports/:jobId/publish-async', express.json({limit:'16kb'}), (req,res,next)=>{
    Promise.resolve(enqueuePublishJob(req,res)).catch(next)
  })
  app.get('/api/admin/imports/:jobId/publish-progress', (req,res,next)=>{
    Promise.resolve(readPublishProgress(req,res)).catch(next)
  })
  app.get('/api/admin/imports/:jobId/recover-alexandre-preview', (req,res,next)=>{
    Promise.resolve(alexandreRecoveryPreview(req,res)).catch(next)
  })
  app.post('/api/admin/imports/:jobId/recover-alexandre', express.json({limit:'16kb'}), (req,res,next)=>{
    Promise.resolve(recoverAlexandreJob(req,res)).catch(next)
  })
  app.post('/api/admin/imports/:jobId/recover-pdf', express.json({ limit: '16kb' }), (req, res, next) => {
    Promise.resolve(recoverLegacyPdfJob(req, res)).catch(next)
  })

  if(pool && process.env.SHOPVAX_PUBLISH_WORKER_DISABLED!=='1'){
    const timer=setInterval(()=>void runPublishWorker(),1400)
    timer.unref()
    setImmediate(()=>void runPublishWorker())
  }

  // Legacy repair is explicit opt-in. Avoid parallel repair transactions on
  // every application restart and the deadlocks they caused in production.
  if (pool && process.env.SHOPVAX_IMPORT_MEDIA_REPAIR_ON_STARTUP === '1' &&
      process.env.SHOPVAX_IMPORT_MEDIA_REPAIR_DISABLED !== '1') {
    const timer = setTimeout(() => {
      void (async () => {
        const lock = await pool.connect()
        try {
          const acquired = await lock.query(
            "SELECT pg_try_advisory_lock(hashtext('shopvax-legacy-media-repair')::bigint) AS ok"
          )
          if (!acquired.rows[0]?.ok) return
          try {
            await repairExistingImportedMedia()
            await upgradeExistingBraavoMediaAssets()
          } finally {
            await lock.query(
              "SELECT pg_advisory_unlock(hashtext('shopvax-legacy-media-repair')::bigint)"
            )
          }
        } finally {lock.release()}
      })().catch(error => console.warn('[scanner publish] opt-in legacy repair:',error?.message || error))
    },30_000)
    timer.unref()
  }
}

const originalInit = express.application.init
express.application.init = function scannerPublisherPatchedInit(...args) {
  const result = originalInit.apply(this, args)
  installPublisherRoute(this)
  return result
}
