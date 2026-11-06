// Prepare remote product images BEFORE publishing products. Do not hold a
// PostgreSQL transaction or product-row lock while downloading network assets.
import { localizeImportedProductMedia, isLocalShopvaxMedia } from './import-media-localizer.mjs'
import { prepareReview } from './scanner-review.mjs'

function remote(value) {
  try {
    const url = new URL(String(value || ''))
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch { return false }
}

function sourceImages(product) {
  return [...new Set([
    product?.media_url,
    ...(Array.isArray(product?.images) ? product.images : []),
    ...(Array.isArray(product?.variant_images) ? product.variant_images.flatMap(v => v?.images || []) : []),
  ].filter(Boolean).map(String))]
}

export async function stageSelectedImportMedia({
  query, storeId, jobId, localize = localizeImportedProductMedia,
  maxSelected = 2000,
}) {
  if (typeof query !== 'function') throw new Error('Consulta ao banco indisponível.')
  // First verify that the job is still in review. This is also checked again
  // under a transaction lock by publishJob after staging.
  const found = await query('SELECT status FROM import_jobs WHERE id=$1 AND store_id=$2 LIMIT 1',
    [jobId, storeId])
  if (!found.rowCount || found.rows[0].status !== 'review') return { staged: 0, failed: 0, skipped: true }

  let staged = 0
  let failed = 0
  let cursor = ''
  let examined = 0
  while (true) {
    const result = await query(
      `SELECT id,updated_at,COALESCE(review_data,normalized_data) AS data
       FROM import_normalized_products
       WHERE job_id=$1 AND store_id=$2 AND selected=true AND id>$3
       ORDER BY id ASC LIMIT 25`,
      [jobId, storeId, cursor],
    )
    if (!result.rowCount) break
    for (const row of result.rows) {
      cursor = row.id
      examined += 1
      if (examined > maxSelected) throw new Error(
        'Esta importação possui muitos produtos selecionados. Divida a publicação em lotes menores.'
      )
      const product = prepareReview(row.data).data
      const originalImages = sourceImages(product)
      const remoteImages = originalImages.filter(remote)
      if (!remoteImages.length) continue // Local PDF media already saved at scan time.
      const localized = await localize({
        query, storeId, product, sourceUrl: product.source_url || '',
      })
      const replacements = sourceImages({
        ...product, media_url:localized.mediaUrl,
        images:localized.images, variant_images:localized.variantImages,
      })
      const anyLocal = replacements.some(isLocalShopvaxMedia)
      if (!anyLocal) {
        failed += 1
        throw new Error(
          'Não foi possível salvar nenhuma foto do produto "' +
          String(product.name || 'sem nome').slice(0, 90) +
          '". O item continua em revisão; confira a URL ou substitua a imagem antes de publicar.'
        )
      }
      const updated = prepareReview({
        ...product,media_url:localized.mediaUrl,
        images:localized.images,variant_images:localized.variantImages,
      })
      const written = await query(
        `UPDATE import_normalized_products n
         SET review_data=$1::jsonb, warnings=$2::jsonb,
           confidence=$3,updated_at=now(),review_updated_at=now()
         WHERE n.id=$4 AND n.job_id=$5 AND n.store_id=$6 AND n.selected=true
           AND n.updated_at=$7
           AND EXISTS (SELECT 1 FROM import_jobs j
             WHERE j.id=n.job_id AND j.store_id=n.store_id AND j.status='review')`,
        [JSON.stringify(updated.data), JSON.stringify(updated.warnings),
          updated.confidence,row.id,jobId,storeId,row.updated_at],
      )
      if (written.rowCount !== 1) throw new Error(
        'A revisão do catálogo mudou durante a preparação das fotos. Atualize a lista e tente novamente.'
      )
      staged += 1
      if (localized.failed) {
        console.warn('[scanner publish] additional images unavailable', {
          jobId, productId:row.id,failed:localized.failed,
        })
      }
    }
  }
  return { staged, failed, skipped:false }
}
