import assert from 'node:assert/strict'
import { canonicalVariationName, cleanDescription, normalizeCandidate, normalizeCandidates, normalizeVariations } from './scanner-normalizer.mjs'

assert.equal(cleanDescription('<p>Camisa <strong>ampla</strong> em linho.</p>'), 'Camisa ampla em linho.')
assert.equal(cleanDescription('cal&ccedil;a jogging em fluity'), 'calça jogging em fluity')
assert.equal(cleanDescription('Vestido &amp; faixa &#231;'), 'Vestido & faixa ç')
assert.equal(canonicalVariationName('Color'), 'Cor')
assert.equal(canonicalVariationName('cores'), 'Cor')
assert.equal(canonicalVariationName('tam'), 'Tamanho')
assert.equal(canonicalVariationName('attribute_pa_cor'), 'Cor')
assert.equal(canonicalVariationName('pa_size'), 'Tamanho')

const variations = normalizeVariations({
  properties: [
    { name: 'Color', values: ['Preto', 'Caramelo', 'Preto'] },
    { name: 'Size', values: ['P', 'M'] },
  ],
  variants: [
    { option1: 'Preto', option2: 'G' },
    { color: 'Azul', size: 'M' },
  ],
})
assert.deepEqual(variations, [
  { name: 'Cor', options: ['Preto', 'Caramelo', 'Azul'] },
  { name: 'Tamanho', options: ['P', 'M', 'G'] },
])

const normalized = normalizeCandidate({
  __candidate_id: 'candidate-1',
  source_url: 'https://loja.example/products/camisa',
  external_id: '101',
  title: '  Camisa   Linho  ',
  description: '<p>Camisa <b>leve</b> para atacado.</p>',
  sku: 'CL-01',
  category: 'Camisas',
  brand: 'Marca X',
  images: ['https://cdn.example/camisa.jpg', 'https://cdn.example/camisa.jpg', 'javascript:alert(1)'],
  properties: [{ name: 'Cor', values: ['Preto'] }],
  variants: [{ price: 49.9, color: 'Caramelo' }, { price: 42, color: 'Preto' }],
  price: null,
  currency: 'brl',
})
assert.equal(normalized.source_candidate_id, 'candidate-1')
assert.equal(normalized.normalized.name, 'Camisa Linho')
const encodedName = normalizeCandidate({ title: 'Cal&ccedil;a Jogging em Fluity', price: 79.9, source_url: 'https://loja.example/p/calca' })
assert.equal(encodedName.normalized.name, 'Calça Jogging em Fluity')
assert.equal(normalized.normalized.description, 'Camisa leve para atacado.')
assert.equal(normalized.normalized.price, 42)
assert.equal(normalized.normalized.currency, 'BRL')
assert.deepEqual(normalized.normalized.images, ['https://cdn.example/camisa.jpg'])
assert.deepEqual(normalized.normalized.variations, [{ name: 'Cor', options: ['Preto', 'Caramelo'] }])
assert.deepEqual(normalized.warnings, [])
assert.equal(normalized.confidence, 1)


const braavoImages = Array.from({ length: 10 }, (_, index) => `https://thumb.braavo.me/azul-${index + 1}.webp`)
const braavoNormalized = normalizeCandidate({
  source_url: 'https://loja.example/p/blusa-braavo',
  source: 'braavo-html',
  title: 'Blusa Braavo',
  price: 56.9,
  images: ['https://thumb.braavo.me/azul-1.webp', 'https://thumb.braavo.me/azul-2.webp'],
  variants: [
    { external_id: 'color-1', color: 'Azul', images: braavoImages },
    { external_id: 'sku-p', color: 'Azul', size: 'P', price: 56.9, images: [] },
    { external_id: 'sku-m', color: 'Azul', size: 'M', price: 56.9, images: [] },
  ],
})
assert.deepEqual(braavoNormalized.normalized.images, [
  'https://thumb.braavo.me/azul-1.webp',
  'https://thumb.braavo.me/azul-2.webp',
], 'Braavo não deve misturar fotos de outras cores na galeria base')
assert.deepEqual(braavoNormalized.normalized.variations, [
  { name: 'Cor', options: ['Azul'] },
  { name: 'Tamanho', options: ['P', 'M'] },
])
assert.deepEqual(braavoNormalized.normalized.variant_images, [{
  selections: { Cor: 'Azul' },
  images: braavoImages,
}], 'a galeria da cor deve manter as dez fotos e não depender do tamanho selecionado')

const incomplete = normalizeCandidate({ title: 'Produto sem dados', source_url: 'https://loja.example/p/sem-dados' })
assert.equal(incomplete.normalized.category, 'Geral')
assert.equal(incomplete.normalized.price, null)
assert.deepEqual(incomplete.warnings, ['missing_price'], 'somente bloqueios exigem revisão manual')
assert.ok(incomplete.confidence < 1, 'completude ainda afeta confiança sem bloquear importação')

const validButSparse = normalizeCandidate({
  title: 'Produto simples',
  source_url: 'https://loja.example/p/simples',
  price: 19.9,
})
assert.deepEqual(validButSparse.warnings, [], 'produto com nome e preço deve seguir automaticamente')
assert.ok(validButSparse.confidence < 1, 'dados opcionais ausentes continuam refletidos na confiança')

const deduped = normalizeCandidates([
  {
    __candidate_id: 'poor', source_url: 'https://loja.example/a', title: 'Bolsa Siena', sku: 'BS-01', price: 40,
    images: ['https://cdn.example/bolsa-frente.jpg'],
    variants: [{ color: 'Preto', image: 'https://cdn.example/bolsa-preta-1.jpg' }],
  },
  {
    __candidate_id: 'rich', source_url: 'https://loja.example/b', title: 'Bolsa Siena', sku: 'BS-01', price: 40,
    description: 'Bolsa estruturada.', category: 'Bolsas', images: ['https://cdn.example/bolsa-lado.jpg'],
    properties: [{ name: 'Cores', values: ['Preto', 'Caramelo'] }],
    variants: [
      { color: 'Preto', images: ['https://cdn.example/bolsa-preta-2.jpg'] },
      { color: 'Caramelo', image: 'https://cdn.example/bolsa-caramelo.jpg' },
    ],
  },
])
assert.equal(deduped.inputCount, 2)
assert.equal(deduped.products.length, 1)
assert.equal(deduped.duplicateCount, 1)
assert.equal(deduped.products[0].source_candidate_id, 'rich')
assert.equal(deduped.products[0].normalized.description, 'Bolsa estruturada.')
assert.deepEqual(deduped.products[0].normalized.images, [
  'https://cdn.example/bolsa-lado.jpg',
  'https://cdn.example/bolsa-preta-2.jpg',
  'https://cdn.example/bolsa-caramelo.jpg',
  'https://cdn.example/bolsa-frente.jpg',
  'https://cdn.example/bolsa-preta-1.jpg',
], 'candidatos duplicados devem somar galerias complementares, não descartar uma delas')
const blackGallery = deduped.products[0].normalized.variant_images.find((item) => item.selections.Cor === 'Preto')
assert.deepEqual(blackGallery?.images, [
  'https://cdn.example/bolsa-preta-2.jpg',
  'https://cdn.example/bolsa-preta-1.jpg',
], 'imagens da mesma variação também devem ser unidas')
assert.deepEqual(deduped.products[0].normalized.variations, [{ name: 'Cor', options: ['Preto', 'Caramelo'] }])

console.log('[scanner module 3] normalizer tests: ok')
