import assert from 'node:assert/strict'
import { collectCatalog } from './scanner-collector.mjs'
import { processImportJob, processNormalizationJob } from './scanner-hooks.mjs'

const base = process.env.BASE_URL || 'http://127.0.0.1:3000'
const sourceUrl = process.env.LIVE_SCANNER_URL || 'https://books.toscrape.com/'

async function register() {
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Homologação Scanner',
      email: `scanner-live-${Date.now()}-${Math.random()}@example.test`,
      password: 'scanner1234',
      storeName: `Homologação Scanner ${Date.now()}`,
      whatsapp: '5511999999999',
    }),
  })
  assert.equal(response.status, 201)
  const payload = await response.json()
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie)
  assert.ok(payload.storeSlug)
  return { cookie, storeSlug: payload.storeSlug }
}

async function api(path, cookie, options = {}) {
  return fetch(`${base}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(options.headers || {}) },
  })
}

const { cookie, storeSlug } = await register()

let response = await api('/api/admin/store', cookie, {
  method: 'PUT',
  body: JSON.stringify({ minimumOrder: 0 }),
})
assert.equal(response.status, 200)

response = await api('/api/admin/imports', cookie, {
  method: 'POST',
  body: JSON.stringify({ url: sourceUrl }),
})
assert.equal(response.status, 201)
let payload = await response.json()
const jobId = payload.job.id
assert.ok(jobId)

const liveCollector = (url, options = {}) => collectCatalog(url, {
  ...options,
  maxProducts: 120,
  maxPages: 500,
})

const collected = await processImportJob(jobId, liveCollector)
assert.equal(collected.status, 'processing')
assert.ok(collected.result_count >= 100, `coleta real insuficiente: ${collected.result_count}`)
assert.equal(collected.platform, 'generic')

const normalized = await processNormalizationJob(jobId)
assert.equal(normalized.status, 'review')
assert.equal(normalized.normalized_count, collected.result_count)
assert.ok(normalized.selected_count >= 100, `produtos válidos insuficientes: ${normalized.selected_count}`)
assert.equal(normalized.warning_count, 0, 'sandbox conhecido deve normalizar sem bloqueios de nome/preço')

response = await api(`/api/admin/imports/${jobId}/publish`, cookie, { method: 'POST', body: '{}' })
assert.equal(response.status, 200)
const published = await response.json()
assert.equal(published.job.status, 'completed')
assert.ok(published.result.created >= 100, `publicação real insuficiente: ${published.result.created}`)
assert.equal(published.result.skipped_existing, 0)

response = await api('/api/admin/bootstrap', cookie)
assert.equal(response.status, 200)
payload = await response.json()
assert.equal(payload.products.length, published.result.created)
const sample = payload.products.find((item) => item.name === 'A Light in the Attic') || payload.products[0]
assert.ok(sample)
assert.ok(sample.name)
assert.ok(Number(sample.price) > 0)
assert.ok(sample.media_url)
assert.ok(sample.sku, 'UPC da página externa deve ser preservado como referência')
assert.ok(sample.category)

response = await fetch(`${base}/api/public/store/${encodeURIComponent(storeSlug)}?limit=500`)
assert.equal(response.status, 200)
const visitorCookie = response.headers.get('set-cookie')?.split(';')[0]
assert.ok(visitorCookie)
const page1 = await response.json()
assert.equal(page1.products.length, 24, 'API pública não pode expor a importação inteira')
assert.equal(page1.page.hasMore, true)
assert.ok(page1.page.nextCursor)

response = await fetch(`${base}/api/public/store/${encodeURIComponent(storeSlug)}?cursor=${encodeURIComponent(page1.page.nextCursor)}`, {
  headers: { Cookie: visitorCookie },
})
assert.equal(response.status, 200)
const page2 = await response.json()
assert.ok(page2.products.length > 0 && page2.products.length <= 24)
const firstIds = new Set(page1.products.map((item) => item.id))
assert.equal(page2.products.some((item) => firstIds.has(item.id)), false, 'páginas públicas não podem repetir produtos')

const deepProduct = page2.products[0]
assert.ok(deepProduct)
response = await api('/api/public/orders', null, {
  method: 'POST',
  body: JSON.stringify({
    storeSlug,
    items: [{ productId: deepProduct.id, quantity: 1, selections: {} }],
  }),
})
assert.equal(response.status, 201, 'produto vindo de página posterior precisa continuar comprável')
payload = await response.json()
assert.ok(payload.code?.startsWith('AS-'))
assert.ok(payload.whatsappUrl?.startsWith('https://wa.me/'))

response = await api(`/api/admin/imports/${jobId}/publish`, cookie, { method: 'POST', body: '{}' })
assert.equal(response.status, 200)
payload = await response.json()
assert.equal(payload.idempotent, true, 'repetir publicação real não pode duplicar catálogo')

response = await api('/api/admin/bootstrap', cookie)
payload = await response.json()
assert.equal(payload.products.length, published.result.created, 'republicação não pode aumentar a quantidade de produtos')

console.log(JSON.stringify({
  sourceUrl,
  collected: collected.result_count,
  normalized: normalized.normalized_count,
  selected: normalized.selected_count,
  published: published.result.created,
  firstPublicPage: page1.products.length,
  secondPublicPage: page2.products.length,
  deepOrderProduct: deepProduct.name,
  orderCode: payload.code || 'validated-before-bootstrap',
}, null, 2))
console.log('LIVE_SCANNER_E2E_OK')
