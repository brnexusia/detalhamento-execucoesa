import assert from 'node:assert/strict'
import pg from 'pg'
import { processImportJob, processNormalizationJob } from '../../server/scanner-hooks.mjs'
import { collectCatalog } from '../../server/scanner-collector.mjs'

const { Pool } = pg
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const base = process.env.BASE_URL || 'http://127.0.0.1:3000'

const register = await fetch(`${base}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'FácilZap Live', email: `fz-live-${Date.now()}@example.test`, password: 'scanner1234', storeName: 'FácilZap Live', whatsapp: '5511999999999' }),
})
assert.equal(register.status, 201)
const cookie = register.headers.get('set-cookie')?.split(';')[0]
assert.ok(cookie)

let response = await fetch(`${base}/api/admin/imports`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify({ url: 'https://facilzap.app.br/nesmodaintima' }),
})
assert.equal(response.status, 201)
let payload = await response.json()
const jobId = payload.job.id

const collected = await processImportJob(jobId, collectCatalog)
assert.equal(collected.status, 'processing')
console.log('collected', collected.result_count, collected.pages_scanned, collected.platform)
assert.equal(collected.platform, 'facilzap')
assert.ok(collected.result_count >= 200, `esperava catálogo real amplo; recebeu ${collected.result_count}`)

const normalized = await processNormalizationJob(jobId)
assert.equal(normalized.status, 'review')
console.log('normalized', normalized.normalized_count, normalized.selected_count)
assert.ok(normalized.selected_count >= 200)

const sample = await pool.query(`SELECT normalized_data FROM import_normalized_products WHERE job_id=$1 AND selected=true ORDER BY created_at LIMIT 40`, [jobId])
assert.ok(sample.rowCount > 0)
const withImage = sample.rows.map((row) => row.normalized_data).find((data) => String(data.media_url || data.images?.[0] || '').includes('arquivos.facilzap.app.br/produtos/'))
assert.ok(withImage, 'produto normalizado deve apontar para CDN real do FácilZap')
console.log('sampleImage', withImage.media_url || withImage.images?.[0])
const imageResponse = await fetch(withImage.media_url || withImage.images?.[0])
console.log('imageHTTP', imageResponse.status, imageResponse.headers.get('content-type'))
assert.equal(imageResponse.ok, true)
assert.match(imageResponse.headers.get('content-type') || '', /^image\//i)
await imageResponse.body?.cancel()

const withVariations = sample.rows.map((row) => row.normalized_data).find((data) => Array.isArray(data.variations) && data.variations.length)
assert.ok(withVariations, 'produto normalizado deve preservar grade real')
console.log('sampleVariations', JSON.stringify(withVariations.variations))

const started = Date.now()
response = await fetch(`${base}/api/admin/imports/${jobId}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: '{}' })
const rawText = await response.text()
console.log('publishHTTP', response.status, 'ms', Date.now() - started, 'body', rawText.slice(0,1000))
assert.equal(response.ok, true, rawText)
payload = JSON.parse(rawText)
assert.ok(payload.result.created > 0)

response = await fetch(`${base}/api/admin/bootstrap`, { headers: { Cookie: cookie } })
assert.equal(response.status, 200)
payload = await response.json()
console.log('publishedProducts', payload.products.length)
assert.ok(payload.products.length > 0)
assert.ok(payload.products.some((product) => String(product.media_url || product.mediaUrl || '').includes('arquivos.facilzap.app.br/produtos/')), 'produto publicado deve manter imagem válida')
assert.ok(payload.products.some((product) => Array.isArray(product.variations) && product.variations.length), 'produto publicado deve manter variações')

await pool.end()
console.log('[facilzap live e2e] scan + image + variations + publish: ok')
