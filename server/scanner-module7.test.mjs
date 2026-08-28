import assert from 'node:assert/strict'
import { collectCatalog, detectPlatform } from './scanner-collector.mjs'
import { extractFacilZapRuntime, facilZapProducts, parseVestiContext, vestiProducts } from './scanner-platforms.mjs'

assert.equal(detectPlatform('', 'https://minha.lojavirtualnuvem.com.br/'), 'nuvemshop')
assert.equal(detectPlatform('', 'https://minha.lojaintegrada.com.br/'), 'lojaintegrada')
assert.equal(detectPlatform('', 'https://demo.commercesuite.com.br/'), 'tray')
assert.equal(detectPlatform('', 'https://facilzap.app.br/minhaloja'), 'facilzap')
assert.equal(detectPlatform('', 'https://v.vesti.mobi/minhaloja/catalogo/abc'), 'vesti')
assert.equal(detectPlatform('', 'https://zapfacil.shop/'), 'zapfacil')

const facilRoot = `<!doctype html><html><body><script>
window.FZCatalogoRuntime = window.FZCatalogoRuntime || {};
window.FZCatalogoRuntime.listagem = {"urlCarregarProdutosTemplate":"https://facilzap.app.br/minhaloja/carregar_produtos/{PAGE}/{CATEGORY}/5511999999999","searchId":"search-123","paginaEspecifica":"","categoria":0,"idPerfilCompra":""};
</script></body></html>`
const runtime = extractFacilZapRuntime(facilRoot)
assert.ok(runtime)
assert.match(runtime.urlCarregarProdutosTemplate, /carregar_produtos\/\{PAGE\}\/\{CATEGORY\}/)
assert.equal(runtime.searchId, 'search-123')

const mappedFacil = facilZapProducts({ produtos: [{
  id: 11,
  nome: 'Vestido Solar',
  descricao: 'Midi',
  codigo: 'VS-11',
  preco: 'R$ 49,90',
  categoria: { nome: 'Vestidos' },
  fotos: [{ url: '/media/11.jpg' }],
  cores: [{ nome: 'Azul' }, { nome: 'Preto' }],
  tamanhos: ['P', 'M'],
  variacoes: [{ id: 101, sku: 'VS-11-P-AZ', cor: 'Azul', tamanho: 'P', preco: '49,90' }],
}] }, 'https://facilzap.app.br/minhaloja/')
assert.equal(mappedFacil.products.length, 1)
assert.equal(mappedFacil.products[0].price, 49.9)
assert.equal(mappedFacil.products[0].sku, 'VS-11')
assert.deepEqual(mappedFacil.products[0].properties[0].values, ['Azul', 'Preto'])
assert.equal(mappedFacil.products[0].variants[0].size, 'P')
assert.equal(facilZapProducts({ acao: 'sem_mais_produtos' }, 'https://facilzap.app.br/minhaloja/').end, true)

const vestiContext = parseVestiContext('https://v.vesti.mobi/lojax/catalogo/cat123')
assert.deepEqual(vestiContext, {
  schemeUrl: 'lojax',
  catalogId: 'cat123',
  catalogBaseUrl: 'https://v.vesti.mobi/lojax/catalogo/cat123',
})
const mappedVesti = vestiProducts({ products: [{
  id: 'p1', code: '04.147', name: 'Pantalona', slug: 'pantalona-preta', price: 59.99,
  prices: [{ price: 59.99 }], stockout: false,
  media: { normal: { url: 'https://cdn-op.vesti.mobi/p/p1-lg.webp' } },
  colors: [{ id: 'c1', name: 'PRETO' }], sizes: [{ id: 's1', name: 'M' }],
  skus: [{ id: 'sku1', sku: '04.147-M-P', color_name: 'PRETO', size_name: 'M', qnt: 3 }],
}] }, vestiContext)
assert.equal(mappedVesti.length, 1)
assert.equal(mappedVesti[0].sku, '04.147')
assert.equal(mappedVesti[0].price, 59.99)
assert.equal(mappedVesti[0].variants[0].size, 'M')
assert.ok(mappedVesti[0].images.some((url) => url.includes('p1-lg.webp')))

