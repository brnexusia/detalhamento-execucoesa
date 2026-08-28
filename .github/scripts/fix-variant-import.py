from pathlib import Path
import re

normalizer = Path('server/scanner-normalizer.mjs')
source = normalizer.read_text()
old = """function normalizedKey(value) {
  return canonicalKey(value).replace(/\\s+/g, '-')
}

function productFingerprint(candidate, normalized) {
  const sku = canonicalKey(normalized.sku)
  if (sku) return `sku:${sku}`
  const externalId = canonicalKey(candidate?.external_id)
  if (externalId) return `external:${externalId}`
  const sourceUrl = text(candidate?.source_url, 2048)
  if (sourceUrl) return `url:${sourceUrl.toLowerCase()}`
  return `product:${normalizedKey(normalized.name)}:${normalized.price ?? ''}`
}
"""
new = """function normalizedKey(value) {
  return canonicalKey(value).replace(/\\s+/g, '-')
}

const VARIANT_QUERY_PARAM = /^(?:variant|variant_id|variation|variation_id|variacao|variacao_id|id_variacao|sku|color|colour|cor|size|tamanho|tam|option\\d*|opcao\\d*|attribute_.+|atributo_.+)$/i
const TRACKING_QUERY_PARAM = /^(?:utm_.+|fbclid|gclid|msclkid|ref|referrer)$/i

function canonicalProductUrl(value) {
  const raw = text(value, 2048)
  if (!raw) return ''
  try {
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol)) return ''
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (VARIANT_QUERY_PARAM.test(key) || TRACKING_QUERY_PARAM.test(key)) url.searchParams.delete(key)
    }
    url.searchParams.sort()
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\\/+$/, '')
    return url.toString()
  } catch {
    return ''
  }
}

function productUrlIsSpecific(value) {
  try {
    const url = new URL(value)
    const path = url.pathname.replace(/\\/+$/, '') || '/'
    if (path === '/') return false
    if (/\\/(?:catalogo|catalog|loja|shop|produtos|products|categoria|category|collection|collections|busca|search)$/i.test(path)) return false
    return true
  } catch {
    return false
  }
}

export function candidateProductGroupKey(candidate) {
  const parent = text(candidate?.parent_external_id || candidate?.parent_product_id || '', 200)
  if (parent) return `parent:${canonicalKey(parent)}`

  const sourceUrl = canonicalProductUrl(candidate?.source_url)
  if (sourceUrl && productUrlIsSpecific(sourceUrl)) return `url:${sourceUrl.toLowerCase()}`

  let origin = ''
  try { origin = sourceUrl ? new URL(sourceUrl).origin.toLowerCase() : '' } catch {}
  const title = normalizedKey(candidate?.title)
  const category = normalizedKey(candidate?.category)
  const brand = normalizedKey(candidate?.brand)
  const hasVariantEvidence = Boolean(
    text(candidate?.sku, 80) || text(candidate?.external_id, 200) ||
    (Array.isArray(candidate?.properties) && candidate.properties.length) ||
    (Array.isArray(candidate?.variants) && candidate.variants.length)
  )
  if (title && hasVariantEvidence) return `title:${origin}:${title}:${category}:${brand}`

  const externalId = canonicalKey(candidate?.external_id)
  if (externalId) return `external:${origin}:${externalId}`
  const sku = canonicalKey(candidate?.sku)
  if (sku) return `sku:${origin}:${sku}`
  return `product:${origin}:${title}:${candidate?.price ?? ''}`
}

function productFingerprint(candidate, normalized) {
  const sku = canonicalKey(normalized.sku)
  if (sku) return `sku:${sku}`
  const sourceUrl = canonicalProductUrl(candidate?.source_url)
  if (sourceUrl && productUrlIsSpecific(sourceUrl)) return `url:${sourceUrl.toLowerCase()}`
  const externalId = canonicalKey(candidate?.external_id)
  if (externalId) return `external:${externalId}`
  return `product:${normalizedKey(normalized.name)}:${normalized.price ?? ''}`
}
"""
if old not in source:
    raise SystemExit('normalizer anchor 1 not found')
