import assert from 'node:assert/strict'
import { test } from 'node:test'
import PDFDocument from 'pdfkit'
import sharp from 'sharp'
import { collectPdfCatalog, parsePdfCatalogText, assertPdfImageBudget, PdfSafetyError, MAX_PDF_BYTES } from './scanner-pdf.mjs'
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

test('matches global PDF image IDs to page-local extraction filenames and keeps additional photo pages', async () => {
  const colorImage = async (rgb) => sharp({
    create: { width: 550, height: 750, channels: 3, background: rgb },
  }).jpeg().toBuffer()
  const cover = await colorImage({ r: 55, g: 55, b: 55 })
  const main = await colorImage({ r: 205, g: 55, b: 75 })
  const additional = await colorImage({ r: 60, g: 95, b: 205 })
  const second = await colorImage({ r: 60, g: 180, b: 90 })
  const pdf = await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false })
    const chunks = []
    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('error', reject)
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    // Non-product cover guarantees global image indices are nonzero by the
    // time the first priced product appears.
    doc.addPage()
    doc.image(cover, 30, 80, { width: 300 })
    doc.text('COLECAO VERAO', 30, 450)
    doc.addPage()
    doc.image(main, 30, 50, { width: 300 })
    doc.text('Blusa Dominique', 30, 470)
    doc.text('Valor: R$ 50,00', 30, 495)
    // As with Look Premium, this picture-only page belongs to the prior
    // product. It must not become a new product nor lose its photo.
    doc.addPage()
    doc.image(additional, 30, 70, { width: 300 })
    doc.addPage()
    doc.image(second, 30, 50, { width: 300 })
    doc.text('Calca Olivia', 30, 470)
    doc.text('Valor: R$ 60,00', 30, 495)
    doc.end()
  })
  const uploaded = []
  const result = await collectPdfCatalog(pdf, {
    onImage: async (bytes, mime, filename) => {
      assert.ok(bytes.length > 0)
      assert.equal(mime, 'image/webp')
      uploaded.push(filename)
      return '/media/' + String(uploaded.length).padStart(30, 'a')
    },
  })
  assert.equal(result.candidates.length, 2)
  assert.equal(result.candidates[0].title, 'Blusa Dominique')
  assert.equal(result.candidates[0].pdf_page, 2)
  assert.equal(result.candidates[0].price, 50)
  assert.equal(result.candidates[0].images.length, 2, 'priced page and continuation photo are both attached')
  assert.equal(result.candidates[1].title, 'Calca Olivia')
  assert.equal(result.candidates[1].price, 60)
  assert.equal(result.candidates[1].images.length, 1, 'next product cannot inherit the previous product photos')
  assert.deepEqual(uploaded, ['catalogo-p2.webp', 'catalogo-p3.webp', 'catalogo-p4.webp'])
})

test('rejects non-PDF binary before launching converters', async () => {
  await assert.rejects(collectPdfCatalog(Buffer.from('NOT A PDF')), /PDF válido/)
})

test('PDF input limit is 50 MiB and rejects larger uploads before parsing', async () => {
  assert.equal(MAX_PDF_BYTES, 50 * 1024 * 1024)
  const fake = Buffer.alloc(MAX_PDF_BYTES + 1)
  fake.write('%PDF-1.4', 0, 'ascii')
  await assert.rejects(collectPdfCatalog(fake), /50 MB/)
})

test('blocks image decompression bombs before photo extraction', () => {
  const listing = (width, height) => 'page num  type   width height\n   1   0 image ' + width + ' ' + height + ' rgb'
  assert.throws(() => assertPdfImageBudget(listing(10000, 10000)), PdfSafetyError)
  assert.throws(() => assertPdfImageBudget(listing(20000, 10)), PdfSafetyError)
  const many = Array.from({length:221},(_,i)=>'   1 '+i+' image 500 500 rgb').join('\n')
  assert.throws(() => assertPdfImageBudget(many), PdfSafetyError)
  const tooManyPixels = Array.from({length:9},(_,i)=>'   1 '+i+' image 4800 4800 rgb').join('\n')
  assert.throws(() => assertPdfImageBudget(tooManyPixels), PdfSafetyError)
  assert.equal(assertPdfImageBudget(listing(500, 500)).length, 1)
})

test('accepts a long 166-page wholesale PDF (real catalog size class)', async () => {
  const pdf = await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false, compress: true })
    const chunks = []
    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('error', reject)
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    for (let page = 1; page <= 166; page += 1) {
      doc.addPage()
      doc.fontSize(18).text('Vestido Verao ' + page)
      doc.fontSize(12).text('REF: VV-' + page)
      doc.text('Valor: R$ 49,90')
    }
    doc.end()
  })
  const result = await collectPdfCatalog(pdf)
  assert.equal(result.pagesScanned, 166)
  assert.equal(result.candidates.length, 166)
})

test('a PDF beyond page limit reports its real page count', async () => {
  const pdf = await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false })
    const chunks = []
    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('error', reject)
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    for (let page = 0; page < 201; page += 1) doc.addPage().text('Produto ' + page)
    doc.end()
  })
  await assert.rejects(collectPdfCatalog(pdf), /201 páginas; o limite é 200/)
})

test('global listing image indices are not the extracted page-local indexes', () => {
  const entries = assertPdfImageBudget(
    'page num type width height color comp bpc enc interp object ID x-ppi y-ppi size ratio\n' +
    '   2  17 image 500 500 rgb 3 8 jpeg no 1 0 72 72 2K 2%\n' +
    '   3  26 image 550 550 rgb 3 8 jpeg no 2 0 72 72 2K 2%'
  )
  assert.equal(entries.length, 2)
  assert.deepEqual(entries.map((entry) => entry.index), [17, 26])
})
