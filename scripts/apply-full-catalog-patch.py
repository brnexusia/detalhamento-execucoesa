from pathlib import Path
import re


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'Bloco não encontrado: {label}')
    return text.replace(old, new, 1)


def replace_regex(text, pattern, replacement, label):
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'Regex não encontrou exatamente um bloco ({count}): {label}')
    return updated


collector_path = Path('server/scanner-collector.mjs')
collector = collector_path.read_text()
collector = replace_once(
    collector,
    "import { isIP } from 'node:net'\nimport { load } from 'cheerio'",
    "import { isIP } from 'node:net'\nimport { gunzipSync } from 'node:zlib'\nimport { load } from 'cheerio'",
    'zlib import',
)
collector = replace_once(
    collector,
    "const DEFAULT_MAX_PRODUCTS = 2000\nconst DEFAULT_MAX_PAGES = 2500\nconst MAX_SITEMAPS = 40\nconst MAX_RESPONSE_BYTES = 5 * 1024 * 1024",
    "// Produção não possui teto artificial de produtos/páginas. Limites só são usados quando\n// explicitamente informados (testes, diagnóstico ou operação controlada).\nconst MAX_RESPONSE_BYTES = 5 * 1024 * 1024\nconst SITEMAP_MAX_RESPONSE_BYTES = 64 * 1024 * 1024",
    'remove hard limits',
)
collector = replace_once(
    collector,
    "      response.on('end', () => {\n        const body = Buffer.concat(chunks).toString('utf8')\n        resolve({",
    "      response.on('end', () => {\n        let buffer = Buffer.concat(chunks)\n        const gzip = String(response.headers['content-encoding'] || '').toLowerCase().includes('gzip') || url.pathname.toLowerCase().endsWith('.gz')\n        if (gzip) {\n          try {\n            buffer = gunzipSync(buffer, { maxOutputLength: Number(options.maxOutputBytes || Math.max(maxBytes, SITEMAP_MAX_RESPONSE_BYTES)) })\n          } catch {\n            reject(new Error('Não foi possível descompactar o sitemap da loja.'))\n            return\n          }\n        }\n        const body = buffer.toString('utf8')\n        resolve({",
    'gzip sitemap support',
)
collector = replace_once(
    collector,
    "    url.hash = ''\n    return url.toString()",
    "    url.hash = ''\n    for (const key of [...url.searchParams.keys()]) {\n      if (/^(utm_|fbclid$|gclid$|msclkid$|ref$|referrer$)/i.test(key)) url.searchParams.delete(key)\n    }\n    url.searchParams.sort()\n    return url.toString()",
    'canonical same-origin url',
)