source = source.replace(old, new)
old_tail = """export function normalizeCandidates(candidates) {
  const byFingerprint = new Map()
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const item = normalizeCandidate(candidate)
    if (!item.normalized.name) continue
    const previous = byFingerprint.get(item.fingerprint)
    if (!previous || richness(item) > richness(previous)) byFingerprint.set(item.fingerprint, item)
  }
  const products = [...byFingerprint.values()]
  return {
    products,
    inputCount: Array.isArray(candidates) ? candidates.length : 0,
    duplicateCount: Math.max(0, (Array.isArray(candidates) ? candidates.length : 0) - products.length),
    warningCount: products.filter((item) => item.warnings.length > 0).length,
  }
}
"""
new_tail = """function rawCandidateRichness(candidate) {
  const images = Array.isArray(candidate?.images) ? candidate.images.filter(Boolean).length : 0
  const variants = Array.isArray(candidate?.variants) ? candidate.variants.length : 0
  const properties = Array.isArray(candidate?.properties) ? candidate.properties.length : 0
  return (images * 4) + (variants * 5) + (properties * 2) + (text(candidate?.description, 6000) ? 4 : 0) +
    (text(candidate?.category, 80) ? 2 : 0) + (Number(candidate?.price) > 0 ? 3 : 0)
}

function candidateImages(candidate) {
  const values = [...(Array.isArray(candidate?.images) ? candidate.images : [])]
  for (const variant of Array.isArray(candidate?.variants) ? candidate.variants : []) {
    if (variant?.image) values.push(variant.image)
    if (Array.isArray(variant?.images)) values.push(...variant.images)
  }
  const result = []
  const seen = new Set()
  for (const raw of values) {
    const value = text(raw, 2048)
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(value)
  }
  return result
}

function singularProperties(candidate) {
  const result = []
  for (const property of Array.isArray(candidate?.properties) ? candidate.properties : []) {
    const values = propertyValues(property).map(validOption).filter(Boolean)
    if (values.length === 1) result.push({ name: canonicalVariationName(property?.name), value: values[0] })
  }
  return result.filter((item) => item.name && item.value)
}

function mergeCandidateGroup(items, groupKey) {
  const group = Array.isArray(items) ? items.filter(Boolean) : []
  const base = [...group].sort((a, b) => rawCandidateRichness(b) - rawCandidateRichness(a))[0] || {}
  const images = []
  const imageSeen = new Set()
  const addImage = (raw) => {
    const value = text(raw, 2048)
    if (!value) return
    const key = value.toLowerCase()
    if (imageSeen.has(key)) return
    imageSeen.add(key)
    images.push(value)
  }
  for (const candidate of group) for (const image of candidateImages(candidate)) addImage(image)

  const propertyMap = new Map()
  const addProperty = (name, values) => {
    const canonical = canonicalVariationName(name)
    if (!canonical) return
    const key = canonicalKey(canonical)
    if (!propertyMap.has(key)) propertyMap.set(key, { name: canonical, values: new Map() })
    const target = propertyMap.get(key)
    for (const raw of Array.isArray(values) ? values : [values]) {
      const option = validOption(raw)
      if (!option) continue
      const optionKey = canonicalKey(option)
      if (optionKey && !target.values.has(optionKey)) target.values.set(optionKey, option)
    }
  }

  const variants = []
  const variantSeen = new Set()
  const addVariant = (variant) => {
    if (!variant || typeof variant !== 'object') return
    const properties = Array.isArray(variant.properties) ? variant.properties.filter(Boolean) : []
    const key = [variant.external_id, variant.sku, variant.color, variant.size, variant.title,
      ...properties.map((property) => `${property?.name}:${property?.value}`)].map((value) => text(value, 120).toLowerCase()).join('|')
    if (!key.replace(/\\|/g, '') || variantSeen.has(key)) return
    variantSeen.add(key)
    variants.push(variant)
    if (variant.image) addImage(variant.image)
    if (Array.isArray(variant.images)) for (const image of variant.images) addImage(image)
    if (variant.color) addProperty('Cor', variant.color)
    if (variant.size) addProperty('Tamanho', variant.size)
    for (const property of properties) addProperty(property?.name, propertyValues(property))
  }

  for (const candidate of group) {
    for (const property of Array.isArray(candidate?.properties) ? candidate.properties : []) addProperty(property?.name, propertyValues(property))
    for (const variant of Array.isArray(candidate?.variants) ? candidate.variants : []) addVariant(variant)

    if (group.length > 1) {
      const properties = singularProperties(candidate)
      const color = properties.find((property) => canonicalVariationName(property.name) === 'Cor')?.value || ''
      const size = properties.find((property) => canonicalVariationName(property.name) === 'Tamanho')?.value || ''
      if (properties.length || color || size) {
        addVariant({
          external_id: text(candidate?.external_id, 200),
          title: text(candidate?.title, 180),
          sku: text(candidate?.sku, 80),
          color,
          size,
          price: Number(candidate?.price) > 0 ? Number(candidate.price) : null,
          available: candidate?.available !== false,
          image: candidateImages(candidate)[0] || '',
          properties,
        })
      }
    }
  }

  const distinctSkus = [...new Set(group.map((candidate) => text(candidate?.sku, 80)).filter(Boolean).map((value) => value.toLowerCase()))]
  const prices = group.map((candidate) => Number(candidate?.price)).filter((value) => Number.isFinite(value) && value > 0)
  const canonicalUrl = canonicalProductUrl(base?.source_url)
  return {
    ...base,
    __group_key: groupKey,
    source_url: canonicalUrl || text(base?.source_url, 2048),
    sku: group.length > 1 && distinctSkus.length > 1 ? '' : text(base?.sku, 80),
    images,
    properties: [...propertyMap.values()].map((property) => ({ name: property.name, values: [...property.values.values()] })),
    variants,
    price: prices.length ? Math.min(...prices) : base?.price,
  }
}

export function normalizeCandidates(candidates) {
  const input = Array.isArray(candidates) ? candidates : []
  const grouped = new Map()
  for (const candidate of input) {
    const key = candidateProductGroupKey(candidate)
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(candidate)
  }

  const byFingerprint = new Map()
  for (const [groupKey, items] of grouped) {
    const item = normalizeCandidate(mergeCandidateGroup(items, groupKey))
    if (!item.normalized.name) continue
    const previous = byFingerprint.get(item.fingerprint)
    if (!previous || richness(item) > richness(previous)) byFingerprint.set(item.fingerprint, item)
  }
  const products = [...byFingerprint.values()]
  return {
    products,
    inputCount: input.length,
    duplicateCount: Math.max(0, input.length - products.length),
    warningCount: products.filter((item) => item.warnings.length > 0).length,
  }
}
"""
if old_tail not in source:
    raise SystemExit('normalizer anchor 2 not found')
