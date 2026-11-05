import crypto from 'node:crypto'
import express from 'express'
import pg from 'pg'
import { prepareReview } from './scanner-review.mjs'
import { importPublishGroupHash, previewPdfPublishGroups, mergeImportParentProducts } from './scanner-import-grouping.mjs'
import { inferPdfProductCategory } from './scanner-pdf-category.mjs'
import { fetchBestImportImage, isBraavoImageUrl, localizeImportedProductMedia } from './import-media-localizer.mjs'

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
    ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS publish_mode text;
    ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS hidden_published_product_ids text[] NOT NULL DEFAULT ARRAY[]::text[];
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
    `SELECT id,COALESCE(review_data,normalized_data) AS data FROM import_normalized_products
     WHERE job_id=$1 AND store_id=$2 AND selected=true ORDER BY id ASC`,
    [job.id, store.store_id],
  )
  const preview = previewPdfPublishGroups(selected.rows, mode)
  res.json({ preview, job: { id: job.id, platform: job.platform } })
}

async function assignPublishGroups(client, jobId, storeId, pdfSeparate = false) {
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

    const updates = result.rows.map((row) => ({ id: row.id, group_key: importPublishGroupHash(row.data, { pdfSeparate, rowId: row.id }) }))
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

    const mode = pdfMode(String(req.body?.mode || ''), job.platform)
    if (!mode) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'Modo de importação inválido.' })
    }
    await assignPublishGroups(client, job.id, store.store_id, job.platform === 'pdf' && mode === 'separate')

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
          error: `${invalid.length} produto(s) agrupado(s) ainda precisam de nome, preço e, para PDFs, foto válida. Corrija essas exceções antes de importar.`,
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
    if (process.env.SHOPVAX_IMPORT_MEDIA_REPAIR_DISABLED !== '1') {
      setImmediate(() => {
        void materializeJobMedia(pool.query.bind(pool), job.id, store.store_id)
          .catch((error) => console.warn('[scanner publish] media localization:', error?.message || error))
      })
    }
    return res.json({ ...publicResult(updated.rows[0], false), media: { queued: true } })
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


async function togglePublishedPdfVisibility(req, res, restore = false) {
  await ensurePublisherSchema()
  const store = await currentStore(req)
  if (!store) return res.status(401).json({ error: 'Sessão necessária.' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", ['scanner-publish-store:' + store.store_id])
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", ['scanner-publish-job:' + req.params.jobId])
    const found = await client.query(
      'SELECT id,platform,status,hidden_published_product_ids FROM import_jobs WHERE id=$1 AND store_id=$2 FOR UPDATE',
      [req.params.jobId, store.store_id],
    )
    const job = found.rows[0]
    if (!job) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Importação não encontrada.' }) }
    if (job.platform !== 'pdf' || job.status !== 'completed') {
      await client.query('ROLLBACK')
      return res.status(409).json({ error: 'Somente PDFs publicados podem ser ocultados ou restaurados.' })
    }
    const savedIds = Array.isArray(job.hidden_published_product_ids) ? job.hidden_published_product_ids : []
    if (restore) {
      const restored = savedIds.length ? await client.query(
        'UPDATE products SET active=true,updated_at=now() WHERE store_id=$1 AND id=ANY($2::text[]) AND active=false',
        [store.store_id, savedIds],
      ) : { rowCount: 0 }
      await client.query(
        'UPDATE import_jobs SET hidden_published_product_ids=ARRAY[]::text[] WHERE id=$1 AND store_id=$2',
        [job.id, store.store_id],
      )
      await client.query('COMMIT')
      return res.json({ ok: true, restored: restored.rowCount })
    }
    const products = await client.query(
      'SELECT p.id FROM products p WHERE p.store_id=$1 AND p.active=true AND p.id IN ' +
      "(SELECT n.published_product_id FROM import_normalized_products n WHERE n.job_id=$2 AND n.store_id=$1 AND n.publish_result='created')" +
      ' FOR UPDATE OF p',
      [store.store_id, job.id],
    )
    const newlyHiddenIds = products.rows.map((row) => row.id)
    if (newlyHiddenIds.length) {
      await client.query(
        'UPDATE products SET active=false,updated_at=now() WHERE store_id=$1 AND id=ANY($2::text[])',
        [store.store_id, newlyHiddenIds],
      )
    }
    const allIds = [...new Set([...savedIds, ...newlyHiddenIds])]
    await client.query(
      'UPDATE import_jobs SET hidden_published_product_ids=$1::text[] WHERE id=$2 AND store_id=$3',
      [allIds, job.id, store.store_id],
    )
    await client.query('COMMIT')
    return res.json({ ok: true, hidden: newlyHiddenIds.length, total_hidden: allIds.length })
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
  app.post('/api/admin/imports/:jobId/hide-published-pdf', express.json({ limit: '4kb' }), (req, res, next) => {
    Promise.resolve(togglePublishedPdfVisibility(req, res, false)).catch(next)
  })
  app.post('/api/admin/imports/:jobId/restore-published-pdf', express.json({ limit: '4kb' }), (req, res, next) => {
    Promise.resolve(togglePublishedPdfVisibility(req, res, true)).catch(next)
  })
  app.get('/api/admin/imports/:jobId/publish-preview', (req, res, next) => {
    Promise.resolve(previewJob(req, res)).catch(next)
  })
  app.post('/api/admin/imports/:jobId/publish', express.json({ limit: '16kb' }), (req, res, next) => {
    Promise.resolve(publishJob(req, res)).catch(next)
  })
  app.post('/api/admin/imports/:jobId/recover-pdf', express.json({ limit: '16kb' }), (req, res, next) => {
    Promise.resolve(recoverLegacyPdfJob(req, res)).catch(next)
  })

  if (pool && process.env.SHOPVAX_IMPORT_MEDIA_REPAIR_DISABLED !== '1') {
    for (const delay of [15_000, 120_000, 600_000]) {
      const timer = setTimeout(() => {
        void repairExistingImportedMedia().catch((error) => console.warn('[scanner publish] imported media repair:', error?.message || error))
        void upgradeExistingBraavoMediaAssets()
          .then((stats) => {
            if (stats?.checked) console.info(`[scanner publish] braavo media quality: checked=${stats.checked} upgraded=${stats.upgraded} failed=${stats.failed}`)
          })
          .catch((error) => console.warn('[scanner publish] braavo media quality:', error?.message || error))
      }, delay)
      timer.unref()
    }
  }
}

const originalInit = express.application.init
express.application.init = function scannerPublisherPatchedInit(...args) {
  const result = originalInit.apply(this, args)
  installPublisherRoute(this)
  return result
}
