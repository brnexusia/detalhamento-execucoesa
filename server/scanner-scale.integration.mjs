import assert from 'node:assert/strict'
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
