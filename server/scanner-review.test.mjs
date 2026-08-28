import assert from 'node:assert/strict'
import { prepareReview, sanitizeReviewData, sanitizeReviewVariations } from './scanner-review.mjs'

const clean = sanitizeReviewData({
  name: '  Camisa   Linho  ',
  description: 'Descrição\r\ncom duas linhas.',
  sku: ' CL-01 ',
  category: ' Camisas ',
  brand: ' Marca ',
  price: '42.90',
  currency: 'brl',
  images: [
    'https://cdn.example.com/a.jpg#x',
    'https://cdn.example.com/a.jpg',
    'javascript:alert(1)',
  ],
  variations: [
    { name: 'Color', options: ['Preto', 'Caramelo', 'Preto'] },
    { name: 'Tam', options: ['P', 'M'] },
  ],
  source_url: 'https://loja.example.com/produto/1#detalhes',
  source: 'fixture',
})

assert.equal(clean.name, 'Camisa Linho')
assert.equal(clean.price, 42.9)
assert.equal(clean.currency, 'BRL')
assert.deepEqual(clean.images, ['https://cdn.example.com/a.jpg'])
assert.deepEqual(clean.variations, [
  { name: 'Cor', options: ['Preto', 'Caramelo'] },
  { name: 'Tamanho', options: ['P', 'M'] },
])
assert.equal(clean.source_url, 'https://loja.example.com/produto/1')

assert.deepEqual(sanitizeReviewVariations([
  { name: 'Cor', options: ['Azul'] },
  { name: 'Color', options: ['Preto', 'Azul'] },
]), [{ name: 'Cor', options: ['Azul', 'Preto'] }])

const incomplete = prepareReview({ name: 'Bolsa', price: null, images: [], sku: '', category: '', description: '' })
assert.equal(incomplete.publishable, false)
assert.ok(incomplete.warnings.includes('missing_price'))
assert.ok(incomplete.warnings.includes('missing_image'))
assert.ok(incomplete.warnings.includes('missing_sku'))
assert.ok(incomplete.warnings.includes('missing_category'))
assert.ok(incomplete.warnings.includes('missing_description'))
assert.ok(incomplete.confidence < 1)

const accepted = prepareReview({
  name: 'Bolsa',
  price: 48.9,
  images: ['https://cdn.example.com/bolsa.jpg'],
  sku: 'B-1',
  category: 'Bolsas',
  description: 'Bolsa estruturada.',
})
assert.equal(accepted.publishable, true)
assert.deepEqual(accepted.warnings, [])
assert.equal(accepted.confidence, 1)

console.log('[scanner module 4] review validation: ok')
