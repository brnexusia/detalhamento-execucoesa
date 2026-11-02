import pg from 'pg'
import Redis from 'ioredis'
import { Queue, Worker } from 'bullmq'
import { generateMediaVariants } from './media-variants.mjs'

// Job payload contains only an opaque media id; original bytes stay in PostgreSQL.
export const MEDIA_QUEUE_NAME = 'shopvax-media-variants'
const REDIS_URL = String(process.env.REDIS_URL || '').trim()
const connection = () => new Redis(REDIS_URL, { maxRetriesPerRequest: null })

export function createRedisMediaVariantQueue({ onError = console.warn } = {}) {
  if (!REDIS_URL) throw new Error('REDIS_URL é obrigatório para a fila distribuída')
  const queue = new Queue(MEDIA_QUEUE_NAME, { connection: connection(), defaultJobOptions: {
    attempts: 3, backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { age: 86400, count: 2000 },
    removeOnFail: { age: 7 * 86400, count: 2000 },
  } })
  queue.on('error', onError)
  return {
    enqueue(assetId) {
      const done = queue.add('optimize', { assetId }, { jobId: assetId })
        .then(() => true)
        .catch((error) => { onError(error); return false })
      return { accepted: true, done }
    },
    close: () => queue.close(),
  }
}

export function startRedisMediaWorker({ onError = console.warn } = {}) {
  if (!REDIS_URL) throw new Error('REDIS_URL é obrigatório para o worker')
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
    connectionTimeoutMillis: 5000,
  })
  pool.on('error', onError)
  const worker = new Worker(MEDIA_QUEUE_NAME, async (job) => {
    const assetId = String(job.data?.assetId || '')
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(assetId)) throw new Error('assetId inválido')
    const original = await pool.query(
      'SELECT mime_type,data FROM media_assets WHERE id=$1 LIMIT 1', [assetId],
    )
    if (!original.rowCount) throw new Error('Mídia original ausente: ' + assetId)
    const { mime_type: mimeType, data } = original.rows[0]
    if (!String(mimeType).startsWith('image/')) return { skipped: true }
    const variants = await generateMediaVariants(data, mimeType)
    for (const variant of variants) {
      await pool.query(
        `INSERT INTO media_variants (asset_id,width,mime_type,byte_size,data)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (asset_id,width) DO NOTHING`,
        [assetId, variant.width, variant.mimeType, variant.bytes.length, variant.bytes],
      )
    }
    return { count: variants.length }
  }, { connection: connection(), concurrency: Math.max(1, Math.min(2, Number(process.env.SHOPVAX_MEDIA_WORKER_CONCURRENCY || 1))) })
  worker.on('failed', (job, error) => onError(new Error('job ' + job?.id + ': ' + error.message)))
  worker.on('error', onError)
  const shutdown = async () => { await worker.close(); await pool.end() }
  return { worker, shutdown }
}
