import { collectCatalog, safeRequest } from '../../server/scanner-collector.mjs'

const url = 'https://cristaluxesemijoias.com.br/'
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
for (const p of result.candidates.slice(0,3)) {
  if (p.images?.[0]) {
    const r = await safeRequest(p.images[0], { accept: 'image/*', maxBytes: 5*1024*1024 })
    console.log('imageCheck', p.sku, r.status, r.contentType, r.body.length)
  }
}