new_collectors = r'''function configuredLimit(value) {
  if (value == null || value === '') return Number.POSITIVE_INFINITY
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : Number.POSITIVE_INFINITY
}

function candidateKey(product) {
  return `${product?.source_url || ''}|${product?.external_id || ''}|${product?.title || ''}`.toLowerCase()
}

function createCandidateSink(options, maxProducts) {
  const collectInMemory = options.collectInMemory !== false
  const onBatch = typeof options.onBatch === 'function' ? options.onBatch : null
  const candidates = []
  const seen = new Set()
  let count = 0
  let chain = Promise.resolve()

  const push = (items) => {
    chain = chain.then(async () => {
      const accepted = []
      for (const product of Array.isArray(items) ? items : []) {
        if (count >= maxProducts) break
        const key = candidateKey(product)
        if (!product?.title || seen.has(key)) continue
        seen.add(key)
        count += 1
        accepted.push(product)
      }
      if (!accepted.length) return
      if (collectInMemory) candidates.push(...accepted)
      if (onBatch) await onBatch(accepted, { candidateCount: count })
    })
    return chain
  }

  return {
    push,
    flush: () => chain,
    get count() { return count },
    get candidates() { return candidates },
  }
}

function shopifyProduct(origin, product) {
  const options = asArray(product.options).map((option) => ({ name: String(option.name || ''), values: uniqueStrings(option.values || []) }))
  const variants = asArray(product.variants).map((variant) => ({
    external_id: String(variant.id || ''),
    title: String(variant.title || ''),
    sku: String(variant.sku || ''),
    price: Number(variant.price),
    option1: String(variant.option1 || ''),
    option2: String(variant.option2 || ''),
    option3: String(variant.option3 || ''),
    available: variant.available !== false,
  }))
  return {
    source_url: `${origin}/products/${product.handle}`,
    external_id: String(product.id || ''),
    title: String(product.title || ''),
    description: String(product.body_html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
    sku: String(variants[0]?.sku || ''),
    category: String(product.product_type || ''),
    brand: String(product.vendor || ''),
    images: uniqueStrings(asArray(product.images).map((image) => image?.src || '')),
    variants,
    properties: options,
    price: Number.isFinite(variants[0]?.price) ? variants[0].price : null,
    price_text: variants[0]?.price != null ? String(variants[0].price) : '',
    currency: '',
    availability: '',
    source: 'shopify-products-json',
  }
}

async function collectShopify(rootUrl, request, maxProducts, sink, onProgress) {
  const origin = new URL(rootUrl).origin
  const pageSignatures = new Set()
  let pagesScanned = 0

  for (let page = 1; sink.count < maxProducts; page += 1) {
    const url = `${origin}/products.json?limit=250&page=${page}`
    const response = await request(url, { accept: 'application/json' })
    pagesScanned += 1
    if (!response.ok) break
    let payload
    try { payload = JSON.parse(response.body) } catch { break }
    const products = Array.isArray(payload?.products) ? payload.products : []
    if (!products.length) break

    const signature = `${products[0]?.id || products[0]?.handle || ''}|${products.at(-1)?.id || products.at(-1)?.handle || ''}|${products.length}`
    if (pageSignatures.has(signature)) break
    pageSignatures.add(signature)

    await sink.push(products.map((product) => shopifyProduct(origin, product)))
    if (page % 5 === 0 || products.length < 250 || sink.count >= maxProducts) {
      await onProgress({ progress: Math.min(90, 15 + Math.floor(Math.log2(page + 1) * 8)), pagesScanned, candidates: sink.count })
    }
    if (products.length < 250) break
  }

  await sink.flush()
  return { candidateCount: sink.count, pagesScanned }
}

function wooProduct(origin, product) {
  const minor = Number(product.prices?.currency_minor_unit ?? 2)
  const rawPrice = Number(product.prices?.price)
  const price = Number.isFinite(rawPrice) ? rawPrice / (10 ** minor) : null
  return {
    source_url: String(product.permalink || `${origin}/?p=${product.id}`),
    external_id: String(product.id || ''),
    title: String(product.name || ''),
    description: String(product.description || product.short_description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
    sku: String(product.sku || ''),
    category: String(product.categories?.[0]?.name || ''),
    brand: '',
    images: uniqueStrings(asArray(product.images).map((image) => image?.src || image?.thumbnail || '')),
    variants: [],
    properties: asArray(product.attributes).map((attribute) => ({ name: String(attribute.name || ''), values: uniqueStrings(attribute.terms?.map((term) => term.name) || []) })),
    price,
    price_text: price == null ? '' : String(price),
    currency: String(product.prices?.currency_code || ''),
    availability: product.is_in_stock ? 'InStock' : 'OutOfStock',
    source: 'woocommerce-store-api',
  }
}

async function collectWooCommerce(rootUrl, request, maxProducts, sink, onProgress) {
  const origin = new URL(rootUrl).origin
  const pageSignatures = new Set()
  let pagesScanned = 0

  for (let page = 1; sink.count < maxProducts; page += 1) {
    const url = `${origin}/wp-json/wc/store/v1/products?per_page=100&page=${page}`
    const response = await request(url, { accept: 'application/json' })
    pagesScanned += 1
    if (!response.ok) break
    let products
    try { products = JSON.parse(response.body) } catch { break }
    if (!Array.isArray(products) || !products.length) break

    const signature = `${products[0]?.id || ''}|${products.at(-1)?.id || ''}|${products.length}`
    if (pageSignatures.has(signature)) break
    pageSignatures.add(signature)

    await sink.push(products.map((product) => wooProduct(origin, product)))
    if (page % 10 === 0 || products.length < 100 || sink.count >= maxProducts) {
      await onProgress({ progress: Math.min(90, 15 + Math.floor(Math.log2(page + 1) * 8)), pagesScanned, candidates: sink.count })
    }
    if (products.length < 100) break
  }

  await sink.flush()
  return { candidateCount: sink.count, pagesScanned }
}
'''
collector = replace_regex(
    collector,
    r"async function collectShopify\(rootUrl, request, maxProducts\) \{.*?\n\}\n\nasync function collectWooCommerce\(rootUrl, request, maxProducts\) \{.*?\n\}\n(?=\nasync function mapLimit)",
    new_collectors.rstrip(),
    'specialized collectors',
)

