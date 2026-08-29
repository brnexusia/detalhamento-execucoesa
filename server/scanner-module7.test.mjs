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

const modernFacilRoot = `<!doctype html><html><head>
<script src="https://assets-cdn.facilzap.app.br/catalogo.js"></script>
</head><body><script>
const urlCarregarSecoesProdutos = ` + "`" + `https://cristaluxe.example/c/atacado/carregar_produtos/0/todas/11933520201` + "`" + `;
</script></body></html>`
const modernRuntime = extractFacilZapRuntime(modernFacilRoot)
assert.ok(modernRuntime)
assert.equal(modernRuntime.urlCarregarProdutosTemplate, 'https://cristaluxe.example/c/atacado/carregar_produtos/{PAGE}/{CATEGORY}/11933520201')

const mappedFacil = facilZapProducts({ produtos: [{
  id: '3652733',
  nome: 'Kit Calcinhas Total Confort',
  descricao: 'Produto realista de teste',
  preco: 75,
  categoria: 47650,
  categoria_nome: 'Calcinhas',
  sku: 'FZ3652733',
  controlar_estoque: true,
  total_disponibilidade: 6,
  imagens: ['produtos/1765916872_baba5b625a9226b240b3.webp'],
  precos_produto: {
    preco_a_partir: { preco: '60', ativado: true },
    promocional: '70.00',
    variacoes: { '1773005': { padrao: '60', promocional: false }, '1773006': { padrao: '60', promocional: false } },
  },
  variacoes: {
    '1773005': { id: '1773005', nome: 'M (Preto)', cor: '' },
    '1773006': { id: '1773006', nome: 'G (Azul)', cor: '' },
  },
  sku_variacoes: { '1773005': 'FZ3652733.6', '1773006': 'FZ3652733.15' },
  disponibilidade: { '1773005': '1', '1773006': '1' },
  estoque: { '1773005': 3, '1773006': 5 },
}] }, 'https://minhaloja.com.br/')
assert.equal(mappedFacil.products.length, 1)
assert.equal(mappedFacil.products[0].price, 60)
assert.equal(mappedFacil.products[0].sku, 'FZ3652733')
assert.equal(mappedFacil.products[0].category, 'Calcinhas')
assert.equal(mappedFacil.products[0].images[0], 'https://arquivos.facilzap.app.br/produtos/1765916872_baba5b625a9226b240b3.webp')
assert.deepEqual(mappedFacil.products[0].properties.find((group) => group.name === 'Tamanho').values, ['M', 'G'])
assert.deepEqual(mappedFacil.products[0].properties.find((group) => group.name === 'Cor').values, ['Preto', 'Azul'])
assert.equal(mappedFacil.products[0].variants[0].size, 'M')
assert.equal(mappedFacil.products[0].variants[0].color, 'Preto')
assert.equal(mappedFacil.products[0].variants[0].sku, 'FZ3652733.6')
assert.equal(mappedFacil.products[0].variants[0].price, 60)
assert.equal(mappedFacil.products[0].availability, 'InStock')

const namedColorFacil = facilZapProducts({ produtos: [{
  id: '4263588', nome: 'Pulseira', sku: 'FZ4263588', preco: 37.5,
  variacoes: {
    '2124362': { id: '2124362', nome: 'Prata', cor: '#b8bec4' },
    '2130878': { id: '2130878', nome: 'Grafite', cor: '#8a8787' },
  },
  sku_variacoes: { '2124362': 'FZ4263588.1', '2130878': 'FZ4263588.2' },
}] }, 'https://cristaluxe.example/')
assert.deepEqual(namedColorFacil.products[0].properties.find((group) => group.name === 'Cor').values, ['Prata', 'Grafite'])
assert.equal(namedColorFacil.products[0].variants[0].color, 'Prata')
assert.equal(namedColorFacil.products[0].variants[1].color, 'Grafite')
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

const modernCalls = []
const modernRequest = async (input, options = {}) => {
  const url = String(input)
  modernCalls.push({ url, options })
  if (url === 'https://cristaluxe.example/') return response(url, modernFacilRoot)
  const match = /carregar_produtos\/(\d+)\/todas\//.exec(url)
  if (!match) return { status: 404, ok: false, url, contentType: 'text/plain', headers: {}, body: '' }
  const page = Number(match[1])
  if (page === 3) return response(url, JSON.stringify({ acao: 'sem_mais_produtos' }), 'application/json')
  const count = page === 1 ? 12 : 7
  const start = page === 1 ? 0 : 12
  return response(url, JSON.stringify({ produtos: Array.from({ length: count }, (_, index) => ({
    id: start + index + 1,
    nome: `Cristaluxe ${start + index + 1}`,
    sku: `CR-${start + index + 1}`,
    preco: '29,90',
    imagens: [`produtos/cr-${start + index + 1}.webp`],
    descricao: 'Descrição completa',
  })) }), 'application/json')
}
const modernCollected = await collectCatalog('https://cristaluxe.example/', { request: modernRequest, strictPlatformAdapters: true })
assert.equal(modernCollected.platform, 'facilzap')
assert.equal(modernCollected.candidateCount, 19)
assert.equal(modernCollected.candidates.at(-1).sku, 'CR-19')
assert.equal(modernCollected.candidates[0].images[0], 'https://arquivos.facilzap.app.br/produtos/cr-1.webp')
assert.ok(modernCalls.some((call) => call.url.includes('/carregar_produtos/2/todas/')))


let redirectedRootCalls = []
const redirectedRequest = async (input, options = {}) => {
  const url = String(input)
  redirectedRootCalls.push(url)
  if (url === 'https://facilzap.app.br/minhaloja') return response(url, `<script>window.location.href = 'https://loja-propria.example';</script>`)
  if (url === 'https://loja-propria.example/') return response(url, facilRoot.replaceAll('https://facilzap.app.br/minhaloja', 'https://loja-propria.example'))
  const match = /carregar_produtos\/(\d+)\/todas\//.exec(url)
  if (!match) return { status: 404, ok: false, url, contentType: 'text/plain', headers: {}, body: '' }
  const page = Number(match[1])
  if (page > 1) return response(url, JSON.stringify({ acao: 'sem_mais_produtos' }), 'application/json')
  return response(url, JSON.stringify({ produtos: [{ id: 1, nome: 'Produto redirecionado', sku: 'FZ1', preco: 10, imagens: ['produtos/foto.webp'] }] }), 'application/json')
}
const redirectedCollected = await collectCatalog('https://facilzap.app.br/minhaloja', { request: redirectedRequest, strictPlatformAdapters: true })
assert.equal(redirectedCollected.platform, 'facilzap')
assert.equal(redirectedCollected.candidateCount, 1)
assert.equal(redirectedCollected.candidates[0].images[0], 'https://arquivos.facilzap.app.br/produtos/foto.webp')
assert.ok(redirectedRootCalls.includes('https://loja-propria.example/'))

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
