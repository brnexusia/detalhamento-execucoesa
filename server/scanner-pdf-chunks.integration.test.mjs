import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import express from 'express'
import pg from 'pg'
import {
  PDF_CHUNK_BYTES, pdfChunkCount, pdfChunkLength, ensurePdfChunkSchema,
  installChunkedPdfRoutes, loadChunkedPdf, clearChunkedPdf,
} from './scanner-pdf-chunks.mjs'

test('PDF uploads are split into bounded 512 KiB requests', () => {
  assert.equal(PDF_CHUNK_BYTES, 524288)
  assert.equal(pdfChunkCount(15571113), 30)
  assert.equal(pdfChunkCount(100 * 1024 * 1024), 200)
  assert.equal(pdfChunkCount(100 * 1024 * 1024 + 1), null)
  assert.equal(pdfChunkLength(15571113, 0), PDF_CHUNK_BYTES)
  assert.equal(pdfChunkLength(15571113, 29), 15571113 - 29 * PDF_CHUNK_BYTES)
  assert.equal(pdfChunkLength(15571113, 30), null)
})

test('real Postgres records a 15.57 MB PDF without one large HTTP POST', {
  skip: !process.env.PDF_TEST_DATABASE_URL,
  timeout: 120000,
}, async () => {
  const pool = new pg.Pool({ connectionString: process.env.PDF_TEST_DATABASE_URL, max: 3 })
  let server
  try {
    await pool.query('CREATE TABLE IF NOT EXISTS stores (id text PRIMARY KEY)')
    await pool.query(`
      CREATE TABLE IF NOT EXISTS import_jobs (
        id text PRIMARY KEY,
        store_id text REFERENCES stores(id),
        source_url text NOT NULL,
        source_host text NOT NULL,
        status text NOT NULL,
        platform text NOT NULL,
        created_at timestamptz DEFAULT now()
      )
    `)
    await pool.query("INSERT INTO stores (id) VALUES ('store-one'),('store-two') ON CONFLICT DO NOTHING")
    await ensurePdfChunkSchema(pool)
    const router = express.Router()
    const app = express()
    app.use(express.json({ limit: '64kb' }))
    let queued = 0
    const requireStore = (req, _res, next) => {
      req.scannerStore = { store_id: req.headers['x-store'] === 'other' ? 'store-two' : 'store-one' }
      next()
    }
    const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req,res,next)).catch(next)
    installChunkedPdfRoutes(router, {
      pool, requireStore, asyncRoute, ensureSchema: async () => {},
      maxPdfBytes: 100 * 1024 * 1024, makeId: () => crypto.randomUUID(),
      publicJob: (row) => ({ id: row.id, status: row.status, platform: row.platform }),
      runNextWork: () => { queued++ },
      workerDisabled: true,
    })
    app.use('/api/admin/imports', router)
    app.use((err,_req,res,_next) => res.status(err.status || 500).json({ error: err.message }))
    server = app.listen(0, '127.0.0.1')
    await new Promise(resolve => server.once('listening', resolve))
    const root = 'http://127.0.0.1:' + server.address().port + '/api/admin/imports/pdf/chunks'
    const file = Buffer.alloc(15571113, 32)
    file.write('%PDF-1.4\n', 0, 'latin1')
    const start = await fetch(root + '/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sizeBytes: file.length, filename: 'meu-catalogo.pdf' }),
    })
    assert.equal(start.status, 201)
    const session = await start.json()
    assert.equal(session.totalChunks, 30)
    assert.equal(session.chunkSize, PDF_CHUNK_BYTES)

    const first = file.subarray(0, PDF_CHUNK_BYTES)
    const denied = await fetch(root + '/' + session.uploadId + '/0', {
      method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'X-Store': 'other' },
      body: first,
    })
    assert.equal(denied.status, 404, 'Different stores cannot write to another upload')

    const premature = await fetch(root + '/complete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId: session.uploadId }),
    })
    assert.equal(premature.status, 409, 'Must not create a queued job for an incomplete PDF')

    for (let index = 0; index < session.totalChunks; index++) {
      const part = file.subarray(index * PDF_CHUNK_BYTES, Math.min(file.length,(index+1)*PDF_CHUNK_BYTES))
      const response = await fetch(root + '/' + session.uploadId + '/' + index, {
        method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: part,
      })
      assert.equal(response.status, 200, 'Failed chunk ' + index + ': ' + await response.text())
    }

    const duplicate = await fetch(root + '/' + session.uploadId + '/0', {
      method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: first,
    })
    assert.equal(duplicate.status, 200, 'Idempotent retry')
    const wrong = Buffer.alloc(first.length, 10)
    const conflict = await fetch(root + '/' + session.uploadId + '/0', {
      method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: wrong,
    })
    assert.equal(conflict.status, 409, 'Cannot overwrite a verified chunk')

    const done = await fetch(root + '/complete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId: session.uploadId }),
    })
    assert.equal(done.status, 202)
    const { job } = await done.json()
    assert.equal(job.status,'queued')
    const duplicateFinish = await fetch(root + '/complete', {
      method:'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ uploadId: session.uploadId }),
    })
    assert.equal(duplicateFinish.status, 202)
    assert.equal((await duplicateFinish.json()).duplicated, true)
    assert.equal(queued,0,'Test uses workerDisabled=true; production worker runs in background')
    const loaded = await loadChunkedPdf(pool,job.id)
    assert.equal(loaded.length,15571113)
    assert.equal(crypto.createHash('sha256').update(loaded).digest('hex'),
      crypto.createHash('sha256').update(file).digest('hex'))
    await clearChunkedPdf(pool, job.id)
    assert.equal(await loadChunkedPdf(pool,job.id),null)
  } finally {
    if (server) await new Promise(resolve => server.close(resolve))
    await pool.query('DROP TABLE IF EXISTS import_pdf_upload_chunks CASCADE').catch(() => {})
    await pool.query('DROP TABLE IF EXISTS import_pdf_upload_sessions CASCADE').catch(() => {})
    await pool.query('DROP TABLE IF EXISTS import_jobs CASCADE').catch(() => {})
    await pool.query('DROP TABLE IF EXISTS stores CASCADE').catch(() => {})
    await pool.end()
  }
})
