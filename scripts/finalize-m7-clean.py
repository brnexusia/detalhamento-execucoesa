from pathlib import Path
import re

path = Path('server/scanner-collector.mjs')
text = path.read_text()

platform_import = "import { detectStorefrontPlatform, extractFacilZapRuntime, facilZapProducts, parseVestiContext, vestiProducts, isZapFacilCatalogPage } from './scanner-platforms.mjs'\n"
collector_import = "import { collectDirectedSitemap, collectTrayPublic, parseVestiCompanyId, enrichVestiCandidate } from './scanner-platform-collectors.mjs'\n"
if collector_import not in text:
    if platform_import not in text:
        raise SystemExit('platform import anchor missing')
    text = text.replace(platform_import, platform_import + collector_import, 1)

pattern = r"async function collectVesti\(rootResponse, request, maxProducts, sink, onProgress\) \{[\s\S]*?\n\}\n\nasync function mapLimit"
replacement = r'''async function collectVesti(rootResponse, request, maxProducts, sink, onProgress) {
  const context = parseVestiContext(rootResponse.url, rootResponse.body)
  if (!context) throw new Error('Não foi possível identificar loja e catálogo Vesti pela URL pública.')
  const companyId = parseVestiCompanyId(rootResponse.body)
  const pageSignatures = new Set()
  let pagesScanned = 1

  for (let page = 1; sink.count < maxProducts; page += 1) {
    const endpoint = new URL(`https://apivesti.vesti.mobi/appmarca/v2/catalogue/${encodeURIComponent(context.catalogId)}/company/${encodeURIComponent(context.schemeUrl)}/`)
    endpoint.searchParams.set('page', String(page))
    endpoint.searchParams.set('perpage', '60')
    endpoint.searchParams.set('with_categories', 'true')
    endpoint.searchParams.set('with_colors', 'true')
    endpoint.searchParams.set('with_product_colors', 'true')
    endpoint.searchParams.set('with_sizes', 'true')
    endpoint.searchParams.set('with_brands', 'true')
    endpoint.searchParams.set('with_prices', 'true')
    endpoint.searchParams.set('with_tags', '1')

    const response = await request(endpoint.toString(), { accept: 'application/json' })
    pagesScanned += 1
    if (!response.ok) throw new Error(`A API pública do Vesti respondeu HTTP ${response.status}.`)
    let payload
    try { payload = JSON.parse(response.body) } catch { throw new Error('O Vesti retornou catálogo em formato inesperado.') }
    const listed = Array.isArray(payload?.products) ? payload.products : []
    const products = vestiProducts(payload, context)
    if (!products.length) break
    const signature = `${products[0]?.external_id || ''}|${products.at(-1)?.external_id || ''}|${products.length}`
    if (pageSignatures.has(signature)) break
    pageSignatures.add(signature)

    let enriched = products
    if (companyId) {
      enriched = await mapLimit(products, 6, async (candidate, index) => {
        const raw = listed[index]
        const productId = candidate.external_id || raw?.id
        if (!productId) return candidate
        const detailUrl = new URL(`https://apivesti.vesti.mobi/appmarca/v1/products/company/${encodeURIComponent(companyId)}/product/${encodeURIComponent(productId)}/showcase`)
        detailUrl.searchParams.set('cid', context.catalogId)
        detailUrl.searchParams.set('reseller_id', 'null')
        try {
          const detailResponse = await request(detailUrl.toString(), { accept: 'application/json' })
          pagesScanned += 1
          if (!detailResponse.ok) return candidate
          const detail = JSON.parse(detailResponse.body)
          return enrichVestiCandidate(candidate, detail)
        } catch {
          return candidate
        }
      })
    }

    await sink.push(enriched)
    await onProgress({ progress: Math.min(90, 15 + Math.floor(Math.log2(page + 1) * 8)), pagesScanned, candidates: sink.count, platform: 'vesti' })
    if (!payload?.links?.next) break
  }
  await sink.flush()
  return { candidateCount: sink.count, pagesScanned }
}

async function mapLimit'''
text, count = re.subn(pattern, lambda _m: replacement, text, count=1)
if count != 1:
    raise SystemExit(f'collectVesti replacement count={count}')

anchor = """  if (platform === 'shopify') {
"""
insert = """  if (platform === 'nuvemshop' || platform === 'lojaintegrada') {
    try {
      const result = await collectDirectedSitemap({
        rootResponse,
        platform,
        request,
        maxProducts,
        maxPages,
        sink,
        onProgress,
        extractSitemapLocations,
        extractProductsFromHtml,
      })
      if (result.candidateCount) return { platform, pagesScanned: result.pagesScanned, candidateCount: sink.count, candidates: sink.candidates }
    } catch (error) {
      if (options.strictPlatformAdapters) throw error
      // Sites legados sem sitemap de produto continuam pelo crawler genérico.
    }
  }

  if (platform === 'tray') {
    try {
      const result = await collectTrayPublic({ rootResponse, request, maxProducts, sink, onProgress })
      if (result.candidateCount) return { platform, pagesScanned: result.pagesScanned, candidateCount: sink.count, candidates: sink.candidates }
    } catch (error) {
      if (options.strictPlatformAdapters) throw error
      // Algumas lojas Tray restringem a API pública; nesses casos há fallback genérico.
    }
  }

  if (platform === 'shopify') {
"""
if insert not in text:
    if anchor not in text:
        raise SystemExit('shopify anchor missing')
    text = text.replace(anchor, insert, 1)

path.write_text(text)
print('M7_FINAL_COLLECTOR_PATCH_OK')
