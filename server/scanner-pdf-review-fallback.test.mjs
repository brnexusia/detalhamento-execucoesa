import test from 'node:test'
import assert from 'node:assert/strict'
import { parseReferenceOnlyPdfProducts } from './scanner-pdf-review-fallback.mjs'
import { prepareReview } from './scanner-review.mjs'

test('preserves explicitly named/ref catalog items without inventing prices',()=>{
  const candidates=parseReferenceOnlyPdfProducts([
    'COLEÇÃO LUME\nVestido Bela\nREF: VB-103\nTamanho M\nBlusa Linho\nSKU: BL-99',
    'BOLSA\nBolsa Estruturada\nCÓDIGO: BO-101',
  ])
  assert.equal(candidates.length,3)
  assert.equal(candidates[0].title,'Vestido Bela')
  assert.equal(candidates[0].sku,'VB-103')
  assert.equal(candidates[0].price,null)
  assert.equal(candidates[1].pdf_page,1)
  assert.equal(candidates[2].pdf_page,2)
  const review=prepareReview({name:candidates[0].title,price:candidates[0].price,
    description:candidates[0].description,source:candidates[0].source})
  assert.equal(review.publishable,false)
  assert.ok(review.warnings.includes('missing_price'))
})

test('does not turn broad catalog headers or unreferenced names into products',()=>{
  const products=parseReferenceOnlyPdfProducts([
    'COLEÇÃO PRIMAVERA\nVestido Aurora\nVisite nossa loja\nSUMÁRIO\nREF: 100',
    'Instagram\nWhatsApp\nColeção de vestidos\nSKU: ABC-099',
    'Blusa Colorida\nREF: (sem codigo)',
  ])
  assert.deepEqual(products,[])
})
