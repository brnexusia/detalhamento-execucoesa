import assert from 'node:assert/strict'
import { canonicalImportProductUrl, importParentKey, mergeImportParentProducts } from './scanner-import-grouping.mjs'

assert.equal(
  canonicalImportProductUrl('https://loja.example/produto/camiseta?sku=PRETO-P&utm_source=teste&variant=123'),
  'https://loja.example/produto/camiseta',
)

const black = {
  name: 'Camiseta Essencial',
  sku: 'CAM-PRETO-P',
  price: 39.9,
  category: 'Camisetas',
  images: ['https://cdn.example/camiseta-preta.jpg'],
  media_url: 'https://cdn.example/camiseta-preta.jpg',
  media_type: 'image',
  variations: [{ name: 'Cor', options: ['Preto'] }, { name: 'Tamanho', options: ['P'] }],
  source_url: 'https://loja.example/produto/camiseta?sku=CAM-PRETO-P',
}
const blue = {
  ...black,
  sku: 'CAM-AZUL-M',
  price: 41.9,
  images: ['https://cdn.example/camiseta-azul.jpg'],
  media_url: 'https://cdn.example/camiseta-azul.jpg',
  variations: [{ name: 'Color', options: ['Azul'] }, { name: 'Size', options: ['M'] }],
  source_url: 'https://loja.example/produto/camiseta?variant=CAM-AZUL-M',
}

assert.equal(importParentKey(black), importParentKey(blue), 'query de variação não pode criar outro produto pai')
assert.notEqual(
  importParentKey(black),
  importParentKey({ ...blue, source_url: 'https://loja.example/produto/camiseta-premium?variant=CAM-AZUL-M' }),
  'URLs reais de produtos diferentes não podem ser agrupadas pelo título',
)

const merged = mergeImportParentProducts([black, blue])
assert.equal(merged.sku, '', 'SKUs diferentes de variante não devem virar SKU do produto pai')
assert.equal(merged.price, 39.9)
assert.equal(merged.media_url, 'https://cdn.example/camiseta-preta.jpg')
assert.deepEqual(merged.images, [
  'https://cdn.example/camiseta-preta.jpg',
  'https://cdn.example/camiseta-azul.jpg',
])
assert.deepEqual(merged.variations, [
  { name: 'Cor', options: ['Preto', 'Azul'] },
  { name: 'Tamanho', options: ['P', 'M'] },
])

console.log('[scanner import grouping] parent product merge: ok')