new_generic = r'''async function collectGeneric(rootResponse, request, maxProducts, maxPages, onProgress, sink) {
  const rootUrl = rootResponse.url
  const origin = new URL(rootUrl).origin
  const queued = new Set()
  const visited = new Set([rootUrl])
  const highQueue = []
  const normalQueue = []

  const enqueue = (input) => {
    const resolved = sameOriginUrl(input, origin)
    if (!resolved || visited.has(resolved) || queued.has(resolved) || visited.size + queued.size >= maxPages) return
    queued.add(resolved)
    if (productPathScore(resolved) > 0) highQueue.push(resolved)
    else normalQueue.push(resolved)
  }
  const nextBatch = () => {
    const batch = []
    while (batch.length < 12 && (highQueue.length || normalQueue.length)) {
      const url = highQueue.length ? highQueue.shift() : normalQueue.shift()
      if (!url) continue
      queued.delete(url)
      batch.push(url)
    }
    return batch
  }

  for (const link of linksFromHtml(rootResponse.body, rootUrl)) enqueue(link)
  await sink.push(extractProductsFromHtml(rootResponse.body, rootUrl))

  const sitemapQueue = [`${origin}/sitemap.xml`]
  const visitedSitemaps = new Set()
  let pagesScanned = 1

  try {
    const robots = await request(`${origin}/robots.txt`, { accept: 'text/plain' })
    pagesScanned += 1
    if (robots.ok) {
      for (const line of robots.body.split(/\r?\n/)) {
        const match = /^\s*sitemap\s*:\s*(\S+)/i.exec(line)
        if (match) sitemapQueue.push(match[1])
      }
    }
  } catch { /* sitemap.xml fallback remains */ }

  while (sitemapQueue.length && visited.size + queued.size < maxPages && sink.count < maxProducts) {
    const sitemapUrl = sitemapQueue.shift()
    if (!sitemapUrl || visitedSitemaps.has(sitemapUrl)) continue
    visitedSitemaps.add(sitemapUrl)
    try {
      const response = await request(sitemapUrl, {
        accept: 'application/xml,text/xml,text/plain,application/gzip',
        maxBytes: SITEMAP_MAX_RESPONSE_BYTES,
        maxOutputBytes: SITEMAP_MAX_RESPONSE_BYTES,
      })
      pagesScanned += 1
      if (!response.ok) continue
      for (const location of extractSitemapLocations(response.body)) {
        const resolved = sameOriginUrl(location, origin)
        if (!resolved) continue
        if (/\.xml(?:\.gz)?(?:\?|$)/i.test(resolved) || /sitemap/i.test(new URL(resolved).pathname)) {
          if (!visitedSitemaps.has(resolved)) sitemapQueue.push(resolved)
        } else {
          enqueue(resolved)
        }
        if (visited.size + queued.size >= maxPages) break
      }
    } catch { /* one broken sitemap must not abort the catalog */ }
  }

  let processed = 0
  while ((highQueue.length || normalQueue.length) && visited.size < maxPages && sink.count < maxProducts) {
    const batch = nextBatch()
    await mapLimit(batch, 4, async (url) => {
      if (visited.has(url) || sink.count >= maxProducts) return
      visited.add(url)
      try {
        const response = await request(url)
        pagesScanned += 1
        if (!response.ok || !response.contentType.includes('html')) return
        await sink.push(extractProductsFromHtml(response.body, response.url))
        if (visited.size + queued.size < maxPages && sink.count < maxProducts) {
          for (const link of linksFromHtml(response.body, response.url)) enqueue(link)
        }
      } catch { /* inaccessible pages are skipped */ }
      finally {
        processed += 1
        if (processed % 25 === 0 || (!highQueue.length && !normalQueue.length) || sink.count >= maxProducts) {
          const discovered = Math.max(1, visited.size + queued.size)
          const progress = Math.min(90, 15 + Math.round((visited.size / discovered) * 75))
          await onProgress({ progress, pagesScanned, candidates: sink.count })
        }
      }
    })
  }

  await sink.flush()
  return { candidateCount: sink.count, pagesScanned }
}

export async function collectCatalog(sourceUrl, options = {}) {
  const request = options.request || safeRequest
  const maxProducts = configuredLimit(options.maxProducts ?? process.env.SCANNER_MAX_PRODUCTS)
  const maxPages = configuredLimit(options.maxPages ?? process.env.SCANNER_MAX_PAGES)
  const onProgress = options.onProgress || (async () => {})
  const sink = createCandidateSink(options, maxProducts)

  await onProgress({ progress: 5, pagesScanned: 0, candidates: 0 })
  const rootResponse = await request(sourceUrl)
  if (!rootResponse.ok) throw new Error(`A loja respondeu HTTP ${rootResponse.status}.`)
  if (!rootResponse.contentType.includes('html')) throw new Error('A URL informada não parece ser uma página de loja.')

  const platform = detectPlatform(rootResponse.body)
  await onProgress({ progress: 10, pagesScanned: 1, candidates: 0, platform })

  if (platform === 'shopify') {
    try {
      const result = await collectShopify(rootResponse.url, request, maxProducts, sink, onProgress)
      if (result.candidateCount) return { platform, pagesScanned: result.pagesScanned + 1, candidateCount: sink.count, candidates: sink.candidates }
    } catch { /* generic fallback below; already collected batches remain deduplicated */ }
  }

  if (platform === 'woocommerce') {
    try {
      const result = await collectWooCommerce(rootResponse.url, request, maxProducts, sink, onProgress)
      if (result.candidateCount) return { platform, pagesScanned: result.pagesScanned + 1, candidateCount: sink.count, candidates: sink.candidates }
    } catch { /* generic fallback below */ }
  }

  const result = await collectGeneric(rootResponse, request, maxProducts, maxPages, onProgress, sink)
  return { platform, pagesScanned: result.pagesScanned, candidateCount: sink.count, candidates: sink.candidates }
}
'''
collector = replace_regex(
    collector,
    r"async function collectGeneric\(rootResponse, request, maxProducts, maxPages, onProgress\) \{.*?\nexport async function collectCatalog\(sourceUrl, options = \{\}\) \{.*?\n\}",
    new_generic.rstrip(),
    'generic and entry collector',
)
collector_path.write_text(collector)

