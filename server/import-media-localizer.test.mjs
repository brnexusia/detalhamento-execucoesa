import assert from 'node:assert/strict'
import sharp from 'sharp'
import { fetchBestImportImage, fetchImportImage, isLocalShopvaxMedia, localizeImportedProductMedia, recoverImportImagesFromSource } from './import-media-localizer.mjs'

assert.equal(isLocalShopvaxMedia('/media/abc-123'), true)
assert.equal(isLocalShopvaxMedia('https://cdn.example/foto.jpg'), false)

const downloaded = await fetchImportImage('https://cdn.example/foto.jpg', {
  referer: 'https://loja.example/produto/1',
  request: async (_url, options) => {
    assert.equal(options.responseType, 'buffer')
    assert.equal(options.headers.referer, 'https://loja.example/produto/1')
    return { ok: true, status: 200, contentType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]) }
  },
})
assert.equal(downloaded.mimeType, 'image/jpeg')
assert.ok(Buffer.isBuffer(downloaded.buffer))

// 404 from the older FácilZap file hostname must be retried only on
// the provider's known file hosts, never by guessing products or paths.
const facilZapRequests = []
const aliasMedia = await fetchBestImportImage('https://arquivos.facilzap.app.br/produtos/brinco.webp', {
  referer:'https://galego.example/produto/12',
  request:async (url) => {
    facilZapRequests.push(url)
    return url === 'https://arquivos-cdn.facilzap.app.br/produtos/brinco.webp'
      ? { ok:true,status:200,contentType:'image/webp',buffer:Buffer.from([0x52,0x49,0x46,0x46,0,0,0,0,0x57,0x45,0x42,0x50]) }
      : { ok:false,status:404,contentType:'text/html',buffer:Buffer.alloc(0) }
  },
})
assert.equal(aliasMedia.resolvedUrl,'https://arquivos-cdn.facilzap.app.br/produtos/brinco.webp')
assert.deepEqual(facilZapRequests,[
  'https://arquivos.facilzap.app.br/produtos/brinco.webp',
  'https://arquivos-cdn.facilzap.app.br/produtos/brinco.webp',
])

const unavailableRequests=[]
await assert.rejects(() => fetchBestImportImage('https://arquivos.facilzap.app.br/produtos/indisponivel.webp', {
  request:async url=>{
    unavailableRequests.push(url)
    return {ok:false,status:404,contentType:'text/html',buffer:Buffer.alloc(0)}
  },
}),/HTTP 404/)
assert.equal(unavailableRequests.length,3,'Tentar somente domínios de arquivos conhecidos da FácilZap')

const unrelatedRequests=[]
await assert.rejects(()=>fetchBestImportImage('https://cdn.example/foto.webp',{
  request:async url=>{
    unrelatedRequests.push(url)
    return {ok:false,status:404,contentType:'text/html',buffer:Buffer.alloc(0)}
  },
}),/HTTP 404/)
assert.deepEqual(unrelatedRequests,['https://cdn.example/foto.webp'],'Não testar aliases para outros fornecedores')

