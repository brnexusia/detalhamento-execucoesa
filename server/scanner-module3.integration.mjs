import assert from 'node:assert/strict'
import { processImportJob, processNormalizationJob } from './scanner-hooks.mjs'

const base = process.env.BASE_URL || 'http://127.0.0.1:3000'

async function register(label) {
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Normalizer ${label}`,
      email: `normalizer-${label}-${Date.now()}-${Math.random()}@example.test`,
      password: 'scanner1234',
      storeName: `Loja Normalizer ${label}`,
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
let response = await api('/api/admin/bootstrap', cookieA)
let payload = await response.json()
assert.equal(payload.products.length, 0, 'normalização não deve depender de catálogo existente')

response = await api('/api/admin/imports', cookieA, {
  method: 'POST',
  body: JSON.stringify({ url: 'https://normalizer.fixture.example/' }),
})
assert.equal(response.status, 201)
payload = await response.json()
const jobId = payload.job.id

const fakeCollector = async () => ({
  platform: 'shopify',
  pagesScanned: 3,
  candidates: [
    {
      source_url: 'https://normalizer.fixture.example/products/camisa',
      external_id: '1001',
      title: '  Camisa   Linho ',
      description: '<p>Camisa <strong>leve</strong> em linho.</p>',
      sku: 'CL-01',
      category: 'Camisas',
      brand: 'Fixture',
      images: ['https://cdn.fixture.example/camisa.jpg', 'https://cdn.fixture.example/camisa.jpg'],
      properties: [{ name: 'Color', values: ['Preto', 'Caramelo'] }, { name: 'Size', values: ['P', 'M'] }],
      variants: [
        { sku: 'CL-01-P', option1: 'Preto', option2: 'P', price: 45 },
        { sku: 'CL-01-M', option1: 'Caramelo', option2: 'M', price: 42 },
      ],
      price: null,
      currency: 'brl',
      source: 'fixture',
    },
    {
      source_url: 'https://normalizer.fixture.example/products/camisa-duplicada',
      external_id: '1001-copy',
      title: 'Camisa Linho',
      description: '',
      sku: 'CL-01',
      category: '',
      images: [],
      properties: [],
      variants: [{ price: 49 }],
      price: null,
      currency: 'BRL',
      source: 'fixture',
    },
    {
      source_url: 'https://normalizer.fixture.example/products/bolsa',
      external_id: '1002',
      title: 'Bolsa Siena',
      description: 'Bolsa estruturada.',
      sku: '',
      category: '',
      images: [],
      properties: [{ name: 'attribute_pa_cor', values: ['Preto', 'Caramelo'] }],
      variants: [],
      price: 48.9,
      currency: 'BRL',
      source: 'fixture',
    },
  ],
})

const collected = await processImportJob(jobId, fakeCollector)
assert.equal(collected.status, 'processing')
assert.equal(collected.result_count, 3)
assert.equal(collected.progress, 100)

const normalized = await processNormalizationJob(jobId)
assert.ok(normalized)
assert.equal(normalized.status, 'review')
assert.equal(normalized.progress, 100)
assert.equal(normalized.normalized_count, 2, 'SKU repetido deve virar um produto')
assert.equal(normalized.duplicate_count, 1)
assert.equal(normalized.warning_count, 1, 'apenas a bolsa incompleta deve exigir revisão')

response = await api(`/api/admin/imports/${jobId}/normalized?limit=10`, cookieA)
assert.equal(response.status, 200)
payload = await response.json()
assert.equal(payload.products.length, 2)

const camisa = payload.products.find((item) => item.normalized_data.sku === 'CL-01')
assert.ok(camisa)
assert.equal(camisa.normalized_data.name, 'Camisa Linho')
assert.equal(camisa.normalized_data.description, 'Camisa leve em linho.')
assert.equal(camisa.normalized_data.price, 42)
assert.deepEqual(camisa.normalized_data.images, ['https://cdn.fixture.example/camisa.jpg'])
assert.deepEqual(camisa.normalized_data.variations, [
  { name: 'Cor', options: ['Preto', 'Caramelo'] },
  { name: 'Tamanho', options: ['P', 'M'] },
])
assert.deepEqual(camisa.warnings, [])
assert.equal(camisa.confidence, 1)

const bolsa = payload.products.find((item) => item.normalized_data.name === 'Bolsa Siena')
assert.ok(bolsa)
assert.equal(bolsa.normalized_data.category, 'Geral')
assert.deepEqual(bolsa.normalized_data.variations, [{ name: 'Cor', options: ['Preto', 'Caramelo'] }])
assert.ok(bolsa.warnings.includes('missing_image'))
assert.ok(bolsa.warnings.includes('missing_sku'))
assert.ok(bolsa.warnings.includes('missing_category'))

response = await api('/api/admin/bootstrap', cookieA)
payload = await response.json()
assert.equal(payload.products.length, 0, 'Módulo 3 não pode publicar produto no catálogo')

const cookieB = await register('b')
response = await api(`/api/admin/imports/${jobId}/normalized?limit=10`, cookieB)
assert.equal(response.status, 404, 'outra loja não pode ler os produtos normalizados')

console.log('[scanner module 3] normalization persistence: ok')