hooks_path = Path('server/scanner-hooks.mjs')
hooks = hooks_path.read_text()
hooks = replace_once(
    hooks,
    "const workerDisabled = process.env.SCANNER_WORKER_DISABLED === '1'",
    "const workerDisabled = process.env.SCANNER_WORKER_DISABLED === '1'\nconst SCANNER_DB_BATCH_SIZE = 250",
    'db batch constant',
)

new_import_job = r'''export async function processImportJob(jobId, collector = collectCatalog) {
  await ensureScannerSchema()
  const claimed = await pool.query(
    `UPDATE import_jobs SET status='scanning',progress=1,error='',updated_at=now()
     WHERE id=$1 AND status='queued' RETURNING *`,
    [jobId],
  )
  if (!claimed.rowCount) return null
  const job = claimed.rows[0]
  let persistedBatches = 0

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
    await pool.query('DELETE FROM import_normalized_products WHERE job_id=$1', [job.id])
    await pool.query('DELETE FROM import_candidates WHERE job_id=$1', [job.id])

    const result = await collector(job.source_url, {
      collectInMemory: false,
      onBatch: persistBatch,
      onProgress: async ({ progress, pagesScanned, candidates, platform }) => {
        await pool.query(
          `UPDATE import_jobs
           SET progress=GREATEST(progress,$1),pages_scanned=GREATEST(pages_scanned,$2),result_count=GREATEST(result_count,$3),platform=CASE WHEN $4<>'' THEN $4 ELSE platform END,updated_at=now()
           WHERE id=$5 AND status='scanning'`,
          [Math.max(1, Math.min(95, Number(progress || 1))), Number(pagesScanned || 0), Number(candidates || 0), String(platform || ''), job.id],
        )
      },
    })

    // Compatibilidade com coletores de testes/integrações que ainda retornam array.
    if (!persistedBatches && Array.isArray(result?.candidates) && result.candidates.length) await persistBatch(result.candidates)

    const countResult = await pool.query('SELECT count(*)::int AS count FROM import_candidates WHERE job_id=$1 AND store_id=$2', [job.id, job.store_id])
    const persistedCount = Number(countResult.rows[0]?.count || 0)
    const updated = await pool.query(
      `UPDATE import_jobs
       SET status='processing',progress=100,result_count=$1,normalized_count=0,warning_count=0,duplicate_count=0,selected_count=0,review_changed_count=0,platform=$2,pages_scanned=$3,error='',updated_at=now()
       WHERE id=$4 RETURNING *`,
      [persistedCount, String(result?.platform || 'generic'), Number(result?.pagesScanned || 0), job.id],
    )
    return publicJob(updated.rows[0])
  } catch (error) {
    try {
      await pool.query('DELETE FROM import_normalized_products WHERE job_id=$1', [job.id])
      await pool.query('DELETE FROM import_candidates WHERE job_id=$1', [job.id])
    } catch {}
    const message = error instanceof Error ? error.message : String(error)
    const failed = await pool.query(`UPDATE import_jobs SET status='failed',error=$1,updated_at=now() WHERE id=$2 RETURNING *`, [message.slice(0, 2000), job.id])
    console.error('[scanner] job failed:', job.id, message)
    return publicJob(failed.rows[0])
  }
}
'''
hooks = replace_regex(
    hooks,
    r"export async function processImportJob\(jobId, collector = collectCatalog\) \{.*?\n\}\n\n(?=export async function processNormalizationJob)",
    new_import_job + "\n",
    'processImportJob',
)