normalizer.write_text(source.replace(old_tail, new_tail))

hooks = Path('server/scanner-hooks.mjs')
source = hooks.read_text()
source = source.replace("import { normalizeCandidates } from './scanner-normalizer.mjs'", "import { normalizeCandidates, candidateProductGroupKey } from './scanner-normalizer.mjs'")
source = source.replace(
    "      CREATE INDEX IF NOT EXISTS idx_import_candidates_job ON import_candidates(job_id, created_at ASC);\n      CREATE INDEX IF NOT EXISTS idx_import_candidates_store ON import_candidates(store_id);",
    "      ALTER TABLE import_candidates ADD COLUMN IF NOT EXISTS group_key text NOT NULL DEFAULT '';\n      CREATE INDEX IF NOT EXISTS idx_import_candidates_job ON import_candidates(job_id, created_at ASC);\n      CREATE INDEX IF NOT EXISTS idx_import_candidates_store ON import_candidates(store_id);\n      CREATE INDEX IF NOT EXISTS idx_import_candidates_group ON import_candidates(job_id, group_key);"
)
source = source.replace(
    "    source_url: sourceUrl,\n    external_id: String(candidate?.external_id || '').slice(0, 200),",
    "    source_url: sourceUrl,\n    parent_external_id: String(candidate?.parent_external_id || candidate?.parent_product_id || '').slice(0, 200),\n    external_id: String(candidate?.external_id || '').slice(0, 200),"
)
source = source.replace(
    "        source_key: hashValue(`${candidate.external_id}|${candidate.source_url}|${candidate.title.toLowerCase()}`),\n        source_url: candidate.source_url, raw_data: candidate,",
    "        source_key: hashValue(`${candidate.external_id}|${candidate.source_url}|${candidate.title.toLowerCase()}`),\n        group_key: hashValue(candidateProductGroupKey(candidate)),\n        source_url: candidate.source_url, raw_data: candidate,"
)
source = source.replace(
    "        `INSERT INTO import_candidates (id,job_id,store_id,source_key,source_url,raw_data)\n         SELECT x.id,x.job_id,x.store_id,x.source_key,x.source_url,x.raw_data\n         FROM jsonb_to_recordset($1::jsonb) AS x(id text,job_id text,store_id text,source_key text,source_url text,raw_data jsonb)\n         ON CONFLICT (job_id,source_key) DO UPDATE SET source_url=EXCLUDED.source_url,raw_data=EXCLUDED.raw_data`,",
    "        `INSERT INTO import_candidates (id,job_id,store_id,source_key,group_key,source_url,raw_data)\n         SELECT x.id,x.job_id,x.store_id,x.source_key,x.group_key,x.source_url,x.raw_data\n         FROM jsonb_to_recordset($1::jsonb) AS x(id text,job_id text,store_id text,source_key text,group_key text,source_url text,raw_data jsonb)\n         ON CONFLICT (job_id,source_key) DO UPDATE SET group_key=EXCLUDED.group_key,source_url=EXCLUDED.source_url,raw_data=EXCLUDED.raw_data`,"
)
pattern = re.compile(r"    let cursorCreatedAt = null\n    let cursorId = ''\n\n    while \(true\) \{.*?\n    \}\n\n    const stats = await pool\.query\(", re.S)
replacement = """    let cursorGroupKey = ''

    while (true) {
      const groupsResult = await pool.query(
        `SELECT DISTINCT COALESCE(NULLIF(group_key,''),source_key) AS effective_group_key
         FROM import_candidates
         WHERE job_id=$1 AND store_id=$2 AND COALESCE(NULLIF(group_key,''),source_key)>$3
         ORDER BY effective_group_key ASC
         LIMIT $4`,
        [job.id, job.store_id, cursorGroupKey, SCANNER_DB_BATCH_SIZE],
      )
      if (!groupsResult.rowCount) break
      const groupKeys = groupsResult.rows.map((row) => row.effective_group_key)

      const candidatesResult = await pool.query(
        `SELECT id,raw_data,COALESCE(NULLIF(group_key,''),source_key) AS effective_group_key
         FROM import_candidates
         WHERE job_id=$1 AND store_id=$2 AND COALESCE(NULLIF(group_key,''),source_key)=ANY($3::text[])
         ORDER BY effective_group_key ASC,id ASC`,
        [job.id, job.store_id, groupKeys],
      )
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

      cursorGroupKey = groupKeys.at(-1)
    }

    const stats = await pool.query("""
