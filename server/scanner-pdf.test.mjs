import assert from 'node:assert/strict'
import { test } from 'node:test'
import PDFDocument from 'pdfkit'
import sharp from 'sharp'
import { collectPdfCatalog, parsePdfCatalogText, MAX_PDF_BYTES } from './scanner-pdf.mjs'
import { normalizeCandidate } from './scanner-normalizer.mjs'
import { prepareReview } from './scanner-review.mjs'

test('recognizes two products and prices in a text catalog page', () => {
  const pdf = [
    'COLEÇÃO OUTONO',
    'Vestido Aurora',
    'REF: VA-42',
    'Preço atacado: R$ 49,90',
    'Tamanho P, M, G',
    'Blusa Linho - R$ 35,50',
    'SKU: BL-02',
    '',
  ].join('\n')
  const result = parsePdfCatalogText(pdf + '\f')
  assert.equal(result.candidates.length, 2)
  assert.equal(result.candidates[0].title, 'Vestido Aurora')
  assert.equal(result.candidates[0].price, 49.90)
  assert.equal(result.candidates[0].sku, 'VA-42')
  assert.equal(result.candidates[1].title, 'Blusa Linho -')
  assert.equal(result.candidates[1].price, 35.50)
  assert.equal(result.candidates[1].pdf_page, 1)
})

test('keeps products from different pages and avoids repeat price variants', () => {
  const pdf = [
    'Conjunto Maré\nREF: CM-09\nAtacado R$ 59,90\nVarejo R$ 79,90',
    'Saia Midi\nR$ 34,90',
  ].join('\f')
  const products = parsePdfCatalogText(pdf).candidates
  assert.equal(products.length, 2)
  assert.equal(products[0].price, 59.90)
  assert.equal(products[1].pdf_page, 2)
  assert.equal(products[1].title, 'Saia Midi')
})

test('does not invent products or prices for PDFs without prices', () => {
  const products = parsePdfCatalogText('NOSSA COLEÇÃO\nVestido Aurora\nFale conosco').candidates
  assert.equal(products.length, 0)
})

test('accepts internal image assets in normalizer and in review', () => {
  const normalized = normalizeCandidate({
    title: 'Saia Midi',
    sku: 'S10',
    price: 60,
    images: ['/media/11111111-2222-3333-4444-555555555555'],
    source_url: 'pdf://page/1/item/0',
    external_id: 'pdf-p1-0',
  }).normalized
  assert.equal(normalized.images.length, 1)
  assert.equal(prepareReview(normalized).data.media_url, normalized.images[0])
})

function createPdf() {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false, compress: false })
    const chunks = []
    doc.on('data', (data) => chunks.push(data))
    doc.on('error', reject)
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.addPage()
    doc.fontSize(20).text('Vestido Aurora')
    doc.fontSize(12).text('REF: VA-42')
    doc.text('Preco R$ 49,90')
    doc.addPage()
    doc.fontSize(20).text('Saia Midi')
    doc.fontSize(12).text('SKU: SA-10')
    doc.text('R$ 35,90')
    doc.end()
  })
}

test('collects an actual two-page PDF without publishing it', async () => {
  const buffer = await createPdf()
  assert.ok(buffer.length < MAX_PDF_BYTES)
  const result = await collectPdfCatalog(buffer)
  assert.equal(result.pagesScanned, 2)
  assert.equal(result.platform, 'pdf')
  assert.equal(result.candidates.length, 2)
  assert.equal(result.candidates[0].price, 49.90)
  assert.equal(result.candidates[1].price, 35.90)
})

test('extracts an embedded product photo only for unambiguous single-product pages', async () => {
  const image = await sharp({
    create: { width: 500, height: 500, channels: 3, background: { r: 92, g: 112, b: 180 } },
  }).jpeg().toBuffer()
  const pdf = await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false })
    const chunks = []
    doc.on('data', (data) => chunks.push(data))
    doc.on('error', reject)
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.addPage()
    doc.image(image, 30, 70, { width: 290 })
    doc.text('Camisa Brisa', 30, 390)
    doc.text('REF: CB-05', 30, 413)
    doc.text('R$ 49,00', 30, 435)
    doc.end()
  })
  const images = []
  const result = await collectPdfCatalog(pdf, { onImage: async (bytes, mime) => {
    assert.ok(bytes.length > 0)
    assert.equal(mime, 'image/webp')
    images.push(bytes)
    return '/media/aaaa1111-2222-3333-4444-555555555555'
  } })
  assert.equal(result.candidates.length, 1)
  assert.equal(result.candidates[0].images.length, 1)
  assert.equal(images.length, 1)
})

test('rejects non-PDF binary before launching converters', async () => {
  await assert.rejects(collectPdfCatalog(Buffer.from('NOT A PDF')), /PDF válido/)
})