new_normalization = r'''export async function processNormalizationJob(jobId, normalizer = normalizeCandidates) {
  await ensureScannerSchema()
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
      const rows = products.map((product) => {
        const warnings = Array.isArray(product.warnings) ? product.warnings : []
        return {
          id: id(),
          job_id: job.id,
          store_id: job.store_id,
          source_candidate_id: product.source_candidate_id || null,
          fingerprint: hashValue(product.fingerprint),
          normalized_data: product.normalized,
          warnings,
          confidence: Number.isFinite(Number(product.confidence)) ? Number(product.confidence) : 0,
          selected: warnings.length === 0,
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
}
'''
hooks = replace_regex(
    hooks,
    r"export async function processNormalizationJob\(jobId, normalizer = normalizeCandidates\) \{.*?\n\}\n\n(?=let workerBusy)",
    new_normalization + "\n",
    'processNormalizationJob',
)

hooks = replace_once(
    hooks,
    "const offset = Math.max(0, Math.min(100000, Number(req.query.offset || 0)))",
    "const offset = Math.max(0, Number.isFinite(Number(req.query.offset)) ? Math.floor(Number(req.query.offset)) : 0)",
    'review offset ceiling',
)
hooks_path.write_text(hooks)

publish_path = Path('server/scanner-publish-hooks.mjs')
publish = publish_path.read_text()
publish = replace_once(
    publish,
    "const sessionCookie = 'atacado_session'",
    "const sessionCookie = 'atacado_session'\nconst PUBLISH_BATCH_SIZE = 250",
    'publish batch constant',
)

new_publish_job = r'''async function publishJob(req, res) {
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

    let created = 0
    let skippedExisting = 0
    let cursorCreatedAt = null
    let cursorId = ''

    while (true) {
      const selectedResult = await client.query(
        `SELECT *,created_at::text AS cursor_created_at
         FROM import_normalized_products
         WHERE job_id=$1 AND store_id=$2 AND selected=true
           AND ($3::timestamptz IS NULL OR created_at>$3::timestamptz OR (created_at=$3::timestamptz AND id>$4))
         ORDER BY created_at ASC,id ASC
         LIMIT $5
         FOR UPDATE`,
        [job.id, store.store_id, cursorCreatedAt, cursorId, PUBLISH_BATCH_SIZE],
      )
      if (!selectedResult.rowCount) break

      const preparedRows = selectedResult.rows.map((row) => ({ row, prepared: prepareReview(row.review_data || row.normalized_data) }))
      const invalid = preparedRows.filter((item) => !item.prepared.publishable)
      if (invalid.length) {
        await client.query('ROLLBACK')
        return res.status(409).json({
          error: `${invalid.length} produto(s) selecionado(s) ainda precisam de nome e preço válido. Corrija apenas essas exceções antes de importar.`,
        })
      }

      const pending = preparedRows.filter((item) => !item.row.published_product_id)
      for (const item of preparedRows) {
        if (!item.row.published_product_id) continue
        if (item.row.publish_result === 'created') created += 1
        else if (item.row.publish_result === 'existing') skippedExisting += 1
      }

      const skuKeys = [...new Set(pending.map((item) => String(item.prepared.data.sku || '').trim().toLowerCase()).filter(Boolean))]
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
      for (const item of pending) {
        const row = item.row
        const data = item.prepared.data
        const sku = String(data.sku || '').trim().slice(0, 80)
        const skuKey = sku.toLowerCase()
        const existingId = skuKey ? existingBySku.get(skuKey) : null
        if (existingId) {
          skippedExisting += 1
          publishRows.push({ row_id: row.id, product_id: existingId, result: 'existing' })
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
        publishRows.push({ row_id: row.id, product_id: productId, result: 'created' })
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

      const last = selectedResult.rows.at(-1)
      cursorCreatedAt = last.cursor_created_at
      cursorId = last.id
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
'''
publish = replace_regex(
    publish,
    r"async function publishJob\(req, res\) \{.*?\n\}\n\n(?=function installPublisherRoute)",
    new_publish_job + "\n",
    'publishJob',
)
publish_path.write_text(publish)

