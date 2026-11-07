import crypto from 'node:crypto'
import express from 'express'

export const PDF_CHUNK_BYTES = 512 * 1024
const MAX_ACTIVE_SESSIONS = 4

export function pdfChunkCount(sizeBytes, maxPdfBytes = 100 * 1024 * 1024) {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 8 || sizeBytes > maxPdfBytes) return null
  return Math.ceil(sizeBytes / PDF_CHUNK_BYTES)
}

export function pdfChunkLength(sizeBytes, index) {
  const count = pdfChunkCount(sizeBytes)
  if (count == null || !Number.isSafeInteger(index) || index < 0 || index >= count) return null
  return Math.min(PDF_CHUNK_BYTES, sizeBytes - index * PDF_CHUNK_BYTES)
}

export async function ensurePdfChunkSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS import_pdf_upload_sessions (
      id text PRIMARY KEY,
      store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      filename text NOT NULL,
      size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 8 AND 104857600),
      total_chunks integer NOT NULL CHECK (total_chunks BETWEEN 1 AND 200),
      expires_at timestamptz NOT NULL DEFAULT now() + interval '4 hours',
      job_id text UNIQUE REFERENCES import_jobs(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_import_pdf_sessions_expiry ON import_pdf_upload_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_import_pdf_sessions_store ON import_pdf_upload_sessions(store_id, created_at);
    CREATE TABLE IF NOT EXISTS import_pdf_upload_chunks (
      upload_id text NOT NULL REFERENCES import_pdf_upload_sessions(id) ON DELETE CASCADE,
      chunk_index integer NOT NULL CHECK (chunk_index >= 0 AND chunk_index < 200),
      size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 524288),
      digest_sha256 text NOT NULL,
      data bytea NOT NULL,
      PRIMARY KEY (upload_id, chunk_index)
    );
  `)
}

export async function loadChunkedPdf(pool, jobId, maxPdfBytes = 100 * 1024 * 1024) {
  const info = await pool.query(
    'SELECT id,size_bytes,total_chunks FROM import_pdf_upload_sessions WHERE job_id=$1 LIMIT 1',
    [jobId],
  )
  if (!info.rowCount) return null
  const upload = info.rows[0]
  const expected = Number(upload.size_bytes)
  if (!pdfChunkCount(expected, maxPdfBytes) ||
      Number(upload.total_chunks) !== pdfChunkCount(expected, maxPdfBytes)) {
    throw new Error('Sessão de PDF contém metadados inválidos.')
  }
  const rows = await pool.query(
    'SELECT chunk_index,data FROM import_pdf_upload_chunks WHERE upload_id=$1 ORDER BY chunk_index',
    [upload.id],
  )
  if (rows.rowCount !== Number(upload.total_chunks)) {
    throw new Error('Uma ou mais partes do PDF estão ausentes.')
  }
  let length = 0
  const buffers = rows.rows.map((row, index) => {
    const part = row.data
    if (Number(row.chunk_index) !== index || !Buffer.isBuffer(part) ||
        part.length !== pdfChunkLength(expected, index)) {
      throw new Error('Uma das partes do PDF está corrompida.')
    }
    length += part.length
    return part
  })
  if (length !== expected) throw new Error('O tamanho do PDF recebido não confere.')
  return Buffer.concat(buffers, expected)
}

export async function clearChunkedPdf(pool, jobId) {
  await pool.query('DELETE FROM import_pdf_upload_sessions WHERE job_id=$1', [jobId])
}

export function installChunkedPdfRoutes(router, {
  pool, requireStore, asyncRoute, ensureSchema,
  maxPdfBytes, makeId, publicJob, runNextWork, workerDisabled,
}) {
  if (!pool) return
  const rawChunk = express.raw({ type: 'application/octet-stream', limit: PDF_CHUNK_BYTES })

  router.post('/pdf/chunks/start', requireStore, asyncRoute(async (req, res) => {
    const sizeBytes = Number(req.body?.sizeBytes)
    const totalChunks = pdfChunkCount(sizeBytes, maxPdfBytes)
    if (!totalChunks) return res.status(413).json({ error: 'PDF inválido ou maior que 100 MB.' })
    const filename = String(req.body?.filename || 'catalogo.pdf')
      .replace(/[\/\\\x00-\x1f]/g, '').slice(0, 180) || 'catalogo.pdf'
    if (!/\.pdf$/i.test(filename)) return res.status(400).json({ error: 'Selecione um arquivo PDF.' })
    await ensureSchema()
    await pool.query('DELETE FROM import_pdf_upload_sessions WHERE job_id IS NULL AND expires_at < now()')
    const active = await pool.query(
      'SELECT count(*)::int AS total FROM import_pdf_upload_sessions WHERE store_id=$1 AND job_id IS NULL AND expires_at>now()',
      [req.scannerStore.store_id],
    )
    if (Number(active.rows[0]?.total || 0) >= MAX_ACTIVE_SESSIONS) {
      return res.status(429).json({ error: 'Há muitos envios incompletos desta loja. Tente novamente depois.' })
    }
    const uploadId = makeId()
    await pool.query(
      'INSERT INTO import_pdf_upload_sessions (id,store_id,filename,size_bytes,total_chunks) VALUES ($1,$2,$3,$4,$5)',
      [uploadId, req.scannerStore.store_id, filename, sizeBytes, totalChunks],
    )
    console.info('[pdf upload] chunk session created', { uploadId, bytes: sizeBytes, parts: totalChunks })
    res.status(201).json({ uploadId, chunkSize: PDF_CHUNK_BYTES, totalChunks })
  }))

  router.put('/pdf/chunks/:uploadId/:index', requireStore, rawChunk, asyncRoute(async (req, res) => {
    const index = Number(req.params.index)
    const received = Buffer.isBuffer(req.body) ? req.body : null
    const session = await pool.query(
      `SELECT size_bytes,total_chunks FROM import_pdf_upload_sessions
       WHERE id=$1 AND store_id=$2 AND job_id IS NULL AND expires_at>now() LIMIT 1`,
      [req.params.uploadId, req.scannerStore.store_id],
    )
    if (!session.rowCount) return res.status(404).json({ error: 'Envio expirado ou indisponível.' })
    const sizeBytes = Number(session.rows[0].size_bytes)
    const expectedBytes = pdfChunkLength(sizeBytes, index)
    if (!expectedBytes || !received || received.length !== expectedBytes) {
      return res.status(422).json({ error: 'Parte do PDF com tamanho inesperado.' })
    }
    const digest = crypto.createHash('sha256').update(received).digest('hex')
    const inserted = await pool.query(
      `INSERT INTO import_pdf_upload_chunks (upload_id,chunk_index,size_bytes,digest_sha256,data)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (upload_id,chunk_index) DO NOTHING`,
      [req.params.uploadId, index, received.length, digest, received],
    )
    if (!inserted.rowCount) {
      const prior = await pool.query(
        'SELECT digest_sha256 FROM import_pdf_upload_chunks WHERE upload_id=$1 AND chunk_index=$2',
        [req.params.uploadId, index],
      )
      if (prior.rows[0]?.digest_sha256 !== digest) {
        return res.status(409).json({ error: 'Parte já recebida com conteúdo diferente.' })
      }
    }
    res.json({ ok: true, index })
  }))

  router.post('/pdf/chunks/complete', requireStore, asyncRoute(async (req, res) => {
    const uploadId = String(req.body?.uploadId || '')
    const client = await pool.connect()
    let job = null
    try {
      await client.query('BEGIN')
      const found = await client.query(
        `SELECT * FROM import_pdf_upload_sessions
         WHERE id=$1 AND store_id=$2 FOR UPDATE`,
        [uploadId, req.scannerStore.store_id],
      )
      if (!found.rowCount) {
        await client.query('ROLLBACK')
        return res.status(404).json({ error: 'Envio não encontrado.' })
      }
      const session = found.rows[0]
      if (session.job_id) {
        const existing = await client.query('SELECT * FROM import_jobs WHERE id=$1', [session.job_id])
        await client.query('COMMIT')
        return res.status(202).json({ job: publicJob(existing.rows[0]), duplicated: true })
      }
      if (new Date(session.expires_at).getTime() <= Date.now()) {
        await client.query('ROLLBACK')
        return res.status(410).json({ error: 'Envio expirado. Recomece a transferência.' })
      }
      const stats = await client.query(
        'SELECT count(*)::int AS total,COALESCE(sum(size_bytes),0)::bigint AS size FROM import_pdf_upload_chunks WHERE upload_id=$1',
        [uploadId],
      )
      if (Number(stats.rows[0].total) !== Number(session.total_chunks) ||
          Number(stats.rows[0].size) !== Number(session.size_bytes)) {
        await client.query('ROLLBACK')
        return res.status(409).json({ error: 'Ainda existem partes do PDF pendentes.' })
      }
      const first = await client.query(
        'SELECT data FROM import_pdf_upload_chunks WHERE upload_id=$1 AND chunk_index=0 LIMIT 1', [uploadId],
      )
      if (!first.rows[0]?.data?.subarray(0, 1024).toString('latin1').includes('%PDF-')) {
        await client.query('ROLLBACK')
        return res.status(400).json({ error: 'Arquivo PDF inválido.' })
      }
      const jobId = makeId()
      const created = await client.query(
        "INSERT INTO import_jobs (id,store_id,source_url,source_host,status,platform) VALUES ($1,$2,$3,$4,'queued','pdf') RETURNING *",
        [jobId, req.scannerStore.store_id, 'pdf://' + jobId, session.filename],
      )
      await client.query('UPDATE import_pdf_upload_sessions SET job_id=$1 WHERE id=$2', [jobId, uploadId])
      await client.query('COMMIT')
      job = publicJob(created.rows[0])
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
    if (!workerDisabled) setImmediate(() => void runNextWork())
    console.info('[pdf upload] finalized', { uploadId, jobId: job.id })
    res.status(202).json({ job, duplicated: false })
  }))

  router.delete('/pdf/chunks/:uploadId', requireStore, asyncRoute(async (req, res) => {
    await pool.query(
      'DELETE FROM import_pdf_upload_sessions WHERE id=$1 AND store_id=$2 AND job_id IS NULL',
      [req.params.uploadId, req.scannerStore.store_id],
    )
    res.json({ ok: true })
  }))

  // Clean up interrupted browser sessions even when nobody starts a new upload.
  const cleanup = setInterval(() => {
    void pool.query('DELETE FROM import_pdf_upload_sessions WHERE job_id IS NULL AND expires_at < now()')
      .catch(error => console.warn('[pdf upload] stale session cleanup:', error.message))
  }, 60 * 60 * 1000)
  cleanup.unref()
}
