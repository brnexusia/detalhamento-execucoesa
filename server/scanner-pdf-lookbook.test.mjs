import assert from 'node:assert/strict'
import { test } from 'node:test'
import crypto from 'node:crypto'
import PDFDocument from 'pdfkit'
import sharp from 'sharp'
import { parseNumberedLookbookPages, parseLookbookPhotoBands } from './scanner-pdf-lookbook.mjs'
import { collectPdfCatalog, parsePdfCatalogText } from './scanner-pdf.mjs'

test('links numbered prices to the next colors board by item number and preserves unknowns', () => {
  const pages = [
    'MEMORIES traduz a beleza dos detalhes',
    '',
    'Foto editorial sem textos',
    '01 R$ 23,00 03 R$ 24,00\n02 R$ 45,00',
    '',
    'CORES DISPONÍVEIS\nBRINCO 01\nPULSEIRA 02\nPULSEIRA 03',
    '01 R$ 18,00\n02 R$ 27,50\n03 R$ 21,50',
    '',
    'CORES DISPONÍVEIS\nBRINCO 01',
  ]
  const parsed = parsePdfCatalogText(pages.join('\f'))
  assert.equal(parsed.lookbook, true)
  assert.equal(parsed.candidates.length, 6)
  assert.deepEqual(parsed.candidates.slice(0, 3).map(x => x.price), [23, 24, 45])
  assert.equal(parsed.candidates[0].title.startsWith('Brinco 01'), true)
  assert.equal(parsed.candidates[0].pdf_page, 4)
  assert.equal(parsed.candidates[0].pdf_detail_page, 6)
  assert.equal(parsed.candidates[1].title.startsWith('Pulseira 03'), true)
  assert.equal(parsed.candidates[2].title.startsWith('Pulseira 02'), true)
  assert.equal(parsed.candidates[3].title.startsWith('Brinco 01'), true)
  assert.match(parsed.candidates[4].title, /tipo a confirmar/)
  assert.equal(parsed.candidates[4].category, 'Geral')
  assert.equal(parsed.candidates[4].sku, '')
  assert.notEqual(parsed.candidates[0].external_id, parsed.candidates[3].external_id)
})

test('assigns accessory category and tolerates supplier typos without inventing missing SKUs', () => {
  const p = parsePdfCatalogText([
    'MEMORIES',
    '01 R$ 17,50\n02 R$ 42,00',
    'CORES DISPONÍVEIS\nBRINCO 01\nBACELETE 02',
    '01 R$ 140,00',
    'CORES DISPONÍVEIS\nBOLSA 01',
  ].join('\f'))
  assert.equal(p.lookbook, true)
  assert.deepEqual(p.candidates.map(x => x.category), ['Brincos', 'Braceletes', 'Bolsas'])
  assert.deepEqual(p.candidates.map(x => x.sku), ['', '', ''])
})

test('flags a high-priced item with a suspect earring label rather than inventing its category', () => {
  const parsed = parsePdfCatalogText([
    '01 R$ 140,00',
    'CORES DISPONÍVEIS\nBRINCO 01',
    '01 R$ 18,00',
    'CORES DISPONÍVEIS\nBRINCO 01',
  ].join('\f'))
  assert.equal(parsed.lookbook, true)
  assert.equal(parsed.candidates[0].category, 'Geral')
  assert.match(parsed.candidates[0].title, /tipo a confirmar/)
  assert.match(parsed.candidates[0].description, /pode estar incorreta/)
  assert.equal(parsed.candidates[1].category, 'Brincos')
})

test('does not misclassify ordinary numbered price lists as a lookbook', () => {
  assert.equal(parseNumberedLookbookPages([
    'Vestido Aurora\n01 R$ 49,90', 'Saia Midi\n02 R$ 35,50',
  ]), null)
  assert.equal(parseNumberedLookbookPages([
    '01 R$ 49,90', 'CORES DISPONÍVEIS\nBRINCO 01',
  ]), null)
})

test('extracts unique item-specific photo bands from positioned board labels', () => {
  const html = `<page width="810" height="1440">
    <line xMin="30" yMin="220" yMax="252"><word>BRINCO</word><word>01</word></line>
    <line xMin="30" yMin="720" yMax="752"><word>PULSEIRA</word><word>02</word></line>
    <line xMin="30" yMin="1070" yMax="1102"><word>BRACELETE</word><word>04</word><word>E</word><word>05</word></line>
  </page>`
  const bands = parseLookbookPhotoBands(html)
  assert.deepEqual([1, 2, 4, 5].map(id => bands.has('1:' + id)), [true,true,true,true])
  assert.equal(bands.get('1:1').top, 260)
  assert.equal(bands.get('1:1').bottom, 710)
  assert.equal(bands.get('1:2').bottom, 1060)
  assert.deepEqual(bands.get('1:4'),bands.get('1:5'))
})

