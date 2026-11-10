// Prepare remote product images BEFORE publishing products. Do not hold a
// PostgreSQL transaction or product-row lock while downloading network assets.
import { localizeImportedProductMedia, isLocalShopvaxMedia } from './import-media-localizer.mjs'
import { prepareReview } from './scanner-review.mjs'
import { facilZapProductUrl } from './scanner-platforms.mjs'

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
  maxSelected = 100000,
  onProgress = async () => {},
}) {
  if (typeof query !== 'function') throw new Error('Consulta ao banco indisponível.')
  // First verify that the job is still in review. This is also checked again
  // under a transaction lock by publishJob after staging.
  const found = await query('SELECT status FROM import_jobs WHERE id=$1 AND store_id=$2 LIMIT 1',
    [jobId, storeId])
  if (!found.rowCount || found.rows[0].status !== 'review') return { staged: 0, failed: 0, skipped: true }

  const totals = await query(
    `SELECT COUNT(*)::int AS count FROM import_normalized_products
     WHERE job_id=$1 AND store_id=$2 AND selected=true
       AND (
         COALESCE(review_data,normalized_data)->>'media_url' ~* '^https?://'
         OR (COALESCE(review_data,normalized_data)->'images')::text ~* 'https?://'
         OR (COALESCE(review_data,normalized_data)->'variant_images')::text ~* 'https?://'
       )`, [jobId,storeId])
  const total = Number(totals.rows[0]?.count || 0)
  await onProgress({ phase: 'images', completed:0, total })
  let staged = 0
  let failed = 0
  let cursor = ''
  let examined = 0
  while (true) {
    const result = await query(
      `SELECT n.id,n.updated_at::text AS media_revision,COALESCE(n.review_data,n.normalized_data) AS data,
              c.raw_data->>'external_id' AS source_product_id,
              j.source_url AS job_source_url,j.platform AS job_platform
       FROM import_normalized_products n
       JOIN import_jobs j ON j.id=n.job_id AND j.store_id=n.store_id
       LEFT JOIN import_candidates c ON c.id=n.source_candidate_id AND c.store_id=n.store_id
       WHERE n.job_id=$1 AND n.store_id=$2 AND n.selected=true AND n.id>$3
         AND (
           COALESCE(n.review_data,n.normalized_data)->>'media_url' ~* '^https?://'
           OR (COALESCE(n.review_data,n.normalized_data)->'images')::text ~* 'https?://'
           OR (COALESCE(n.review_data,n.normalized_data)->'variant_images')::text ~* 'https?://'
         )
       ORDER BY n.id ASC LIMIT 100`,
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
      if (!remoteImages.length) continue // No external asset to persist.
      // Old FácilZap imports can have a detail URL missing the store slug.
      // Rebuild it from the original import-job URL + source product ID,
      // so the same review can recover images without a full rescan.
      const sourceProductId = String(row.source_product_id || '').trim() ||
        (/\/produto\/([^/?#]+)/i.exec(String(product.source_url || ''))?.[1] || '')
      const correctedSource = row.job_platform === 'facilzap' && sourceProductId && row.job_source_url
        ? facilZapProductUrl({}, sourceProductId, row.job_source_url)
        : ''
      const sourceUrl = correctedSource || product.source_url || ''
      const localized = await localize({
        query, storeId, product, sourceUrl,
      })
      const replacements = sourceImages({
        ...product, media_url:localized.mediaUrl,
        images:localized.images, variant_images:localized.variantImages,
      })
      const anyLocal = replacements.some(isLocalShopvaxMedia)
      if (!anyLocal) {
        failed += 1
        const reasons = Array.isArray(localized.failureReasons) ? localized.failureReasons.slice(0, 3) : []
        // Diagnóstico acionável sem expor URL assinada, token ou caminho privado.
        console.warn('[scanner publish] product photo staging failed', {
          jobId, productId:row.id, reasons,
        })
        throw new Error(
          'Não foi possível salvar nenhuma foto do produto "' +
          String(product.name || 'sem nome').slice(0, 90) +
          '". O item continua em revisão; confira a URL ou substitua a imagem antes de publicar.' +
          (reasons.length ? ' Diagnóstico: ' + reasons.join('; ') + '.' : '')
        )
      }
      // Product records must never retain expired third-party image URLs.
      const safeImages = (localized.images || []).filter(isLocalShopvaxMedia)
      const safeVariants = (localized.variantImages || []).map(group => ({
        ...group, images:(group.images || []).filter(isLocalShopvaxMedia),
      })).filter(group => group.images.length)
      const safeCover = isLocalShopvaxMedia(localized.mediaUrl) ? localized.mediaUrl :
        safeImages[0] || safeVariants[0]?.images[0] || ''
      const updated = prepareReview({
        ...product,source_url:sourceUrl,media_url:safeCover,
        images:safeImages.length ? safeImages : safeCover ? [safeCover] : [],
        variant_images:safeVariants,
      })
      const written = await query(
        `UPDATE import_normalized_products n
         SET review_data=$1::jsonb, warnings=$2::jsonb,
           confidence=$3,updated_at=now(),review_updated_at=now()
         WHERE n.id=$4 AND n.job_id=$5 AND n.store_id=$6 AND n.selected=true
           AND n.updated_at::text=$7
           AND EXISTS (SELECT 1 FROM import_jobs j
             WHERE j.id=n.job_id AND j.store_id=n.store_id AND j.status='review')`,
        [JSON.stringify(updated.data), JSON.stringify(updated.warnings),
          updated.confidence,row.id,jobId,storeId,row.media_revision],
      )
      if (written.rowCount !== 1) throw new Error(
        'A revisão do catálogo mudou durante a preparação das fotos. Atualize a lista e tente novamente.'
      )
      staged += 1
      await onProgress({ phase:'images', completed: examined, total })
      if (localized.failed) {
        console.warn('[scanner publish] additional images unavailable', {
          jobId, productId:row.id,failed:localized.failed,
        })
      }
    }
  }
  await onProgress({ phase:'images', completed:total, total })
  return { staged, failed, skipped:false }
}