source, count = pattern.subn(replacement, source, count=1)
if count != 1:
    raise SystemExit(f'normalization loop replacement count={count}')
hooks.write_text(source)

test = Path('server/scanner-normalizer.test.mjs')
source = test.read_text()
marker = "console.log('[scanner module 3] normalizer tests: ok')"
extra = """
const groupedVariants = normalizeCandidates([
  { __candidate_id: 'v1', source_url: 'https://loja.example/produto/camiseta?sku=CAM-P', external_id: 'var-1', title: 'Camiseta Essencial', sku: 'CAM-P', category: 'Camisetas', images: ['https://cdn.example/camiseta.jpg'], properties: [{ name: 'Cor', value: 'Preto' }, { name: 'Tamanho', value: 'P' }], price: 39.9 },
  { __candidate_id: 'v2', source_url: 'https://loja.example/produto/camiseta?sku=CAM-M', external_id: 'var-2', title: 'Camiseta Essencial', sku: 'CAM-M', category: 'Camisetas', images: [], properties: [{ name: 'Cor', value: 'Preto' }, { name: 'Tamanho', value: 'M' }], price: 39.9 },
  { __candidate_id: 'v3', source_url: 'https://loja.example/produto/camiseta?variant=var-3', external_id: 'var-3', title: 'Camiseta Essencial', sku: 'CAM-AZUL-M', category: 'Camisetas', images: ['https://cdn.example/camiseta-azul.jpg'], properties: [{ name: 'Color', value: 'Azul' }, { name: 'Size', value: 'M' }], price: 41.9 },
])
assert.equal(groupedVariants.products.length, 1, 'variações da mesma URL base devem virar um único produto')
assert.equal(groupedVariants.products[0].normalized.sku, '', 'SKU de variante não deve virar SKU do produto pai')
assert.deepEqual(groupedVariants.products[0].normalized.images, ['https://cdn.example/camiseta.jpg', 'https://cdn.example/camiseta-azul.jpg'])
assert.deepEqual(groupedVariants.products[0].normalized.variations, [
  { name: 'Cor', options: ['Preto', 'Azul'] },
  { name: 'Tamanho', options: ['P', 'M'] },
])

const sameTitleDifferentProducts = normalizeCandidates([
  { source_url: 'https://loja.example/produto/camiseta-a', external_id: 'a', title: 'Camiseta Básica', sku: 'A', price: 20 },
  { source_url: 'https://loja.example/produto/camiseta-b', external_id: 'b', title: 'Camiseta Básica', sku: 'B', price: 20 },
])
assert.equal(sameTitleDifferentProducts.products.length, 2, 'URLs de produto diferentes não podem ser agrupadas só pelo título')
"""
if extra.strip() not in source:
    source = source.replace(marker, extra + '\n' + marker)
