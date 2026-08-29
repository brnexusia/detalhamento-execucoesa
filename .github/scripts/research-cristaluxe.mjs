import { collectCatalog, safeRequest } from '../../server/scanner-collector.mjs'
import { extractFacilZapRuntime } from '../../server/scanner-platforms.mjs'

const url = 'https://cristaluxesemijoias.com.br/'
const root = await safeRequest(url)
console.log('root', root.status, root.url, root.contentType, root.body.length)
console.log('runtime', JSON.stringify(extractFacilZapRuntime(root.body)))
for (const needle of ['carregar_produtos','FZCatalogoRuntime','search_id','guias_medidas','facilzap']) {
  const idx = root.body.toLowerCase().indexOf(needle.toLowerCase())
  console.log('needle', needle, idx, idx >= 0 ? root.body.slice(Math.max(0, idx-500), idx+1400) : '')
}
try {
  const result = await collectCatalog(url, { strictPlatformAdapters: true })
  console.log('platform', result.platform)
  console.log('candidateCount', result.candidateCount)
  console.log('pagesScanned', result.pagesScanned)
  let withImages = 0, withVariants = 0, withDescription = 0, withSku = 0, withCategory = 0
  let variantCount = 0
  for (const p of result.candidates) {
    if (p.images?.length) withImages++
    if (p.variants?.length) { withVariants++; variantCount += p.variants.length }
    if (String(p.description||'').trim()) withDescription++
    if (String(p.sku||'').trim()) withSku++
    if (String(p.category||'').trim()) withCategory++
  }
  console.log('coverage', JSON.stringify({withImages,withVariants,variantCount,withDescription,withSku,withCategory}))
  console.log('sample', JSON.stringify(result.candidates.slice(0,3), null, 2))
} catch (error) {
  console.error('collectError', error?.stack || error)
}
