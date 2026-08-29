import { collectCatalog, safeRequest } from '../../server/scanner-collector.mjs'
import { extractFacilZapRuntime } from '../../server/scanner-platforms.mjs'

const url = 'https://cristaluxesemijoias.com.br/'
const root = await safeRequest(url)
console.log('root', root.status, root.url, root.contentType, root.body.length)
console.log('runtime', JSON.stringify(extractFacilZapRuntime(root.body)))

const marker = 'urlCarregarSecoesProdutos'
let from = 0
while (true) {
  const idx = root.body.indexOf(marker, from)
  if (idx < 0) break
  console.log('markerSnippet', root.body.slice(Math.max(0, idx-800), idx+2200))
  from = idx + marker.length
}

const match = /const\s+urlCarregarSecoesProdutos\s*=\s*`([^`]+)`/i.exec(root.body)
if (match) {
  const endpoint = match[1]
  console.log('endpoint', endpoint)
  for (const method of ['GET','POST']) {
    try {
      const r = await safeRequest(endpoint, {
        method,
        accept: 'application/json,text/plain,*/*',
        headers: method === 'POST' ? {'content-type':'application/json'} : undefined,
        body: method === 'POST' ? {} : undefined,
      })
      console.log('endpointResult', method, r.status, r.contentType, r.body.length, r.body.slice(0,1500))
      if (r.ok && r.contentType.includes('json')) {
        const p = JSON.parse(r.body)
        console.log('endpointKeys', method, Object.keys(p))
        for (const [k,v] of Object.entries(p)) {
          if (Array.isArray(v)) console.log('arrayKey', k, v.length, JSON.stringify(v.slice(0,1)))
          else if (v && typeof v === 'object') console.log('objectKey', k, Object.keys(v).length, JSON.stringify(Object.entries(v).slice(0,1)))
        }
      }
    } catch (e) { console.log('endpointError', method, String(e)) }
  }
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
} catch (error) {
  console.error('collectError', error?.stack || error)
}
