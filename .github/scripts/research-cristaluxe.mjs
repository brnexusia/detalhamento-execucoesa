import { collectCatalog, safeRequest } from '../../server/scanner-collector.mjs'
import { extractFacilZapRuntime, facilZapProducts } from '../../server/scanner-platforms.mjs'

const url = 'https://cristaluxesemijoias.com.br/'
const root = await safeRequest(url)
console.log('root', root.status, root.url, root.contentType, root.body.length)
console.log('runtime', JSON.stringify(extractFacilZapRuntime(root.body)))
const match = /const\s+urlCarregarSecoesProdutos\s*=\s*`([^`]+)`/i.exec(root.body)
if (match) {
  const page0 = match[1]
  console.log('page0', page0)
  for (const page of [1,2,15,16]) {
    const endpoint = page0.replace('/carregar_produtos/0/', `/carregar_produtos/${page}/`)
    for (const body of [{}, { pagina_especifica: '' }]) {
      try {
        const r = await safeRequest(endpoint, {
          method: 'POST',
          accept: 'application/json,text/plain,*/*',
          headers: {'content-type':'application/json'},
          body,
        })
        console.log('pageResult', page, JSON.stringify(body), r.status, r.contentType, r.body.length, r.body.slice(0,500))
        if (r.ok && r.contentType.includes('json')) {
          const payload = JSON.parse(r.body || '{}')
          const mapped = facilZapProducts(payload, root.url)
          console.log('mappedPage', page, mapped.products.length, mapped.end, mapped.products[0]?.sku, mapped.products[0]?.images?.[0])
        }
      } catch (e) { console.log('pageError', page, String(e)) }
    }
  }
}
try {
  const result = await collectCatalog(url, { strictPlatformAdapters: true })
  console.log('platform', result.platform, 'candidateCount', result.candidateCount, 'pagesScanned', result.pagesScanned)
} catch (error) {
  console.error('collectError', error?.stack || error)
}