# Regressão de 50 mil itens: coleta em lotes -> PostgreSQL -> normalização -> publicação.
scale_test = r'''import assert from 'node:assert/strict'
import pg from 'pg'
import { processImportJob, processNormalizationJob } from './scanner-hooks.mjs'

const { Pool } = pg
const base = process.env.BASE_URL || 'http://127.0.0.1:3000'
const db = new Pool({ connectionString: process.env.DATABASE_URL })
const TOTAL = 50_000
const SOURCE = 'https://catalogo-50k.fixture.example/'

async function register() {
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Escala 50k',
      email: `scanner-50k-${Date.now()}-${Math.random()}@example.test`,
      password: 'scanner1234',
      storeName: `Loja 50k ${Date.now()}`,
      whatsapp: '5511999999999',
    }),
  })
  assert.equal(response.status, 201)
  const body = await response.json()
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie)
  return { cookie, storeSlug: body.storeSlug }
}

async function api(path, cookie, options = {}) {
  return fetch(`${base}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(options.headers || {}) },
  })
}

const startedAt = Date.now()
try {
  const account = await register()
  let response = await api('/api/admin/imports', account.cookie, {
    method: 'POST',
    body: JSON.stringify({ url: SOURCE }),
  })
  assert.equal(response.status, 201)
  let payload = await response.json()
  const jobId = payload.job.id

  const scaleCollector = async (_url, options = {}) => {
    let count = 0
    let pages = 0
    while (count < TOTAL) {
      const size = Math.min(500, TOTAL - count)
      const batch = Array.from({ length: size }, (_, offset) => {
        const index = count + offset + 1
        return {
          source_url: `${SOURCE}produto/${index}`,
          external_id: `EXT-${index}`,
          title: `Produto Escala ${index}`,
          description: '',
          sku: `SCALE-${String(index).padStart(5, '0')}`,
          category: index % 2 ? 'Categoria A' : 'Categoria B',
          brand: '',
          images: [],
          variants: [],
          properties: [],
          price: 10 + (index % 1000) / 100,
          price_text: '',
          currency: 'BRL',
          availability: 'InStock',
          source: 'scale-fixture',
        }
      })
      count += size
      pages += 1
      await options.onBatch?.(batch, { candidateCount: count })
      if (pages % 10 === 0) await options.onProgress?.({ progress: Math.min(95, Math.floor((count / TOTAL) * 95)), pagesScanned: pages, candidates: count, platform: 'scale-fixture' })
    }
    return { platform: 'scale-fixture', pagesScanned: pages, candidateCount: count, candidates: [] }
  }

  const collected = await processImportJob(jobId, scaleCollector)
  assert.equal(collected.status, 'processing')
  assert.equal(collected.result_count, TOTAL, 'a coleta não pode truncar 50 mil produtos')

  const normalized = await processNormalizationJob(jobId)
  assert.equal(normalized.status, 'review')
  assert.equal(normalized.normalized_count, TOTAL, 'normalização precisa processar os 50 mil em lotes')
  assert.equal(normalized.selected_count, TOTAL)
  assert.equal(normalized.duplicate_count, 0)

  response = await api(`/api/admin/imports/${jobId}/publish`, account.cookie, { method: 'POST', body: '{}' })
  assert.equal(response.status, 200)
  payload = await response.json()
  assert.equal(payload.job.status, 'completed')
  assert.equal(payload.result.created, TOTAL, 'publicação em massa precisa criar todos os 50 mil produtos')
  assert.equal(payload.result.skipped_existing, 0)

  const store = await db.query('SELECT id FROM stores WHERE slug=$1 LIMIT 1', [account.storeSlug])
  assert.equal(store.rowCount, 1)
  const productCount = await db.query('SELECT count(*)::int AS count FROM products WHERE store_id=$1', [store.rows[0].id])
  assert.equal(Number(productCount.rows[0].count), TOTAL)

  response = await api(`/api/admin/imports/${jobId}/publish`, account.cookie, { method: 'POST', body: '{}' })
  assert.equal(response.status, 200)
  payload = await response.json()
  assert.equal(payload.idempotent, true)
  assert.equal(payload.result.created, TOTAL)

  console.log(JSON.stringify({ products: TOTAL, elapsedMs: Date.now() - startedAt }, null, 2))
  console.log('[scanner scale] 50k full pipeline: ok')
} finally {
  await db.end()
}
'''
Path('server/scanner-scale.integration.mjs').write_text(scale_test)