const braavoSmall = await sharp({ create: { width: 566, height: 850, channels: 3, background: '#bbb' } }).webp({ quality: 80 }).toBuffer()
const braavoLarge = await sharp({ create: { width: 1000, height: 1502, channels: 3, background: '#bbb' } }).webp({ quality: 80 }).toBuffer()
const braavoRequests = []
const bestBraavo = await fetchBestImportImage('https://thumb.braavo.me/slave/0/example.webp', {
  request: async (url) => {
    braavoRequests.push(url)
    if (url.includes('/slave/0/')) return { ok: true, status: 200, contentType: 'image/webp', buffer: braavoSmall }
    if (url.includes('/slave/1000/')) return { ok: true, status: 200, contentType: 'image/webp', buffer: braavoLarge }
    throw new Error(`Unexpected Braavo URL: ${url}`)
  },
})
assert.equal(bestBraavo.width, 1000)
assert.equal(bestBraavo.height, 1502)
assert.match(bestBraavo.resolvedUrl, /\/slave\/1000\//)
assert.equal(braavoRequests.length, 2, 'Braavo pequeno deve comparar original e 1000px')

const braavoOriginalLarge = await sharp({ create: { width: 1871, height: 2807, channels: 3, background: '#aaa' } }).webp({ quality: 80 }).toBuffer()
const largeRequests = []
const bestOriginalBraavo = await fetchBestImportImage('https://thumb.braavo.me/slave/0/original-large.webp', {
  request: async (url) => {
    largeRequests.push(url)
    return { ok: true, status: 200, contentType: 'image/webp', buffer: braavoOriginalLarge }
  },
})
assert.equal(bestOriginalBraavo.width, 1871)
assert.match(bestOriginalBraavo.resolvedUrl, /\/slave\/0\//)
assert.equal(largeRequests.length, 1, 'original Braavo maior que 1000px não deve ser reduzido nem baixar variante desnecessária')


const sniffed = await fetchImportImage('https://cdn.example/sem-tipo', {
  request: async () => ({
    ok: true,
    status: 200,
    contentType: 'application/octet-stream',
    buffer: Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00]),
  }),
})
assert.equal(sniffed.mimeType, 'image/png', 'CDNs com content-type genérico devem ser aceitas pelo conteúdo binário')

await assert.rejects(
  () => fetchImportImage('https://cdn.example/not-image', {
    request: async () => ({ ok: true, status: 200, contentType: 'text/html', buffer: Buffer.from('<html>') }),
  }),
  /imagem suportada/i,
)

const cache = new Map()
let inserts = 0
const query = async (sql, params) => {
  if (sql.startsWith('SELECT id FROM media_assets')) {
    const found = cache.get(params[1])
    return { rowCount: found ? 1 : 0, rows: found ? [{ id: found }] : [] }
  }
  if (sql.startsWith('INSERT INTO media_assets')) {
    inserts += 1
    const assetId = `asset-${inserts}`
    cache.set(params[6], assetId)
    return { rowCount: 1, rows: [{ id: assetId }] }
  }
  throw new Error(`Unexpected query: ${sql}`)
}

const request = async (url) => ({
  ok: true,
  status: 200,
  contentType: url.endsWith('.png') ? 'image/png' : 'image/jpeg',
  buffer: Buffer.from(url.endsWith('.png') ? [0x89, 0x50, 0x4e, 0x47] : [0xff, 0xd8, 0xff]),
})

const product = {
  media_url: 'https://cdn.example/capa.jpg',
  media_type: 'image',
  images: ['https://cdn.example/capa.jpg', 'https://cdn.example/lado.png'],
  variant_images: [
    { selections: { Cor: 'Preto' }, images: ['https://cdn.example/capa.jpg'] },
  ],
}

const result = await localizeImportedProductMedia({
  query,
  storeId: 'store-1',
  sourceUrl: 'https://loja.example/produto/1',
  product,
  request,
})

assert.equal(result.changed, true)
assert.equal(result.failed, 0)
assert.equal(result.localized, 2)
assert.equal(inserts, 2, 'a mesma URL não deve ser armazenada duas vezes')
assert.equal(result.mediaUrl, '/media/asset-1')
assert.deepEqual(result.images, ['/media/asset-1', '/media/asset-2'])
assert.deepEqual(result.variantImages[0].images, ['/media/asset-1'])

const recoveredCache = new Map()
let recoveredInserts = 0
const recoveredQuery = async (sql, params) => {
  if (sql.startsWith('SELECT id FROM media_assets')) {
    const found = recoveredCache.get(params[1])
    return { rowCount: found ? 1 : 0, rows: found ? [{ id: found }] : [] }
  }
  if (sql.startsWith('INSERT INTO media_assets')) {
    recoveredInserts += 1
    const assetId = `recovered-${recoveredInserts}`
    recoveredCache.set(params[6], assetId)
    return { rowCount: 1, rows: [{ id: assetId }] }
  }
  throw new Error(`Unexpected recovery query: ${sql}`)
}

