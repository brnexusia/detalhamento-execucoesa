import assert from 'node:assert/strict'
import { processImportJob, processNormalizationJob } from './scanner-hooks.mjs'
import { collectCatalog } from './scanner-collector.mjs'

const base = process.env.BASE_URL || 'http://127.0.0.1:3000'

async function register() {
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Cristaluxe Publish Test',
      email: `cristaluxe-${Date.now()}@example.test`,
      password: 'scanner1234',
      storeName: 'Cristaluxe Publish Fixture',
      whatsapp: '5511999999999',
    }),
  })
  const body = await response.text()
  console.log('register', response.status, body)
  assert.equal(response.status, 201)
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie)
  return cookie
}

async function api(path, cookie, options = {}) {
  return fetch(`${base}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(options.headers || {}) },
  })
}

const cookie = await register()
let response = await api('/api/admin/imports', cookie, {
  method: 'POST',
  body: JSON.stringify({ url: 'https://cristaluxesemijoias.com.br/' }),
})
let raw = await response.text()
console.log('createJob', response.status, raw)
assert.equal(response.status, 201)
const jobId = JSON.parse(raw).job.id

const collected = await processImportJob(jobId, collectCatalog)
console.log('collected', JSON.stringify({ status: collected.status, result_count: collected.result_count, platform: collected.platform, pages_scanned: collected.pages_scanned }))
assert.equal(collected.result_count, 175)

const normalized = await processNormalizationJob(jobId)
console.log('normalized', JSON.stringify({ status: normalized.status, normalized_count: normalized.normalized_count, selected_count: normalized.selected_count, warning_count: normalized.warning_count }))
assert.equal(normalized.normalized_count, 175)
assert.equal(normalized.selected_count, 175)

response = await api(`/api/admin/imports/${jobId}/publish`, cookie, { method: 'POST', body: '{}' })
raw = await response.text()
console.log('publish', response.status, raw)
assert.equal(response.status, 200, raw)

const published = JSON.parse(raw)
assert.equal(published.job.status, 'completed')
assert.equal(published.result.created + published.result.skipped_existing, 175)

response = await api('/api/admin/bootstrap', cookie)
raw = await response.text()
console.log('bootstrapStatus', response.status)
assert.equal(response.status, 200, raw)
const bootstrap = JSON.parse(raw)
console.log('savedProducts', bootstrap.products.length)
assert.equal(bootstrap.products.length, 175)
assert.ok(bootstrap.products.every((p) => p.name && Number(p.price) > 0))
assert.ok(bootstrap.products.filter((p) => p.mediaUrl || p.media_url).length >= 170)

console.log('[cristaluxe publish] 175/175 saved successfully')
