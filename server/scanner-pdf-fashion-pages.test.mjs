import test from 'node:test'
import assert from 'node:assert/strict'
import { parseFashionPhotoPages } from './scanner-pdf-fashion-pages.mjs'
import { parsePdfCatalogText } from './scanner-pdf.mjs'

const sample=(name,amount,fabric='Crepe')=>
  'Tecido: '+fabric+'\nTecido: '+fabric+'\nTam: unico\nTam: unico\n'+
  'Valor: R$ '+amount+'\nValor: R$ '+amount+'\n'+name+'\n'+name+'\nCores:\nCores:'

test('recognizes real fashion lookbook layout: title AFTER price and duplicate Canva text',()=>{
  const pages=[sample('Calça Dominique','60,00'),sample('Blusa Dominique','50,00'),'',
    sample('Calça Dominique','60,00'),sample('Shorts Eva','45,00','Cetim'),
    sample('Corset Cloé','50,00','Crepinho'),sample('Regta Lumi','30,00','Crepinho')]
  const result=parseFashionPhotoPages(pages,500)
  assert.equal(result.candidates.length,6)
  assert.equal(result.fashion,true)
  assert.deepEqual(result.candidates.map(p=>[p.title,p.price,p.pdf_page]),[
    ['Calça Dominique',60,1],['Blusa Dominique',50,2],['Calça Dominique',60,4],
    ['Shorts Eva',45,5],['Corset Cloé',50,6],['Regta Lumi',30,7],
  ])
  assert.equal(result.candidates[0].pdf_review_required,true)
  assert.equal(result.candidates[2].pdf_duplicate_model,true)
  assert.equal(result.candidates[1].pdf_review_required,false)
  assert.equal(result.unlabeledPhotoPages,1)
  assert.ok(result.candidates.every(p=>p.pdf_fashion_lookbook))
})

test('main PDF parser respects per-page product titles and does not create shadow-image products',()=>{
  const source=[sample('Calça Dominique','60,00'),sample('Blusa Dominique','50,00'),'',
    sample('Calça Olivia','60,00','Marrant'),'',sample('Blusa Olivia','40,00','Marrant')].join('\f')
  const result=parsePdfCatalogText(source)
  assert.equal(result.candidates.length,4)
  assert.deepEqual(result.candidates.map(p=>[p.title,p.price]),
    [['Calça Dominique',60],['Blusa Dominique',50],['Calça Olivia',60],['Blusa Olivia',40]])
})

test('isolated ordinary price pages do not switch the entire PDF parser into fashion layout',()=>{
  assert.equal(parseFashionPhotoPages(['Camisa ABC R$ 49,00','Vitrine R$ 29,00'],500),null)
})

test('conflicting price labels must be reviewed instead of inventing a single value',()=>{
  const pages=[sample('Calça A','49,90'),sample('Blusa B','50,00'),sample('Calça C','70,00'),
    sample('Blusa D','30,00')+'\nValor: R$ 32,00',sample('Calça E','60,00')]
  const result=parseFashionPhotoPages(pages,500)
  assert.equal(result.candidates[3].price,null)
  assert.equal(result.candidates[3].pdf_review_required,true)
})