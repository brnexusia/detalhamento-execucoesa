import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import PDFDocument from 'pdfkit'
import { paddleOcrLayout } from './scanner-pdf-paddle.mjs'
import { associateOcrProducts } from './scanner-pdf-spatial.mjs'
import { collectPdfCatalog } from './scanner-pdf.mjs'

async function scannedCatalog() {
  const image = await sharp(Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1500" height="900">
      <rect width="1500" height="900" fill="white"/>
      <g font-family="DejaVu Sans, Arial, sans-serif" font-size="58" fill="#111111">
        <text x="70" y="190">Blusa Aurora</text>
        <text x="70" y="305">R$ 12,50</text>
        <text x="830" y="190">Calca Milano</text>
        <text x="830" y="305">R$ 34,90</text>
      </g>
    </svg>
  `)).png().toBuffer()
  const pdf = await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false, size: [900, 560] })
    const chunks = []
    doc.on('data', value => chunks.push(value))
    doc.on('error', reject)
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.addPage()
    doc.image(image, 0, 0, { width: 900 })
    doc.end()
  })
  return { image, pdf }
}

test('REAL PaddleOCR reads a scanned PDF page and produces usable x/y boxes', {
  timeout: 120000,
  skip: process.env.PDF_OCR_REAL_TEST !== '1',
}, async () => {
  const { image, pdf } = await scannedCatalog()
  const layout = await paddleOcrLayout(image)
  assert.ok(layout.lines.length >= 3, 'PaddleOCR returned no text boxes: ' + layout.text)
  assert.ok(layout.lines.every(line => Array.isArray(line.box) && line.box.length === 4))
  assert.match(layout.text, /Blusa/i, 'PaddleOCR must read the actual printed product name')
  assert.match(layout.text, /12[,\.]50/, 'PaddleOCR must read the actual printed price')
  const spatial = associateOcrProducts(layout, 1)
  assert.ok(spatial.some(item => item.price === 12.5),
    'PaddleOCR boxes were not associated with price R$ 12,50; text=' + layout.text)
  console.info('PADDLE_REAL_LAYOUT', JSON.stringify({
    lines: layout.lines.length, products: spatial.map(item => [item.title, item.price]),
    text: layout.text.slice(0, 1000),
  }))
  const imported = await collectPdfCatalog(pdf)
  assert.ok(imported.candidates.some(item => item.price === 12.5),
    'Real scanned PDF failed through the full import pipeline')
  assert.ok(imported.candidates.some(item => item.price === 34.9),
    'Right-column product was not linked to its own real price')
  console.info('PADDLE_REAL_PDF', JSON.stringify(imported.candidates.map(item => [item.title,item.price])))
})