test.write_text(source)

Path('server/scanner-variant-grouping.integration.mjs').write_text("""import assert from 'node:assert/strict'
import { processImportJob, processNormalizationJob } from './scanner-hooks.mjs'
const base = process.env.BASE_URL || 'http://127.0.0.1:3000'
async function register() {
  const response = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Variant grouping', email: `variant-group-${Date.now()}-${Math.random()}@example.test`, password: 'scanner1234', storeName: 'Loja Variant Group', whatsapp: '5511999999999' }) })
  assert.equal(response.status, 201)
  return response.headers.get('set-cookie')?.split(';')[0]
}
async function api(path, cookie, options = {}) { return fetch(`${base}${path}`, { ...options, headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(options.headers || {}) } }) }
const cookie = await register()
let response = await api('/api/admin/imports', cookie, { method: 'POST', body: JSON.stringify({ url: 'https://variants.fixture.example/' }) })
assert.equal(response.status, 201)
let payload = await response.json()
const jobId = payload.job.id
const colors = ['Preto', 'Azul']
const sizes = ['P', 'M']
const candidates = Array.from({ length: 251 }, (_, index) => {
  const color = colors[index % 2]
  const size = sizes[Math.floor(index / 2) % 2]
  return { source_url: `https://variants.fixture.example/produto/camiseta?sku=CAM-${index}`, external_id: `variant-${index}`, title: 'Camiseta Essencial', description: 'Camiseta em algodão.', sku: `CAM-${index}`, category: 'Camisetas', images: index === 0 ? ['https://cdn.fixture.example/camiseta.jpg'] : [], properties: [{ name: 'Cor', value: color }, { name: 'Tamanho', value: size }], variants: [], price: 39.9, currency: 'BRL', source: 'fixture-variant-page' }
})
const fakeCollector = async () => ({ platform: 'generic', pagesScanned: 251, candidates })
const collected = await processImportJob(jobId, fakeCollector)
assert.equal(collected.result_count, 251)
const normalized = await processNormalizationJob(jobId)
assert.equal(normalized.normalized_count, 1, '251 variantes atravessando lote de 250 devem virar um único produto')
assert.equal(normalized.duplicate_count, 250)
response = await api(`/api/admin/imports/${jobId}/normalized?limit=10`, cookie)
payload = await response.json()
const data = payload.products[0].normalized_data
assert.equal(data.media_url, 'https://cdn.fixture.example/camiseta.jpg')
assert.deepEqual(data.variations, [{ name: 'Cor', options: ['Preto', 'Azul'] }, { name: 'Tamanho', options: ['P', 'M'] }])
response = await api(`/api/admin/imports/${jobId}/publish`, cookie, { method: 'POST', body: '{}' })
assert.equal(response.status, 200)
response = await api('/api/admin/bootstrap', cookie)
payload = await response.json()
assert.equal(payload.products.length, 1)
assert.equal(payload.products[0].mediaUrl, 'https://cdn.fixture.example/camiseta.jpg')
assert.deepEqual(payload.products[0].variations, [{ name: 'Cor', options: ['Preto', 'Azul'] }, { name: 'Tamanho', options: ['P', 'M'] }])
console.log('[scanner variant grouping] image + parent variations across DB batches: ok')
""")

ci = Path('.github/workflows/ci.yml')
source = ci.read_text()
anchor = "      - name: Scanner module 5 integration\n        run: node server/scanner-module5.integration.mjs\n"
if 'Scanner variant grouping integration' not in source:
    if anchor not in source:
        raise SystemExit('CI anchor not found')
    source = source.replace(anchor, anchor + "      - name: Scanner variant grouping integration\n        run: node server/scanner-variant-grouping.integration.mjs\n")
ci.write_text(source)
