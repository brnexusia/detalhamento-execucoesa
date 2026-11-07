import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import PDFDocument from 'pdfkit'
import sharp from 'sharp'
import { collectPdfCatalog } from './scanner-pdf.mjs'

async function syntheticScannedPdf() {
  const image = await sharp({
    create: { width: 1100, height: 1300, channels: 3, background: { r: 255, g: 255, b: 255 } },
  }).png().toBuffer()
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false })
    const chunks = []
    doc.on('data', (value) => chunks.push(value))
    doc.on('error', reject)
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.addPage()
    // All content is rasterized (no PDF text layer).
    doc.image(image, 0, 0, { width: 550 })
    doc.end()
  })
}

test('real PDF pipeline uses OCR coordinates instead of mixing multi-column prices', { timeout: 60000 }, async () => {
  const lines = [
    { text: 'R$ 70,00', box: [850, 220, 1000, 249], score: 0.98 },
    { text: 'Blusa Florença', box: [40, 100, 270, 132], score: 0.98 },
    { text: 'Descrição: crepe macio', box: [40, 170, 275, 198], score: 0.97 },
    { text: 'R$ 45,00', box: [50, 220, 190, 249], score: 0.98 },
    { text: 'Calça Milano', box: [810, 100, 1070, 132], score: 0.99 },
    { text: 'Descrição: cetim premium', box: [810, 170, 1080, 198], score: 0.99 },
  ]
  const web = createServer((request, response) => {
    assert.equal(request.url, '/ocr')
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ text: lines.map(line => line.text).join('\n'), lines }))
  })
  await new Promise((resolve) => web.listen(0, '127.0.0.1', resolve))
  const originalPort = process.env.PDF_OCR_PORT
  const originalEngine = process.env.PDF_OCR_ENGINE
  try {
    process.env.PDF_OCR_PORT = String(web.address().port)
    process.env.PDF_OCR_ENGINE = 'paddle'
    const imported = await collectPdfCatalog(await syntheticScannedPdf())
    assert.equal(imported.candidates.length, 2)
    const pairs = imported.candidates.map((row) => [row.title, row.price])
      .sort((a, b) => a[0].localeCompare(b[0]))
    assert.deepEqual(pairs, [
      ['Blusa Florença', 45],
      ['Calça Milano', 70],
    ])
    assert.ok(imported.candidates.every((row) => row.pdf_review_required === true))
    assert.match(imported.candidates.find((row) => row.title === 'Calça Milano').description, /cetim premium/)
  } finally {
    if (originalPort == null) delete process.env.PDF_OCR_PORT
    else process.env.PDF_OCR_PORT = originalPort
    if (originalEngine == null) delete process.env.PDF_OCR_ENGINE
    else process.env.PDF_OCR_ENGINE = originalEngine
    await new Promise((resolve, reject) => web.close(error => error ? reject(error) : resolve()))
  }
})