const recoveringRequest = async (url, options = {}) => {
  if (url === 'https://cdn.example/expired.jpg') {
    return { ok: false, status: 403, contentType: 'text/plain', buffer: Buffer.alloc(0) }
  }
  if (url === 'https://loja.example/produto/novo') {
    return {
      ok: true,
      status: 200,
      url,
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><html><head>
        <meta property="og:type" content="product">
        <meta property="og:title" content="Produto Recuperado">
        <meta property="product:price:amount" content="29.90">
        <meta property="og:image" content="https://cdn.example/fresh.jpg">
      </head><body><h1>Produto Recuperado</h1></body></html>`,
    }
  }
  if (url === 'https://cdn.example/fresh.jpg') {
    assert.equal(options.responseType, 'buffer')
    return { ok: true, status: 200, contentType: 'image/jpeg', buffer: Buffer.from([0xff,0xd8,0xff,0x00]) }
  }
  throw new Error(`Unexpected recovery URL: ${url}`)
}

const recovered = await localizeImportedProductMedia({
  query: recoveredQuery,
  storeId: 'store-2',
  sourceUrl: 'https://loja.example/produto/novo',
  product: {
    name: 'Produto Recuperado',
    sku: '',
    media_url: 'https://cdn.example/expired.jpg',
    media_type: 'image',
    images: ['https://cdn.example/expired.jpg'],
    variant_images: [],
  },
  request: recoveringRequest,
})
assert.equal(recovered.recovered, 1)
assert.equal(recovered.mediaUrl, '/media/recovered-1')
assert.deepEqual(recovered.images, ['/media/recovered-1'])
assert.equal(recoveredInserts, 1)

// A FácilZap expõe imagens novas no DadosProduto mesmo quando o link antigo
// coletado na listagem expirou. Recuperar apenas se SKU ou nome coincidirem.
const facilZapAssets = new Map()
const facilZapQuery = async (sql, params) => {
  if (sql.startsWith('SELECT id FROM media_assets')) {
    const id = facilZapAssets.get(params[1])
    return { rowCount: id ? 1 : 0, rows: id ? [{ id }] : [] }
  }
  if (sql.startsWith('INSERT INTO media_assets')) {
    facilZapAssets.set(params[6], 'facilzap-recovered')
    return { rowCount: 1, rows: [{ id:'facilzap-recovered' }] }
  }
  throw new Error('Unexpected FacilZap SQL')
}
const facilZapRequest = async (url) => {
  if (url === 'https://arquivos.facilzap.app.br/produtos/expirado.webp') {
    return { ok:false, status:403, contentType:'text/html', buffer:Buffer.alloc(0) }
  }
  if (url === 'https://galego.example/produto/123') {
    const data = { id:'123', nome:'Brinco Importado', imagens:['produtos/foto-nova.webp'] }
    return { ok:true,status:200,url,contentType:'text/html',body:
      '<script>const DadosProduto = '+JSON.stringify(data)+';</script>' }
  }
  if (url === 'https://arquivos.facilzap.app.br/produtos/foto-nova.webp') {
    return { ok:true,status:200,contentType:'image/webp',
      buffer:Buffer.from([0x52,0x49,0x46,0x46,0x00,0x00,0x00,0x00,0x57,0x45,0x42,0x50]) }
  }
  throw new Error('Unexpected FacilZap URL: '+url)
}
const facilZapRecovered = await localizeImportedProductMedia({
  query:facilZapQuery,storeId:'store-facilzap',
  sourceUrl:'https://galego.example/produto/123',
  product:{name:'Brinco Importado',sku:'',media_type:'image',
    media_url:'https://arquivos.facilzap.app.br/produtos/expirado.webp',
    images:['https://arquivos.facilzap.app.br/produtos/expirado.webp']},
  request:facilZapRequest,
})
assert.equal(facilZapRecovered.mediaUrl,'/media/facilzap-recovered')
assert.deepEqual(facilZapRecovered.images,['/media/facilzap-recovered'])
assert.ok(facilZapRecovered.failureReasons.some(x=>x.includes('HTTP 403')))

const wrongFacilZap = await localizeImportedProductMedia({
  query:facilZapQuery,storeId:'store-facilzap',
  sourceUrl:'https://galego.example/produto/123',
  product:{name:'Outro Produto',sku:'OUTRO',media_type:'image',
    media_url:'https://arquivos.facilzap.app.br/produtos/expirado.webp',
    images:['https://arquivos.facilzap.app.br/produtos/expirado.webp']},
  request:facilZapRequest,
})
assert.ok(!wrongFacilZap.images.some(isLocalShopvaxMedia),
  'Não associar foto de Brinco Importado a outro produto no fallback')


const sourceGalego = 'https://galego.example/produto/789'
const realGalegoImage = 'https://assets-cdn.facilzap.app.br/produtos/imagens/brinco-inox-original.webp'
const guessedGalegoImage = 'https://arquivos.facilzap.app.br/produtos/brinco-inox-404.webp'
const detailGalegoHtml = `<!doctype html>
  <meta property="og:type" content="product.item">
  <meta property="og:title" content="Brinco Aço Inox">
  <meta property="og:image" content="${realGalegoImage}">
  <script>const DadosProduto = ${JSON.stringify({
    id:'789',nome:'Brinco Aço Inox',imagens:['produtos/brinco-inox-404.webp'],
  })};</script>
  <section class="product-gallery">
    <img src="https://arquivos.facilzap.app.br/produtos/brinco-inox-404.webp"
         data-full="${realGalegoImage}">
  </section>`
const pageRequest = async (url) => url === sourceGalego
  ? {ok:true,status:200,url,contentType:'text/html',body:detailGalegoHtml}
  : url === realGalegoImage
    ? {ok:true,status:200,contentType:'image/webp',buffer:Buffer.from([0x52,0x49,0x46,0x46,0,0,0,0,0x57,0x45,0x42,0x50])}
    : {ok:false,status:404,contentType:'text/html',buffer:Buffer.alloc(0)}
const verifiedGalegoImages = await recoverImportImagesFromSource(sourceGalego, {
  name:'Brinco Aço Inox',sku:'',
},{request:pageRequest})
assert.equal(verifiedGalegoImages[0],realGalegoImage,
  'Prioriza o caminho real da galeria, em vez da URL presumida pelo scanner')
assert.ok(verifiedGalegoImages.includes(guessedGalegoImage))

const galegoMediaCache = new Map()
const galegoQuery = async (sql, params) => {
  if (sql.startsWith('SELECT id FROM media_assets')) {
    const hit=galegoMediaCache.get(params[1])
    return {rowCount:hit?1:0,rows:hit?[{id:hit}]:[]}
  }
  if (sql.startsWith('INSERT INTO media_assets')) {
    galegoMediaCache.set(params[6],'brinco-inox-local')
    return {rowCount:1,rows:[{id:'brinco-inox-local'}]}
  }
  throw Error('Unexpected SQL for verified Galego image: '+sql)
}
const recoveredRealGalego = await localizeImportedProductMedia({
  query:galegoQuery,storeId:'store-galego',
  sourceUrl:sourceGalego,
  product:{name:'Brinco Aço Inox',sku:'',media_type:'image',
    media_url:guessedGalegoImage,images:[guessedGalegoImage],variant_images:[]},
  request:pageRequest,
})
assert.equal(recoveredRealGalego.mediaUrl,'/media/brinco-inox-local')
assert.deepEqual(recoveredRealGalego.images,['/media/brinco-inox-local'])
assert.equal(galegoMediaCache.get(realGalegoImage),'brinco-inox-local')

const mismatchedProductImages = await recoverImportImagesFromSource(sourceGalego,{
  name:'Brinco de Outro Fornecedor',sku:'OUTRO',
},{request:pageRequest})
assert.deepEqual(mismatchedProductImages,[],
  'Nunca aproveitar galeria de página que não pertence ao produto')

const genericHtml = `<!doctype html><html><head>
<script type="application/ld+json">${JSON.stringify({
  '@context':'https://schema.org','@type':'Product',
  name:'Brinco Aço Inox',image:'https://outra-cdn.example/foto-real.jpg',
})}</script>
</head><body><script>const DadosProduto = ${JSON.stringify({
 id:'789',nome:'Brinco Aço Inox',imagens:['produtos/foto-anterior.jpg'],
})};</script></body></html>`
const verifiedMultipleSources = await recoverImportImagesFromSource(sourceGalego,{
 name:'Brinco Aço Inox',sku:'',
},{request:async url=>({ok:true,status:200,url,contentType:'text/html',body:genericHtml})})
assert.ok(verifiedMultipleSources.includes('https://outra-cdn.example/foto-real.jpg'),
  'Não perder a URL real do JSON-LD quando DadosProduto também corresponde')
assert.ok(verifiedMultipleSources.includes('https://arquivos.facilzap.app.br/produtos/foto-anterior.jpg'))

const failed = await localizeImportedProductMedia({
  query: async (sql, params) => {
    if (sql.startsWith('SELECT id FROM media_assets')) return { rowCount: 0, rows: [] }
    throw new Error(`Unexpected query after failed download: ${sql} ${params}`)
  },
  storeId: 'store-3',
  product: { media_url: 'https://cdn.example/broken.jpg', media_type: 'image', images: ['https://cdn.example/broken.jpg'], variant_images: [] },
  request: async () => ({ ok: false, status: 403, contentType: 'text/plain', buffer: Buffer.alloc(0) }),
})
assert.equal(failed.failed, 1)
assert.equal(failed.mediaUrl, 'https://cdn.example/broken.jpg', 'falha sem source_url não deve apagar a referência original')

const manyCache = new Map()
let manyInserts = 0
const manyQuery = async (sql, params) => {
  if (sql.startsWith('SELECT id FROM media_assets')) {
    const found = manyCache.get(params[1])
    return { rowCount: found ? 1 : 0, rows: found ? [{ id: found }] : [] }
  }
  if (sql.startsWith('INSERT INTO media_assets')) {
    manyInserts += 1
    const assetId = `many-${manyInserts}`
    manyCache.set(params[6], assetId)
    return { rowCount: 1, rows: [{ id: assetId }] }
  }
  throw new Error(`Unexpected many-gallery query: ${sql}`)
}
const manyVariantImages = Array.from({ length: 5 }, (_, colorIndex) => ({
  selections: { Cor: `Cor ${colorIndex + 1}` },
  images: Array.from({ length: 10 }, (_, imageIndex) => `https://cdn.example/cor-${colorIndex + 1}-${imageIndex + 1}.jpg`),
}))
const many = await localizeImportedProductMedia({
  query: manyQuery,
  storeId: 'store-many',
  sourceUrl: 'https://loja.example/produto/muitas-cores',
  product: {
    media_url: 'https://cdn.example/base.jpg',
    media_type: 'image',
    images: ['https://cdn.example/base.jpg'],
    variant_images: manyVariantImages,
  },
  request: async () => ({ ok: true, status: 200, contentType: 'image/jpeg', buffer: Buffer.from([0xff,0xd8,0xff,0x00]) }),
})
assert.equal(many.localized, 51, 'produto com muitas cores não deve parar no limite antigo de 40 imagens')
assert.equal(manyInserts, 51)
assert.ok(many.variantImages.every((group) => group.images.length === 10 && group.images.every(isLocalShopvaxMedia)))

console.log('[import media localizer] remote images are copied into Shopvax media storage: ok')
