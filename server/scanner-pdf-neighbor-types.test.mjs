import test from 'node:test'
import assert from 'node:assert/strict'
import { suggestMissingLookbookTypes } from './scanner-pdf-lookbook.mjs'

function record(pricePage, item, price = 25) {
  return {
    title:'Acessório para identificar · Memories · ' +
      String(pricePage).padStart(2,'0') + '-' + String(item).padStart(2,'0'),
    description:'Coleção Memories.', category:'Geral', price,
    pdf_page: pricePage, pdf_item_number: item, pdf_review_required: true,
  }
}

test('corroborated neighboring board suggests types for missing numbered items', () => {
  const pages = Array(16).fill('')
  pages[5] = 'CORES DISPONÍVEIS\nBRINCO 01\nPULSEIRA 02\nPULSEIRA 03'
  pages[8] = 'CORES DISPONÍVEIS\nBRINCO 01'
  const items=[record(7,1),record(7,2,27.5),record(7,3,21.5)]
  const total=suggestMissingLookbookTypes(items,pages)
  assert.equal(total,2)
  assert.match(items[1].title,/^Pulseira ·/)
  assert.match(items[2].title,/^Pulseira ·/)
  assert.equal(items[1].price,27.5)
  assert.equal(items[1].pdf_item_number,2)
  assert.equal(items[1].pdf_review_required,true)
  assert.match(items[1].description,/quadro da página 6/)
  assert.match(items[1].description,/REVISÃO OBRIGATÓRIA/)
})

test('wrong look numbering does not infer from only one overlapping marker', () => {
  const pages=Array(15).fill('')
  pages[4]='CORES DISPONÍVEIS\nBRINCO 01\nCOLAR 05'
  pages[11]='CORES DISPONÍVEIS\nBRINCO 01'
  const items=[record(10,1),record(10,2),record(10,3)]
  assert.equal(suggestMissingLookbookTypes(items,pages),0)
  assert.ok(items.every(x=>/^Acessório para identificar/.test(x.title)))
})

test('conflicting equally corroborated boards never produce a category guess', () => {
  const pages=Array(10).fill('')
  pages[2]='CORES DISPONÍVEIS\nBRINCO 01\nCOLAR 02\nPULSEIRA 03'
  pages[6]='CORES DISPONÍVEIS\nBRINCO 01\nBRACELETE 02\nPULSEIRA 03'
  const items=[record(5,1),record(5,2),record(5,3)]
  assert.equal(suggestMissingLookbookTypes(items,pages),2)
  assert.match(items[1].title,/^Acessório para identificar/)
  assert.equal(items[1].category,'Geral')
})

test('single price and one adjacent unnumbered product label can suggest category', () => {
  const pages=Array(7).fill('')
  pages[3]='CORES DISPONÍVEIS\nBOLSA'
  const items=[record(5,1,140)]
  assert.equal(suggestMissingLookbookTypes(items,pages),1)
  assert.match(items[0].title,/^Bolsa ·/)
  assert.equal(items[0].price,140)
  assert.equal(items[0].pdf_type_suggestion_page,4)
  assert.equal(items[0].pdf_review_required,true)
})

test('never borrow unnumbered label when two price items are on the page', () => {
  const pages=Array(7).fill('')
  pages[3]='CORES DISPONÍVEIS\nBOLSA'
  const items=[record(5,1,140),record(5,2,140)]
  assert.equal(suggestMissingLookbookTypes(items,pages),0)
})

test('does not alter source-confirmed types or replace supplier prices and photos', () => {
  const pages=Array(7).fill('')
  pages[3]='CORES DISPONÍVEIS\nBRINCO 01\nCOLAR 02'
  const items=[
    {title:'Brinco · Memories · 01-01',pdf_page:5,pdf_item_number:1,
      category:'Brincos',images:['https://example.test/image.webp'],price:17,description:'original'},
    record(5,2,29),
  ]
  const old={...items[0]}
  assert.equal(suggestMissingLookbookTypes(items,pages),1)
  assert.deepEqual(items[0],old)
  assert.equal(items[1].price,29)
})
