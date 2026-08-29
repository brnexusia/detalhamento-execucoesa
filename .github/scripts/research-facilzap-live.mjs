import { safeRequest } from '../../server/scanner-collector.mjs'
import { extractFacilZapRuntime, facilZapProducts } from '../../server/scanner-platforms.mjs'

const storeUrl = process.env.FACILZAP_STORE_URL || 'https://facilzap.app.br/nesmodaintima'
const root = await safeRequest(storeUrl)
console.log('root', root.status, root.url, root.contentType, root.body.length)
console.log('rootBody', JSON.stringify(root.body.slice(0,1000)))
const runtime = extractFacilZapRuntime(root.body)
console.log('runtime', JSON.stringify(runtime))
if (!runtime?.urlCarregarProdutosTemplate) process.exit(2)
const category = Number(runtime.categoria || 0) > 0 ? String(runtime.categoria) : 'todas'
const endpoint = String(runtime.urlCarregarProdutosTemplate).replace('{PAGE}', '1').replace('{CATEGORY}', category)
const url = new URL(endpoint, root.url)
if (runtime.searchId) url.searchParams.set('search_id', String(runtime.searchId))
url.searchParams.set('mobile', '0')
if (runtime.idPerfilCompra) url.searchParams.set('perfil_compra', String(runtime.idPerfilCompra))
if (runtime.variacoes) url.searchParams.set('variacoes', String(runtime.variacoes))
const response = await safeRequest(url.toString(), {
  method: 'POST',
  accept: 'application/json,text/plain,*/*',
  headers: { 'content-type': 'application/json' },
  body: { pagina_especifica: runtime.paginaEspecifica || '' },
})
console.log('page', response.status, response.url, response.contentType, response.body.length)
const payload = JSON.parse(response.body || '{}')
const raw = payload.produtos ?? payload.products ?? payload.data ?? payload
const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : []
console.log('payloadKeys', Object.keys(payload))
console.log('count', list.length)
for (const [index, item] of list.slice(0, 3).entries()) {
  const shallow = {}
  for (const [key, value] of Object.entries(item || {})) {
    if (value == null || ['string','number','boolean'].includes(typeof value)) shallow[key] = value
    else if (Array.isArray(value)) shallow[key] = { type: 'array', length: value.length, sample: value.slice(0,2) }
    else shallow[key] = { type: 'object', keys: Object.keys(value).slice(0,30), value }
  }
  console.log(`raw${index}`, JSON.stringify(shallow))
}
const mapped = facilZapProducts(payload, root.url)
console.log('mappedCount', mapped.products.length, 'end', mapped.end)
console.log('mapped', JSON.stringify(mapped.products.slice(0,3), null, 2))
