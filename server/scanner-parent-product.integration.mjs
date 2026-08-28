import assert from 'node:assert/strict'
import { processImportJob, processNormalizationJob } from './scanner-hooks.mjs'

const base = process.env.BASE_URL || 'http://127.0.0.1:3000'

async function register() {
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Parent product',
      email: `parent-product-${Date.now()}-${Math.random()}@example.test`,
      password: 'scanner1234',
      storeName: 'Loja Parent Product',
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

const cookie = await register()
let response = await api('/api/admin/imports', cookie, {
  method: 'POST',
  body: JSON.stringify({ url: 'https://variants.fixture.example/' }),
})
assert.equal(response.status, 201)
let payload = await response.json()
const jobId = payload.job.id

const colors = ['Preto', 'Azul']
const sizes = ['P', 'M']
const candidates = Array.from({ length: 251 }, (_, index) => {
  const color = colors[index % colors.length]
  const size = sizes[Math.floor(index / colors.length) % sizes.length]
  return {
    source_url: `https://variants.fixture.example/produto/camiseta?sku=CAM-${index}&variant=VAR-${index}`,
    external_id: `variant-${index}`,
    title: 'Camiseta Essencial',
    description: 'Camiseta em algodão.',
    sku: `CAM-${index}`,
    category: 'Camisetas',
    images: index === 0 ? ['https://cdn.fixture.example/camiseta.jpg'] : [],
    properties: [{ name: 'Cor', value: color }, { name: 'Tamanho', value: size }],
    variants: [],
    price: 39.9,
    currency: 'BRL',
    source: 'fixture-variant-page',
  }
})

// Mesmo título, mas URL real de outro produto: não pode entrar no agrupamento acima.
candidates.push({
  source_url: 'https://variants.fixture.example/produto/camiseta-premium?sku=PREM-1',
  external_id: 'premium-1',
  title: 'Camiseta Essencial',
  description: 'Outra peça.',
  sku: 'PREM-1',
  category: 'Camisetas',
  images: ['https://cdn.fixture.example/premium.jpg'],
  properties: [{ name: 'Cor', value: 'Branco' }],
  variants: [],
  price: 59.9,
  currency: 'BRL',
  source: 'fixture-variant-page',
})

const fakeCollector = async () => ({ platform: 'generic', pagesScanned: 252, candidates })
const collected = await processImportJob(jobId, fakeCollector)
assert.equal(collected.status, 'processing')
assert.equal(collected.result_count, 252)

const normalized = await processNormalizationJob(jobId)
assert.equal(normalized.status, 'review')
assert.equal(normalized.normalized_count, 252, 'normalização mantém a rastreabilidade das linhas de origem')
assert.equal(normalized.selected_count, 252)

response = await api(`/api/admin/imports/${jobId}/publish`, cookie, { method: 'POST', body: '{}' })
assert.equal(response.status, 200)
payload = await response.json()
assert.equal(payload.result.source_rows, 252)
assert.equal(payload.result.selected, 2, '252 linhas de origem representam só 2 produtos pais')
assert.equal(payload.result.created, 2)
assert.equal(payload.result.skipped_existing, 0)

response = await api('/api/admin/bootstrap', cookie)
assert.equal(response.status, 200)
payload = await response.json()
assert.equal(payload.products.length, 2, 'variações não podem ser cadastradas como produtos separados')

const parent = payload.products.find((item) => item.mediaUrl === 'https://cdn.fixture.example/camiseta.jpg')
assert.ok(parent, 'imagem encontrada em uma das variações deve acompanhar o produto pai')
assert.equal(parent.name, 'Camiseta Essencial')
assert.equal(parent.sku, '', 'SKUs diferentes das variantes não devem ocupar o SKU do pai')
assert.deepEqual(parent.variations, [
  { name: 'Cor', options: ['Preto', 'Azul'] },
  { name: 'Tamanho', options: ['P', 'M'] },
])

const premium = payload.products.find((item) => item.sku === 'PREM-1')
assert.ok(premium, 'produto distinto com o mesmo título deve continuar separado')
assert.equal(premium.mediaUrl, 'https://cdn.fixture.example/premium.jpg')

response = await api(`/api/admin/imports/${jobId}/publish`, cookie, { method: 'POST', body: '{}' })
assert.equal(response.status, 200)
payload = await response.json()
assert.equal(payload.idempotent, true)
assert.equal(payload.result.created, 2)

response = await api('/api/admin/bootstrap', cookie)
payload = await response.json()
assert.equal(payload.products.length, 2, 'repetir publicação não pode duplicar os produtos pais')

console.log('[scanner parent product] image + variations grouped at publish: ok')