async function sampleLookbook() {
  const photo = await sharp({ create:{ width:450,height:300,channels:3,background:{r:230,g:120,b:90} } }).png().toBuffer()
  return new Promise((resolve,reject)=>{
    const doc = new PDFDocument({ autoFirstPage: false, compress: false, size: [810, 1440] })
    const chunks=[]
    doc.on('data',chunk=>chunks.push(chunk))
    doc.on('end',()=>resolve(Buffer.concat(chunks)))
    doc.on('error',reject)
    doc.addPage().fontSize(26).text('MEMORIES',60,70)
    doc.addPage().fontSize(25).text('01 R$ 23,00\n02 R$ 45,00',70,1200)
    doc.addPage().image(photo,150,150,{width:500})
    doc.addPage().fontSize(27).text('CORES DISPONÍVEIS',65,80)
    doc.fontSize(23).text('BRINCO 01',65,240).image(photo,120,330,{width:300})
    doc.fontSize(23).text('PULSEIRA 02',65,800).image(photo,120,900,{width:300})
    doc.addPage().fontSize(25).text('01 R$ 18,00',70,1200)
    doc.addPage().fontSize(27).text('CORES DISPONÍVEIS',65,80)
    doc.fontSize(23).text('BRINCO 01',65,250).image(photo,120,340,{width:300})
    doc.end()
  })
}

test('collects a separated-page lookbook and assigns cropped images to individual items', async () => {
  const uploads=[]
  const parsed = await collectPdfCatalog(await sampleLookbook(),{
    onImage: async (buffer,mime,file)=>{
      const m = await sharp(buffer).metadata()
      assert.equal(mime,'image/webp')
      assert(m.height < 1250 && m.height > 200, 'crop is a single-item band, not the whole page')
      uploads.push({file,bytes:buffer.length})
      return '/media/' + crypto.randomUUID()
    },
  })
  assert.equal(parsed.platform,'pdf')
  assert.equal(parsed.candidates.length,3)
  assert.deepEqual(parsed.candidates.map(x=>x.price),[23,45,18])
  assert.equal(parsed.candidates.filter(x=>x.images.length===1).length,3)
  assert.equal(uploads.length,3)
  assert.equal(parsed.candidates[0].pdf_page,2)
  assert.equal(parsed.candidates[1].pdf_detail_page,4)
})

test('Costa: continues split model price pages before the same colors board', () => {
  const text = [
    'COSTA',
    '01 R$ 18,00 02 R$ 32,50 03 R$ 34,50 04 R$ 28,50',
    '05 R$ 10,50',
    'CORES DISPONÍVEIS\nPRESILHA 05',
    '01 R$ 18,50 02 R$ 24,50',
    'CORES DISPONÍVEIS\nBRINCO 01\nCOLAR 02',
  ].join('\f')
  const parsed = parsePdfCatalogText(text)
  assert.equal(parsed.lookbook, true)
  assert.equal(parsed.lookCount, 2)
  assert.equal(parsed.candidates.length, 7)
  assert.equal(parsed.candidates[4].price, 10.50)
  assert.equal(parsed.candidates[4].category, 'Acessórios')
  assert.equal(parsed.candidates[4].pdf_page, 3)
  assert.equal(parsed.candidates[4].pdf_detail_page, 4)
  assert.equal(parsed.candidates[0].pdf_detail_page, null)
})

test('Lume and Memories: join all successive variant boards for the same look', () => {
  const parsed = parsePdfCatalogText([
    'LUME',
    '01 R$ 15,00 02 R$ 44,00 03 R$ 23,50 04 R$ 25,00 05 R$ 23,50',
    'CORES DISPONÍVEIS\nBRINCO 01\nCOLAR 02\nBRACELETE 03 E 05',
    'CORES DISPONÍVEIS\nBRACELETE 04',
    '01 R$ 16,00 02 R$ 18,00',
    'CORES DISPONÍVEIS\nBRINCO 01\nANEL 02',
  ].join('\f'))
  assert.equal(parsed.lookbook, true)
  assert.deepEqual(parsed.candidates.slice(0,5).map(x=>x.category),
    ['Brincos','Colares','Braceletes','Braceletes','Braceletes'])
  assert.equal(parsed.candidates[3].pdf_detail_page, 4)
  assert.equal(parsed.candidates[4].pdf_detail_page, 3)
})

test('Memories Drop II: never merge repeated 01 item from two adjacent looks', () => {
  const parsed = parsePdfCatalogText([
    'MEMORIES',
    '01 R$ 140,00',
    'CORES DISPONÍVEIS\nBRINCO 01',
    '01 R$ 25,00 02 R$ 30,00',
    'CORES DISPONÍVEIS\nBRACELETE 01\nBRACELETE 02',
  ].join('\f'))
  assert.equal(parsed.lookCount, 2)
  assert.equal(parsed.candidates.length, 3)
  assert.notEqual(parsed.candidates[0].external_id, parsed.candidates[1].external_id)
  assert.equal(parsed.candidates[0].category, 'Geral')
  assert.equal(parsed.candidates[1].category, 'Braceletes')
})

test('Origem: prints genuine prices but requires review for unnamed model products', () => {
  const parsed = parsePdfCatalogText([
    'ORIGEM',
    '01 R$ 17,50 02 R$ 37,50 03 R$ 27,00',
    'CORES DISPONÍVEIS\nBRINCO 01\nCOLAR 02',
    '01 R$ 14,50 02 R$ 32,50',
    'CORES DISPONÍVEIS\nBRINCO 01\nCOLAR 02',
  ].join('\f'))
  assert.equal(parsed.candidates.length, 5)
  assert.equal(parsed.candidates[2].price, 27)
  assert.equal(parsed.candidates[2].pdf_needs_review, true)
  assert.equal(parsed.candidates[2].images.length, 0)
})
