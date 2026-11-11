/**
 * Read-only production diagnostic for a single import-review product.
 * Run from the ShopVax container with DATABASE_URL configured:
 * node scripts/diagnose-facilzap-import.mjs JOB_ID PRODUCT_ID
 * Never modifies data or prints URL query parameters/tokens.
 */
import pg from 'pg'
import { facilZapProductUrl, extractFacilZapDetailProduct } from '../server/scanner-platforms.mjs'
import { safeRequest } from '../server/scanner-collector.mjs'
import { fetchBestImportImage, recoverImportImagesFromSource } from '../server/import-media-localizer.mjs'

const [jobId, productId] = process.argv.slice(2)
if (!/^[0-9a-f-]{36}$/i.test(jobId || '') || !/^[0-9a-f-]{36}$/i.test(productId || '')) {
  console.error('Uso: node scripts/diagnose-facilzap-import.mjs JOB_ID PRODUCT_ID')
  process.exit(2)
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL não está configurada no serviço atual.')
  process.exit(2)
}
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 })
const location = (raw) => {
  try {
    const u = new URL(String(raw || ''))
    return (u.protocol === 'http:' || u.protocol === 'https:')
      ? u.origin + u.pathname.slice(0, 400) : '<non-http-url>'
  } catch { return '<invalid-url>' }
}
const compactFailure = (error) => {
  const msg = String(error?.message || '')
  return (/HTTP \d{3}|timeout|tempo demais|ENOTFOUND|EAI_AGAIN|imagem suportada|maior que o limite|retornou vazia/i.exec(msg)?.[0] || 'falha ao obter imagem')
}
const unique = values => [...new Set(values.filter(x => typeof x === 'string' && /^https?:\/\//i.test(x)))]
const probe = async (kind, urls, limit = 2) => {
  for (const url of unique(urls).slice(0, limit)) {
    try {
      const media = await fetchBestImportImage(url)
      console.log(JSON.stringify({ kind, url:location(url), result:'download_ok', bytes:media.buffer.length, resolved:location(media.resolvedUrl) }))
    } catch (error) {
      console.log(JSON.stringify({ kind, url:location(url), result:'download_failed', reason:compactFailure(error) }))
    }
  }
}
try {
  const sql = [
    'SELECT j.platform,j.source_url AS catalog_url,j.status,',
    'n.id,n.store_id,COALESCE(n.review_data,n.normalized_data) AS data,',
    "c.raw_data->>'external_id' AS source_product_id",
    'FROM import_jobs j',
    'JOIN import_normalized_products n ON n.job_id=j.id AND n.store_id=j.store_id',
    'LEFT JOIN import_candidates c ON c.id=n.source_candidate_id AND c.store_id=n.store_id',
    'WHERE j.id=$1 AND n.id=$2',
  ].join(' ')
  const found = await db.query(sql, [jobId, productId])
  if (!found.rowCount) {
    console.error('Não encontrei esse produto nesta importação.')
    process.exitCode = 1
  } else {
    const row = found.rows[0]
    const item = row.data
    const id = String(row.source_product_id || '') ||
      /\/produto\/([^/?#]+)/i.exec(String(item.source_url || ''))?.[1] || ''
    const corrected = row.platform === 'facilzap' && id
      ? facilZapProductUrl({}, id, row.catalog_url) : item.source_url
    console.log(JSON.stringify({
      event:'product_source',
      platform:row.platform,
      jobStatus:row.status,
      name:String(item.name || '').slice(0, 90),
      sku:String(item.sku || '').slice(0, 80),
      importCatalogUrl:location(row.catalog_url),
      storedProductUrl:location(item.source_url),
      correctedProductUrl:location(corrected),
      wrongPathCorrected:location(item.source_url) !== location(corrected),
    }))
    const sourceImages = unique([
      item.media_url,
      ...(Array.isArray(item.images) ? item.images : []),
      ...(Array.isArray(item.variant_images) ? item.variant_images.flatMap(x => x.images || []) : []),
    ])
    await probe('url_armazenada', sourceImages)
    try {
      const page = await safeRequest(corrected, {
        accept:'text/html,application/xhtml+xml',
        maxBytes:6 * 1024 * 1024,
      })
      const detail = String(page.contentType || '').includes('html')
        ? extractFacilZapDetailProduct(page.body, page.url || corrected) : null
      console.log(JSON.stringify({
        event:'pagina_produto',
        httpStatus:page.status,
        finalUrl:location(page.url || corrected),
        contentType:String(page.contentType || '').slice(0, 60),
        hasDadosProduto:Boolean(detail),
        extractedProductId:detail?.external_id || '',
        extractedProductName:String(detail?.title || '').slice(0, 90),
        hasOgImage:/property=["']og:image["']/i.test(page.body || ''),
      }))
    } catch (error) {
      console.log(JSON.stringify({event:'pagina_produto',result:'fetch_failed',reason:compactFailure(error)}))
    }
    try {
      const recovered = await recoverImportImagesFromSource(corrected, item)
      console.log(JSON.stringify({event:'recovery',candidateImages:recovered.length,first3:recovered.slice(0, 3).map(location)}))
      await probe('url_recuperada', recovered, 3)
    } catch (error) {
      console.log(JSON.stringify({event:'recovery_failed',reason:compactFailure(error)}))
    }
  }
} catch (error) {
  console.error('Falha ao consultar importação:', String(error?.message || '').slice(0, 200))
  process.exitCode = 1
} finally {
  await db.end()
}
