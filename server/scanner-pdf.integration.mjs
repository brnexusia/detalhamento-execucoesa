import assert from 'node:assert/strict'
import PDFDocument from 'pdfkit'
import sharp from 'sharp'
import pg from 'pg'
import { processImportJob, processNormalizationJob } from './scanner-hooks.mjs'

const base = process.env.BASE_URL || 'http://127.0.0.1:3000'
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })

async function register(label) {
  const response = await fetch(base + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'PDF Import ' + label,
      email: 'pdf-import-' + label + '-' + Date.now() + '-' + Math.random() + '@example.test',
      password: 'scanner1234',
      storeName: 'Loja PDF ' + label,
      whatsapp: '5511999999999',
      planCode: 'bronze',
    }),
  })
  assert.equal(response.status, 201)
  return response.headers.get('set-cookie')?.split(';')[0]
}

async function pdfBytes() {
  const jpg = await sharp({ create: {
    width: 500, height: 500, channels: 3, background: { r: 154, g: 72, b: 92 },
  } }).jpeg().toBuffer()
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false })
    const chunks = []
    doc.on('data', (data) => chunks.push(data))
    doc.on('error', reject)
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.addPage()
    doc.image(jpg, 30, 65, { width: 320 })
    doc.fontSize(20).text('Blusa Concha', 30, 425)
    doc.fontSize(12).text('REF: BC-19', 30, 460)
    doc.text('R$ 55,90', 30, 482)
    doc.end()
  })
}

try {
  const first = await register('a')
  const second = await register('b')
  const form = new FormData()
  form.append('file', new Blob([await pdfBytes()], { type: 'application/pdf' }), 'catalogo-teste.pdf')

  let response = await fetch(base + '/api/admin/imports/pdf', { method: 'POST', headers: { Cookie: first }, body: form })
  assert.equal(response.status, 202, 'PDF deve entrar como job para revisão')
  let body = await response.json()
  const jobId = body.job.id
  assert.equal(body.job.platform, 'pdf')

  let stored = await db.query('SELECT count(*)::int AS count FROM import_pdf_uploads WHERE job_id=$1', [jobId])
  assert.equal(stored.rows[0].count, 1)

  let job = await processImportJob(jobId)
  assert.equal(job.status, 'processing')
  assert.equal(job.platform, 'pdf')
  assert.equal(job.result_count, 1)
  stored = await db.query('SELECT count(*)::int AS count FROM import_pdf_uploads WHERE job_id=$1', [jobId])
  assert.equal(stored.rows[0].count, 0, 'arquivo bruto deve ser apagado depois da leitura')

  job = await processNormalizationJob(jobId)
  assert.equal(job.status, 'review')

  response = await fetch(base + '/api/admin/imports/' + jobId + '/review', { headers: { Cookie: second } })
  assert.equal(response.status, 404, 'outra loja não pode ler revisão de PDFs')

  response = await fetch(base + '/api/admin/imports/' + jobId + '/review', { headers: { Cookie: first } })
  assert.equal(response.status, 200)
  body = await response.json()
  assert.equal(body.products.length, 1)
  assert.equal(body.products[0].data.name, 'Blusa Concha')
  assert.equal(body.products[0].data.price, 55.90)
  assert.equal(body.products[0].data.sku, 'BC-19')
  assert.equal(body.products[0].selected, true)
  assert.match(body.products[0].data.media_url, /^\/media\/[a-z0-9-]+$/i)

  response = await fetch(base + body.products[0].data.media_url)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') || '', /image\/webp/)

  response = await fetch(base + '/api/admin/imports/' + jobId + '/publish', {
    method: 'POST',
    headers: { Cookie: first, 'Content-Type': 'application/json' },
    body: '{}',
  })
  assert.equal(response.status, 200)
  response = await fetch(base + '/api/admin/bootstrap', { headers: { Cookie: first } })
  const products = (await response.json()).products
  assert.equal(products.some((product) => product.name === 'Blusa Concha'), true)

  response = await fetch(base + '/api/admin/imports/' + jobId, {
    method: 'DELETE',
    headers: { Cookie: first },
  })
  assert.equal(response.status, 200, 'descartar histórico não apaga produto publicado')

  const oversized = new FormData()
  const overLimit = Buffer.alloc(50 * 1024 * 1024 + 1)
  overLimit.write('%PDF-1.4', 0, 'ascii')
  oversized.append('file', new Blob([overLimit], { type: 'application/pdf' }), 'grande.pdf')
  response = await fetch(base + '/api/admin/imports/pdf', { method: 'POST', headers: { Cookie: first }, body: oversized })
  assert.equal(response.status, 413, 'upload acima de 50 MB deve ser bloqueado sem criar job')
  const invalid = new FormData()
  invalid.append('file', new Blob([Buffer.from('not a PDF')], { type: 'application/pdf' }), 'fake.pdf')
  response = await fetch(base + '/api/admin/imports/pdf', { method: 'POST', headers: { Cookie: first }, body: invalid })
  assert.equal(response.status, 400, 'uploads forjados devem ser rejeitados')

  console.log('[pdf catalog] authenticated upload, extraction, review, image, publish, isolation: ok')
} finally {
  await db.end()
}