# Teste do coletor especializado sem teto: 200 páginas x 250 = 50.000, sem reter tudo em memória.
test_path = Path('server/scanner-collector.test.mjs')
test = test_path.read_text()
anchor = "assert.equal(shopify.candidates[0].properties[0].values[2], 'G')\n\nconsole.log('[scanner module 2] collector tests: ok')"
scale_collector_test = r'''assert.equal(shopify.candidates[0].properties[0].values[2], 'G')

let streamed50k = 0
let maxBatch50k = 0
const shopify50kRequest = async (input) => {
  const url = new URL(String(input))
  if (url.pathname === '/') return { status: 200, ok: true, url: url.toString(), contentType: 'text/html', headers: {}, body: shopifyRoot }
  if (url.pathname !== '/products.json') return { status: 404, ok: false, url: url.toString(), contentType: 'text/plain', headers: {}, body: '' }
  const page = Number(url.searchParams.get('page') || 1)
  if (page > 200) return { status: 200, ok: true, url: url.toString(), contentType: 'application/json', headers: {}, body: JSON.stringify({ products: [] }) }
  const start = (page - 1) * 250
  const products = Array.from({ length: 250 }, (_, offset) => {
    const id = start + offset + 1
    return { id, title: `Produto ${id}`, handle: `produto-${id}`, body_html: '', product_type: 'Teste', vendor: '', options: [], images: [], variants: [{ id, title: 'Default', sku: `SKU-${id}`, price: '10.00', available: true }] }
  })
  return { status: 200, ok: true, url: url.toString(), contentType: 'application/json', headers: {}, body: JSON.stringify({ products }) }
}
const shopify50k = await collectCatalog('https://shop50k.example/', {
  request: shopify50kRequest,
  collectInMemory: false,
  onBatch: async (batch) => {
    streamed50k += batch.length
    maxBatch50k = Math.max(maxBatch50k, batch.length)
  },
})
assert.equal(shopify50k.platform, 'shopify')
assert.equal(shopify50k.candidateCount, 50_000, 'Shopify não pode parar em 5 mil/qualquer teto artificial')
assert.equal(streamed50k, 50_000)
assert.equal(shopify50k.candidates.length, 0, 'modo streaming não deve reter 50 mil objetos na memória')
assert.ok(maxBatch50k <= 250)
assert.ok(shopify50k.pagesScanned >= 201)

console.log('[scanner module 2] collector tests: ok')'''
test = replace_once(test, anchor, scale_collector_test, 'collector 50k test anchor')
test_path.write_text(test)

ci_path = Path('.github/workflows/ci.yml')
ci = ci_path.read_text()
ci = replace_once(
    ci,
    "      - name: Scanner module 6 integration\n        run: npm run test:scanner:module6",
    "      - name: Scanner 50k full pipeline\n        run: node server/scanner-scale.integration.mjs\n      - name: Scanner module 6 integration\n        run: npm run test:scanner:module6",
    'CI 50k step',
)
ci_path.write_text(ci)

print('FULL_CATALOG_PATCH_APPLIED')