function response(url, body, contentType = 'text/html') {
  return { status: 200, ok: true, url, contentType, headers: {}, body }
}

let facilCalls = []
const facilRequest = async (input, options = {}) => {
  const url = String(input)
  facilCalls.push({ url, options })
  if (url === 'https://facilzap.app.br/minhaloja') return response(url, facilRoot)
  const match = /carregar_produtos\/(\d+)\/todas\//.exec(url)
  if (!match) return { status: 404, ok: false, url, contentType: 'text/plain', headers: {}, body: '' }
  const page = Number(match[1])
  assert.equal(options.method, 'POST')
  assert.equal(options.headers['content-type'], 'application/json')
  if (page === 4) return response(url, JSON.stringify({ acao: 'sem_mais_produtos' }), 'application/json')
  const count = page < 3 ? 12 : 2
  const start = (page - 1) * 12
  return response(url, JSON.stringify({ produtos: Array.from({ length: count }, (_, index) => ({
    id: start + index + 1,
    nome: `Produto FZ ${start + index + 1}`,
    codigo: `FZ-${start + index + 1}`,
    preco: '19,90',
    imagem: `/p/${start + index + 1}.jpg`,
  })) }), 'application/json')
}
const facilCollected = await collectCatalog('https://facilzap.app.br/minhaloja', {
  request: facilRequest,
  strictPlatformAdapters: true,
})
assert.equal(facilCollected.platform, 'facilzap')
assert.equal(facilCollected.candidateCount, 26)
assert.equal(facilCollected.candidates.length, 26)
assert.equal(facilCollected.candidates.at(-1).sku, 'FZ-26')
assert.ok(facilCalls.some((call) => call.options.method === 'POST'))

const vestiRoot = '<html><head><meta property="og:image" content="https://cdn-op.vesti.mobi/p/x.jpg"></head></html>'
const vestiRequest = async (input) => {
  const url = String(input)
  if (url === 'https://v.vesti.mobi/lojax/catalogo/cat123') return response(url, vestiRoot)
  if (url.startsWith('https://apivesti.vesti.mobi/')) {
    const page = Number(new URL(url).searchParams.get('page'))
    const products = page === 1
      ? [{ id: '1', code: 'V1', name: 'Vesti 1', slug: 'vesti-1', price: 10, media: { normal: { url: 'https://cdn/p1.jpg' } }, colors: [{ name: 'AZUL' }] }, { id: '2', code: 'V2', name: 'Vesti 2', slug: 'vesti-2', price: 20 }]
      : [{ id: '3', code: 'V3', name: 'Vesti 3', slug: 'vesti-3', price: 30, sizes: [{ name: 'G' }] }]
    return response(url, JSON.stringify({ products, links: { next: page === 1 ? 'page2' : null }, meta: { current_page: page } }), 'application/json')
  }
  return { status: 404, ok: false, url, contentType: 'text/plain', headers: {}, body: '' }
}
const vestiCollected = await collectCatalog('https://v.vesti.mobi/lojax/catalogo/cat123', {
  request: vestiRequest,
  strictPlatformAdapters: true,
})
assert.equal(vestiCollected.platform, 'vesti')
assert.equal(vestiCollected.candidateCount, 3)
assert.equal(vestiCollected.candidates.at(-1).sku, 'V3')
assert.deepEqual(vestiCollected.candidates.at(-1).properties[0].values, ['G'])

await assert.rejects(
  () => collectCatalog('https://zapfacil.shop/', { request: async (url) => response(String(url), '<html><h1>Automação de WhatsApp</h1></html>') }),
  /não expõe uma vitrine pública/i,
)

console.log('[scanner module 7] platform adapters: ok')
