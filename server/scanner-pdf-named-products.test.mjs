import test from 'node:test'
import assert from 'node:assert/strict'
import { parseNamedUnpricedPdfProducts } from './scanner-pdf-named-products.mjs'

test('captures explicitly named cosmetic products in price-free supplier brochure',()=>{
  const pages=[
    'CATÁLOGO 2026\nShampoo Suave 300ml/1L\nMáscara Reparadora 300g/1Kg\nCondicionador Suave 300ml/1L\nDescrição longa: auxilia na limpeza e hidratação.',
    'Shampoo Suave 300ml/1L\nÓleo Capilar 30ml\nAtivador de Cachos 450g\nPara todos os tipos de cabelo.',
  ]
  const items=parseNamedUnpricedPdfProducts(pages)
  assert.equal(items.length,5)
  assert.ok(items.every(p=>p.price===null && p.pdf_review_required))
  assert.ok(items.every(p=>p.images.length===0))
  assert.equal(items[0].title,'Shampoo Suave 300ml/1L')
  assert.equal(items[3].title,'Óleo Capilar 30ml')
})

test('ignores promotional prose, repeated titles and vague unnamed products',()=>{
  const pages=['CATÁLOGO\nShampoo
Óleo natural e ingredientes de qualidade.\nCom 450ml e uma ótima fragrância\nPreço especial\nProduto de destaque\nShampoo Suave 300ml']
  const products=parseNamedUnpricedPdfProducts(pages)
  assert.equal(products.length,1)
  assert.equal(products[0].title,'Shampoo Suave 300ml')
})
