import assert from 'node:assert/strict'
import { processImportJob, processNormalizationJob } from './scanner-hooks.mjs'

const base = process.env.BASE_URL || 'http://127.0.0.1:3000'

async function register(label) {
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Review ${label}`,
      email: `review-${label}-${Date.now()}-${Math.random()}@example.test`,
      password: 'scanner1234',
      storeName: `Loja Review ${label}`,
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
  body: JSON.stringify({ url: 'https://review.fixture.example/' }),
})
assert.equal(response.status, 201)
let payload = await response.json()
const jobId = payload.job.id

const fakeCollector = async () => ({
  platform: 'shopify',
  pagesScanned: 2,
  candidates: [
    {
      source_url: 'https://review.fixture.example/products/camisa',
      external_id: 'r-1',
      title: 'Camisa Linho',
      description: 'Camisa leve em linho.',
      sku: 'CL-01',
      category: 'Camisas',
      images: ['https://cdn.fixture.example/camisa.jpg'],
      properties: [{ name: 'Cor', values: ['Preto', 'Caramelo'] }],
      variants: [],
      price: 42,
      currency: 'BRL',
      source: 'fixture',
    },
    {
      source_url: 'https://review.fixture.example/products/bolsa',
      external_id: 'r-2',
      title: 'Bolsa Siena',
      description: '',
      sku: '',
      category: '',
      images: [],
      properties: [{ name: 'Color', values: ['Preto', 'Caramelo'] }],
      variants: [],
      price: null,
      currency: 'BRL',
      source: 'fixture',
    },
  ],
})

const collected = await processImportJob(jobId, fakeCollector)
assert.equal(collected.status, 'processing')
const normalized = await processNormalizationJob(jobId)
assert.equal(normalized.status, 'review')
assert.equal(normalized.normalized_count, 2)
assert.equal(normalized.selected_count, 1, 'somente produto sem alerta inicia selecionado')

response = await api(`/api/admin/imports/${jobId}/review?limit=10`, cookieA)
assert.equal(response.status, 200)
payload = await response.json()
assert.equal(payload.products.length, 2)
assert.equal(payload.summary.total_count, 2)
assert.equal(payload.summary.ready_count, 1)
assert.equal(payload.summary.warning_count, 1)
assert.equal(payload.summary.selected_count, 1)

const camisa = payload.products.find((item) => item.data.sku === 'CL-01')
const bolsa = payload.products.find((item) => item.data.name === 'Bolsa Siena')
assert.ok(camisa)
assert.ok(bolsa)
assert.equal(camisa.selected, true)
assert.equal(bolsa.selected, false)
assert.ok(bolsa.warnings.includes('missing_price'))

response = await api(`/api/admin/imports/${jobId}/review/${bolsa.id}`, cookieA, {
  method: 'PATCH',
  body: JSON.stringify({ selected: true }),
})
assert.equal(response.status, 400, 'produto sem preço não pode ser selecionado')

response = await api(`/api/admin/imports/${jobId}/review/${bolsa.id}`, cookieA, {
  method: 'PATCH',
  body: JSON.stringify({
    data: {
      name: 'Bolsa Siena Premium',
      description: 'Bolsa estruturada com alça regulável.',
      sku: 'BS-02',
      category: 'Bolsas',
      price: 48.9,
      currency: 'BRL',
      images: ['https://cdn.fixture.example/bolsa.jpg'],
      variations: [{ name: 'Color', options: ['Preto', 'Caramelo'] }],
    },
    selected: true,
  }),
})
assert.equal(response.status, 200)
payload = await response.json()
assert.equal(payload.product.edited, true)
assert.equal(payload.product.selected, true)
assert.equal(payload.product.data.name, 'Bolsa Siena Premium')
assert.equal(payload.product.data.price, 48.9)
assert.deepEqual(payload.product.data.variations, [{ name: 'Cor', options: ['Preto', 'Caramelo'] }])
assert.deepEqual(payload.product.warnings, [])
assert.equal(payload.summary.warning_count, 0)
assert.equal(payload.summary.selected_count, 2)
assert.equal(payload.summary.review_changed_count, 1)

response = await api(`/api/admin/imports/${jobId}/review?filter=all&q=Premium&limit=10`, cookieA)
assert.equal(response.status, 200)
payload = await response.json()
assert.equal(payload.pagination.total, 1)
assert.equal(payload.products[0].data.sku, 'BS-02')

response = await api(`/api/admin/imports/${jobId}/review/${camisa.id}`, cookieA, {
  method: 'PATCH',
  body: JSON.stringify({ selected: false }),
})
assert.equal(response.status, 200)
payload = await response.json()
assert.equal(payload.summary.selected_count, 1)

response = await api(`/api/admin/imports/${jobId}/review-selection`, cookieA, {
  method: 'PATCH',
  body: JSON.stringify({ action: 'ready' }),
})
assert.equal(response.status, 200)
payload = await response.json()
assert.equal(payload.summary.selected_count, 2, 'selecionar sem alertas inclui os dois após correção')

response = await api(`/api/admin/imports/${jobId}/review?filter=selected&limit=10`, cookieA)
assert.equal(response.status, 200)
payload = await response.json()
assert.equal(payload.pagination.total, 2)
assert.ok(payload.products.every((item) => item.selected))

response = await api('/api/admin/bootstrap', cookieA)
assert.equal(response.status, 200)
payload = await response.json()
assert.equal(payload.products.length, 0, 'Módulo 4 não pode publicar produtos no catálogo')

const cookieB = await register('b')
response = await api(`/api/admin/imports/${jobId}/review?limit=10`, cookieB)
assert.equal(response.status, 404, 'outra loja não pode abrir a revisão')
response = await api(`/api/admin/imports/${jobId}/review/${bolsa.id}`, cookieB, {
  method: 'PATCH',
  body: JSON.stringify({ selected: false }),
})
assert.equal(response.status, 404, 'outra loja não pode editar a revisão')

console.log('[scanner module 4] review persistence: ok')
