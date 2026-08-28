import assert from 'node:assert/strict'
import { processImportJob } from './scanner-hooks.mjs'

const base = process.env.BASE_URL || 'http://127.0.0.1:3000'

async function register(label) {
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Collector ${label}`,
      email: `collector-${label}-${Date.now()}-${Math.random()}@example.test`,
      password: 'scanner1234',
      storeName: `Loja Collector ${label}`,
      whatsapp: '5511999999999',
    }),
  })
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

const cookieA = await register('a')
let response = await api('/api/admin/imports', cookieA, {
  method: 'POST',
  body: JSON.stringify({ url: 'https://catalogo.fixture.example/' }),
})
assert.equal(response.status, 201)
let payload = await response.json()
const jobId = payload.job.id
assert.equal(payload.job.status, 'queued')

const fakeCollector = async (_sourceUrl, options = {}) => {
  await options.onProgress?.({ progress: 25, pagesScanned: 2, candidates: 0, platform: 'fixture' })
  await options.onProgress?.({ progress: 80, pagesScanned: 5, candidates: 2, platform: 'fixture' })
  return {
    platform: 'fixture',
    pagesScanned: 5,
    candidates: [
      {
        source_url: 'https://catalogo.fixture.example/produto/camisa',
        external_id: '101',
        title: 'Camisa Linho',
        description: 'Camisa ampla em linho.',
        sku: 'CL-01',
        category: 'Camisas',
        brand: 'Fixture',
        images: ['https://catalogo.fixture.example/camisa.jpg'],
        variants: [{ sku: 'CL-01-P', size: 'P', color: 'Preto', price: 42 }],
        properties: [{ name: 'Tamanho', values: ['P', 'M', 'G'] }],
        price: 42,
        price_text: '42.00',
        currency: 'BRL',
        availability: 'InStock',
        source: 'fixture',
      },
      {
        source_url: 'https://catalogo.fixture.example/produto/bolsa',
        external_id: '102',
        title: 'Bolsa Siena',
        description: 'Bolsa estruturada.',
        sku: 'BS-02',
        category: 'Bolsas',
        brand: 'Fixture',
        images: ['https://catalogo.fixture.example/bolsa.jpg'],
        variants: [],
        properties: [{ name: 'Cor', values: ['Preto', 'Caramelo'] }],
        price: 48.9,
        price_text: '48.90',
        currency: 'BRL',
        availability: 'InStock',
        source: 'fixture',
      },
    ],
  }
}

const processed = await processImportJob(jobId, fakeCollector)
assert.ok(processed)
assert.equal(processed.status, 'processing')
assert.equal(processed.progress, 100)
assert.equal(processed.result_count, 2)
assert.equal(processed.platform, 'fixture')
assert.equal(processed.pages_scanned, 5)

response = await api(`/api/admin/imports/${jobId}/candidates?limit=10`, cookieA)
assert.equal(response.status, 200)
payload = await response.json()
assert.equal(payload.candidates.length, 2)
assert.equal(payload.candidates[0].raw_data.title, 'Camisa Linho')
assert.deepEqual(payload.candidates[1].raw_data.properties[0].values, ['Preto', 'Caramelo'])

response = await api('/api/admin/imports', cookieA)
payload = await response.json()
const storedJob = payload.jobs.find((job) => job.id === jobId)
assert.equal(storedJob.status, 'processing')
assert.equal(storedJob.result_count, 2)
assert.equal(storedJob.platform, 'fixture')

const cookieB = await register('b')
response = await api(`/api/admin/imports/${jobId}/candidates?limit=10`, cookieB)
assert.equal(response.status, 404, 'outra loja não pode ler candidatos do job')

console.log('[scanner module 2] collection persistence: ok')
