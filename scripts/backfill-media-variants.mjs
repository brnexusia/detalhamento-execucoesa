/**
 * Backfill idempotente das miniaturas WebP no PostgreSQL.
 * Leitura/consulta é o padrão; gravação exige --apply.
 * Não modifica ou apaga media_assets, nem emite requisições HTTP.
 *
 * No serviço APP do EasyPanel, após publicar a revisão:
 *   node scripts/backfill-media-variants.mjs
 *   node scripts/backfill-media-variants.mjs --apply --limit 200 --batch 20
 *   node scripts/backfill-media-variants.mjs --apply --limit 25000 --batch 20 --sleep-ms 150
 * Opcional: --store-id ID, --after ID (cursor exibido na saída).
 */
import pg from 'pg'
import { generateMediaVariants } from '../server/media-variants.mjs'

const supported = ['image/jpeg', 'image/png', 'image/webp', 'image/avif']
const args = process.argv.slice(2)
function arg(name) {
  const index = args.indexOf(name)
  if (index < 0) return null
  if (index + 1 >= args.length || args[index + 1].startsWith('--')) throw new Error(name + ' precisa de valor.')
  return args[index + 1]
}
function intArg(name, fallback, min, max) {
  const value = arg(name)
  if (value === null) return fallback
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(name + ' fora do intervalo permitido.')
  return n
}
if (args.includes('--help')) {
  console.log('Uso: node scripts/backfill-media-variants.mjs [--apply] [--limit 200] [--batch 20] [--sleep-ms 150] [--store-id ID] [--after ID]')
  process.exit(0)
}
const recognized = new Set(['--apply', '--limit', '--batch', '--sleep-ms', '--store-id', '--after'])
for (let i = 0; i < args.length; i++) {
  if (!recognized.has(args[i])) throw new Error('Argumento desconhecido: ' + args[i])
  if (args[i] !== '--apply') i += 1
}
const apply = args.includes('--apply')
const limit = intArg('--limit', 200, 1, 50000)
const batchSize = intArg('--batch', 20, 1, 50)
const sleepMs = intArg('--sleep-ms', 150, 0, 5000)
const storeId = arg('--store-id') || ''
let after = arg('--after') || ''
if (after.length > 120 || storeId.length > 120) throw new Error('Identificador inválido.')
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não configurada no serviço.')

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const missing = `(
  NOT EXISTS (SELECT 1 FROM media_variants v WHERE v.asset_id=a.id AND v.width=320)
  OR NOT EXISTS (SELECT 1 FROM media_variants v WHERE v.asset_id=a.id AND v.width=960)
)`
const stats = { inspected: 0, created: 0, bytesSaved: 0, unsupported: 0, failed: 0 }
try {
  const filters = ['a.mime_type = ANY($1::text[])', missing]
  const params = [supported]
  if (storeId) { params.push(storeId); filters.push('a.store_id=$' + params.length) }
  const where = filters.join(' AND ')
  const estimate = await pool.query(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(a.byte_size),0)::bigint AS original_bytes
     FROM media_assets a WHERE ${where}`, params,
  )
  console.log(JSON.stringify({
    mode: apply ? 'APPLY' : 'DRY_RUN', candidates: estimate.rows[0].count,
    original_bytes: Number(estimate.rows[0].original_bytes),
    limit, batchSize, sleepMs, storeId: storeId || 'all',
    note: 'Originals are never updated or deleted; small/already-optimized images may not produce variants.',
  }))
  if (!apply) {
    console.log('Nenhuma gravação feita. Para processar: acrescente --apply.')
  } else {
    while (stats.inspected < limit) {
      const selectParams = [...params, after, Math.min(batchSize, limit - stats.inspected)]
      const cursorParam = '$' + (params.length + 1)
      const limitParam = '$' + (params.length + 2)
      const result = await pool.query(
        `SELECT a.id FROM media_assets a
         WHERE ${where} AND a.id > ${cursorParam}
         ORDER BY a.id ASC LIMIT ${limitParam}`, selectParams,
      )
      if (!result.rowCount) break
      for (const { id } of result.rows) {
        after = id
        stats.inspected += 1
        try {
          // Apenas um BYTEA por vez na memória, sem transações ou locks longos.
          const original = await pool.query(
            'SELECT mime_type,data FROM media_assets WHERE id=$1 LIMIT 1', [id],
          )
          if (!original.rowCount) { stats.unsupported++; continue }
          const previous = await pool.query(
            'SELECT width FROM media_variants WHERE asset_id=$1', [id],
          )
          const present = new Set(previous.rows.map(row => Number(row.width)))
          if (present.has(320) && present.has(960)) continue
          const media = original.rows[0]
          const variants = await generateMediaVariants(media.data, media.mime_type)
          let wrote = false
          for (const variant of variants) {
            if (present.has(variant.width)) continue
            const inserted = await pool.query(
              `INSERT INTO media_variants (asset_id,width,mime_type,byte_size,data)
               VALUES ($1,$2,$3,$4,$5)
               ON CONFLICT (asset_id,width) DO NOTHING RETURNING width`,
              [id, variant.width, variant.mimeType, variant.bytes.length, variant.bytes],
            )
            if (inserted.rowCount) {
              stats.created += 1
              stats.bytesSaved += variant.bytes.length
              wrote = true
            }
          }
          if (!wrote) stats.unsupported += 1
        } catch (error) {
          stats.failed += 1
          console.warn('[media-backfill] Falha no asset ' + id + ': ' + (error?.message || 'erro'))
        }
        if (sleepMs) await sleep(sleepMs)
      }
      console.log(JSON.stringify({ ...stats, next_after_id: after }))
      if (stats.failed >= 50) throw new Error('Interrompido após 50 falhas; revise logs antes de continuar.')
    }
    console.log('BACKFILL_FINAL ' + JSON.stringify({ ...stats, next_after_id: after, variants_bytes: stats.bytesSaved }))
    if (stats.failed) process.exitCode = 1
  }
} finally {
  await pool.end()
}
