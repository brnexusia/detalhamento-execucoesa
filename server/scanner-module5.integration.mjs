import assert from 'node:assert/strict'
import pg from 'pg'
import { processImportJob, processNormalizationJob } from './scanner-hooks.mjs'

const base = process.env.BASE_URL || 'http://127.0.0.1:3000'

async function register(label) {
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Publisher ${label}`,
      email: `publisher-${label}-${Date.now()}-${Math.random()}@example.test`,
      password: 'scanner1234',
      storeName: `Loja Publisher ${label}`,
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
  body: JSON.stringify({ url: 'https://publisher.fixture.example/' }),
})
assert.equal(response.status, 201)
let payload = await response.json()
const jobId = payload.job.id

const fakeCollector = async () => ({
  platform: 'shopify',
  pagesScanned: 2,
  candidates: [
    {
      source_url: 'https://publisher.fixture.example/products/camisa',
      external_id: 'p-1',
      title: 'Camisa Linho',
      description: 'Camisa leve.',
      sku: 'SKU-EXISTENTE',
      category: 'Camisas',
      images: ['https://cdn.fixture.example/camisa.jpg'],
      properties: [{ name: 'Cor', values: ['Preto', 'Caramelo'] }],
      variants: [],
      price: 42,
      currency: 'BRL',
      source: 'fixture',
    },
    {
      source_url: 'https://publisher.fixture.example/products/bolsa',
      external_id: 'p-2',
      title: 'Bolsa Siena',
      description: '',
      sku: '',
      category: '',
      images: [],
      properties: [{ name: 'Color', values: ['Preto', 'Caramelo'] }],
      variants: [],
      price: 48.9,
      currency: 'BRL',
      source: 'fixture',
    },
    {
      source_url: 'https://publisher.fixture.example/products/sem-preco',
      external_id: 'p-3',
      title: 'Produto Sem Preço',
      description: 'Precisa de correção.',
      sku: 'SEM-PRECO',
      category: 'Outros',
      images: ['https://cdn.fixture.example/sem-preco.jpg'],
      properties: [],
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
assert.equal(normalized.normalized_count, 3)
assert.equal(normalized.selected_count, 2, 'somente nome/preço devem definir publicação automática')

response = await api('/api/admin/products', cookieA, {
  method: 'POST',
  body: JSON.stringify({
    sku: 'SKU-EXISTENTE',
    name: 'Camisa já cadastrada',
    description: 'Produto anterior.',
    price: 39.9,
    category: 'Camisas',
    mediaUrl: '',
    mediaType: 'image',
    variations: [],
    active: true,
  }),
})
assert.equal(response.status, 201)

// Regressão de produção: versões antigas criaram import_normalized_products
// sem updated_at. O publish deve migrar o schema automaticamente antes de usar a coluna.
const legacyPool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
await legacyPool.query('ALTER TABLE import_normalized_products DROP COLUMN IF EXISTS updated_at')
await legacyPool.end()

const [publishA, publishB] = await Promise.all([
  api(`/api/admin/imports/${jobId}/publish`, cookieA, { method: 'POST', body: '{}' }),
  api(`/api/admin/imports/${jobId}/publish`, cookieA, { method: 'POST', body: '{}' }),
])
assert.equal(publishA.status, 200)
assert.equal(publishB.status, 200)
const results = [await publishA.json(), await publishB.json()]
const first = results.find((item) => item.idempotent === false)
const repeated = results.find((item) => item.idempotent === true)
assert.ok(first, 'uma chamada deve executar a publicação')
assert.ok(repeated, 'a chamada concorrente deve retornar o resultado já concluído')
assert.equal(first.result.selected, 2)
assert.equal(first.result.created, 1)
assert.equal(first.result.skipped_existing, 1)
assert.equal(first.job.status, 'completed')

response = await api('/api/admin/bootstrap', cookieA)
assert.equal(response.status, 200)
payload = await response.json()
assert.equal(payload.products.length, 2, 'deve existir o produto anterior + 1 produto novo')
assert.equal(payload.products.filter((item) => item.sku === 'SKU-EXISTENTE').length, 1, 'SKU existente não pode duplicar')
const bolsa = payload.products.find((item) => item.name === 'Bolsa Siena')
assert.ok(bolsa, 'produto válido e esparso deve ser importado automaticamente')
assert.equal(bolsa.price, 48.9)
assert.equal(bolsa.category, 'Geral')
assert.deepEqual(bolsa.variations, [{ name: 'Cor', options: ['Preto', 'Caramelo'] }])
assert.equal(payload.products.some((item) => item.sku === 'SEM-PRECO'), false, 'exceção sem preço não pode ser publicada')

response = await api(`/api/admin/imports/${jobId}/publish`, cookieA, { method: 'POST', body: '{}' })
assert.equal(response.status, 200)
payload = await response.json()
assert.equal(payload.idempotent, true)
assert.equal(payload.result.created, 1)
assert.equal(payload.result.skipped_existing, 1)

response = await api('/api/admin/bootstrap', cookieA)
payload = await response.json()
assert.equal(payload.products.length, 2, 'repetir publicação não pode criar novos produtos')

const cookieB = await register('b')
response = await api(`/api/admin/imports/${jobId}/publish`, cookieB, { method: 'POST', body: '{}' })
assert.equal(response.status, 404, 'outra loja não pode publicar o job')

response = await api('/api/admin/imports', cookieB, {
  method: 'POST',
  body: JSON.stringify({ url: 'https://empty-selection.fixture.example/' }),
})
payload = await response.json()
const emptyJobId = payload.job.id
const emptyCollector = async () => ({
  platform: 'generic',
  pagesScanned: 1,
  candidates: [{
    source_url: 'https://empty-selection.fixture.example/p/1',
    external_id: 'e-1',
    title: 'Sem preço',
    description: '',
    sku: '',
    category: '',
    images: [],
    properties: [],
    variants: [],
    price: null,
    currency: 'BRL',
    source: 'fixture',
  }],
})
await processImportJob(emptyJobId, emptyCollector)
const emptyNormalized = await processNormalizationJob(emptyJobId)
assert.equal(emptyNormalized.selected_count, 0)
response = await api(`/api/admin/imports/${emptyJobId}/publish`, cookieB, { method: 'POST', body: '{}' })
assert.equal(response.status, 400, 'job sem produto válido não pode concluir publicação vazia')

console.log('[scanner module 5] transactional bulk publish + legacy schema repair: ok')
