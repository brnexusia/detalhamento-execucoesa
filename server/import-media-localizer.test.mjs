import assert from 'node:assert/strict'
import { fetchImportImage, isLocalShopvaxMedia, localizeImportedProductMedia } from './import-media-localizer.mjs'

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

const failed = await localizeImportedProductMedia({
  query: async (sql, params) => {
    if (sql.startsWith('SELECT id FROM media_assets')) return { rowCount: 0, rows: [] }
    throw new Error(`Unexpected query after failed download: ${sql} ${params}`)
  },
  storeId: 'store-2',
  product: { media_url: 'https://cdn.example/broken.jpg', media_type: 'image', images: ['https://cdn.example/broken.jpg'], variant_images: [] },
  request: async () => ({ ok: false, status: 403, contentType: 'text/plain', buffer: Buffer.alloc(0) }),
})
assert.equal(failed.failed, 1)
assert.equal(failed.mediaUrl, 'https://cdn.example/broken.jpg', 'falha de cópia não deve apagar a referência original')

console.log('[import media localizer] remote images are copied into Shopvax media storage: ok')
